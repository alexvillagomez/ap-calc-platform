import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const body = (await request.json()) as { threshold?: number; category_id?: string; global?: boolean };
  const threshold = Math.min(0.99, Math.max(0.5, body.threshold ?? 0.88));

  const supabase = createClient(supabaseUrl, key);

  let query = supabase
    .from("learn_keywords")
    .select("id, name, label, description, category_id, embedding")
    .eq("status", "approved")
    .not("embedding", "is", null);

  if (body.category_id) {
    query = query.eq("category_id", body.category_id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const keywords = (data ?? []).filter((k) => Array.isArray(k.embedding) && k.embedding.length > 0) as KwRow[];

  if (keywords.length === 0) {
    return NextResponse.json({ pairs: [], keywords_scanned: 0, pairs_found: 0 });
  }

  // Pairwise cosine similarity
  const pairs: { a: Omit<KwRow, "embedding">; b: Omit<KwRow, "embedding">; similarity: number }[] = [];

  for (let i = 0; i < keywords.length; i++) {
    for (let j = i + 1; j < keywords.length; j++) {
      const sim = cosineSimilarity(keywords[i]!.embedding, keywords[j]!.embedding);
      if (sim >= threshold) {
        const strip = (k: KwRow): Omit<KwRow, "embedding"> => ({
          id: k.id,
          name: k.name ?? k.label ?? k.id,
          label: k.label,
          description: k.description,
          category_id: k.category_id,
        });
        pairs.push({ a: strip(keywords[i]!), b: strip(keywords[j]!), similarity: sim });
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity);

  return NextResponse.json({
    pairs: pairs.slice(0, 200),
    keywords_scanned: keywords.length,
    pairs_found: pairs.length,
  });
}
