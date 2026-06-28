/**
 * PUT /api/auth/password
 *
 * Changes the signed-in user's password via Supabase Auth. The caller is
 * already authenticated through the GoTrue session cookie, so we update the
 * password directly with supabase.auth.updateUser({ password }).
 *
 * Body: { currentPassword?: string, newPassword: string }
 *
 * - 401 if not authenticated.
 * - 400 if newPassword is shorter than 8 chars.
 * - 200 { ok: true } on success.
 */
import { NextResponse } from "next/server";
import { getAuthUid, supabaseServer } from "@/lib/supabaseServer";

interface PasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

export async function PUT(request: Request) {
  const userId = await getAuthUid();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: PasswordBody;
  try {
    body = (await request.json()) as PasswordBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const newPassword = body.newPassword;
  if (!newPassword) {
    return NextResponse.json({ error: "New password is required." }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to update password" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
