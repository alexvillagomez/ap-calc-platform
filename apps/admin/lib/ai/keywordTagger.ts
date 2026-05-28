import OpenAI from "openai";
import { SupabaseClient } from "@supabase/supabase-js";
import { normalizeWeightsMap } from "@/lib/normalizeWeights";
import { GEN_MODEL } from "@/lib/ai/genClient";

// ─── Cosine similarity ────────────────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na  += a[i]! * a[i]!;
    nb  += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

type KwRow = { id: string; name: string | null; label?: string | null; description: string | null; embedding: number[] };

function topN(embedding: number[], rows: KwRow[], n: number): { id: string; label: string; description: string; score: number }[] {
  return rows
    .filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0)
    .map((r) => ({
      id: r.id,
      label: r.name ?? r.label ?? r.id,
      description: r.description ?? "",
      score: cosineSim(embedding, r.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

// ─── LLM reranker ─────────────────────────────────────────────────────────────

const RERANK_SYSTEM = `You are a math taxonomy tagger for an adaptive learning platform.

RULES:
1. Only select from the candidate list provided — do NOT invent labels.
2. Assign weight 0.0–1.0 per label reflecting how central it is to this specific problem.
3. Omit labels where weight < 0.25.
4. For KEYWORDS: select at most 6 in-depth skill keywords. Do NOT select near-duplicates — if two keywords describe essentially the same skill, pick only the more specific one.
5. For TAGS: select at most 4 format/action/style tags.
6. Return only valid JSON: {"keywords":[{"id":"...","weight":0.0}],"tags":[{"id":"...","weight":0.0}]}`;

async function rerank(
  openai: OpenAI,
  problemText: string,
  kwCandidates: ReturnType<typeof topN>,
  tagCandidates: ReturnType<typeof topN>,
): Promise<{ keyword_weights: Record<string, number>; tag_weights: Record<string, number> }> {
  const kwBlock = kwCandidates.map((c, i) =>
    `  [${i + 1}] id="${c.id}" | ${c.label} | ${c.description}`
  ).join("\n");
  const tagBlock = tagCandidates.map((c, i) =>
    `  [${i + 1}] id="${c.id}" | ${c.label} | ${c.description}`
  ).join("\n");

  const userMsg = `PROBLEM:\n${problemText}\n\nKEYWORD CANDIDATES (in-depth skills, pick ≤6, no near-duplicates):\n${kwBlock}\n\nTAG CANDIDATES (format/action/style, pick ≤4):\n${tagBlock}`;

  let parsed: { keywords?: { id: string; weight: number }[]; tags?: { id: string; weight: number }[] } = {};
  try {
    const completion = await openai.chat.completions.create({
      model: GEN_MODEL,
      messages: [{ role: "system", content: RERANK_SYSTEM }, { role: "user", content: userMsg }],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as typeof parsed;
  } catch { /* fall through to empty result */ }

  const kwValidIds = new Set(kwCandidates.map((c) => c.id));
  const tagValidIds = new Set(tagCandidates.map((c) => c.id));

  const keyword_weights: Record<string, number> = {};
  for (const { id, weight } of parsed.keywords ?? []) {
    if (kwValidIds.has(id) && weight >= 0.25) keyword_weights[id] = weight;
  }

  const tag_weights: Record<string, number> = {};
  for (const { id, weight } of parsed.tags ?? []) {
    if (tagValidIds.has(id) && weight >= 0.25) tag_weights[id] = weight;
  }

  return {
    keyword_weights: Object.keys(keyword_weights).length > 0 ? normalizeWeightsMap(keyword_weights) : {},
    tag_weights: Object.keys(tag_weights).length > 0 ? normalizeWeightsMap(tag_weights) : {},
  };
}

// ─── Wrong-answer data shape ──────────────────────────────────────────────────

export type WrongAnswerEntry = {
  description: string | null;
  embedding: number[] | null;
  keyword_weights: Record<string, number>;
};

// ─── Public API ───────────────────────────────────────────────────────────────

export async function autoTagKeywords(
  openai: OpenAI,
  latexContent: string,
  solutionLatex: string,
  supabase?: SupabaseClient,
  problemDescription?: string,
  wrongAnswerDescriptions?: (string | null)[],
  correctIndex?: number,
): Promise<{
  keyword_weights: Record<string, number>;
  tag_weights: Record<string, number>;
  wrong_answer_data: WrongAnswerEntry[];
}> {
  const empty = { keyword_weights: {}, tag_weights: {}, wrong_answer_data: [] };
  if (!supabase) return empty;

  const problemText = [latexContent, solutionLatex, problemDescription].filter(Boolean).join("\n\n");

  // Build list of wrong-answer texts to embed (null for correct index)
  const waTexts: (string | null)[] = wrongAnswerDescriptions?.length
    ? wrongAnswerDescriptions.map((d, i) => (i === correctIndex ? null : (d ?? null)))
    : [];

  const textsToEmbed = [problemText, ...waTexts.filter((t): t is string => t !== null)];

  // 1. Batch embed problem + all wrong-answer descriptions
  let embeddings: number[][];
  try {
    const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: textsToEmbed });
    embeddings = embRes.data.map((e) => e.embedding);
  } catch {
    return empty;
  }

  const problemEmbedding = embeddings[0]!;
  let waEmbIdx = 1;
  const waEmbeddings: (number[] | null)[] = waTexts.map((t) =>
    t === null ? null : (embeddings[waEmbIdx++] ?? null)
  );

  // 2. Fetch in_depth keywords + tag keywords (approved, with embeddings)
  const [{ data: kwRows }, { data: tagRows }] = await Promise.all([
    supabase.from("learn_keywords").select("id, name, label, description, embedding")
      .eq("tier", "in_depth").eq("status", "approved").not("embedding", "is", null),
    supabase.from("learn_keywords").select("id, name, label, description, embedding")
      .eq("tier", "tag").eq("status", "approved").not("embedding", "is", null),
  ]);

  if (!kwRows?.length && !tagRows?.length) return empty;

  const kwRows_ = (kwRows ?? []) as KwRow[];
  const tagRows_ = (tagRows ?? []) as KwRow[];

  // 3. Tag the problem
  const kwCandidates  = topN(problemEmbedding, kwRows_,  20);
  const tagCandidates = topN(problemEmbedding, tagRows_, 10);
  const { keyword_weights, tag_weights } = await rerank(openai, problemText, kwCandidates, tagCandidates);

  // 4. Tag each wrong answer (keyword_weights only — no action tags for individual errors)
  const wrong_answer_data: WrongAnswerEntry[] = await Promise.all(
    waTexts.map(async (text, i): Promise<WrongAnswerEntry> => {
      if (text === null || waEmbeddings[i] === null) {
        return { description: null, embedding: null, keyword_weights: {} };
      }
      const waEmb = waEmbeddings[i]!;
      const waCandidates = topN(waEmb, kwRows_, 15);
      // Lightweight rerank: cosine similarity only (no LLM call per WA to keep cost down)
      // Take top 4 candidates above threshold, normalize
      const waKw: Record<string, number> = {};
      for (const c of waCandidates.slice(0, 4)) {
        if (c.score >= 0.35) waKw[c.id] = c.score;
      }
      const normalized = Object.keys(waKw).length > 0 ? normalizeWeightsMap(waKw) : {};
      return { description: text, embedding: waEmb, keyword_weights: normalized };
    })
  );

  return { keyword_weights, tag_weights, wrong_answer_data };
}
