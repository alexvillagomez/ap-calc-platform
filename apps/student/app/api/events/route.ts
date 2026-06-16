/**
 * POST /api/events
 *
 * Inserts one telemetry row into student_events.
 * FAIL-SOFT: any failure (table missing, bad body, db error) returns
 * { ok: false } with status 200 — this endpoint must never 500.
 *
 * Side effect: for a 'timer_stop' event carrying a question_id + time_ms in
 * the math/mcat systems, best-effort updates that question's time rollup
 * (time_sample_count / time_sum_ms / est_time_ms). Failures are ignored.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const COOKIE_NAME = "lodera_uid";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function POST(request: Request) {
  try {
    const sb = supabaseAdmin();
    if (!sb) return NextResponse.json({ ok: false });

    const body = await request.json().catch(() => null);
    if (!body || typeof body.event_type !== "string") {
      return NextResponse.json({ ok: false });
    }

    const cookieStore = await cookies();
    const userId = cookieStore.get(COOKIE_NAME)?.value ?? null;

    const system: string | null = body.system ?? null;
    const questionId: string | null = body.question_id ?? null;
    const timeMs: number | null = typeof body.time_ms === "number" ? body.time_ms : null;

    const row = {
      user_id: userId,
      session_id: body.session_id ?? null,
      system,
      course: body.course ?? null,
      event_type: body.event_type,
      keyword_id: body.keyword_id ?? null,
      question_id: questionId,
      content_type: body.content_type ?? null,
      correct: typeof body.correct === "boolean" ? body.correct : null,
      time_ms: timeMs,
      metadata: body.metadata ?? {},
    };

    const { error } = await sb.from("student_events").insert(row);
    if (error) return NextResponse.json({ ok: false });

    // Best-effort per-question time rollup.
    if (
      body.event_type === "timer_stop" &&
      questionId &&
      timeMs != null &&
      (system === "math" || system === "mcat")
    ) {
      try {
        const table = system === "math" ? "math_questions" : "mcat_questions";
        const { data: q } = await sb
          .from(table)
          .select("time_sample_count, time_sum_ms")
          .eq("id", questionId)
          .maybeSingle();

        if (q) {
          const count = (q.time_sample_count ?? 0) + 1;
          const sum = Number(q.time_sum_ms ?? 0) + timeMs;
          await sb
            .from(table)
            .update({
              time_sample_count: count,
              time_sum_ms: sum,
              est_time_ms: Math.round(sum / count),
            })
            .eq("id", questionId);
        }
      } catch {
        // ignore rollup failures
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
