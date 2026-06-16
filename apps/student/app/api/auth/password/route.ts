/**
 * PUT /api/auth/password
 *
 * Changes the signed-in user's password.
 * Reads the httpOnly cookie "lodera_uid" to identify the user.
 *
 * Body: { currentPassword: string, newPassword: string }
 *
 * - 401 if no cookie / user not found.
 * - 400 if currentPassword is wrong, or newPassword is weaker than 8 chars.
 * - 200 { ok: true } on success.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { hashPassword, verifyPassword } from "@/lib/password";

const COOKIE_NAME = "lodera_uid";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key);
}

interface PasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

export async function PUT(request: Request) {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: PasswordBody;
  try {
    body = (await request.json()) as PasswordBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const currentPassword = body.currentPassword;
  const newPassword = body.newPassword;

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Current and new password are required." },
      { status: 400 }
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters." },
      { status: 400 }
    );
  }

  let sb: ReturnType<typeof supabaseAdmin>;
  try {
    sb = supabaseAdmin();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: user } = await sb
    .from("app_users")
    .select("id, password_hash")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const valid = await verifyPassword(currentPassword, user.password_hash as string);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const newHash = await hashPassword(newPassword);
  const { error: updateErr } = await sb
    .from("app_users")
    .update({ password_hash: newHash })
    .eq("id", userId);

  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message ?? "Failed to update password" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
