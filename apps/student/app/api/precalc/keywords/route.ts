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

export type PrecalcKeyword = {
  id: string;
  label: string;
  topic_id: string;
  topic_label: string;
  tier: string;
};

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ keywords: [] });

  const supabase = createClient(supabaseUrl, key);

  const { data, error } = await supabase
    .from("learn_keywords")
    .select("id, label, topic_id, tier")
    .eq("tier", "in_depth")
    .in("topic_id", Object.keys(TOPIC_LABELS))
    .eq("status", "approved")
    .order("topic_id")
    .order("id");

  if (error) return NextResponse.json({ keywords: [] });

  const keywords: PrecalcKeyword[] = (data ?? []).map((row: { id: string; label: string; topic_id: string; tier: string }) => ({
    id: row.id,
    label: row.label ?? row.id.replace(/_/g, " "),
    topic_id: row.topic_id,
    topic_label: TOPIC_LABELS[row.topic_id] ?? row.topic_id,
    tier: row.tier,
  }));

  return NextResponse.json({ keywords });
}
