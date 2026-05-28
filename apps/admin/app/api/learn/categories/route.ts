import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);

  const { data: categories, error } = await supabase
    .from("learn_categories")
    .select("id, name, description, order_index")
    .order("order_index");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with approved keyword counts
  const { data: counts } = await supabase
    .from("learn_keywords")
    .select("category_id")
    .eq("status", "approved")
    .not("category_id", "is", null);

  const countMap: Record<string, number> = {};
  for (const row of counts ?? []) {
    if (row.category_id) countMap[row.category_id] = (countMap[row.category_id] ?? 0) + 1;
  }

  const enriched = (categories ?? []).map((c) => ({
    ...c,
    approved_count: countMap[c.id] ?? 0,
  }));

  return NextResponse.json({ categories: enriched });
}
