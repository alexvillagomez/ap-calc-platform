import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { computeNextReviewDate } from "@/lib/practiceAlgorithm";
import {
  updateMasteryMap,
  isMastered,
  difficultyTierFromScore,
  MASTERY_START,
  updatedFloor,
  FLOOR_START,
  FLOOR_SPACED_MIN_MS,
} from "@/lib/courseEngine/adaptive";
import {
  autoResolvePriorities,
  logServerEvent,
} from "@/lib/priorities";
import { getAuthUid } from "@/lib/supabaseServer";

export const runtime = "nodejs";

// Post-refresher dampening: when a student used a refresher/hint on THIS question
// immediately before answering, a correct answer earns only partial mastery
// credit (Task 4 rule: a correct answer right after a quick refresher must have a
// reduced — effectively negative-vs-clean — effect on weights). The positive EMA
// delta is multiplied by this factor and the answer never counts toward the clean
// consecutive_correct streak that drives mastery.
const REFRESHER_CREDIT_FACTOR = 0.4;

// Wrong-answer-driven (distractor-specific) weighting — see math/attempt/route.ts
// for the full rationale. The chosen distractor's misconception keyword_weights
// (mcat_questions.wrong_answer_data, aligned to choices) are shifted toward the
// misconception by up to ~20% (scaled by weight): score → score·(1−0.20·w).
// Fail-soft: questions without wrong_answer_data keep the old generic behavior.
const DISTRACTOR_WRONG_SHIFT = 0.20;

type WrongAnswerEntry = {
  description?: string | null;
  embedding?: number[] | null;
  keyword_weights?: Record<string, number> | null;
} | null;

