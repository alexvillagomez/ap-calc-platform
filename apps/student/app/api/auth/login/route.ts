/**
 * POST /api/auth/login
 *
 * Body: { email: string, username: string, password: string }
 *
 * Behaviour:
 *   - If email exists in app_users → verify password. On mismatch → 401.
 *   - If email does NOT exist → auto-create account (no verification needed).
 *   - On success: create or reuse a student_session linked via user_id,
 *     set httpOnly cookie "lodera_uid" containing the user UUID,
 *     return { user: { id, email, username }, streak: { current_streak, longest_streak } }.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

const COOKIE_NAME = "lodera_uid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  if (!hashed || !salt) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  try {
    return timingSafeEqual(Buffer.from(hashed, "hex"), buf);
  } catch {
    return false;
  }
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key);
}

export async function POST(request: Request) {
  let body: { email?: string; username?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; username?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email    = body.email?.trim().toLowerCase();
  const username = body.username?.trim();
  const password = body.password;

  if (!email || !username || !password) {
    return NextResponse.json({ error: "email, username, and password are required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  let sb: ReturnType<typeof supabaseAdmin>;
  try {
    sb = supabaseAdmin();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // ── Look up by email ────────────────────────────────────────────────────────
  const { data: existingUser } = await sb
    .from("app_users")
    .select("id, email, username, password_hash")
    .eq("email", email)
    .maybeSingle();

  let userId: string;
  let resolvedUsername: string;

  if (existingUser) {
    // Email registered — verify password
    const valid = await verifyPassword(password, existingUser.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "That email is registered with a different password." },
        { status: 401 }
      );
    }
    userId = existingUser.id as string;
    resolvedUsername = existingUser.username as string;
  } else {
    // New email — auto-create account
    const hash = await hashPassword(password);
    const { data: newUser, error: createErr } = await sb
      .from("app_users")
      .insert({ email, username, password_hash: hash })
      .select("id, email, username")
      .single();

    if (createErr || !newUser) {
      return NextResponse.json(
        { error: createErr?.message ?? "Failed to create account" },
        { status: 500 }
      );
    }
    userId = newUser.id as string;
    resolvedUsername = newUser.username as string;

    // Bootstrap streak row
    await sb.from("user_streaks").upsert({ user_id: userId }, { onConflict: "user_id" });
  }

  // ── Create or reuse a student_session linked to this user ───────────────────
  const { data: existingSession } = await sb
    .from("student_sessions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let sessionId: string;
  if (existingSession) {
    sessionId = existingSession.id as string;
  } else {
    sessionId = crypto.randomUUID();
    await sb.from("student_sessions").insert({
      id: sessionId,
      user_id: userId,
      topic_strengths: {},
      action_strengths: {},
      representation_strengths: {},
    });
  }

  // ── Ensure streak row exists (idempotent) ───────────────────────────────────
  await sb.from("user_streaks").upsert({ user_id: userId }, { onConflict: "user_id" });

  // ── Fetch streak ────────────────────────────────────────────────────────────
  const { data: streakRow } = await sb
    .from("user_streaks")
    .select("current_streak, longest_streak")
    .eq("user_id", userId)
    .maybeSingle();

  const streak = {
    current_streak: (streakRow?.current_streak as number) ?? 0,
    longest_streak: (streakRow?.longest_streak as number) ?? 0,
  };

  // ── Set httpOnly cookie ─────────────────────────────────────────────────────
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  return NextResponse.json({
    user: { id: userId, email, username: resolvedUsername },
    sessionId,
    streak,
  });
}
