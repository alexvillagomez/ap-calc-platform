import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateAndStoreLesson } from "@/lib/learnGenerator";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const { keyword } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);

  // Try DB first
  const { data, error } = await supabase
    .from("learn_lessons")
    .select("id, keyword_id, micro_steps, generated_at")
    .eq("keyword_id", keyword)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data) return NextResponse.json(data);

  // Not in DB — generate on demand
  const { data: kw } = await supabase
    .from("learn_keywords")
    .select("id, label, description, category_id")
    .eq("id", keyword)
    .maybeSingle();

  if (!kw) return NextResponse.json({ error: `Keyword not found: ${keyword}` }, { status: 404 });

  const generated = await generateAndStoreLesson(supabase, kw);
  if (!generated) return NextResponse.json({ error: "Generation failed — invalid model output" }, { status: 500 });

  const { data: inserted } = await supabase
    .from("learn_lessons")
    .select("id, keyword_id, micro_steps, generated_at")
    .eq("keyword_id", keyword)
    .maybeSingle();

  return NextResponse.json(inserted ?? { keyword_id: keyword, micro_steps: generated.micro_steps });
}
