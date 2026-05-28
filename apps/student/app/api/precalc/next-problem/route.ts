import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreProblem, selectProblem, computeTargetDifficulty } from "@/lib/practiceAlgorithm";
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
    selectedKeywordIds: string[];
    desiredDifficulty?: number;
  };

  const { sessionId, selectedKeywordIds = [], desiredDifficulty } = body;
  if (!sessionId || selectedKeywordIds.length === 0) {
    return NextResponse.json({ error: "sessionId and selectedKeywordIds required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  // Load student's keyword strengths
  const { data: session } = await supabase
    .from("student_sessions")
    .select("keyword_strengths")
    .eq("id", sessionId)
    .maybeSingle();

  const keywordStrengths: Record<string, number> = session?.keyword_strengths ?? {};

  // Load seen problem IDs for this session
  const { data: attempts } = await supabase
    .from("student_problem_attempts")
    .select("problem_id")
    .eq("session_id", sessionId);

  const seenIds = new Set<string>((attempts ?? []).map((a: { problem_id: string }) => a.problem_id));

  const keywordSet = new Set(selectedKeywordIds);

  // Compute target difficulty
  const targetDiff = desiredDifficulty ?? computeTargetDifficulty(keywordStrengths, selectedKeywordIds);

  // --- Source 1: problems table ---
  const { data: dbProblems } = await supabase
    .from("problems")
    .select("id, latex_content, solution_latex, choices, correct_index, difficulty, estimated_difficulty, keyword_weights, avg_rating")
    .eq("status", "approved")
    .not("choices", "is", null)
    .not("keyword_weights", "is", null);

  // Filter in JS: keyword overlap, not seen
  const filtered = (dbProblems ?? []).filter((p: { id: string; keyword_weights: Record<string, number> }) => {
    if (seenIds.has(p.id)) return false;
    const kws = p.keyword_weights ?? {};
    return Object.keys(kws).some(k => keywordSet.has(k));
  });

  // --- Source 2: rag_examples (precalc, not yet promoted/seen) ---
  const { data: ragRows } = await supabase
    .from("rag_examples")
    .select("id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights")
    .eq("course", "precalc")
    .not("choices", "is", null);

  const ragFiltered = (ragRows ?? []).filter((r: { id: string; keyword_weights: Record<string, number>; promoted_problem_id?: string }) => {
    if (seenIds.has(r.id)) return false;
    const kws = r.keyword_weights ?? {};
    return Object.keys(kws).some(k => keywordSet.has(k));
  });

  // Combine candidates (db problems preferred)
  const allCandidates: Omit<PrecalcCandidate, "score">[] = [
    ...filtered.map((p: { id: string; latex_content: string; solution_latex: string; choices: string[]; correct_index: number; difficulty: number; estimated_difficulty?: number; keyword_weights: Record<string, number>; avg_rating?: number }) => ({
      id: p.id,
      latex_content: p.latex_content,
      solution_latex: p.solution_latex,
      choices: p.choices,
      correct_index: p.correct_index,
      difficulty: p.estimated_difficulty ?? p.difficulty,
      keyword_weights: p.keyword_weights,
      avg_rating: p.avg_rating ?? null,
      fromRag: false,
    })),
    ...ragFiltered.map((r: { id: string; latex_content: string; solution_latex: string; choices: string[]; correct_index: number; difficulty: number; keyword_weights: Record<string, number> }) => ({
      id: r.id,
      latex_content: r.latex_content,
      solution_latex: r.solution_latex,
      choices: r.choices,
      correct_index: r.correct_index,
      difficulty: r.difficulty,
      keyword_weights: r.keyword_weights,
      avg_rating: null,
      fromRag: true,
    })),
  ];

  if (allCandidates.length === 0) {
    return NextResponse.json({ error: "No problems available for selected keywords. Try different keywords or come back later." }, { status: 404 });
  }

  // Score candidates
  const scored: PrecalcCandidate[] = allCandidates.map(p => ({
    ...p,
    score: scoreProblem(p, keywordStrengths, targetDiff),
  }));

  const selected = selectProblem(scored) as PrecalcCandidate | null;
  if (!selected) {
    return NextResponse.json({ error: "Could not select a problem" }, { status: 404 });
  }

  // If selected from rag_examples, promote to problems table
  let finalProblem: PrecalcCandidate = selected;
  let generated = false;

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
      // Update rag_example promoted_problem_id (fire and forget)
      void supabase
        .from("rag_examples")
        .update({ promoted_problem_id: promoted.id })
        .eq("id", selected.id);

      finalProblem = { ...selected, id: promoted.id };
      generated = true;
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
    generated,
  });
}
