import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateStrengths, computeStudentSkill } from "@/lib/practiceAlgorithm";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await request.json()) as {
    sessionId?: string;
    problemId?: string;
    selectedIndex?: number;
    correct?: boolean;
    topicWeights?: Record<string, number>;
    rating?: number | null;
  };

  const { sessionId, problemId, selectedIndex, correct, topicWeights, rating } = body;

  if (!sessionId || !problemId || typeof selectedIndex !== "number" || typeof correct !== "boolean") {
    return NextResponse.json({ error: "sessionId, problemId, selectedIndex, correct are required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Record the attempt (ignore conflict — could be a retry)
  const { error: attemptError } = await supabase
    .from("student_problem_attempts")
    .upsert(
      { session_id: sessionId, problem_id: problemId, selected_index: selectedIndex, correct, rating: rating ?? null },
      { onConflict: "session_id,problem_id" }
    );

  if (attemptError) {
    console.error("record-attempt: upsert error", attemptError.message);
    return NextResponse.json({ error: attemptError.message }, { status: 500 });
  }

  // Update strengths in the session and calibrate estimated_difficulty
  if (topicWeights && typeof topicWeights === "object" && Object.keys(topicWeights).length > 0) {
    const [sessionRes, problemRes] = await Promise.all([
      supabase.from("student_sessions").select("strengths").eq("id", sessionId).maybeSingle(),
      supabase
        .from("problems")
        .select("difficulty, estimated_difficulty, attempt_count, success_count")
        .eq("id", problemId)
        .maybeSingle(),
    ]);

    const currentStrengths = (sessionRes.data?.strengths ?? {}) as Record<string, number>;
    const newStrengths = updateStrengths(currentStrengths, topicWeights, correct);

    // Calibrate estimated_difficulty using student skill at time of attempt (pre-update strengths).
    const prob = problemRes.data as {
      difficulty: number;
      estimated_difficulty: number | null;
      attempt_count: number;
      success_count: number;
    } | null;

    const calibrationPromise = prob
      ? (async () => {
          const skillDifficulty = computeStudentSkill(currentStrengths, topicWeights);
          // Target: correct → assume problem is a bit below student skill; wrong → a bit above.
          const target = correct ? skillDifficulty - 0.5 : skillDifficulty + 0.5;
          const seed = prob.estimated_difficulty ?? prob.difficulty;
          const newEstimated = Math.max(1, Math.min(5, seed + 0.15 * (target - seed)));
          return supabase
            .from("problems")
            .update({
              attempt_count: prob.attempt_count + 1,
              success_count: correct ? prob.success_count + 1 : prob.success_count,
              estimated_difficulty: newEstimated,
            })
            .eq("id", problemId);
        })()
      : Promise.resolve();

    await Promise.all([
      supabase.from("student_sessions").update({ strengths: newStrengths }).eq("id", sessionId),
      calibrationPromise,
    ]);

    return NextResponse.json({ strengths: newStrengths });
  }

  return NextResponse.json({ strengths: null });
}
