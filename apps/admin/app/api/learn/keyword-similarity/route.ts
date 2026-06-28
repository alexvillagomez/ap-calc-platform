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

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const { problem } = (await request.json()) as { problem: string };
  if (!problem?.trim()) return NextResponse.json({ error: "problem text required" }, { status: 400 });

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  // Single embedding call for all searches
  const embRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: problem.trim(),
  });
  const problemEmbedding = embRes.data[0]?.embedding;
  if (!problemEmbedding) return NextResponse.json({ error: "Embedding failed" }, { status: 500 });

  // Fetch categories, content keywords, and tags in parallel
  const [{ data: categories }, { data: allKeywords, error: kwErr }] = await Promise.all([
    supabase.from("learn_categories").select("id, name, embedding").not("embedding", "is", null),
    supabase
      .from("learn_keywords")
      .select("id, name, label, description, category_id, tier, embedding")
      .eq("status", "approved")
      .neq("tier", "umbrella")
      .neq("keyword_type", "umbrella")
      .not("embedding", "is", null),
  ]);

  if (kwErr) return NextResponse.json({ error: kwErr.message }, { status: 500 });
  if (!allKeywords || allKeywords.length === 0) {
    return NextResponse.json({ error: "No embedded keywords found." }, { status: 404 });
  }

  type Row = { id: string; name: string | null; label: string | null; description: string | null; category_id: string | null; tier: string | null; embedding: number[] };

  // Split into content keywords and tags
  const contentRows = (allKeywords as Row[]).filter((k) => k.tier !== "tag");
  const tagRows     = (allKeywords as Row[]).filter((k) => k.tier === "tag");

  // ── Score content keywords ─────────────────────────────────────────────────
  type ScoredKw = { id: string; name: string; description: string; category: string; similarity: number; source: "category_anchor" | "global" };

  const contentScored: ScoredKw[] = contentRows
    .map((kw) => {
      const emb = kw.embedding as number[] | null;
      if (!Array.isArray(emb) || emb.length === 0) return null;
      return {
        id: kw.id,
        name: kw.name ?? kw.label ?? kw.id,
        description: kw.description ?? "",
        category: kw.category_id ?? "",
        similarity: cosineSimilarity(problemEmbedding, emb),
        source: "global" as const,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.similarity - a.similarity);

  // ── Score tags ─────────────────────────────────────────────────────────────
  type ScoredTag = { id: string; name: string; description: string; category: string; similarity: number };

  const tagsScored: ScoredTag[] = tagRows
    .map((t) => {
      const emb = t.embedding as number[] | null;
      if (!Array.isArray(emb) || emb.length === 0) return null;
      return {
        id: t.id,
        name: t.name ?? t.label ?? t.id,
        description: t.description ?? "",
        category: t.category_id ?? "",
        similarity: cosineSimilarity(problemEmbedding, emb),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10);

  // ── Category anchor for content keywords ───────────────────────────────────
  // Exclude tag categories from the anchor search
  const tagCategoryIds = new Set(["action_tags", "representation_tags", "problem_style_tags"]);

  let topCategoryId: string | null = null;
  let topCategoryName: string | null = null;
  let topCategorySimilarity = 0;

  if (categories && categories.length > 0) {
    for (const cat of categories) {
      if (tagCategoryIds.has(cat.id)) continue; // skip tag categories
      const emb = cat.embedding as number[] | null;
      if (!Array.isArray(emb) || emb.length === 0) continue;
      const sim = cosineSimilarity(problemEmbedding, emb);
      if (sim > topCategorySimilarity) {
        topCategorySimilarity = sim;
        topCategoryId = cat.id;
        topCategoryName = cat.name;
      }
    }
  }

  // Fallback: most frequent content category in top-10 results
  if (!topCategoryId && contentScored.length > 0) {
    const freq: Record<string, number> = {};
    for (const k of contentScored.slice(0, 10)) {
      if (k.category && !tagCategoryIds.has(k.category)) {
        freq[k.category] = (freq[k.category] ?? 0) + 1;
      }
    }
    const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    if (best) {
      topCategoryId = best[0];
      topCategoryName = best[0].replace(/_/g, " ");
      topCategorySimilarity = 0;
    }
  }

  // ── Top 5 from best category + next 10 global = 15 keywords ───────────────
  const anchoredIds = new Set<string>();
  const results: ScoredKw[] = [];

  if (topCategoryId) {
    const fromTopCat = contentScored
      .filter((k) => k.category === topCategoryId)
      .slice(0, 5)
      .map((k) => ({ ...k, source: "category_anchor" as const }));
    for (const k of fromTopCat) { anchoredIds.add(k.id); results.push(k); }
  }

  results.push(...contentScored.filter((k) => !anchoredIds.has(k.id)).slice(0, 10));

  return NextResponse.json({
    results,
    tags: tagsScored,
    top_category: topCategoryId ? { id: topCategoryId, name: topCategoryName, similarity: topCategorySimilarity } : null,
    total_keywords_searched: contentRows.length,
    total_tags_searched: tagRows.length,
  });
}
