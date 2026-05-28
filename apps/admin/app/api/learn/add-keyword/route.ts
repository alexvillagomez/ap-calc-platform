import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const body = (await request.json()) as {
    id: string;
    name: string;
    description: string;
    category_id?: string;
    examples?: string[];
  };

  const { id, name, description, category_id, examples } = body;
  if (!id?.trim() || !name?.trim() || !description?.trim()) {
    return NextResponse.json({ error: "id, name, and description are required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  // Generate embedding
  const embRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: `${name}. ${description}`,
  });
  const embedding = embRes.data[0]?.embedding ?? [];

  const row = {
    id: id.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
    name: name.trim(),
    label: name.trim(),
    description: description.trim(),
    examples: examples ?? [],
    category_id: category_id ?? null,
    topic_id: category_id ?? "custom",
    tier: "in_depth" as const,
    status: "approved" as const,
    embedding,
  };

  const { data, error } = await supabase
    .from("learn_keywords")
    .upsert(row, { onConflict: "id" })
    .select("id, name, description, category_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ keyword: data });
}
