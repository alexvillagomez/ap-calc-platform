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

type KwRow = {
  id: string;
  name: string | null;
  label?: string | null;
  description: string | null;
  embedding: number[];
  category_id?: string | null;
};

type Candidate = { id: string; label: string; description: string; score: number };

// ─── Cached keyword-row fetch ─────────────────────────────────────────────────
// Concurrent autoTagKeywords calls (e.g. bulk generation) each re-fetch the same
// ~700-row embedding payload, which overwhelms Postgres and times out. Cache the
// result (and dedupe in-flight fetches) for a short TTL — learn_keywords changes
// infrequently relative to this window.
const KW_ROWS_TTL_MS = 5 * 60 * 1000;
let kwRowsCache: { topicRows: KwRow[]; actionRows: KwRow[]; reprRows: KwRow[]; fetchedAt: number } | null = null;
let kwRowsInFlight: Promise<{ topicRows: KwRow[]; actionRows: KwRow[]; reprRows: KwRow[] }> | null = null;

async function fetchKeywordRows(supabase: SupabaseClient): Promise<{ topicRows: KwRow[]; actionRows: KwRow[]; reprRows: KwRow[] }> {
  if (kwRowsCache && Date.now() - kwRowsCache.fetchedAt < KW_ROWS_TTL_MS) {
    return kwRowsCache;
  }
  if (kwRowsInFlight) return kwRowsInFlight;

  kwRowsInFlight = (async () => {
    const { data: topicKwRows, error: topicKwErr } = await supabase
      .from("learn_keywords")
      .select("id, name, label, description, embedding, category_id")
      .eq("tier", "in_depth")
      .eq("status", "approved")
      .not("embedding", "is", null)
      .not("category_id", "in", "(action_items,representations)");
    if (topicKwErr) console.error("[autoTagKeywords] topicKwRows query failed:", topicKwErr);

    const { data: specialKwRows, error: specialKwErr } = await supabase
      .from("learn_keywords")
      .select("id, name, label, description, embedding, category_id")
      .in("category_id", ["action_items", "representations"])
      .eq("status", "approved")
      .not("embedding", "is", null);
    if (specialKwErr) console.error("[autoTagKeywords] specialKwRows query failed:", specialKwErr);

    const allRows = [...(topicKwRows ?? []), ...(specialKwRows ?? [])] as KwRow[];
    const result = {
      topicRows: allRows.filter((r) => r.category_id !== "action_items" && r.category_id !== "representations"),
      actionRows: allRows.filter((r) => r.category_id === "action_items"),
      reprRows: allRows.filter((r) => r.category_id === "representations"),
    };

    // Only cache a successful, non-empty fetch — don't lock in a transient timeout.
    if (result.topicRows.length > 0) {
      kwRowsCache = { ...result, fetchedAt: Date.now() };
    }
    return result;
  })();

  try {
    return await kwRowsInFlight;
  } finally {
    kwRowsInFlight = null;
  }
}

