import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateAndStoreTip } from "@/lib/learnGenerator";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const { keyword } = await params;
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);

  const { data, error } = await supabase
    .from("learn_tips")
    .select("id, keyword_id, tip_latex")
    .eq("keyword_id", keyword)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tip = data ?? await (async () => {
    const { data: kw } = await supabase
      .from("learn_keywords")
      .select("id, label, description, category_id")
      .eq("id", keyword)
      .maybeSingle();
    if (!kw) return null;
    return generateAndStoreTip(supabase, kw);
  })();

  if (!tip) return NextResponse.json({ error: `No tip for keyword: ${keyword}` }, { status: 404 });

  // Log tip event (fire-and-forget)
  if (sessionId) {
    void supabase.from("learn_tip_events").insert({ session_id: sessionId, keyword_id: keyword });
  }

  return NextResponse.json(tip);
}
