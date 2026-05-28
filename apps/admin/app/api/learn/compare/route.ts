import { NextResponse } from "next/server";
import OpenAI from "openai";

function cosineSimilarity(a: number[], b: number[]): number {
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
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const { a, b } = (await request.json()) as { a: string; b: string };
  if (!a?.trim() || !b?.trim()) return NextResponse.json({ error: "Both inputs required" }, { status: 400 });

  const openai = new OpenAI({ apiKey: openaiKey });

  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: [a.trim(), b.trim()],
  });

  const embA = res.data[0]?.embedding;
  const embB = res.data[1]?.embedding;
  if (!embA || !embB) return NextResponse.json({ error: "Embedding failed" }, { status: 500 });

  const similarity = cosineSimilarity(embA, embB);
  return NextResponse.json({ similarity });
}
