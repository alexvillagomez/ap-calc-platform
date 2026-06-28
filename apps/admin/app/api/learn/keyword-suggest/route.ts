import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { topNCentered, rerankDimension, type Dimension, type KwRow } from "@/lib/ai/keywordTagger";

// POST /api/learn/keyword-suggest
// Body: { text: string, tab: "topic" | "action" | "representation" | "prerequisite" }
//
// Embeds the text, mean-centers cosine scores against the appropriate keyword pool,
// passes top candidates through LLM reranking, and returns weighted suggestions.
export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OpenAI not configured" }, { status: 500 });

  const body = (await request.json()) as { text?: string; tab?: string };
  const { text, tab } = body;

  if (!text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const dimension = (["topic", "action", "representation", "prerequisite"].includes(tab ?? "")
    ? tab
    : "topic") as Dimension;

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  // Embed the query text
  let queryEmbedding: number[];
  try {
    const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: [text.trim()] });
    queryEmbedding = embRes.data[0]?.embedding ?? [];
  } catch {
    return NextResponse.json({ error: "Embedding failed" }, { status: 500 });
  }

  if (queryEmbedding.length === 0) return NextResponse.json({ error: "Empty embedding" }, { status: 500 });

  // Fetch the appropriate keyword pool
  let query = supabase
    .from("learn_keywords")
    .select("id, name, label, description, embedding, category_id")
    .eq("tier", "in_depth")
    .eq("status", "approved")
    .not("embedding", "is", null);

  if (dimension === "action") {
    query = query.eq("category_id", "action_items");
  } else if (dimension === "representation") {
    query = query.eq("category_id", "representations");
  } else {
    // topic and prerequisite both use the non-action, non-representation pool
    query = query.neq("category_id", "action_items").neq("category_id", "representations");
  }

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ suggestions: [] });

  const kwRows = rows as KwRow[];

  // Mean-centered top-N (pass all rows for small catalogs like action/repr)
  const topN = dimension === "topic" || dimension === "prerequisite" ? 20 : kwRows.length;
  const candidates = topNCentered(queryEmbedding, kwRows, topN);

  if (candidates.length === 0) return NextResponse.json({ suggestions: [] });

  // LLM rerank
  const weights = await rerankDimension(openai, text.trim(), candidates, dimension);

  const suggestions = Object.entries(weights)
    .map(([id, weight]) => {
      const row = kwRows.find((r) => r.id === id);
      return { id, label: row?.label ?? row?.name ?? id, weight };
    })
    .sort((a, b) => b.weight - a.weight);

  return NextResponse.json({ suggestions });
}
