/**
 * POST /api/mcat/search
 * Body: { query: string }
 *
 * Free-text topic search. Embeds the query with text-embedding-3-small and
 * matches it against the keyword embeddings stored in mcat_keywords.
 *
 * PRIMARY PATH (post-migration 20260615000001_pgvector_search): the similarity
 * scan runs IN-DATABASE via the `match_mcat_keywords` RPC backed by an HNSW
 * index. This avoids loading every keyword's 1536-float embedding into Node and
 * cosine-scanning in JS — the old approach exhausted the DB's disk-IO budget.
 *
 * FALLBACK PATH (pre-migration): if the RPC is missing, fall back to the original
 * JS cosine scan so search keeps working until the migration is applied manually.
 *
 * Restricts to in_depth leaf keywords: these are the only keywords the
 * practice/quiz/flashcards routes accept as a `keyword_id` for a given category.
 * A leaf's `category_id` is the correct category those routes validate against.
 *
 * FAIL-SOFT: any failure returns { results: [], error } at status 200 — never 500.
 */
import { NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { embedText, cosineSimilarity } from "@/lib/mcatTagging";
import { getReadClient } from "@/lib/supabaseRead";

export const runtime = "nodejs";

type SearchResult = {
  keyword_id: string;
  label: string;
  category_id: string | null;
  score: number;
};

type KeywordRow = {
  id: string;
  category_id: string | null;
  label: string | null;
  tier: string | null;
  embedding: unknown;
};

type MatchRow = {
  keyword_id: string;
  label: string | null;
  category_id: string | null;
  similarity: number;
};

/**
 * Legacy JS cosine scan. Retained as a fallback for when the pgvector RPC is not
 * yet present (migration unapplied). Loads in_depth keyword embeddings and scores
 * in-process.
 */
async function fallbackScan(
  supabase: SupabaseClient,
  queryEmbedding: number[]
): Promise<SearchResult[]> {
  const { data: rows, error: kwErr } = await supabase
    .from("mcat_keywords")
    .select("id, category_id, label, tier, embedding")
    .eq("status", "approved")
    .eq("tier", "in_depth")
    .not("embedding", "is", null);

  if (kwErr) throw new Error(kwErr.message);

  const scored: SearchResult[] = [];
  for (const row of (rows ?? []) as KeywordRow[]) {
    const emb = row.embedding as number[] | null;
    if (!Array.isArray(emb) || emb.length === 0) continue;
    scored.push({
      keyword_id: row.id,
      label: row.label ?? row.id,
      // The leaf keyword's own category_id is the id the practice/quiz/
      // flashcards routes accept. May be null in rare unseeded rows — the
      // client falls back to a Lesson-only link in that case.
      category_id: row.category_id,
      score: cosineSimilarity(queryEmbedding, emb),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8);
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let body: { query?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ results: [], error: "Invalid request body" });
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json({ results: [], error: "query is required" });
  }
  if (!supabaseUrl || !key) {
    return NextResponse.json({ results: [], error: "Supabase not configured" });
  }

  try {
    // Read-only similarity search — route to the read replica when configured.
    const supabase = getReadClient();

    // 1. Embed the query (text-embedding-3-small, 1536-dim).
    const queryEmbedding = await embedText(query);
    const vecStr = "[" + queryEmbedding.join(",") + "]";

    // 2. Primary path: in-database HNSW similarity via RPC.
    const { data, error } = await supabase.rpc("match_mcat_keywords", {
      query_embedding: vecStr,
      match_count: 8,
    });

    if (!error && Array.isArray(data)) {
      const results: SearchResult[] = (data as MatchRow[]).map((row) => ({
        keyword_id: row.keyword_id,
        label: row.label ?? row.keyword_id,
        category_id: row.category_id,
        score: row.similarity,
      }));
      return NextResponse.json({ results });
    }

    // 3. Fallback path: RPC unavailable (migration not yet applied) — JS scan.
    const results = await fallbackScan(supabase, queryEmbedding);
    return NextResponse.json({ results });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error("mcat search failed:", detail);
    return NextResponse.json({
      results: [],
      error: "Search is temporarily unavailable",
    });
  }
}
