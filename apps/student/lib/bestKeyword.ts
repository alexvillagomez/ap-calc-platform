/**
 * bestKeyword — pick the keyword that is SEMANTICALLY CLOSEST to a question.
 *
 * The QuestionToolbar (refresher / lesson / prioritize) acts on a single
 * "primary" keyword. Historically that was `primaryKeywordId(keyword_weights)`
 * — the max stored weight. Those weights are noisy: e.g. "What is the sign of
 * -9/-3?" stores max-weight `negative_signs_and_grouping` (a grouping /
 * distribution sub-concept) even though the correct concept, `sign_of_quotients`,
 * isn't even present in keyword_weights. The result is a refresher about the
 * wrong sub-concept.
 *
 * This helper instead returns the keyword whose embedding is closest (cosine) to
 * the QUESTION's embedding, restricted to the question's category. It is
 * FAIL-SOFT at every step — if anything is missing or errors it returns the
 * max-weight keyword so behaviour never regresses.
 *
 * Primary path: the `match_{system}_keywords_in_category` pgvector RPC
 * (migration 20260616000000) does the nearest-neighbour scan in-database via the
 * HNSW index on *_keywords.embedding_vec — one indexed query.
 *
 * Fallback path: if the RPC is unavailable (migration not yet applied) the helper
 * does a small JS cosine scan over the category's keyword embeddings (JSONB
 * `embedding`), mirroring /api/{system}/search's fallbackScan. Kept cheap by
 * scoping to a single category.
 *
 * Last resort: the max-weight keyword from `keyword_weights`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cosineSimilarity } from "@/lib/mathTagging";
import { primaryKeywordId } from "@/lib/primaryKeyword";

type System = "math" | "mcat";

export type BestKeywordArgs = {
  system: System;
  /** Questions table to read the embedding from, e.g. "math_questions". */
  table: string;
  /** Keywords table to scan, e.g. "math_keywords". */
  keywordTable: string;
  /** Question id — used to fetch the stored embedding when one isn't passed. */
  questionId?: string | null;
  /** Pre-fetched question embedding (1536-d). Skips the embedding read. */
  embeddingVec?: number[] | null;
  /** Category to restrict the keyword search to. */
  categoryId?: string | null;
  /** Stored keyword_weights — the fail-soft fallback. */
  fallbackWeights?: Record<string, number> | null;
};

const RPC_BY_SYSTEM: Record<System, string> = {
  math: "match_math_keywords_in_category",
  mcat: "match_mcat_keywords_in_category",
};

/**
 * Returns the keyword id semantically closest to the question, or the max-weight
 * keyword (or null) as a fail-soft fallback. Never throws.
 */
export async function bestKeywordForQuestion(
  supabase: SupabaseClient,
  args: BestKeywordArgs
): Promise<string | null> {
  const fallback = primaryKeywordId(args.fallbackWeights);

  try {
    // Need a category to scope the search; without it, fall back.
    if (!args.categoryId) return fallback;

    // 1. Resolve the question embedding (passed in, or read one row).
    //    Prefer the question's `description_embedding` (a natural-language
    //    description of what the problem tests — better for pinpointing) when
    //    present, else fall back to `embedding` (the raw stem). Fail-soft: a
    //    missing column just yields no rows and we fall back to the stem vector.
    let embedding = args.embeddingVec ?? null;
    if (!Array.isArray(embedding) && args.questionId) {
      // Try description_embedding + embedding together; if the
      // description_embedding column doesn't exist yet (migration unapplied)
      // the select errors, so retry reading just the stem `embedding`.
      type EmbRow = {
        description_embedding?: unknown;
        embedding?: unknown;
      } | null;
      let row: EmbRow = null;
      const withDesc = await supabase
        .from(args.table)
        .select("description_embedding, embedding")
        .eq("id", args.questionId)
        .maybeSingle();
      if (!withDesc.error) {
        row = withDesc.data as EmbRow;
      } else {
        const stemOnly = await supabase
          .from(args.table)
          .select("embedding")
          .eq("id", args.questionId)
          .maybeSingle();
        row = stemOnly.data as EmbRow;
      }
      const desc = row?.description_embedding;
      const stem = row?.embedding;
      if (Array.isArray(desc) && desc.length > 0) {
        embedding = desc as number[];
      } else if (Array.isArray(stem)) {
        embedding = stem as number[];
      }
    }
    if (!Array.isArray(embedding) || embedding.length === 0) return fallback;

    // 2. Primary path: in-database HNSW nearest-neighbour via RPC (one query).
    const vecStr = "[" + embedding.join(",") + "]";
    const { data: matchData, error: rpcError } = await supabase.rpc(
      RPC_BY_SYSTEM[args.system],
      {
        query_embedding: vecStr,
        p_category_id: args.categoryId,
        match_count: 1,
      }
    );
    if (!rpcError && Array.isArray(matchData) && matchData.length > 0) {
      const id = (matchData[0] as { keyword_id?: string }).keyword_id;
      if (id) return id;
    }

    // 3. Fallback path: RPC missing (migration unapplied) — JS cosine scan over
    //    this category's keyword embeddings. Scoped to one category to stay cheap.
    const { data: kwRows } = await supabase
      .from(args.keywordTable)
      .select("id, embedding")
      .eq("category_id", args.categoryId)
      .eq("status", "approved")
      .not("embedding", "is", null);

    let bestId: string | null = null;
    let bestSim = -Infinity;
    for (const row of (kwRows ?? []) as { id: string; embedding: unknown }[]) {
      const emb = row.embedding;
      if (!Array.isArray(emb) || emb.length === 0) continue;
      const sim = cosineSimilarity(embedding, emb as number[]);
      if (sim > bestSim) {
        bestSim = sim;
        bestId = row.id;
      }
    }
    return bestId ?? fallback;
  } catch {
    // Any failure (pgvector unavailable, network, bad data) → max-weight.
    return fallback;
  }
}
