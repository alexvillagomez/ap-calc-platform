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

  const embRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: problem.trim(),
  });
  const problemEmbedding = embRes.data[0]?.embedding;
  if (!problemEmbedding) return NextResponse.json({ error: "Embedding failed" }, { status: 500 });

  const { data: categories, error } = await supabase
    .from("learn_categories")
    .select("id, name, description, order_index, embedding")
    .not("embedding", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!categories || categories.length === 0) {
    return NextResponse.json({ error: "No embedded categories found. Use the embed button to generate embeddings first." }, { status: 404 });
  }

  const scored = categories
    .map((cat) => {
      const emb = cat.embedding as number[] | null;
      if (!Array.isArray(emb) || emb.length === 0) return null;
      return {
        id: cat.id,
        name: cat.name,
        description: cat.description ?? "",
        order_index: cat.order_index ?? 0,
        similarity: cosineSimilarity(problemEmbedding, emb),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 15);

  return NextResponse.json({
    results: scored,
    total_categories_searched: categories.length,
  });
}
