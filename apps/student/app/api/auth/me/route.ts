/**
 * GET /api/auth/me
 *
 * Returns { user: { id, email, username }, streak: { current_streak, longest_streak } }
 * from the httpOnly cookie "lodera_uid".
 * Returns 401 if no cookie or user not found.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const COOKIE_NAME = "lodera_uid";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key);
}

export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let sb: ReturnType<typeof supabaseAdmin>;
  try {
    sb = supabaseAdmin();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: user } = await sb
    .from("app_users")
    .select("id, email, username")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: streakRow } = await sb
    .from("user_streaks")
    .select("current_streak, longest_streak")
    .eq("user_id", userId)
    .maybeSingle();

  return NextResponse.json({
    user: { id: user.id, email: user.email, username: user.username },
    streak: {
      current_streak: (streakRow?.current_streak as number) ?? 0,
      longest_streak: (streakRow?.longest_streak as number) ?? 0,
    },
  });
}
