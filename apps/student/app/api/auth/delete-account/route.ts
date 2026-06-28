/**
 * POST /api/auth/delete-account
 *
 * Permanently deletes the AUTHENTICATED caller's account and all per-user
 * progress data. The caller is identified ONLY from the verified GoTrue
 * session (never a client-supplied id).
 *
 * Per-user progress rows are keyed by `session_id = uid` and are NOT cascade-
 * linked to auth.users, so we delete them explicitly (best-effort) before the
 * admin auth delete. Deleting the auth user cascades profiles + user_streaks +
 * auth.* internals.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUid, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

// Progress tables keyed by `session_id = uid`.
const SESSION_ID_TABLES = [
  "math_student_keyword_states",
  "mcat_student_keyword_states",
  "learn_student_keyword_states",
  "math_question_attempts",
  "mcat_question_attempts",
  "math_flashcard_attempts",
  "mcat_flashcard_attempts",
  "mcat_flashcard_srs",
  "math_diagnostic_sessions",
  "mcat_diagnostic_sessions",
  "math_content_feedback",
  "mcat_content_feedback",
  "content_ratings",
  "content_reports",
  "student_problem_attempts",
  "anki_card_attempts",
];

// Tables that may key on either `session_id` or `user_id`.
const DUAL_KEY_TABLES = ["student_events", "student_topic_priorities"];

export async function POST() {
  const uid = await getAuthUid();
  if (!uid) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Best-effort: delete per-user progress rows. Ignore per-table errors so a
  // missing/renamed table never blocks the account deletion.
  for (const table of SESSION_ID_TABLES) {
    try {
      await admin.from(table).delete().eq("session_id", uid);
    } catch {
      /* ignore */
    }
  }

  for (const table of DUAL_KEY_TABLES) {
    try {
      await admin.from(table).delete().eq("session_id", uid);
    } catch {
      /* ignore */
    }
    try {
      await admin.from(table).delete().eq("user_id", uid);
    } catch {
      /* ignore */
    }
  }

  try {
    await admin.from("student_sessions").delete().eq("id", uid);
  } catch {
    /* ignore */
  }

  // Delete the auth user (cascades profiles + user_streaks + auth.* internals).
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Clear the session server-side (best-effort).
  try {
    const sb = await supabaseServer();
    await sb.auth.signOut();
  } catch {
    /* ignore */
  }

  return NextResponse.json({ ok: true });
}
