import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPassword } from "@/lib/password";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const body = (await request.json()) as { username?: string; password?: string };
  const username = body.username?.trim().toLowerCase();
  const password = body.password;

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: account, error } = await supabase
    .from("student_accounts")
    .select("id, username, password_hash, session_id")
    .eq("username", username)
    .maybeSingle();

  if (error || !account) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const valid = await verifyPassword(password, account.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  return NextResponse.json({
    accountId: account.id,
    username: account.username,
    sessionId: account.session_id,
  });
}