function selectedDistractorWeights(
  wrongAnswerData: unknown,
  selectedIndex: number | undefined,
  wasCorrect: boolean
): Record<string, number> {
  if (wasCorrect || selectedIndex == null) return {};
  if (!Array.isArray(wrongAnswerData)) return {};
  const entry = wrongAnswerData[selectedIndex] as WrongAnswerEntry;
  const w = entry?.keyword_weights;
  if (!w || typeof w !== "object") return {};
  const out: Record<string, number> = {};
  for (const [id, val] of Object.entries(w)) {
    const num = typeof val === "number" ? val : Number(val);
    if (Number.isFinite(num) && num > 0) out[id] = Math.min(1, num);
  }
  return out;
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as {
    session_id?: string;
    question_id?: string;
    selected_index?: number;
    dont_know?: boolean;
    context?: "practice" | "quiz";
    usedRefresher?: boolean;
    usedHint?: boolean;
  };

  const {
    session_id,
    question_id,
    selected_index,
    dont_know = false,
    context = "practice",
  } = body;
  // Treat a hint the same as a refresher for dampening purposes.
  const usedRefresher = body.usedRefresher === true || body.usedHint === true;

  if (!session_id || !question_id) {
    return NextResponse.json(
      { error: "session_id and question_id are required" },
      { status: 400 }
    );
  }

  if (!dont_know && typeof selected_index !== "number") {
    return NextResponse.json(
      { error: "selected_index is required when dont_know is false" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // Load question (wrong_answer_data carries per-distractor misconception weights)
  const { data: question, error: questionError } = await supabase
    .from("mcat_questions")
    .select("correct_index, keyword_weights, category_id, wrong_answer_data, difficulty")
    .eq("id", question_id)
    .maybeSingle();

  if (questionError || !question) {
    return NextResponse.json(
      { error: "Question not found" },
      { status: 404 }
    );
  }

  const correct = dont_know
    ? false
    : selected_index === (question.correct_index as number);

  const responseType: "answered" | "dont_know" = dont_know
    ? "dont_know"
    : "answered";

  // Insert attempt
  await supabase.from("mcat_question_attempts").insert({
    session_id,
    question_id,
    selected_index: dont_know ? null : (selected_index ?? null),
    correct,
    response_type: responseType,
    context,
  });

  const keywordWeights =
    (question.keyword_weights as Record<string, number>) ?? {};
  // The selected distractor's misconception keywords (empty if correct / no data).
  const distractorWeights = selectedDistractorWeights(
    question.wrong_answer_data,
    selected_index,
    correct
  );
  // Union of the question's keywords and the chosen distractor's keywords.
  const kwIds = [
    ...new Set([...Object.keys(keywordWeights), ...Object.keys(distractorWeights)]),
  ];

  if (kwIds.length === 0) {
    return NextResponse.json({
      correct,
      correct_index: question.correct_index as number,
      keyword_states: {},
    });
  }

  // Validate keyword ids exist in mcat_keywords (skip any that don't — FK safety)
  const { data: validKws } = await supabase
    .from("mcat_keywords")
    .select("id, category_id")
    .in("id", kwIds);

  const validKwSet = new Set((validKws ?? []).map((k) => k.id as string));
  const kwToCat = new Map(
    (validKws ?? []).map((k) => [k.id as string, k.category_id as string])
  );

  const filteredWeights = Object.fromEntries(
    Object.entries(keywordWeights).filter(([id]) => validKwSet.has(id))
  );
  const filteredDistractorWeights = Object.fromEntries(
    Object.entries(distractorWeights).filter(([id]) => validKwSet.has(id))
  );

  // Every keyword we'll write a state for: question keywords ∪ distractor keywords.
  const targetKwIds = [
    ...new Set([
      ...Object.keys(filteredWeights),
      ...Object.keys(filteredDistractorWeights),
    ]),
  ];

  if (targetKwIds.length === 0) {
    return NextResponse.json({
      correct,
      correct_index: question.correct_index as number,
      keyword_states: {},
    });
  }

  // Load current states (include last_review_at for floor spacing calculation)
  const { data: existingStates } = await supabase
    .from("mcat_student_keyword_states")
    .select(
      "keyword_id, score, total_attempts, correct_attempts, consecutive_correct, dont_know_count, state, spaced_review_due_at, spaced_review_count, floor, last_review_at"
    )
    .eq("session_id", session_id)
    .in("keyword_id", targetKwIds);

  const existingMap = new Map(
    (existingStates ?? []).map((s) => [s.keyword_id as string, s])
  );

  // Build current strengths map over the union of keywords
  const currentStrengths: Record<string, number> = Object.fromEntries(
    targetKwIds.map((id) => [
      id,
      (existingMap.get(id)?.score as number) ?? MASTERY_START,
    ])
  );

  // Logarithmic, context-aware mastery update (lib/courseEngine/adaptive.ts).
  // Source = question; difficulty tier from the stored 0–1 difficulty; dont_know
  // applies a small downgrade inside the update.
  const difficultyTier = difficultyTierFromScore(question.difficulty as number);
  let newStrengths = updateMasteryMap(currentStrengths, filteredWeights, {
    correct,
    dontKnow: dont_know,
    difficulty: difficultyTier,
    source: "question",
  });

  // Post-refresher dampening: scale down only the positive gain of a correct
  // answer. Wrong answers and dont_know are unaffected (they already hurt).
  if (usedRefresher && correct) {
    const dampened: Record<string, number> = { ...newStrengths };
    for (const id of Object.keys(filteredWeights)) {
      const before = currentStrengths[id] ?? 0.5;
      const after = newStrengths[id] ?? before;
      const gain = after - before;
      if (gain > 0) dampened[id] = before + gain * REFRESHER_CREDIT_FACTOR;
    }
    newStrengths = dampened;
  }

  // Wrong-answer-driven shift: pull the chosen distractor's misconception keywords
  // toward the misconception (~20% scaled by the distractor's weight).
  if (!correct && Object.keys(filteredDistractorWeights).length > 0) {
    const shifted: Record<string, number> = { ...newStrengths };
    for (const [id, w] of Object.entries(filteredDistractorWeights)) {
      const base = shifted[id] ?? currentStrengths[id] ?? 0.5;
      shifted[id] = Math.max(0, base * (1 - DISTRACTOR_WRONG_SHIFT * w));
    }
    newStrengths = shifted;
  }

  const now = new Date().toISOString();
  const upserts = targetKwIds.map((kwId) => {
    const prev = existingMap.get(kwId);
    const prevTotal = (prev?.total_attempts as number) ?? 0;
    const prevCorrect = (prev?.correct_attempts as number) ?? 0;
    const prevConsecutive = (prev?.consecutive_correct as number) ?? 0;
    const prevDontKnow = (prev?.dont_know_count as number) ?? 0;
    const prevState = (prev?.state as string) ?? null;
    const prevSpacedReviewCount = (prev?.spaced_review_count as number) ?? 0;
    const prevSpacedReviewDueAt = (prev?.spaced_review_due_at as string) ?? null;
    const prevFloor = (prev?.floor as number) ?? FLOOR_START;
    const prevLastReviewAt = (prev?.last_review_at as string | null | undefined) ?? null;
    const nowMs = new Date(now).getTime();
    const elapsedMs = prevLastReviewAt
      ? Math.max(0, nowMs - new Date(prevLastReviewAt).getTime())
      : 0;

    const totalAttempts = prevTotal + 1;
    const correctAttempts = prevCorrect + (correct ? 1 : 0);
    // A refresher-assisted correct does not advance the clean mastery streak
    // (but it doesn't reset it either — the student still got it right).
    const consecutiveCorrect = correct
      ? usedRefresher
        ? prevConsecutive
        : prevConsecutive + 1
      : 0;
    const dontKnowCount = prevDontKnow + (dont_know ? 1 : 0);

    const score = Math.min(1, Math.max(0, newStrengths[kwId] ?? 0.5));

    // ── State machine ──────────────────────────────────────────────────────
    let state: string;
    let spacedReviewDueAt: string | null = prevSpacedReviewDueAt;
    let spacedReviewCount = prevSpacedReviewCount;

    // THRESHOLD-based mastery — no consecutive-correct gate (score ≥ MASTERY_ADVANCE).
    const masteryMet = isMastered(score);
    const wasAlreadyMastered = prevState === "mastered";

    if (masteryMet && !wasAlreadyMastered) {
      // First time mastery
      state = "mastered";
      const nextReview = computeNextReviewDate(score, spacedReviewCount);
      spacedReviewDueAt = nextReview.toISOString();
      spacedReviewCount = spacedReviewCount + 1;
    } else if (wasAlreadyMastered) {
      // Already mastered — keep mastered, reschedule
      state = "mastered";
      const nextReview = computeNextReviewDate(score, spacedReviewCount);
      spacedReviewDueAt = nextReview.toISOString();
      spacedReviewCount = spacedReviewCount + 1;
    } else if (dont_know || (score < 0.35 && totalAttempts >= 3)) {
      // Struggling or explicitly don't know
      state = "needs_lesson";
    } else {
      state = "in_progress";
    }

    return {
      session_id,
      keyword_id: kwId,
      category_id: kwToCat.get(kwId) ?? (question.category_id as string),
      score,
      total_attempts: totalAttempts,
      correct_attempts: correctAttempts,
      consecutive_correct: consecutiveCorrect,
      dont_know_count: dontKnowCount,
      state,
      spaced_review_due_at: spacedReviewDueAt,
      spaced_review_count: spacedReviewCount,
      last_practiced_at: now,
      last_review_at: now,
      // v2: compute the rising floor based on spacing since last review.
      floor: updatedFloor(prevFloor, correct, dont_know, elapsedMs, FLOOR_SPACED_MIN_MS),
      updated_at: now,
    };
  });

  const { error: upsertError } = await supabase
    .from("mcat_student_keyword_states")
    .upsert(upserts, { onConflict: "session_id,keyword_id" });

  if (upsertError) {
    console.error(
      "mcat/attempt: failed to upsert keyword states",
      upsertError.message
    );
  }

  // ── Priority auto-resolve + server-side answer metric (best-effort) ─────────
  // Top keyword = highest weight on this question (for telemetry + user id).
  const topKeywordId =
    Object.entries(filteredWeights).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // Prefer the verified Supabase auth uid; fall back to the lodera_uid cookie for
  // sessions that pre-date the Supabase Auth migration (anonymous / legacy).
  const userId =
    (await getAuthUid()) ??
    (await cookies()).get("lodera_uid")?.value ??
    null;

  // Auto-resolve any active priority whose target_score is now met.
  const newScoreByKeyword = new Map(upserts.map((u) => [u.keyword_id, u.score]));
  const resolved = await autoResolvePriorities(
    supabase,
    session_id,
    "mcat",
    newScoreByKeyword
  );
  for (const kid of resolved) {
    await logServerEvent(supabase, {
      event_type: "prioritize_resolved",
      system: "mcat",
      session_id,
      user_id: userId,
      keyword_id: kid,
      metadata: { score: newScoreByKeyword.get(kid) ?? null },
    });
  }

  // Server-side answer metric.
  await logServerEvent(supabase, {
    event_type: "answer",
    system: "mcat",
    session_id,
    user_id: userId,
    keyword_id: topKeywordId,
    question_id,
    content_type: "question",
    correct,
    metadata: { usedRefresher, dont_know },
  });

  const keyword_states: Record<
    string,
    { score: number; state: string; needs_lesson: boolean }
  > = Object.fromEntries(
    upserts.map((u) => [
      u.keyword_id,
      {
        score: u.score,
        state: u.state,
        needs_lesson: u.state === "needs_lesson",
      },
    ])
  );

  return NextResponse.json({
    correct,
    correct_index: question.correct_index as number,
    keyword_states,
  });
}
