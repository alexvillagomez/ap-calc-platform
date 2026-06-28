/**
 * GET /api/auth/me
 *
 * Identity comes from Supabase Auth (the verified GoTrue session cookie):
 *   const supabase = await supabaseServer();
 *   const { data: { user } } = await supabase.auth.getUser();
 * Returns 401 if there is no authenticated user.
 *
 * Response shape (unchanged for the client):
 *   { user: { id, email, username, created_at, first_name, last_name,
 *             display_name, grade_level, target_exam_date, updated_at },
 *     streak: { current_streak, longest_streak } }
 *
 * email comes from the auth user; the rest from `profiles`; streak from
 * `user_streaks`. Profile/streak reads use the service-role client.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key);
}

export async function GET() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let sb: ReturnType<typeof supabaseAdmin>;
  try {
    sb = supabaseAdmin();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // Read the profile row; fall back gracefully if missing.
  const { data: profile } = await sb
    .from("profiles")
    .select(
      "id, username, created_at, first_name, last_name, display_name, grade_level, target_exam_date, updated_at"
    )
    .eq("id", user.id)
    .maybeSingle();

  const p = (profile ?? {}) as Record<string, unknown>;

  const { data: streakRow } = await sb
    .from("user_streaks")
    .select("current_streak, longest_streak")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      username: p.username ?? null,
      created_at: p.created_at ?? null,
      first_name: p.first_name ?? null,
      last_name: p.last_name ?? null,
      display_name: p.display_name ?? null,
      grade_level: p.grade_level ?? null,
      target_exam_date: p.target_exam_date ?? null,
      updated_at: p.updated_at ?? null,
    },
    streak: {
      current_streak: (streakRow?.current_streak as number) ?? 0,
      longest_streak: (streakRow?.longest_streak as number) ?? 0,
    },
  });
}
