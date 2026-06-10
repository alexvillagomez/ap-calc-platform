import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeDifficulty } from "@/lib/practiceAlgorithm";

export const runtime = "nodejs";

interface AttemptBody {
  sessionId: string;
  correct: boolean;
  topicId: string;
  keywordStrengths: Record<string, number>;
  touchedIds: string[];
  /** rag_examples row id — present when sent by the demo page for difficulty calibration. */
  problemId?: string;
  /** keyword_weights of the answered problem — used to compute student skill for IRT-EMA. */
  keywordWeights?: Record<string, number>;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const body = (await req.json()) as AttemptBody;
  const { sessionId, correct, topicId, keywordStrengths, touchedIds, problemId, keywordWeights } = body;

  if (!sessionId || !touchedIds?.length) return NextResponse.json({ ok: true });

  // The same keyword id can appear in more than one weight dimension (e.g. "verbal"
  // shows up in both keyword_weights and action_weights) — dedupe so the upsert below
  // never targets the same (session_id, keyword_id) row twice in one statement, which
  // Postgres rejects with "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const uniqueTouchedIds = [...new Set(touchedIds)];

  const supabase = createClient(supabaseUrl, key);

  // Fetch existing states for touched keywords so we can carry forward attempt counts
  const { data: existing } = await supabase
    .from("learn_student_keyword_states")
    .select("keyword_id, total_attempts, correct_attempts, consecutive_correct, state")
    .eq("session_id", sessionId)
    .in("keyword_id", uniqueTouchedIds);

  const existingMap = new Map((existing ?? []).map((r) => [r.keyword_id as string, r]));

  const upserts = uniqueTouchedIds.map((keyword_id) => {
    const prev = existingMap.get(keyword_id);
    const totalAttempts = (prev?.total_attempts ?? 0) + 1;
    const correctAttempts = (prev?.correct_attempts ?? 0) + (correct ? 1 : 0);
    const consecutiveCorrect = correct ? (prev?.consecutive_correct ?? 0) + 1 : 0;
    const strength = Math.min(1, Math.max(0, Math.round((keywordStrengths[keyword_id] ?? 0.5) * 1000) / 1000));

    let state = prev?.state ?? "needs_practice";
    if (strength >= 0.8 && consecutiveCorrect >= 4) state = "mastered";
    else if (strength >= 0.6) state = "in_progress";
    else if (strength < 0.35 && totalAttempts >= 2) state = "needs_lesson";
    else if (state === "needs_practice") state = "in_progress";

    return {
      session_id: sessionId,
      keyword_id,
      topic_id: topicId,
      in_depth_score: strength,
      umbrella_score: strength,
      consecutive_correct: consecutiveCorrect,
      total_attempts: totalAttempts,
      correct_attempts: correctAttempts,
      state,
      last_practiced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  const { error: upsertError } = await supabase
    .from("learn_student_keyword_states")
    .upsert(upserts, { onConflict: "session_id,keyword_id" });

  if (upsertError) {
    console.error("demo/attempt: failed to upsert learn_student_keyword_states for session", sessionId, upsertError.message);
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  // ── Record attempt in student_problem_attempts ────────────────────────────
  // This lets seen-problems deduplicate across page reloads. The demo serves
  // rag_examples IDs which have no FK row in problems, so a 23503 violation is
  // expected and silently ignored.
  if (problemId) {
    const { error: attemptError } = await supabase
      .from("student_problem_attempts")
      .upsert(
        { session_id: sessionId, problem_id: problemId, correct },
        { onConflict: "session_id,problem_id" }
      );
    if (attemptError && (attemptError as { code?: string }).code !== "23503") {
      // Log unexpected errors but don't fail the whole request — keyword state
      // updates above already succeeded and are the source of truth.
      console.warn("demo/attempt: student_problem_attempts upsert failed", attemptError.message);
    }
  }

  // ── IRT-EMA difficulty calibration for rag_examples ───────────────────────
  // Mirror the same calibration logic used in record-attempt so that problems
  // served exclusively through the demo path (which never hit record-attempt)
  // still converge toward their true difficulty over time.
  if (problemId && keywordWeights && Object.keys(keywordWeights).length > 0) {
    try {
      const { data: ragRow } = await supabase
        .from("rag_examples")
        .select("difficulty, estimated_difficulty")
        .eq("id", problemId)
        .maybeSingle();

      if (ragRow) {
        // Compute weighted-average student skill for this problem's keyword coverage.
        // keywordStrengths is already the post-update value sent by the client;
        // the pre-update value isn't available here, so we use it as a proxy
        // (it's close enough over a 20-question diagnostic).
        const kw = keywordWeights as Record<string, number>;
        let totalWeight = 0;
        let weightedStrength = 0;
        for (const [id, w] of Object.entries(kw)) {
          if (w > 0) {
            weightedStrength += (keywordStrengths[id] ?? 0.5) * w;
            totalWeight += w;
          }
        }
        const studentSkill = totalWeight > 0 ? weightedStrength / totalWeight : 0.5;

        // ±0.05 nudge keeps convergence slow/accurate (same as record-attempt).
        const target = correct ? studentSkill - 0.05 : studentSkill + 0.05;
        const rawDiff = (ragRow as { difficulty: number | null }).difficulty ?? 3;
        const seed = (ragRow as { estimated_difficulty: number | null }).estimated_difficulty
          ?? normalizeDifficulty(rawDiff);
        const newEstimated = Math.max(0, Math.min(1, seed + 0.15 * (target - seed)));

        await supabase
          .from("rag_examples")
          .update({ estimated_difficulty: newEstimated })
          .eq("id", problemId);
      }
    } catch (err) {
      // Non-fatal — keyword state updates above already succeeded.
      console.warn("demo/attempt: rag_examples calibration failed", err);
    }
  }

  return NextResponse.json({ ok: true });
}
