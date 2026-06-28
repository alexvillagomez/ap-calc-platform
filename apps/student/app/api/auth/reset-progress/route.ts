/**
 * POST /api/auth/reset-progress
 *
 * Wipes the AUTHENTICATED caller's learning progress WITHOUT deleting their
 * account. The caller is identified ONLY from the verified GoTrue session
 * (never a client-supplied id), so a user can only ever reset their own rows.
 *
 * After this runs the user is back to a fresh state: no mastery, no attempts,
 * no flashcard SRS, no diagnostics, no streak, no "intro seen" flags. The
 * account, profile, email and password are untouched.
 *
 * Per-user progress rows are keyed by `session_id = uid` (a few key on
 * `user_id`). Deletes are best-effort per table so a missing/renamed table
 * never blocks the reset.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUid } from "@/lib/supabaseServer";

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
  "math_flashcard_srs",
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

// Tables keyed by `user_id`.
const USER_ID_TABLES = ["user_streaks"];

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

  const cleared: string[] = [];

  for (const table of SESSION_ID_TABLES) {
    try {
      await admin.from(table).delete().eq("session_id", uid);
      cleared.push(table);
    } catch {
      /* ignore — missing/renamed table */
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
      cleared.push(table);
    } catch {
      /* ignore */
    }
  }

  for (const table of USER_ID_TABLES) {
    try {
      await admin.from(table).delete().eq("user_id", uid);
      cleared.push(table);
    } catch {
      /* ignore */
    }
  }

  // Reset the root session rollups (topic/action/representation strengths) by
  // deleting the row; the client re-creates a fresh one on next load.
  try {
    await admin.from("student_sessions").delete().eq("id", uid);
    cleared.push("student_sessions");
  } catch {
    /* ignore */
  }

  return NextResponse.json({ ok: true, cleared });
}
