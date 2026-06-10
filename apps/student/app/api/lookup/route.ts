import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// Inverse of TOPIC_TO_CATEGORY from topicCategoryMap.ts
const CATEGORY_TO_TOPIC: Record<string, string> = {
  exponents_and_radicals: "exponent_rules",
  functions: "functions",
  function_transformations: "function_transformations",
  inverse_functions: "inverse_functions",
  piecewise_functions: "piecewise_functions",
  polynomials: "polynomials",
  rational_functions: "rational_functions",
  exponential_and_logarithmic_functions: "exponential_and_logarithmic_functions",
  trigonometry: "trigonometry",
};

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  let body: {
    query?: string;
    sessionId?: string;
    excludeIds?: string[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { query, excludeIds = [] } = body;
  if (!query?.trim()) return NextResponse.json({ error: "query is required" }, { status: 400 });

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  // 1. Embed the query
  let queryEmbedding: number[] | undefined;
  try {
    const embRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query.trim(),
    });
    queryEmbedding = embRes.data[0]?.embedding;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error("lookup embedding failed:", detail);
    return NextResponse.json({ error: "Search is temporarily unavailable", detail }, { status: 502 });
  }
  if (!queryEmbedding) return NextResponse.json({ error: "Embedding failed" }, { status: 500 });

  const excludeSet = new Set(excludeIds);

  type ProblemRow = {
    id: string;
    latex_content: string;
    solution_latex: string;
    choices: string[];
    correct_index: number;
    difficulty: number;
    keyword_id?: string;
    hint_latex?: string | null;
    keyword_weights?: Record<string, number> | null;
    avg_rating?: number | null;
    feedback_content_type?: "rag_example" | "learn_practice_problem" | "learn_diagnostic_problem";
  };

  // 2. Primary: search rag_examples (precalc) by embedding, then learn tables as fallback
  const [ragRes, practiceRes, diagRes] = await Promise.all([
    supabase
      .from("rag_examples")
      .select("id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights, avg_rating, embedding")
      .eq("course", "precalc")
      .not("choices", "is", null)
      .not("solution_latex", "is", null)
      .not("embedding", "is", null),
    supabase
      .from("learn_practice_problems")
      .select("id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_id, hint_latex, avg_rating, embedding")
      .not("embedding", "is", null),
    supabase
      .from("learn_diagnostic_problems")
      .select("id, latex_content, choices, correct_index, difficulty, in_depth_keywords, avg_rating, embedding")
      .not("embedding", "is", null),
  ]);

  type ScoredProblem = ProblemRow & { similarity: number; source: "rag" | "practice" | "diag" };

  const scoredProblems: ScoredProblem[] = [];

  // rag_examples — precalc problems
  for (const row of (ragRes.data ?? []) as Array<ProblemRow & { embedding: unknown }>) {
    if (excludeSet.has(row.id)) continue;
    const emb = row.embedding as number[] | null;
    if (!Array.isArray(emb) || emb.length === 0) continue;
    scoredProblems.push({
      ...row,
      solution_latex: row.solution_latex ?? "",
      hint_latex: null,
      similarity: cosineSimilarity(queryEmbedding, emb),
      source: "rag",
    });
  }

  // learn_practice_problems — fallback
  for (const row of (practiceRes.data ?? []) as Array<ProblemRow & { embedding: unknown }>) {
    if (excludeSet.has(row.id)) continue;
    const emb = row.embedding as number[] | null;
    if (!Array.isArray(emb) || emb.length === 0) continue;
    scoredProblems.push({
      ...row,
      solution_latex: row.solution_latex ?? "",
      keyword_weights: null,
      similarity: cosineSimilarity(queryEmbedding, emb),
      source: "practice",
    });
  }

  // learn_diagnostic_problems — fallback
  for (const row of (diagRes.data ?? []) as Array<{ id: string; latex_content: string; choices: string[]; correct_index: number; difficulty: number; in_depth_keywords?: Record<string, number> | null; embedding: unknown }>) {
    if (excludeSet.has(row.id)) continue;
    const emb = row.embedding as number[] | null;
    if (!Array.isArray(emb) || emb.length === 0) continue;
    scoredProblems.push({
      id: row.id,
      latex_content: row.latex_content,
      solution_latex: "",
      choices: row.choices,
      correct_index: row.correct_index,
      difficulty: row.difficulty,
      keyword_weights: row.in_depth_keywords ?? null,
      avg_rating: null,
      similarity: cosineSimilarity(queryEmbedding, emb),
      source: "diag",
    });
  }

  // If we have problem embeddings, use the top match
  if (scoredProblems.length > 0) {
    scoredProblems.sort((a, b) => b.similarity - a.similarity);
    const picked = scoredProblems[0]!;

    // Resolve a label for the matched keyword (best practice keyword_id label, or query itself)
    let matchedLabel = query.trim();
    if (picked.keyword_id) {
      const { data: kw } = await supabase
        .from("learn_keywords")
        .select("label, name")
        .eq("id", picked.keyword_id)
        .single();
      if (kw) matchedLabel = (kw as { label?: string; name?: string }).label ?? (kw as { label?: string; name?: string }).name ?? matchedLabel;
    }

    return NextResponse.json({
      problem: {
        id: picked.id,
        latex_content: picked.latex_content,
        solution_latex: picked.solution_latex,
        choices: picked.choices,
        correct_index: picked.correct_index,
        difficulty: picked.difficulty,
        keyword_weights: picked.keyword_weights ?? null,
        avg_rating: picked.avg_rating ?? null,
        feedback_content_type: picked.source === "rag"
          ? "rag_example"
          : picked.source === "practice"
          ? "learn_practice_problem"
          : "learn_diagnostic_problem",
      },
      matched_keyword_label: matchedLabel,
    });
  }

  // 3. Fallback: keyword embedding search (used when problems have no embeddings yet)
  const { data: keywords, error: kwErr } = await supabase
    .from("learn_keywords")
    .select("id, name, label, tier, category_id, embedding")
    .eq("status", "approved")
    .not("embedding", "is", null);

  if (kwErr) return NextResponse.json({ error: kwErr.message }, { status: 500 });
  if (!keywords || keywords.length === 0) {
    return NextResponse.json({ error: "No problems found for that topic" });
  }

  type ScoredKeyword = { id: string; label: string; category_id: string | null; similarity: number };
  const scored: ScoredKeyword[] = (keywords as Array<{ id: string; name: string | null; label: string | null; tier: string | null; category_id: string | null; embedding: unknown }>)
    .filter((k) => k.tier !== "tag")
    .map((kw) => {
      const emb = kw.embedding as number[] | null;
      if (!Array.isArray(emb) || emb.length === 0) return null;
      return {
        id: kw.id,
        label: kw.label ?? kw.name ?? kw.id,
        category_id: kw.category_id,
        similarity: cosineSimilarity(queryEmbedding, emb),
      };
    })
    .filter((x): x is ScoredKeyword => x !== null)
    .sort((a, b) => b.similarity - a.similarity);

  if (scored.length === 0) {
    return NextResponse.json({ error: "No problems found for that topic" });
  }

  const topKeywords = scored.slice(0, 10);
  const topKeywordIds = topKeywords.map((k) => k.id);
  const bestKeyword = topKeywords[0]!;

  // Fallback A: learn_practice_problems by keyword_id
  const { data: practiceProblems } = await supabase
    .from("learn_practice_problems")
    .select("id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_id, hint_latex, avg_rating")
    .in("keyword_id", topKeywordIds);

  let candidates: ProblemRow[] = ((practiceProblems ?? []) as ProblemRow[]).filter((p) => !excludeSet.has(p.id));

  // Fallback B: learn_diagnostic_problems by topic_id
  if (candidates.length === 0) {
    const topicId = bestKeyword.category_id ? CATEGORY_TO_TOPIC[bestKeyword.category_id] ?? null : null;
    const diagQuery = supabase
      .from("learn_diagnostic_problems")
      .select("id, latex_content, choices, correct_index, difficulty, in_depth_keywords, topic_id, avg_rating")
      .not("choices", "is", null);

    const { data: diagProblems } = topicId ? await diagQuery.eq("topic_id", topicId) : await diagQuery;

    type DiagProbRow = { id: string; latex_content: string; choices: string[]; correct_index: number; difficulty: number; in_depth_keywords?: Record<string, number> | null; topic_id?: string; avg_rating?: number | null };
    candidates = ((diagProblems ?? []) as DiagProbRow[])
      .filter((p) => !excludeSet.has(p.id))
      .map((p) => ({
        id: p.id,
        latex_content: p.latex_content,
        solution_latex: "",
        choices: p.choices,
        correct_index: p.correct_index,
        difficulty: p.difficulty,
        keyword_weights: p.in_depth_keywords ?? null,
        avg_rating: p.avg_rating ?? null,
        feedback_content_type: "learn_diagnostic_problem",
      } as ProblemRow));
  }

  if (candidates.length === 0) {
    return NextResponse.json({ error: "No problems found for that topic" });
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)]!;

  let matchedKeywordLabel = bestKeyword.label;
  if (picked.keyword_id) {
    const matchingKeyword = topKeywords.find((k) => k.id === picked.keyword_id);
    if (matchingKeyword) matchedKeywordLabel = matchingKeyword.label;
  }

  return NextResponse.json({
    problem: {
      id: picked.id,
      latex_content: picked.latex_content,
      solution_latex: picked.solution_latex,
      choices: picked.choices,
      correct_index: picked.correct_index,
      difficulty: picked.difficulty,
      keyword_weights: picked.keyword_weights ?? null,
      avg_rating: picked.avg_rating ?? null,
      feedback_content_type: picked.keyword_id ? "learn_practice_problem" : "learn_diagnostic_problem",
    },
    matched_keyword_label: matchedKeywordLabel,
  });
}
