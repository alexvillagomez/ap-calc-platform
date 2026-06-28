import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function DELETE() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);

  // Delete all rows — Supabase requires a filter, so use neq on id
  const { error, count } = await supabase
    .from("learn_lessons")
    .delete({ count: "exact" })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
