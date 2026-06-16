/**
 * POST /api/math/search
 * Body: { query: string, course?: "precalc" | "calc_ab" }
 *
 * Free-text topic search. Embeds the query with text-embedding-3-small and
 * matches it against the keyword embeddings stored in math_keywords.
 *
 * PRIMARY PATH (post-migration 20260615000001_pgvector_search): the similarity
 * scan runs IN-DATABASE via the `match_math_keywords` RPC backed by an HNSW
 * index. This avoids loading every keyword's 1536-float embedding into Node and
 * cosine-scanning in JS — the old approach exhausted the DB's disk-IO budget.
 *
 * FALLBACK PATH (pre-migration): if the RPC is missing (extension/column/function
 * not yet applied), fall back to the original JS cosine scan so search keeps
 * working until the migration is applied manually.
 *
 * FAIL-SOFT: any failure returns { results: [], error } at status 200 — never 500.
 */
import { NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { embedText, cosineSimilarity } from "@/lib/mcatTagging";
import { fetchAllPages } from "@/lib/mathPagedQuery";
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
 * yet present (migration unapplied). Loads paginated keyword embeddings and
 * scores in-process.
 */
async function fallbackScan(
  supabase: SupabaseClient,
  queryEmbedding: number[],
  course: "precalc" | "calc_ab" | undefined
): Promise<SearchResult[]> {
  let categoryIds: string[] | null = null;
  if (course) {
    const { data: memberships } = await supabase
      .from("math_course_categories")
      .select("category_id")
      .eq("course", course);
    categoryIds = (memberships ?? []).map((m) => m.category_id as string);
  }

  const rows = await fetchAllPages<KeywordRow>((from, to) => {
    let q = supabase
      .from("math_keywords")
      .select("id, category_id, label, embedding")
      .eq("status", "approved")
      .not("embedding", "is", null);
    if (categoryIds && categoryIds.length > 0) {
      q = q.in("category_id", categoryIds);
    }
    return q.range(from, to);
  });

  const scored: SearchResult[] = [];
  for (const row of rows) {
    const emb = row.embedding as number[] | null;
    if (!Array.isArray(emb) || emb.length === 0) continue;
    scored.push({
      keyword_id: row.id,
      label: row.label ?? row.id,
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

  let body: { query?: string; course?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ results: [], error: "Invalid request body" });
  }

  const query = body.query?.trim();
  const course =
    body.course === "calc_ab" || body.course === "precalc"
      ? body.course
      : undefined;

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
    const { data, error } = await supabase.rpc("match_math_keywords", {
      query_embedding: vecStr,
      p_course: course ?? null,
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
    const results = await fallbackScan(supabase, queryEmbedding, course);
    return NextResponse.json({ results });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error("math search failed:", detail);
    return NextResponse.json({
      results: [],
      error: "Search is temporarily unavailable",
    });
  }
}
