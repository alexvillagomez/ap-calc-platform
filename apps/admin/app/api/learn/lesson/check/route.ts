import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const keyword_id = searchParams.get("keyword_id");

  if (!keyword_id) return NextResponse.json({ error: "keyword_id required" }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);

  const { data, error } = await supabase
    .from("learn_lessons")
    .select("id")
    .eq("keyword_id", keyword_id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ exists: data !== null });
}
