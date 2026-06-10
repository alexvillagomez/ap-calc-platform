import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// The demo diagnostic is currently scoped to a single category so the
// adaptive run can converge on a confident read of its umbrella keywords
// before showing the report.
const DEMO_CATEGORY_ID = "polynomials";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, key);

  const { data: keywords, error: keywordsError } = await supabase
    .from("learn_keywords")
    .select("id, label, name, tier, parent_keyword_id")
    .eq("category_id", DEMO_CATEGORY_ID);

  if (keywordsError) {
    return NextResponse.json({ error: keywordsError.message }, { status: 500 });
  }

  const umbrellas = (keywords ?? [])
    .filter((k) => k.tier === "umbrella")
    .map((k) => ({ id: k.id as string, label: (k.label ?? k.name ?? k.id) as string }));
  const inDepthToUmbrella: Record<string, string> = {};
  for (const k of keywords ?? []) {
    if (k.tier === "in_depth" && k.parent_keyword_id) {
      inDepthToUmbrella[k.id as string] = k.parent_keyword_id as string;
    }
  }
  const inDepthIds = Object.keys(inDepthToUmbrella);

  const BASE_COLS = "id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights, action_weights, representation_weights, prerequisite_weights, avg_rating, rating_count, report_count, created_at, course";

  const runQuery = (cols: string) =>
    supabase
      .from("rag_examples")
      .select(cols)
      .not("choices", "is", null)
      .not("latex_content", "is", null)
      .order("created_at", { ascending: false })
      .limit(300);

  // Prefer the IRT-calibrated estimated_difficulty, but fall back gracefully if the
  // column hasn't been migrated yet so the diagnostic never hard-fails on schema drift.
  let { data, error } = await runQuery(`${BASE_COLS}, estimated_difficulty`);
  if (error && /estimated_difficulty/.test(error.message)) {
    ({ data, error } = await runQuery(BASE_COLS));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const filtered = rows.filter((p) => {
    const kw = (p.keyword_weights ?? {}) as Record<string, number>;
    return Object.keys(kw).some((id) => inDepthIds.includes(id));
  });

  return NextResponse.json({ problems: filtered, umbrellas, inDepthToUmbrella });
}
