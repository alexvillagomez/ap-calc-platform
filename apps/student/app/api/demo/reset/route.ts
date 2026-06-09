import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

interface ResetBody {
  accountId?: string;
  sessionId?: string;
}

/**
 * Full diagnostic/practice reset for a student. Clears the server-side progress
 * so "Restart diagnostic" genuinely starts over:
 *   - deletes all learn_student_keyword_states for the session
 *   - clears the diagnostic_completed_at flag on the account (so routing/mount
 *     guards no longer treat the student as finished)
 *   - clears the saved practice position on the session
 * Graceful: any column/table that isn't present is tolerated (best-effort).
 */
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await req.json()) as ResetBody;
  const { accountId, sessionId } = body;
  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  try {
    await supabase.from("learn_student_keyword_states").delete().eq("session_id", sessionId);

    await supabase
      .from("student_sessions")
      .update({
        practice_keyword_id: null,
        practice_phase: null,
        practice_lesson_step: null,
        practice_problem_id: null,
        practice_updated_at: null,
      })
      .eq("id", sessionId);

    if (accountId) {
      await supabase
        .from("student_accounts")
        .update({ diagnostic_completed_at: null })
        .eq("id", accountId);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