// Mean-centered top-N: subtracts the average cosine score so values span ~[-0.5, 0.5].
// Keywords above the mean have positive scores; irrelevant ones go negative.
function topNCentered(embedding: number[], rows: KwRow[], n: number): Candidate[] {
  const all = rows
    .filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0)
    .map((r) => ({
      id: r.id,
      label: r.name ?? r.label ?? r.id,
      description: r.description ?? "",
      raw: cosineSim(embedding, r.embedding),
    }));

  if (all.length === 0) return [];

  const mean = all.reduce((s, r) => s + r.raw, 0) / all.length;

  return all
    .map((r) => ({ id: r.id, label: r.label, description: r.description, score: r.raw - mean }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

// ─── Unified LLM reranker ─────────────────────────────────────────────────────

type Dimension = "topic" | "action" | "representation" | "prerequisite";

const DIMENSION_CONFIG: Record<Dimension, { maxSelect: number; context: string }> = {
  topic:          { maxSelect: 6, context: "topic skill — what mathematical concept or technique the problem tests" },
  action:         { maxSelect: 3, context: "action/verb — what cognitive operation the student performs (e.g., solve, evaluate, justify)" },
  representation: { maxSelect: 2, context: "representation — the format or medium in which the problem is presented (e.g., symbolic, verbal, contextual, graphical, tabular, diagram, exact form, approximate form)" },
  prerequisite:   { maxSelect: 4, context: "prerequisite knowledge — what prior skills or knowledge are required to solve the problem" },
};

const RERANK_SYSTEM = `You are a math taxonomy tagger for an adaptive learning platform.

RULES:
1. Only select from the candidate list provided — do NOT invent IDs.
2. Assign weight 0.0–1.0 reflecting how central each label is to the input.
3. Omit any label where weight < 0.2.
4. Do NOT select near-duplicates — if two labels describe essentially the same thing, pick only the most specific one.
5. Return only valid JSON: {"keywords":[{"id":"...","weight":0.0}]}`;

async function rerankDimension(
  openai: OpenAI,
  queryText: string,
  candidates: Candidate[],
  dimension: Dimension,
): Promise<Record<string, number>> {
  if (candidates.length === 0) return {};

  const { maxSelect, context } = DIMENSION_CONFIG[dimension];
  const block = candidates.map((c, i) =>
    `  [${i + 1}] id="${c.id}" | ${c.label} | ${c.description}`
  ).join("\n");

  const userMsg = `DIMENSION: ${context}\nSELECT AT MOST: ${maxSelect}\n\nINPUT:\n${queryText}\n\nCANDIDATES:\n${block}`;

  let parsed: { keywords?: { id: string; weight: number }[] } = {};
  try {
    const completion = await openai.chat.completions.create({
      model: GEN_MODEL,
      messages: [{ role: "system", content: RERANK_SYSTEM }, { role: "user", content: userMsg }],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as typeof parsed;
  } catch (e) {
    console.error(`[autoTagKeywords] rerankDimension(${dimension}) failed:`, e);
  }

  const validIds = new Set(candidates.map((c) => c.id));
  const weights: Record<string, number> = {};
  for (const { id, weight } of parsed.keywords ?? []) {
    if (validIds.has(id) && weight >= 0.2) weights[id] = weight;
  }

  return Object.keys(weights).length > 0 ? normalizeWeightsMap(weights) : {};
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
  topicDescription?: string,
  actionDescription?: string,
  representationDescription?: string,
  prerequisiteDescription?: string,
): Promise<{
  keyword_weights: Record<string, number>;
  action_weights: Record<string, number>;
  representation_weights: Record<string, number>;
  prerequisite_weights: Record<string, number>;
  wrong_answer_data: WrongAnswerEntry[];
}> {
  const empty = { keyword_weights: {}, action_weights: {}, representation_weights: {}, prerequisite_weights: {}, wrong_answer_data: [] };
  if (!supabase) return empty;

  const problemText = [latexContent, solutionLatex, problemDescription].filter(Boolean).join("\n\n");

  // Wrong-answer texts to embed (null at correct index)
  const waTexts: (string | null)[] = wrongAnswerDescriptions?.length
    ? wrongAnswerDescriptions.map((d, i) => (i === correctIndex ? null : (d ?? null)))
    : [];
  const waTextsNonNull = waTexts.filter((t): t is string => t !== null);

  // Build batch embed list with tracked indices
  const textsToEmbed: string[] = [problemText];
  let topicIdx = -1, actionIdx = -1, reprIdx = -1, prereqIdx = -1;

  if (topicDescription?.trim())          { topicIdx  = textsToEmbed.length; textsToEmbed.push([topicDescription, latexContent, solutionLatex].filter(Boolean).join("\n\n")); }
  if (actionDescription?.trim())         { actionIdx  = textsToEmbed.length; textsToEmbed.push(actionDescription); }
  if (representationDescription?.trim()) { reprIdx    = textsToEmbed.length; textsToEmbed.push(representationDescription); }
  if (prerequisiteDescription?.trim())   { prereqIdx  = textsToEmbed.length; textsToEmbed.push(prerequisiteDescription); }

  const waEmbStart = textsToEmbed.length;
  textsToEmbed.push(...waTextsNonNull);

  // Batch embed everything in one call
  let embeddings: number[][];
  try {
    const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: textsToEmbed });
    embeddings = embRes.data.map((e) => e.embedding);
  } catch {
    return empty;
  }

  const problemEmbedding = embeddings[0]!;
  const topicEmbedding   = topicIdx  >= 0 ? (embeddings[topicIdx]  ?? problemEmbedding) : problemEmbedding;
  const actionEmbedding  = actionIdx >= 0 ? (embeddings[actionIdx] ?? null) : null;
  const reprEmbedding    = reprIdx   >= 0 ? (embeddings[reprIdx]   ?? null) : null;
  const prereqEmbedding  = prereqIdx >= 0 ? (embeddings[prereqIdx] ?? null) : null;

  let waEmbIdx = waEmbStart;
  const waEmbeddings: (number[] | null)[] = waTexts.map((t) =>
    t === null ? null : (embeddings[waEmbIdx++] ?? null)
  );

  const { topicRows, actionRows, reprRows } = await fetchKeywordRows(supabase);

  if (!topicRows.length && !actionRows.length && !reprRows.length) return empty;

  // Mean-centered top-N candidates per dimension
  // For small catalogs (action=10, repr=8) pass all rows so LLM sees every option
  const kwCandidates     = topNCentered(topicEmbedding,  topicRows,  20);
  const actionCandidates = actionEmbedding  ? topNCentered(actionEmbedding,  actionRows,  actionRows.length)  : [];
  const reprCandidates   = reprEmbedding    ? topNCentered(reprEmbedding,    reprRows,    reprRows.length)    : [];
  const prereqCandidates = prereqEmbedding  ? topNCentered(prereqEmbedding,  topicRows,  15)                  : [];

  // LLM rerank all four dimensions in parallel
  const topicText  = topicDescription?.trim()          || problemText;
  const actionText = actionDescription?.trim()         || problemText;
  const reprText   = representationDescription?.trim() || problemText;
  const prereqText = prerequisiteDescription?.trim()   || problemText;

  const [keyword_weights, action_weights, representation_weights, prerequisite_weights] = await Promise.all([
    kwCandidates.length     > 0 ? rerankDimension(openai, topicText,  kwCandidates,     "topic")          : Promise.resolve({}),
    actionCandidates.length > 0 ? rerankDimension(openai, actionText, actionCandidates, "action")         : Promise.resolve({}),
    reprCandidates.length   > 0 ? rerankDimension(openai, reprText,   reprCandidates,   "representation") : Promise.resolve({}),
    prereqCandidates.length > 0 ? rerankDimension(openai, prereqText, prereqCandidates, "prerequisite")   : Promise.resolve({}),
  ]);

  // Tag wrong answers: mean-centered cosine-only against topic pool (cost-sensitive)
  const wrong_answer_data: WrongAnswerEntry[] = await Promise.all(
    waTexts.map(async (text, i): Promise<WrongAnswerEntry> => {
      if (text === null || waEmbeddings[i] === null) {
        return { description: null, embedding: null, keyword_weights: {} };
      }
      const waEmb = waEmbeddings[i]!;
      const waCandidates = topNCentered(waEmb, topicRows, 15);
      // Take top 4 with positive centered score (above average similarity)
      const waKw: Record<string, number> = {};
      for (const c of waCandidates.slice(0, 4)) {
        if (c.score > 0) waKw[c.id] = c.score;
      }
      return {
        description: text,
        embedding: waEmb,
        keyword_weights: Object.keys(waKw).length > 0 ? normalizeWeightsMap(waKw) : {},
      };
    })
  );

  return { keyword_weights, action_weights, representation_weights, prerequisite_weights, wrong_answer_data };
}

// ─── Exported helpers for the keyword-suggest API route ──────────────────────

export { topNCentered, rerankDimension, type Candidate, type Dimension, type KwRow };
