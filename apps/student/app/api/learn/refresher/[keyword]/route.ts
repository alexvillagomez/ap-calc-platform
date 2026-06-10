import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateAndStoreRefresher, LearnGenError } from "@/lib/learnGenerator";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const { keyword } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);

  const { data, error } = await supabase
    .from("learn_refreshers")
    .select("id, keyword_id, rule_latex, example_latex, check_question")
    .eq("keyword_id", keyword)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data) return NextResponse.json(data);

  const { data: kw, error: kwError } = await supabase
    .from("learn_keywords")
    .select("id, label, description, category_id")
    .eq("id", keyword)
    .maybeSingle();

  if (kwError) return NextResponse.json({ error: kwError.message }, { status: 500 });
  if (!kw) return NextResponse.json({ error: `Keyword not found: ${keyword}` }, { status: 404 });

  let generated;
  try {
    generated = await generateAndStoreRefresher(supabase, kw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error(`Refresher generation failed for ${keyword}:`, detail);
    const status = err instanceof LearnGenError ? err.status : 502;
    return NextResponse.json({ error: "Refresher generation failed", detail }, { status });
  }
  if (!generated) return NextResponse.json({ error: "Refresher generation failed", detail: "invalid model output" }, { status: 502 });

  const { data: inserted } = await supabase
    .from("learn_refreshers")
    .select("id, keyword_id, rule_latex, example_latex, check_question")
    .eq("keyword_id", keyword)
    .maybeSingle();

  return NextResponse.json(inserted ?? { keyword_id: keyword, ...generated });
}
