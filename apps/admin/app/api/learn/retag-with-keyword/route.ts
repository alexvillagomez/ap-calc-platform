import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { normalizeWeightsMap } from "@/lib/normalizeWeights";

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

const RETAG_SYSTEM = `You are a math problem tagger. Given a problem and one specific keyword, decide if that keyword genuinely applies and assign a weight.

RULES:
1. Weight 0.7–1.0: the keyword is central to solving this problem
2. Weight 0.3–0.6: the keyword is relevant but not the main skill
3. Weight 0.0–0.25: the keyword barely applies — return applies: false
4. If the keyword does not clearly apply, return applies: false and weight: 0
5. Return ONLY valid JSON: {"applies": boolean, "weight": number, "reasoning": "one sentence"}`;

type ProblemRow = {
  id: string;
  latex_content: string;
  solution_latex: string;
  keyword_weights: Record<string, number>;
};

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const body = (await request.json()) as {
    keyword_id: string;
    cos_threshold?: number;    // default 0.45
    weight_threshold?: number; // default 0.25
    dry_run?: boolean;         // if true, don't write to DB
  };

  const { keyword_id, cos_threshold = 0.45, weight_threshold = 0.25, dry_run = false } = body;
  if (!keyword_id) return NextResponse.json({ error: "keyword_id required" }, { status: 400 });

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  // Fetch the keyword with its embedding
  const { data: kw } = await supabase
    .from("learn_keywords")
    .select("id, name, description, embedding")
    .eq("id", keyword_id)
    .single();

  if (!kw) return NextResponse.json({ error: `Keyword not found: ${keyword_id}` }, { status: 404 });
  const kwEmbedding = kw.embedding as number[];
  if (!Array.isArray(kwEmbedding) || kwEmbedding.length === 0) {
    return NextResponse.json({ error: "Keyword has no embedding — embed it first" }, { status: 400 });
  }

  // Fetch all approved problems
  const { data: problems } = await supabase
    .from("problems")
    .select("id, latex_content, solution_latex, keyword_weights")
    .eq("status", "approved")
    .eq("type", "multiple_choice");

  if (!problems || problems.length === 0) {
    return NextResponse.json({ candidates: 0, updated: 0, results: [] });
  }

  // Batch embed all problem texts
  const problemTexts = (problems as ProblemRow[]).map(
    (p) => `${p.latex_content}\n\n${p.solution_latex}`.slice(0, 2000)
  );

  // Embed in batches of 50 to avoid payload limits
  const BATCH = 50;
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < problemTexts.length; i += BATCH) {
    const batch = problemTexts.slice(i, i + BATCH);
    const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: batch });
    allEmbeddings.push(...res.data.map((d) => d.embedding));
  }

  // Score each problem
  type ScoredProblem = ProblemRow & { cos_score: number };
  const scored: ScoredProblem[] = (problems as ProblemRow[])
    .map((p, i) => ({
      ...p,
      cos_score: cosineSimilarity(kwEmbedding, allEmbeddings[i]!),
    }))
    .filter((p) => p.cos_score >= cos_threshold)
    .sort((a, b) => b.cos_score - a.cos_score);

  // For each candidate, ask LLM whether the keyword applies
  type Result = {
    problem_id: string;
    cos_score: number;
    applies: boolean;
    weight: number;
    reasoning: string;
    updated: boolean;
  };

  const results: Result[] = [];

  for (const problem of scored) {
    const userMsg = `Keyword: "${kw.id}" | ${kw.name} | ${kw.description}

Problem:
${problem.latex_content}

Solution:
${problem.solution_latex}`;

    let applies = false, weight = 0, reasoning = "";
    try {
      const completion = await openai.chat.completions.create({
        model: "gemini-3.5-flash",
        messages: [
          { role: "system", content: RETAG_SYSTEM },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
        applies?: boolean; weight?: number; reasoning?: string;
      };
      applies = parsed.applies === true && (parsed.weight ?? 0) >= weight_threshold;
      weight = typeof parsed.weight === "number" ? parsed.weight : 0;
      reasoning = parsed.reasoning ?? "";
    } catch { /* skip on error */ }

    let updated = false;
    if (applies && !dry_run) {
      const newWeights = normalizeWeightsMap({
        ...(problem.keyword_weights ?? {}),
        [kw.id]: weight,
      });
      const { error } = await supabase
        .from("problems")
        .update({ keyword_weights: newWeights })
        .eq("id", problem.id);
      updated = !error;
    }

    results.push({ problem_id: problem.id, cos_score: problem.cos_score, applies, weight, reasoning, updated });
  }

  const updatedCount = results.filter((r) => r.updated).length;
  const appliesCount = results.filter((r) => r.applies).length;

  return NextResponse.json({
    keyword: { id: kw.id, name: kw.name },
    problems_searched: problems.length,
    candidates_above_threshold: scored.length,
    applies_count: appliesCount,
    updated_count: updatedCount,
    dry_run,
    results,
  });
}
