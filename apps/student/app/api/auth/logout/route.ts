/**
 * POST /api/auth/logout
 *
 * Signs the user out of Supabase Auth (clears the GoTrue session cookie).
 * The client also calls supabase.auth.signOut() directly; this keeps the
 * server-side route working too.
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
