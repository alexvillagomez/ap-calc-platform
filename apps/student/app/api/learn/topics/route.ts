import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TOPIC_LABELS: Record<string, string> = {
  exponent_rules: "Exponent Rules",
  functions: "Functions",
  function_transformations: "Function Transformations",
  inverse_functions: "Inverse Functions",
  piecewise_functions: "Piecewise Functions",
  polynomials: "Polynomials",
  rational_functions: "Rational Functions",
  exponential_and_logarithmic_functions: "Exponential & Logarithmic Functions",
  trigonometry: "Trigonometry",
};

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ topics: [] });

  const supabase = createClient(supabaseUrl, key);

  // Get all distinct category_ids from learn_keywords (column is category_id, not topic_id)
  const { data } = await supabase
    .from("learn_keywords")
    .select("category_id")
    .eq("tier", "in_depth")
    .not("category_id", "is", null)
    .limit(500);

  // Deduplicate
  const seen = new Set<string>();
  const topics: { id: string; label: string }[] = [];
  for (const row of data ?? []) {
    if (!seen.has(row.category_id)) {
      seen.add(row.category_id);
      const label = TOPIC_LABELS[row.category_id] ?? row.category_id;
      topics.push({ id: row.category_id, label });
    }
  }

  // Only include topics that exist in TOPIC_LABELS (known precalc topics)
  const filtered = topics.filter(t => TOPIC_LABELS[t.id] !== undefined);

  return NextResponse.json({ topics: filtered });
}
