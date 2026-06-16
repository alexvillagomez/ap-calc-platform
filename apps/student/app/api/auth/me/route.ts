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

  // Try selecting the extended profile columns; fall back to the original set
  // if the migration adding them hasn't been applied to this DB yet.
  const fullSelect =
    "id, email, username, created_at, first_name, last_name, display_name, grade_level, target_exam_date, updated_at";

  let user: Record<string, unknown> | null = null;
  const extended = await sb.from("app_users").select(fullSelect).eq("id", userId).maybeSingle();
  if (!extended.error) {
    user = extended.data as Record<string, unknown> | null;
  } else {
    const basic = await sb
      .from("app_users")
      .select("id, email, username")
      .eq("id", userId)
      .maybeSingle();
    user = basic.data as Record<string, unknown> | null;
  }

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: streakRow } = await sb
    .from("user_streaks")
    .select("current_streak, longest_streak")
    .eq("user_id", userId)
    .maybeSingle();

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      // Extended fields — present only if the migration is applied.
      created_at: user.created_at ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      display_name: user.display_name ?? null,
      grade_level: user.grade_level ?? null,
      target_exam_date: user.target_exam_date ?? null,
      updated_at: user.updated_at ?? null,
    },
    streak: {
      current_streak: (streakRow?.current_streak as number) ?? 0,
      longest_streak: (streakRow?.longest_streak as number) ?? 0,
    },
  });
}
