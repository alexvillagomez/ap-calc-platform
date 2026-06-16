/**
 * PUT /api/auth/user
 *
 * Updates the signed-in user's profile.
 * Reads the httpOnly cookie "lodera_uid" to identify the user.
 *
 * Body (all optional except validation rules below):
 *   { first_name, last_name, display_name, grade_level, target_exam_date,
 *     username, email }
 *
 * - Validates email format + uniqueness (no collision with another user).
 * - Requires non-empty username.
 * - FAIL-SOFT: if updating the newer columns errors (e.g. the migration
 *   adding first_name/last_name/display_name/grade_level/target_exam_date/
 *   updated_at hasn't been applied to the live DB), falls back to updating
 *   only the guaranteed columns (username/email) and still succeeds.
 *
 * Returns { user } with the refreshed row. 401 if no cookie.
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

/** Detect Postgres "column does not exist" style errors so we can fail-soft. */
function isMissingColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42703") return true; // undefined_column
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("column") && (msg.includes("does not exist") || msg.includes("could not find"));
}

export async function PUT(request: Request) {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
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
    // Uniqueness — reject collision with a different user
    const { data: clash } = await sb
      .from("app_users")
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

  // Guaranteed columns always safe to write.
  const safeUpdate: Record<string, unknown> = {};
  if (username !== undefined) safeUpdate.username = username;
  if (email !== undefined) safeUpdate.email = email;

  // Newer columns (may not exist yet on the live DB).
  const extendedUpdate: Record<string, unknown> = { ...safeUpdate };
  if (body.first_name !== undefined) extendedUpdate.first_name = body.first_name || null;
  if (body.last_name !== undefined) extendedUpdate.last_name = body.last_name || null;
  if (body.display_name !== undefined) extendedUpdate.display_name = body.display_name || null;
  if (body.grade_level !== undefined) extendedUpdate.grade_level = body.grade_level || null;
  if (body.target_exam_date !== undefined)
    extendedUpdate.target_exam_date = body.target_exam_date || null;
  extendedUpdate.updated_at = new Date().toISOString();

  const fullSelect =
    "id, email, username, created_at, first_name, last_name, display_name, grade_level, target_exam_date, updated_at";
  const safeSelect = "id, email, username, created_at";

  // Try the full update first.
  const attempt = await sb
    .from("app_users")
    .update(extendedUpdate)
    .eq("id", userId)
    .select(fullSelect)
    .maybeSingle();

  if (!attempt.error && attempt.data) {
    return NextResponse.json({ user: attempt.data });
  }

  // FAIL-SOFT: missing columns → retry with only guaranteed columns.
  if (isMissingColumnError(attempt.error)) {
    if (Object.keys(safeUpdate).length === 0) {
      // Nothing guaranteed to write — just return the current row.
      const { data: current } = await sb
        .from("app_users")
        .select(safeSelect)
        .eq("id", userId)
        .maybeSingle();
      return NextResponse.json({ user: current });
    }
    const fallback = await sb
      .from("app_users")
      .update(safeUpdate)
      .eq("id", userId)
      .select(safeSelect)
      .maybeSingle();
    if (!fallback.error && fallback.data) {
      return NextResponse.json({ user: fallback.data });
    }
    return NextResponse.json(
      { error: fallback.error?.message ?? "Failed to update profile" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { error: attempt.error?.message ?? "Failed to update profile" },
    { status: 500 }
  );
}
