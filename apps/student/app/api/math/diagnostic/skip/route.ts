/**
 * POST /api/math/diagnostic/skip
 *
 * Persist the student's "skip the placement diagnostic" choice for a math course.
 * Without this, the skip was client-side only (auto/page applied
 * needs_diagnostic:false in memory) and the gate re-appeared on every page load.
 *
 * Inserts a COMPLETED math_diagnostic_sessions row (asked:[], category_estimates:{})
 * — only if no completed row already exists for this session+course — so
 * auto-plan's hasCompletedDiagnostic check turns true permanently.
 *
 * Body: { session_id, course }
 * Response: { ok: true, skipped: boolean }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { MathCourse } from "@/lib/mathTypes";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await request.json()) as {
    session_id?: string;
    course?: MathCourse;
  };
  const { session_id } = body;
  const course: MathCourse = body.course ?? "precalc";
  if (!session_id) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }
  if (course !== "precalc" && course !== "calc_ab") {
    return NextResponse.json(
      { error: "course must be 'precalc' or 'calc_ab'" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // Idempotent: if a completed diagnostic session already exists, do nothing.
  const { data: existing } = await supabase
    .from("math_diagnostic_sessions")
    .select("id")
    .eq("session_id", session_id)
    .eq("course", course)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return NextResponse.json({ ok: true, skipped: false });
  }

  const { error: insErr } = await supabase.from("math_diagnostic_sessions").insert({
    session_id,
    course,
    status: "completed",
    asked: [],
    category_estimates: {},
    completed_at: new Date().toISOString(),
  });

  if (insErr) {
    return NextResponse.json(
      { error: "Failed to record skip", detail: insErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, skipped: true });
}
