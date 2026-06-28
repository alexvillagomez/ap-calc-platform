import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const { ids, embed_categories } = (await request.json()) as { ids?: string[]; embed_categories?: boolean };

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  let embedded = 0;

  // Embed keywords — batch OpenAI call for the whole batch, then write rows
  if (ids && ids.length > 0) {
    const { data: keywords } = await supabase
      .from("learn_keywords")
      .select("id, name, description, examples")
      .in("id", ids);

    const kws = keywords ?? [];
    if (kws.length > 0) {
      const texts = kws.map((kw) => {
        const exampleStr = Array.isArray(kw.examples) && kw.examples.length > 0
          ? ` Examples: ${(kw.examples as string[]).join('; ')}`
          : '';
        return `${kw.name}: ${kw.description}${exampleStr}`;
      });
      try {
        const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: texts });
        for (let i = 0; i < kws.length; i++) {
          const embedding = res.data[i]?.embedding ?? [];
          await supabase.from("learn_keywords").update({ embedding }).eq("id", kws[i]!.id);
          embedded++;
        }
      } catch (err) {
        console.error("embed-keywords: batch failed", err);
      }
    }
  }

  // Embed categories
  if (embed_categories) {
    const { data: cats } = await supabase
      .from("learn_categories")
      .select("id, name, description")
      .is("embedding", null);

    for (const cat of cats ?? []) {
      const text = `${cat.name}: ${cat.description}`;
      try {
        const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
        const embedding = res.data[0]?.embedding ?? [];
        await supabase.from("learn_categories").update({ embedding }).eq("id", cat.id);
        embedded++;
      } catch (err) {
        console.error(`embed-keywords: failed for category ${cat.id}`, err);
      }
    }
  }

  return NextResponse.json({ embedded });
}
