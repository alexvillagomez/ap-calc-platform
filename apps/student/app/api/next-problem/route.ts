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
    supabase.from("student_sessions").select("topic_strengths").eq("id", sessionId).maybeSingle(),
    supabase.from("student_problem_attempts").select("problem_id").eq("session_id", sessionId),
  ]);

  const strengths = (sessionRes.data?.topic_strengths ?? {}) as Record<string, number>;
  const seenIds = new Set((attemptsRes.data ?? []).map((a: { problem_id: string }) => a.problem_id));

  // Fetch all precalc rag_examples not yet seen by this student
  const { data: problems, error: probError } = await supabase
    .from("rag_examples")
    .select("id, latex_content, solution_latex, choices, correct_index, difficulty, estimated_difficulty, keyword_weights, topic_weights, avg_rating")
    .eq("course", "precalc")
    .not("choices", "is", null);

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
      return NextResponse.json({ problem: { ...full, feedback_content_type: "rag_example" }, generated: false });
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
      return NextResponse.json({ problem: { ...full, feedback_content_type: "rag_example" }, generated: false });
    }
  }

  return NextResponse.json({ error: "No suitable problems available." }, { status: 404 });
}
