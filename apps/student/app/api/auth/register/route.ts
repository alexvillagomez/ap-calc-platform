import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashPassword } from "@/lib/password";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const body = (await request.json()) as { username?: string; password?: string; existingSessionId?: string };
  const username = body.username?.trim().toLowerCase();
  const password = body.password;
  const existingSessionId = body.existingSessionId?.trim() || null;

  if (!username || username.length < 2) {
    return NextResponse.json({ error: "Username must be at least 2 characters" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Check username availability
  const { data: existing } = await supabase
    .from("student_accounts")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Username is already taken" }, { status: 409 });
  }

  // Adopt a pre-existing guest session (if any) so practice done before
  // registering carries over, rather than always starting from a blank slate.
  let sessionId: string | null = null;
  if (existingSessionId) {
    const [{ data: guestSession }, { data: claimedBy }] = await Promise.all([
      supabase.from("student_sessions").select("id").eq("id", existingSessionId).maybeSingle(),
      supabase.from("student_accounts").select("id").eq("session_id", existingSessionId).maybeSingle(),
    ]);
    if (guestSession && !claimedBy) {
      sessionId = guestSession.id;
    }
  }

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    const { error: sessionError } = await supabase
      .from("student_sessions")
      .insert({ id: sessionId, topic_strengths: {}, action_strengths: {}, representation_strengths: {} });

    if (sessionError) {
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }
  }

  // Create the account
  const password_hash = await hashPassword(password);
  const { data: account, error: accountError } = await supabase
    .from("student_accounts")
    .insert({ username, password_hash, session_id: sessionId })
    .select("id, username, session_id")
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }

  return NextResponse.json({
    accountId: account.id,
    username: account.username,
    sessionId: account.session_id,
    diagnosticCompletedAt: null,
  });
}
