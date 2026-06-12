/**
 * POST /api/math/attempt
 *
 * Record a student's answer to a math question.
 * - Inserts into math_question_attempts.
 * - EMA-updates math_student_keyword_states (learning rate 0.12, same as MCAT).
 * - State machine: mastered (score ≥ 0.8 AND consecutive_correct ≥ 4),
 *   needs_lesson (dont_know OR score < 0.35 after ≥ 3 attempts), in_progress otherwise.
 * - Sets course on states (passed in body; defaults to "precalc").
 * - Returns keyword_states + needs_lesson flag.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateStrengths, computeNextReviewDate } from "@/lib/practiceAlgorithm";
import type { MathCourse } from "@/lib/mathTypes";

export const runtime = "nodejs";

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
    course?: MathCourse;
  };

  const {
    session_id,
    question_id,
    selected_index,
    dont_know = false,
    context = "practice",
  } = body;
  const course: MathCourse = body.course ?? "precalc";

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

  // Load question
  const { data: question, error: questionError } = await supabase
    .from("math_questions")
    .select("correct_index, keyword_weights, category_id")
    .eq("id", question_id)
    .maybeSingle();

  if (questionError || !question) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const correct = dont_know
    ? false
    : selected_index === (question.correct_index as number);

  const responseType: "answered" | "dont_know" = dont_know
    ? "dont_know"
    : "answered";

  // Insert attempt
  await supabase.from("math_question_attempts").insert({
    session_id,
    question_id,
    selected_index: dont_know ? null : (selected_index ?? null),
    correct,
    response_type: responseType,
    context,
  });

  const keywordWeights =
    (question.keyword_weights as Record<string, number>) ?? {};
  const kwIds = Object.keys(keywordWeights);

  if (kwIds.length === 0) {
    return NextResponse.json({
      correct,
      correct_index: question.correct_index as number,
      keyword_states: {},
    });
  }

  // Validate keyword ids exist in math_keywords (FK safety)
  const { data: validKws } = await supabase
    .from("math_keywords")
    .select("id, category_id")
    .in("id", kwIds);

  const validKwSet = new Set((validKws ?? []).map((k) => k.id as string));
  const kwToCat = new Map(
    (validKws ?? []).map((k) => [k.id as string, k.category_id as string])
  );

  const filteredWeights = Object.fromEntries(
    Object.entries(keywordWeights).filter(([id]) => validKwSet.has(id))
  );

  if (Object.keys(filteredWeights).length === 0) {
    return NextResponse.json({
      correct,
      correct_index: question.correct_index as number,
      keyword_states: {},
    });
  }

  // Load current states
  const { data: existingStates } = await supabase
    .from("math_student_keyword_states")
    .select(
      "keyword_id, score, total_attempts, correct_attempts, consecutive_correct, dont_know_count, state, spaced_review_due_at, spaced_review_count"
    )
    .eq("session_id", session_id)
    .in("keyword_id", Object.keys(filteredWeights));

  const existingMap = new Map(
    (existingStates ?? []).map((s) => [s.keyword_id as string, s])
  );

  // EMA update (learning rate 0.12 — same as MCAT)
  const currentStrengths: Record<string, number> = Object.fromEntries(
    Object.keys(filteredWeights).map((id) => [
      id,
      (existingMap.get(id)?.score as number) ?? 0.5,
    ])
  );

  const newStrengths = updateStrengths(currentStrengths, filteredWeights, correct);

  const now = new Date().toISOString();
  const upserts = Object.keys(filteredWeights).map((kwId) => {
    const prev = existingMap.get(kwId);
    const prevTotal = (prev?.total_attempts as number) ?? 0;
    const prevCorrect = (prev?.correct_attempts as number) ?? 0;
    const prevConsecutive = (prev?.consecutive_correct as number) ?? 0;
    const prevDontKnow = (prev?.dont_know_count as number) ?? 0;
    const prevState = (prev?.state as string) ?? null;
    const prevSpacedReviewCount = (prev?.spaced_review_count as number) ?? 0;
    const prevSpacedReviewDueAt = (prev?.spaced_review_due_at as string) ?? null;

    const totalAttempts = prevTotal + 1;
    const correctAttempts = prevCorrect + (correct ? 1 : 0);
    const consecutiveCorrect = correct ? prevConsecutive + 1 : 0;
    const dontKnowCount = prevDontKnow + (dont_know ? 1 : 0);

    const score = Math.min(1, Math.max(0, newStrengths[kwId] ?? 0.5));

    // ── State machine ──────────────────────────────────────────────────────
    let state: string;
    let spacedReviewDueAt: string | null = prevSpacedReviewDueAt;
    let spacedReviewCount = prevSpacedReviewCount;

    const masteryMet = score >= 0.8 && consecutiveCorrect >= 4;
    const wasAlreadyMastered = prevState === "mastered";

    if (masteryMet && !wasAlreadyMastered) {
      state = "mastered";
      const nextReview = computeNextReviewDate(score, spacedReviewCount);
      spacedReviewDueAt = nextReview.toISOString();
      spacedReviewCount = spacedReviewCount + 1;
    } else if (wasAlreadyMastered) {
      state = "mastered";
      const nextReview = computeNextReviewDate(score, spacedReviewCount);
      spacedReviewDueAt = nextReview.toISOString();
      spacedReviewCount = spacedReviewCount + 1;
    } else if (dont_know || (score < 0.35 && totalAttempts >= 3)) {
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
      course,
      last_practiced_at: now,
      updated_at: now,
    };
  });

  const { error: upsertError } = await supabase
    .from("math_student_keyword_states")
    .upsert(upserts, { onConflict: "session_id,keyword_id" });

  if (upsertError) {
    console.error(
      "math/attempt: failed to upsert keyword states",
      upsertError.message
    );
  }

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
