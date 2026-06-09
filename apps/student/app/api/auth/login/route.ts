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

  // Read the diagnostic-completion flag separately and defensively: the column
  // may not exist yet (migration not applied), in which case we default to null
  // (treated as "not completed") rather than breaking login.
  let diagnosticCompletedAt: string | null = null;
  const { data: flag } = await supabase
    .from("student_accounts")
    .select("diagnostic_completed_at")
    .eq("id", account.id)
    .maybeSingle();
  if (flag && "diagnostic_completed_at" in flag) {
    diagnosticCompletedAt = (flag as { diagnostic_completed_at: string | null }).diagnostic_completed_at ?? null;
  }

  return NextResponse.json({
    accountId: account.id,
    username: account.username,
    sessionId: account.session_id,
    diagnosticCompletedAt,
  });
}
