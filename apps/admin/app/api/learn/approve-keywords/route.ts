import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type IncomingKeyword = {
  id: string;
  name: string;
  description: string;
  examples: string[];
  category: string;
};

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const { keywords } = (await request.json()) as { keywords: IncomingKeyword[] };
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return NextResponse.json({ error: "keywords array required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  const rows = keywords.map((k) => ({
    id: k.id,
    name: k.name,
    label: k.name,
    description: k.description,
    examples: k.examples,
    category_id: k.category,
    topic_id: k.category,
    tier: "in_depth" as const,
    status: "approved" as const,
  }));

  const { data, error } = await supabase
    .from("learn_keywords")
    .upsert(rows, { onConflict: "id" })
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ saved: data?.length ?? 0, ids: data?.map((r) => r.id) });
}

export async function DELETE(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const { ids } = (await request.json()) as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });

  const supabase = createClient(supabaseUrl, key);
  const { error } = await supabase.from("learn_keywords").delete().in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: ids.length });
}
