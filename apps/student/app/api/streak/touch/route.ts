/**
 * POST /api/streak/touch
 *
 * For the logged-in user (cookie "lodera_uid"):
 *   - last_active_date is today  → no-op, return { current_streak, longest_streak, extended_today: false }
 *   - last_active_date is yesterday → increment current_streak
 *   - otherwise → reset to 1
 *   - update longest_streak if needed
 *   - return { current_streak, longest_streak, extended_today: true }
 *
 * CONTRACT IS FROZEN — another agent builds UI against this exact shape.
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

/** Returns today's date as a UTC YYYY-MM-DD string. */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns yesterday's date as a UTC YYYY-MM-DD string. */
function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function POST() {
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

  // Ensure streak row exists
  await sb.from("user_streaks").upsert(
    { user_id: userId, current_streak: 0, longest_streak: 0 },
    { onConflict: "user_id", ignoreDuplicates: true }
  );

  const { data: row } = await sb
    .from("user_streaks")
    .select("current_streak, longest_streak, last_active_date")
    .eq("user_id", userId)
    .maybeSingle();

  const current = (row?.current_streak as number) ?? 0;
  const longest = (row?.longest_streak as number) ?? 0;
  const lastDate = (row?.last_active_date as string | null) ?? null;

  const today = todayUTC();
  const yesterday = yesterdayUTC();

  // Already touched today — no-op
  if (lastDate === today) {
    return NextResponse.json({
      current_streak: current,
      longest_streak: longest,
      extended_today: false,
    });
  }

  // Calculate new streak
  const newStreak = lastDate === yesterday ? current + 1 : 1;
  const newLongest = Math.max(longest, newStreak);

  await sb
    .from("user_streaks")
    .update({
      current_streak: newStreak,
      longest_streak: newLongest,
      last_active_date: today,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return NextResponse.json({
    current_streak: newStreak,
    longest_streak: newLongest,
    extended_today: true,
  });
}
