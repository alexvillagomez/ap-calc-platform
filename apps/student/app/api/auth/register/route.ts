import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashPassword } from "@/lib/password";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const body = (await request.json()) as { username?: string; password?: string };
  const username = body.username?.trim().toLowerCase();
  const password = body.password;

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

  // Create a new student session for this account
  const sessionId = crypto.randomUUID();
  const { error: sessionError } = await supabase
    .from("student_sessions")
    .insert({ id: sessionId, strengths: {} });

  if (sessionError) {
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
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
  });
}
