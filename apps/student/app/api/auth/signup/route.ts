/**
 * POST /api/auth/signup  { email, username, password }
 *
 * Creates a Supabase Auth user that is ALREADY email-confirmed, server-side, via
 * the admin API — so it sends NO confirmation email (avoids GoTrue's built-in
 * email rate limit) and the user can log in instantly. This is the "no email
 * verification" UX, made independent of the project's "Confirm email" dashboard
 * setting. The client signs in (signInWithPassword) right after to establish the
 * cookie session. The `on_auth_user_created` trigger provisions profile + streak.
 *
 * Service-role key is used ONLY here on the server and never exposed to the client.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Server auth is not configured (missing service-role key)." },
      { status: 500 }
    );
  }

  let body: { email?: string; username?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const username = body.username?.trim();
  const password = body.password;

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!username || username.length < 2) {
    return NextResponse.json({ error: "Username must be at least 2 characters." }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // pre-confirmed → instant login, no email sent
    user_metadata: { username },
  });

  if (error) {
    const msg = error.message ?? "";
    if (/already.*registered|already.*exists|duplicate/i.test(msg)) {
      return NextResponse.json(
        { error: "An account with that email already exists. Switch to Log in.", code: "email_exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg || "Failed to create account" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, userId: data.user?.id ?? null });
}
