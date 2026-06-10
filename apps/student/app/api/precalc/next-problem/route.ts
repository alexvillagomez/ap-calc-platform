import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreProblemByKeyword, selectProblem, computeTargetDifficulty } from "@/lib/practiceAlgorithm";
import type { ScoredProblem } from "@/lib/practiceAlgorithm";

interface PrecalcCandidate extends ScoredProblem {
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
  fromRag: boolean;
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = await request.json() as {
    sessionId: string;
    desiredDifficulty?: number;
  };

  const { sessionId, desiredDifficulty } = body;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  // Load student's keyword strengths and seen problems in parallel
  const [kwStatesRes, attemptsRes, ragRes, keywordRes] = await Promise.all([
    supabase.from("learn_student_keyword_states").select("keyword_id, in_depth_score").eq("session_id", sessionId),
    supabase.from("student_problem_attempts").select("problem_id").eq("session_id", sessionId),
    supabase
      .from("rag_examples")
      .select("id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights, avg_rating")
      .eq("course", "precalc")
      .not("choices", "is", null)
      .not("keyword_weights", "is", null),
    supabase
      .from("learn_keywords")
      .select("id")
      .eq("status", "approved"),
  ]);

  const validKeywordIds = new Set((keywordRes.data ?? []).map((kw: { id: string }) => kw.id));
  const keywordStrengths = Object.fromEntries(
    (kwStatesRes.data ?? [])
      .filter((r: { keyword_id: string }) => validKeywordIds.has(r.keyword_id))
      .map((r: { keyword_id: string; in_depth_score: number }) => [r.keyword_id, r.in_depth_score ?? 0.5])
  );
  const seenIds = new Set<string>((attemptsRes.data ?? []).map((a: { problem_id: string }) => a.problem_id));

  // Target difficulty derived from all known keyword strengths (defaults to 2.5 for new sessions)
  const knownKeywordIds = Object.keys(keywordStrengths);
  const targetDiff = desiredDifficulty ?? computeTargetDifficulty(keywordStrengths, knownKeywordIds);

  // All candidates come from rag_examples (precalc course only)
  type RawProblem = { id: string; latex_content: string; solution_latex: string; choices: string[]; correct_index: number; difficulty: number; keyword_weights: Record<string, number>; avg_rating: number | null };

  const allCandidates: Omit<PrecalcCandidate, "score">[] = [
    ...((ragRes.data ?? []) as RawProblem[])
      .filter(r => !seenIds.has(r.id))
      .map(r => ({
        ...r,
        keyword_weights: Object.fromEntries(
          Object.entries(r.keyword_weights ?? {}).filter(([keywordId]) => validKeywordIds.has(keywordId))
        ) as Record<string, number>,
      }))
      .filter(r => Object.keys(r.keyword_weights).length > 0)
      .map(r => ({
        id: r.id,
        latex_content: r.latex_content,
        solution_latex: r.solution_latex ?? "",
        choices: r.choices,
        correct_index: r.correct_index,
        difficulty: r.difficulty,
        keyword_weights: r.keyword_weights,
        avg_rating: r.avg_rating,
        fromRag: true,
      })),
  ];

  if (allCandidates.length === 0) {
    return NextResponse.json({ error: "No problems available. Come back later as more are added." }, { status: 404 });
  }

  // Score all candidates: weakness-weighted by keyword_strengths × difficulty proximity
  const scored: PrecalcCandidate[] = allCandidates.map(p => ({
    ...p,
    score: scoreProblemByKeyword(p, keywordStrengths, targetDiff),
  }));

  const selected = selectProblem(scored) as PrecalcCandidate | null;
  if (!selected) {
    return NextResponse.json({ error: "Could not select a problem" }, { status: 404 });
  }

  // Promote rag_example to problems table on first serve
  let finalProblem: PrecalcCandidate = selected;

  if (selected.fromRag) {
    const { data: promoted } = await supabase
      .from("problems")
      .insert({
        latex_content: selected.latex_content,
        solution_latex: selected.solution_latex,
        choices: selected.choices,
        correct_index: selected.correct_index,
        difficulty: selected.difficulty,
        estimated_difficulty: selected.difficulty,
        keyword_weights: selected.keyword_weights,
        status: "approved",
        type: "multiple_choice",
      })
      .select("id")
      .maybeSingle();

    if (promoted?.id) {
      void supabase.from("rag_examples").update({ promoted_problem_id: promoted.id }).eq("id", selected.id);
      finalProblem = { ...selected, id: promoted.id };
    }
  }

  return NextResponse.json({
    problem: {
      id: finalProblem.id,
      latex_content: finalProblem.latex_content,
      solution_latex: finalProblem.solution_latex,
      choices: finalProblem.choices,
      correct_index: finalProblem.correct_index,
      difficulty: finalProblem.difficulty,
      keyword_weights: finalProblem.keyword_weights,
      avg_rating: finalProblem.avg_rating,
      feedback_content_type: finalProblem.fromRag ? "rag_example" : "problem",
    },
  });
}
