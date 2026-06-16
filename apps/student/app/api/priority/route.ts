/**
 * /api/priority — "prioritize this topic" management.
 *
 * POST   add an active priority for a (session, system, keyword)
 * DELETE remove (deactivate) the active priority for a (session, system, keyword)
 * GET    list active priorities for a session (optionally filtered by system)
 *
 * On POST: reads the student's current score for the keyword from the relevant
 * *_student_keyword_states as baseline_score; target_score = min(1, baseline +
 * PRIORITY_TARGET_MARGIN). Upserts an active row in student_topic_priorities and
 * logs a 'prioritize_added' student_events row.
 *
 * FAIL-SOFT: if student_topic_priorities is missing (migration not yet applied)
 * every handler returns status 200 with { ok: false } rather than 500.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import {
  PRIORITY_TARGET_MARGIN,
  logServerEvent,
} from "@/lib/priorities";

export const runtime = "nodejs";

const COOKIE_NAME = "lodera_uid";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

type System = "math" | "mcat";

function statesTable(system: System): string {
  return system === "math"
    ? "math_student_keyword_states"
    : "mcat_student_keyword_states";
}

export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ ok: false }, { status: 200 });

  const body = (await request.json().catch(() => null)) as {
    session_id?: string;
    system?: System;
    course?: string;
    keyword_id?: string;
  } | null;

  if (!body || !body.session_id || !body.keyword_id || !body.system) {
    return NextResponse.json(
      { ok: false, error: "session_id, system, and keyword_id are required" },
      { status: 200 }
    );
  }

  const { session_id, system, keyword_id } = body;
  const course = body.course ?? null;

  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value ?? null;

  // Baseline from the student's current keyword score (defaults to 0.5).
  let baseline = 0.5;
  try {
    const { data: state } = await supabase
      .from(statesTable(system))
      .select("score")
      .eq("session_id", session_id)
      .eq("keyword_id", keyword_id)
      .maybeSingle();
    if (state && typeof state.score === "number") baseline = state.score;
  } catch {
    // ignore — fall back to default baseline
  }

  const target = Math.min(1, baseline + PRIORITY_TARGET_MARGIN);

  try {
    // Deactivate any existing active priority for this triple first so the
    // partial unique index (session_id, system, keyword_id WHERE active) never
    // conflicts, then insert the fresh active row with updated baseline/target.
    await supabase
      .from("student_topic_priorities")
      .update({ active: false, resolved_at: new Date().toISOString() })
      .eq("session_id", session_id)
      .eq("system", system)
      .eq("keyword_id", keyword_id)
      .eq("active", true);

    const { error } = await supabase.from("student_topic_priorities").insert({
      session_id,
      user_id: userId,
      system,
      course,
      keyword_id,
      baseline_score: baseline,
      target_score: target,
      active: true,
    });

    if (error) return NextResponse.json({ ok: false }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  await logServerEvent(supabase, {
    event_type: "prioritize_added",
    system,
    session_id,
    user_id: userId,
    course,
    keyword_id,
    metadata: { baseline_score: baseline, target_score: target },
  });

  return NextResponse.json({
    ok: true,
    baseline_score: baseline,
    target_score: target,
  });
}

export async function DELETE(request: Request) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ ok: false }, { status: 200 });

  // Accept params from either the query string or a JSON body.
  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as {
    session_id?: string;
    system?: System;
    keyword_id?: string;
  } | null;

  const session_id = body?.session_id ?? url.searchParams.get("session_id") ?? undefined;
  const system = (body?.system ?? url.searchParams.get("system") ?? undefined) as
    | System
    | undefined;
  const keyword_id =
    body?.keyword_id ?? url.searchParams.get("keyword_id") ?? undefined;

  if (!session_id || !system || !keyword_id) {
    return NextResponse.json(
      { ok: false, error: "session_id, system, and keyword_id are required" },
      { status: 200 }
    );
  }

  try {
    const { error } = await supabase
      .from("student_topic_priorities")
      .update({ active: false, resolved_at: new Date().toISOString() })
      .eq("session_id", session_id)
      .eq("system", system)
      .eq("keyword_id", keyword_id)
      .eq("active", true);

    if (error) return NextResponse.json({ ok: false }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ ok: false, priorities: [] }, { status: 200 });

  const url = new URL(request.url);
  const session_id = url.searchParams.get("session_id") ?? undefined;
  const system = url.searchParams.get("system") ?? undefined;

  if (!session_id) {
    return NextResponse.json(
      { ok: false, error: "session_id is required", priorities: [] },
      { status: 200 }
    );
  }

  try {
    let query = supabase
      .from("student_topic_priorities")
      .select(
        "keyword_id, system, course, baseline_score, target_score, created_at"
      )
      .eq("session_id", session_id)
      .eq("active", true);
    if (system) query = query.eq("system", system);

    const { data, error } = await query;
    if (error) return NextResponse.json({ ok: false, priorities: [] }, { status: 200 });

    return NextResponse.json({ ok: true, priorities: data ?? [] });
  } catch {
    return NextResponse.json({ ok: false, priorities: [] }, { status: 200 });
  }
}
