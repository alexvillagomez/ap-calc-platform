/**
 * PUT /api/auth/user
 *
 * Updates the signed-in user's profile. Identity comes from Supabase Auth
 * via getAuthUid() (401 if not signed in).
 *
 * Body (all optional except validation rules below):
 *   { first_name, last_name, display_name, grade_level, target_exam_date,
 *     username, email }
 *
 * - Validates email format + uniqueness (against `profiles`, no collision with
 *   another user).
 * - Requires non-empty username when provided.
 * - Updates the `profiles` row (service-role).
 * - On email change, also calls supabase.auth.updateUser({ email }) best-effort
 *   (fail-soft) so Supabase Auth proper reflects the new address.
 *
 * Returns { user } with the refreshed profile fields (email from auth). 401 if
 * not authenticated.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUid, supabaseServer } from "@/lib/supabaseServer";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserBody {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  grade_level?: string | null;
  target_exam_date?: string | null;
  username?: string;
  email?: string;
}

export async function PUT(request: Request) {
  const userId = await getAuthUid();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: UserBody;
  try {
    body = (await request.json()) as UserBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let sb: ReturnType<typeof supabaseAdmin>;
  try {
    sb = supabaseAdmin();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const username = body.username?.trim();
  const email = body.email?.trim().toLowerCase();

  if (username !== undefined && !username) {
    return NextResponse.json({ error: "Username cannot be empty." }, { status: 400 });
  }
  if (email !== undefined) {
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    // Uniqueness — reject collision with a different user (against profiles).
    const { data: clash } = await sb
      .from("profiles")
      .select("id")
      .eq("email", email)
      .neq("id", userId)
      .maybeSingle();
    if (clash) {
      return NextResponse.json(
        { error: "That email is already in use by another account." },
        { status: 409 }
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (username !== undefined) update.username = username;
  if (email !== undefined) update.email = email;
  if (body.first_name !== undefined) update.first_name = body.first_name || null;
  if (body.last_name !== undefined) update.last_name = body.last_name || null;
  if (body.display_name !== undefined) update.display_name = body.display_name || null;
  if (body.grade_level !== undefined) update.grade_level = body.grade_level || null;
  if (body.target_exam_date !== undefined) update.target_exam_date = body.target_exam_date || null;
  update.updated_at = new Date().toISOString();

  const select =
    "id, email, username, created_at, first_name, last_name, display_name, grade_level, target_exam_date, updated_at";

  const { data: updated, error } = await sb
    .from("profiles")
    .update(update)
    .eq("id", userId)
    .select(select)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to update profile" },
      { status: 500 }
    );
  }

  // Best-effort: propagate email change to Supabase Auth proper.
  if (email !== undefined) {
    try {
      const supabase = await supabaseServer();
      await supabase.auth.updateUser({ email });
    } catch {
      // fail-soft — profile is updated; auth email sync is non-blocking.
    }
  }

  return NextResponse.json({ user: updated });
}
