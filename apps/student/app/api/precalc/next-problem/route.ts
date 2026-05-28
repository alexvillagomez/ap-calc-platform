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
  const [sessionRes, attemptsRes, problemsRes, ragRes] = await Promise.all([
    supabase.from("student_sessions").select("keyword_strengths").eq("id", sessionId).maybeSingle(),
    supabase.from("student_problem_attempts").select("problem_id").eq("session_id", sessionId),
    supabase
      .from("problems")
      .select("id, latex_content, solution_latex, choices, correct_index, difficulty, estimated_difficulty, keyword_weights, avg_rating")
      .eq("status", "approved")
      .not("choices", "is", null)
      .not("keyword_weights", "is", null),
    supabase
      .from("rag_examples")
      .select("id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights")
      .not("choices", "is", null)
      .not("keyword_weights", "is", null),
  ]);

  const keywordStrengths: Record<string, number> = sessionRes.data?.keyword_strengths ?? {};
  const seenIds = new Set<string>((attemptsRes.data ?? []).map((a: { problem_id: string }) => a.problem_id));

  // Target difficulty derived from all known keyword strengths (defaults to 2.5 for new sessions)
  const knownKeywordIds = Object.keys(keywordStrengths);
  const targetDiff = desiredDifficulty ?? computeTargetDifficulty(keywordStrengths, knownKeywordIds);

  // Combine all unseen candidates — problems table first (canonical), then rag_examples
  type RawProblem = { id: string; latex_content: string; solution_latex: string; choices: string[]; correct_index: number; difficulty: number; estimated_difficulty?: number; keyword_weights: Record<string, number>; avg_rating?: number };

  const allCandidates: Omit<PrecalcCandidate, "score">[] = [
    ...((problemsRes.data ?? []) as RawProblem[])
      .filter(p => !seenIds.has(p.id))
      .map(p => ({
        id: p.id,
        latex_content: p.latex_content,
        solution_latex: p.solution_latex ?? "",
        choices: p.choices,
        correct_index: p.correct_index,
        difficulty: p.estimated_difficulty ?? p.difficulty,
        keyword_weights: p.keyword_weights,
        avg_rating: p.avg_rating ?? null,
        fromRag: false,
      })),
    ...((ragRes.data ?? []) as RawProblem[])
      .filter(r => !seenIds.has(r.id))
      .map(r => ({
        id: r.id,
        latex_content: r.latex_content,
        solution_latex: r.solution_latex ?? "",
        choices: r.choices,
        correct_index: r.correct_index,
        difficulty: r.difficulty,
        keyword_weights: r.keyword_weights,
        avg_rating: null,
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
        difficulty: Math.round(selected.difficulty),
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
      difficulty: Math.round(finalProblem.difficulty),
      keyword_weights: finalProblem.keyword_weights,
      avg_rating: finalProblem.avg_rating,
    },
  });
}
