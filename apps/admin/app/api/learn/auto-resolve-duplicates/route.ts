import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

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

type KwRow = {
  id: string;
  name: string | null;
  label: string | null;
  description: string | null;
  category_id: string | null;
  embedding: number[];
};

type Decision = "keep_a" | "keep_b" | "keep_both";

type PairResult = {
  a: Omit<KwRow, "embedding">;
  b: Omit<KwRow, "embedding">;
  similarity: number;
  decision: Decision;
  reasoning: string;
};

const SYSTEM_PROMPT = `You are a math taxonomy curator reviewing pairs of skill keywords for an adaptive learning platform.

For each pair, decide:
- "same": these keywords describe essentially the same mathematical skill (even if worded differently) — pick which to keep
- "different": these are genuinely distinct skills that should both exist

Rules:
- Keep the keyword with a more specific, descriptive name or richer description
- Keep the keyword whose name sounds most like a search query a teacher would use
- If truly unsure, return "keep_both"

Return JSON: {"decisions": [{"index": 0, "verdict": "same|different", "keep": "a|b|both", "reasoning": "one sentence"}]}`;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OpenAI not configured" }, { status: 500 });

  const body = (await request.json()) as { threshold?: number; category_id?: string };
  const threshold = Math.min(0.99, Math.max(0.70, body.threshold ?? 0.88));

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  let query = supabase
    .from("learn_keywords")
    .select("id, name, label, description, category_id, embedding")
    .eq("status", "approved")
    .not("embedding", "is", null);

  if (body.category_id) query = query.eq("category_id", body.category_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const keywords = (data ?? []).filter((k) => Array.isArray(k.embedding) && k.embedding.length > 0) as KwRow[];

  // Find pairs above threshold
  const pairs: { a: KwRow; b: KwRow; similarity: number }[] = [];
  for (let i = 0; i < keywords.length; i++) {
    for (let j = i + 1; j < keywords.length; j++) {
      const sim = cosineSimilarity(keywords[i]!.embedding, keywords[j]!.embedding);
      if (sim >= threshold) pairs.push({ a: keywords[i]!, b: keywords[j]!, similarity: sim });
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity);
  const topPairs = pairs.slice(0, 60); // LLM batch cap

  if (topPairs.length === 0) {
    return NextResponse.json({ pairs: [], keywords_scanned: keywords.length, pairs_found: 0 });
  }

  // Batch LLM classification in chunks of 20
  const CHUNK = 20;
  const results: PairResult[] = [];

  for (let start = 0; start < topPairs.length; start += CHUNK) {
    const chunk = topPairs.slice(start, start + CHUNK);
    const userMsg = chunk.map((p, i) => {
      const nameA = p.a.name ?? p.a.label ?? p.a.id;
      const nameB = p.b.name ?? p.b.label ?? p.b.id;
      return `[${i}] sim=${p.similarity.toFixed(3)}\n  A: "${nameA}" — ${p.a.description ?? "(no description)"}\n  B: "${nameB}" — ${p.b.description ?? "(no description)"}`;
    }).join("\n\n");

    let parsed: { decisions?: { index: number; verdict: string; keep: string; reasoning: string }[] } = {};
    try {
      const completion = await openai.chat.completions.create({
        model: "gemini-3.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });
      parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as typeof parsed;
    } catch { /* fall through — default to keep_both */ }

    const decisionMap = new Map<number, { verdict: string; keep: string; reasoning: string }>();
    for (const d of parsed.decisions ?? []) {
      decisionMap.set(d.index, d);
    }

    for (let i = 0; i < chunk.length; i++) {
      const p = chunk[i]!;
      const llm = decisionMap.get(i);
      const strip = (k: KwRow): Omit<KwRow, "embedding"> => ({
        id: k.id, name: k.name, label: k.label, description: k.description, category_id: k.category_id,
      });

      let decision: Decision = "keep_both";
      if (llm?.verdict === "same") {
        decision = llm.keep === "b" ? "keep_b" : llm.keep === "a" ? "keep_a" : "keep_both";
      }

      results.push({
        a: strip(p.a),
        b: strip(p.b),
        similarity: p.similarity,
        decision,
        reasoning: llm?.reasoning ?? "No LLM response — defaulted to keep both",
      });
    }
  }

  return NextResponse.json({
    pairs: results,
    keywords_scanned: keywords.length,
    pairs_found: pairs.length,
  });
}
