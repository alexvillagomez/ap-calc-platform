import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);

  const { data, error } = await supabase
    .from("learn_keywords")
    .select("id")
    .is("embedding", null)
    .eq("status", "approved");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ids: (data ?? []).map((r: { id: string }) => r.id) });
}
