import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateScores } from "@/lib/diagnosticScoring";
import { computeNextReviewDate } from "@/lib/practiceAlgorithm";

const ALPHA_CORRECT = 0.25;
const ALPHA_WRONG = 0.20;

// Suppress unused var warnings — these document the intent even though
// the actual EMA update logic lives in diagnosticScoring.ts
void ALPHA_CORRECT;
void ALPHA_WRONG;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, key);

  const body = (await request.json()) as {
    sessionId: string;
    keyword_id: string;
    topic_id: string;
    correct: boolean;
    time_spent_ms?: number;
    hint_used?: boolean;
  };

  const { sessionId, keyword_id, topic_id, correct, time_spent_ms, hint_used = false } = body;

  if (!sessionId || !keyword_id || typeof correct !== "boolean") {
    return NextResponse.json({ error: "sessionId, keyword_id, correct required" }, { status: 400 });
  }

  // Load current state
  const { data: existing } = await supabase
    .from("learn_student_keyword_states")
    .select(
      "umbrella_score, in_depth_score, consecutive_correct, total_attempts, correct_attempts, state, spaced_review_due_at, spaced_review_count, avg_response_ms, fast_correct_count, hint_used_count"
    )
    .eq("session_id", sessionId)
    .eq("keyword_id", keyword_id)
    .maybeSingle();

  const prev = existing ?? {
    umbrella_score: 0.5,
    in_depth_score: 0.5,
    consecutive_correct: 0,
    total_attempts: 0,
    correct_attempts: 0,
    state: "needs_practice",
    spaced_review_due_at: null,
    spaced_review_count: 0,
    avg_response_ms: null,
    fast_correct_count: 0,
    hint_used_count: 0,
  };

  // Time-weighted EMA multiplier
  // Fast correct (<8s) = confident → stronger update. Slow correct (>30s) = guessing → weaker.
  // Fast wrong (<5s) = confident misconception → stronger penalty. Hint used = partial credit.
  let emaMultiplier = 1.0;
  if (time_spent_ms !== undefined) {
    if (correct) {
      if (time_spent_ms < 8000) emaMultiplier = 1.3;       // fast correct: confident mastery
      else if (time_spent_ms > 30000) emaMultiplier = 0.7; // slow correct: might be guessing
    } else {
      if (time_spent_ms < 5000) emaMultiplier = 1.2;       // fast wrong: confident misconception
    }
  }
  if (hint_used && correct) emaMultiplier = Math.min(emaMultiplier, 0.5); // hint used: partial credit

  // Apply multiplier by temporarily scaling the weight
  const scaledKwWeight = { [keyword_id]: emaMultiplier };
  const scaledUmbrellaWeight = { [topic_id]: emaMultiplier };

  // Update EMA scores
  const newInDepthScores = updateScores({ [keyword_id]: prev.in_depth_score }, scaledKwWeight, correct);
  const newUmbrellaScores = updateScores({ [topic_id]: prev.umbrella_score }, scaledUmbrellaWeight, correct);

  const newConsecutiveCorrect = correct ? prev.consecutive_correct + 1 : 0;
  const newTotalAttempts = prev.total_attempts + 1;
  const newCorrectAttempts = prev.correct_attempts + (correct ? 1 : 0);

  const newInDepth = newInDepthScores[keyword_id] ?? 0.5;

  // ── Mastery & spaced-review check ─────────────────────────────────────────
  // Mastery gate: in_depth_score >= 0.8 AND consecutive_correct >= 4
  const masteryMet = newInDepth >= 0.8 && newConsecutiveCorrect >= 4;

  // Also check if we were already in spaced_review phase (state = 'mastered')
  // and this is a review session — update the next review date accordingly.
  const wasAlreadyMastered = prev.state === "mastered";

  let newState = prev.state as string;
  let newSpacedReviewDueAt: string | null = prev.spaced_review_due_at;
  let newSpacedReviewCount = prev.spaced_review_count ?? 0;

  if (masteryMet && !wasAlreadyMastered) {
    // First time hitting mastery: mark as mastered and schedule first spaced review
    newState = "mastered";
    newSpacedReviewCount = 0;
    const nextReview = computeNextReviewDate(newInDepth, newSpacedReviewCount);
    newSpacedReviewDueAt = nextReview.toISOString();
    newSpacedReviewCount = 1;
  } else if (wasAlreadyMastered) {
    // Already mastered — this is a spaced review. Schedule the next one.
    const nextReview = computeNextReviewDate(newInDepth, newSpacedReviewCount);
    newSpacedReviewDueAt = nextReview.toISOString();
    newSpacedReviewCount = newSpacedReviewCount + 1;
    newState = "mastered"; // keep mastered
  } else if (newInDepth >= 0.85 && newConsecutiveCorrect >= 3) {
    newState = "in_progress"; // ready for mastery quiz
  } else if (newInDepth < 0.35 && newTotalAttempts >= 3) {
    newState = "needs_lesson"; // struggling too much
  } else if (newState === "needs_practice" || newState === "") {
    newState = "in_progress";
  }

  // Update rolling avg_response_ms (exponential moving average, α=0.3)
  const prevAvgMs = (prev.avg_response_ms as number | null) ?? null;
  const newAvgMs = time_spent_ms !== undefined
    ? prevAvgMs !== null
      ? Math.round(prevAvgMs * 0.7 + time_spent_ms * 0.3)
      : time_spent_ms
    : prevAvgMs;

  const newFastCorrectCount = (prev.fast_correct_count as number ?? 0)
    + (correct && time_spent_ms !== undefined && time_spent_ms < 8000 ? 1 : 0);
  const newHintUsedCount = (prev.hint_used_count as number ?? 0) + (hint_used ? 1 : 0);

  await supabase
    .from("learn_student_keyword_states")
    .upsert(
      {
        session_id: sessionId,
        keyword_id,
        topic_id,
        state: newState,
        umbrella_score: Math.min(1, Math.max(0, newUmbrellaScores[topic_id] ?? 0.5)),
        in_depth_score: Math.min(1, Math.max(0, newInDepth)),
        consecutive_correct: newConsecutiveCorrect,
        total_attempts: newTotalAttempts,
        correct_attempts: newCorrectAttempts,
        spaced_review_due_at: newSpacedReviewDueAt,
        spaced_review_count: newSpacedReviewCount,
        avg_response_ms: newAvgMs,
        fast_correct_count: newFastCorrectCount,
        hint_used_count: newHintUsedCount,
        last_practiced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id,keyword_id" }
    );

  return NextResponse.json({
    state: newState,
    in_depth_score: newInDepth,
    consecutive_correct: newConsecutiveCorrect,
    show_tip: !correct && (newTotalAttempts - newCorrectAttempts) >= 2,
    offer_mastery_quiz: newState === "in_progress",
    mastery_achieved: masteryMet && !wasAlreadyMastered,
    spaced_review_due_at: newSpacedReviewDueAt,
  });
}
