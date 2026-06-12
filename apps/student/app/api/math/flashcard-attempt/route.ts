/**
 * POST /api/math/flashcard-attempt
 *
 * Record a student's flashcard result.
 * - Inserts into math_flashcard_attempts.
 * - EMA-updates math_student_keyword_states (same constants as MCAT).
 * - Returns keyword_states.
 *
 * Body: { session_id, flashcard_id, result: "got_it" | "missed_it" | "dont_know", course? }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateStrengths } from "@/lib/practiceAlgorithm";
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
    flashcard_id?: string;
    result?: "got_it" | "missed_it" | "dont_know";
    course?: MathCourse;
  };

  const { session_id, flashcard_id, result } = body;
  const course: MathCourse = body.course ?? "precalc";

  if (!session_id || !flashcard_id || !result) {
    return NextResponse.json(
      { error: "session_id, flashcard_id, and result are required" },
      { status: 400 }
    );
  }

  const validResults = ["got_it", "missed_it", "dont_know"];
  if (!validResults.includes(result)) {
    return NextResponse.json(
      { error: "result must be one of: got_it, missed_it, dont_know" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // Load flashcard
  const { data: flashcard, error: fcError } = await supabase
    .from("math_flashcards")
    .select("keyword_weights, category_id")
    .eq("id", flashcard_id)
    .maybeSingle();

  if (fcError || !flashcard) {
    return NextResponse.json({ error: "Flashcard not found" }, { status: 404 });
  }

  const correct = result === "got_it";
  const isDontKnow = result === "dont_know";

  // Insert attempt
  await supabase.from("math_flashcard_attempts").insert({
    session_id,
    flashcard_id,
    result,
  });

  const keywordWeights =
    (flashcard.keyword_weights as Record<string, number>) ?? {};
  const kwIds = Object.keys(keywordWeights);

  if (kwIds.length === 0) {
    return NextResponse.json({ keyword_states: {} });
  }

  // Validate keyword ids
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
    return NextResponse.json({ keyword_states: {} });
  }

  // Load current states
  const { data: existingStates } = await supabase
    .from("math_student_keyword_states")
    .select(
      "keyword_id, score, total_attempts, correct_attempts, consecutive_correct, dont_know_count, state"
    )
    .eq("session_id", session_id)
    .in("keyword_id", Object.keys(filteredWeights));

  const existingMap = new Map(
    (existingStates ?? []).map((s) => [s.keyword_id as string, s])
  );

  const currentStrengths: Record<string, number> = Object.fromEntries(
    Object.keys(filteredWeights).map((id) => [
      id,
      (existingMap.get(id)?.score as number) ?? 0.5,
    ])
  );

  // EMA update — got_it = correct; missed_it and dont_know = incorrect
  const newStrengths = updateStrengths(currentStrengths, filteredWeights, correct);

  const now = new Date().toISOString();
  const upserts = Object.keys(filteredWeights).map((kwId) => {
    const prev = existingMap.get(kwId);
    const prevTotal = (prev?.total_attempts as number) ?? 0;
    const prevCorrect = (prev?.correct_attempts as number) ?? 0;
    const prevConsecutive = (prev?.consecutive_correct as number) ?? 0;
    const prevDontKnow = (prev?.dont_know_count as number) ?? 0;

    const totalAttempts = prevTotal + 1;
    const correctAttempts = prevCorrect + (correct ? 1 : 0);
    const consecutiveCorrect = correct ? prevConsecutive + 1 : 0;
    const dontKnowCount = prevDontKnow + (isDontKnow ? 1 : 0);

    const score = Math.min(1, Math.max(0, newStrengths[kwId] ?? 0.5));
    const state: "mastered" | "in_progress" =
      score >= 0.8 && consecutiveCorrect >= 4 ? "mastered" : "in_progress";

    return {
      session_id,
      keyword_id: kwId,
      category_id: kwToCat.get(kwId) ?? (flashcard.category_id as string),
      score,
      total_attempts: totalAttempts,
      correct_attempts: correctAttempts,
      consecutive_correct: consecutiveCorrect,
      dont_know_count: dontKnowCount,
      state,
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
      "math/flashcard-attempt: failed to upsert keyword states",
      upsertError.message
    );
  }

  const keyword_states: Record<string, { score: number; state: string }> =
    Object.fromEntries(
      upserts.map((u) => [u.keyword_id, { score: u.score, state: u.state }])
    );

  return NextResponse.json({ keyword_states });
}
