import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  computeTargetDifficulty,
  scoreProblem,
  selectProblem,
  type ScoredProblem,
} from "@/lib/practiceAlgorithm";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await request.json()) as {
    sessionId?: string;
    selectedTopicIds?: string[];
  };

  const { sessionId, selectedTopicIds } = body;
  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  if (!Array.isArray(selectedTopicIds) || selectedTopicIds.length === 0) {
    return NextResponse.json({ error: "selectedTopicIds must be a non-empty array" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Load session strengths and seen problem IDs in parallel
  const [sessionRes, attemptsRes] = await Promise.all([
    supabase.from("student_sessions").select("strengths").eq("id", sessionId).maybeSingle(),
    supabase.from("student_problem_attempts").select("problem_id").eq("session_id", sessionId),
  ]);

  const strengths = (sessionRes.data?.strengths ?? {}) as Record<string, number>;
  const seenIds = new Set((attemptsRes.data ?? []).map((a: { problem_id: string }) => a.problem_id));

  // Fetch all approved MCQ problems not yet seen by this student
  const { data: problems, error: probError } = await supabase
    .from("problems")
    .select("id, latex_content, solution_latex, choices, correct_index, difficulty, estimated_difficulty, topic_weights, avg_rating")
    .eq("type", "multiple_choice")
    .eq("status", "approved");

  if (probError) {
    return NextResponse.json({ error: probError.message }, { status: 500 });
  }

  const unseen = (problems ?? []).filter(
    (p: { id: string }) => !seenIds.has(p.id)
  ) as Array<{
    id: string;
    latex_content: string;
    solution_latex: string;
    choices: string[] | null;
    correct_index: number | null;
    difficulty: number;
    estimated_difficulty: number | null;
    topic_weights: Record<string, number> | null;
    avg_rating: number | null;
  }>;

  // Filter to problems that have at least some overlap with selected topics
  const selectedSet = new Set(selectedTopicIds);
  const relevant = unseen.filter((p) => {
    const tw = p.topic_weights ?? {};
    return Object.keys(tw).some((id) => selectedSet.has(id));
  });

  const targetDifficulty = computeTargetDifficulty(strengths, selectedTopicIds);

  if (relevant.length > 0) {
    // Score and pick
    const scored: ScoredProblem[] = relevant.map((p) => ({
      id: p.id,
      difficulty: p.difficulty,
      estimated_difficulty: p.estimated_difficulty,
      topic_weights: p.topic_weights ?? {},
      avg_rating: p.avg_rating,
      score: scoreProblem(
        { difficulty: p.difficulty, estimated_difficulty: p.estimated_difficulty, topic_weights: p.topic_weights ?? {}, avg_rating: p.avg_rating },
        strengths,
        selectedTopicIds,
        targetDifficulty
      ),
    }));

    const picked = selectProblem(scored);
    if (picked) {
      const full = relevant.find((p) => p.id === picked.id)!;
      return NextResponse.json({ problem: full, generated: false });
    }
  }

  // Fallback: try any unseen problem from the full pool (wider search)
  if (unseen.length > 0) {
    const scored: ScoredProblem[] = unseen.map((p) => ({
      id: p.id,
      difficulty: p.difficulty,
      estimated_difficulty: p.estimated_difficulty,
      topic_weights: p.topic_weights ?? {},
      avg_rating: p.avg_rating,
      score: scoreProblem(
        { difficulty: p.difficulty, estimated_difficulty: p.estimated_difficulty, topic_weights: p.topic_weights ?? {}, avg_rating: p.avg_rating },
        strengths,
        selectedTopicIds,
        targetDifficulty
      ),
    }));
    const picked = selectProblem(scored.filter((s) => s.score > 0));
    if (picked) {
      const full = unseen.find((p) => p.id === picked.id)!;
      return NextResponse.json({ problem: full, generated: false });
    }
  }

  // Final fallback: generate a new problem via the admin API
  const adminUrl = process.env.ADMIN_APP_URL ?? "http://localhost:3001";
  const targetDiffInt = Math.min(5, Math.max(1, Math.round(targetDifficulty)));

  try {
    const genRes = await fetch(`${adminUrl}/api/generate-problem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topicIds: selectedTopicIds,
        difficulty: targetDiffInt,
        questionType: "multiple_choice",
      }),
    });

    if (!genRes.ok) {
      return NextResponse.json({ error: "No suitable problems available and generation failed." }, { status: 404 });
    }

    const genData = (await genRes.json()) as Record<string, unknown>;

    // Assess difficulty and topic_weights for the generated problem
    const assessRes = await fetch(`${adminUrl}/api/assess-problem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latex_content: genData.latex_content,
        solution_latex: genData.solution_latex,
        choices: genData.choices,
        type: "multiple_choice",
        topicIds: selectedTopicIds,
      }),
    });

    const assessData = assessRes.ok ? ((await assessRes.json()) as { difficulty?: number; topic_weights?: Record<string, number> }) : {};

    const newProblem = {
      latex_content: genData.latex_content as string,
      solution_latex: genData.solution_latex as string,
      choices: genData.choices as string[],
      correct_index: genData.correct_index as number,
      difficulty: assessData.difficulty ?? targetDiffInt,
      topic_weights: assessData.topic_weights ?? {},
      type: "multiple_choice",
      status: "approved",
    };

    // Save to DB so the problem persists for future sessions
    const { data: saved, error: saveError } = await supabase
      .from("problems")
      .insert(newProblem)
      .select("id, latex_content, solution_latex, choices, correct_index, difficulty, estimated_difficulty, topic_weights, avg_rating")
      .single();

    if (saveError || !saved) {
      console.error("next-problem: failed to save generated problem", saveError?.message);
      return NextResponse.json({ error: "Generation succeeded but could not save problem." }, { status: 500 });
    }

    return NextResponse.json({ problem: saved, generated: true });
  } catch (err) {
    console.error("next-problem: generation error", err);
    return NextResponse.json({ error: "No suitable problems available." }, { status: 404 });
  }
}
