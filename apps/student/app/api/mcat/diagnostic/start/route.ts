/**
 * POST /api/mcat/diagnostic/start
 *
 * Start a short MCAT Biology placement diagnostic. Mirrors the math diagnostic
 * (app/api/math/diagnostic/start) but adapted to the isolated mcat_* tables and
 * the simpler MCAT placement intent.
 *
 * ─── DIAGNOSTIC ALGORITHM (SIMPLE, UMBRELLA-LEVEL) ───────────────────────────
 *
 * GOAL: fewest problems. Map weak/strong at the UMBRELLA level (NOT every
 * subtopic). We walk umbrella keywords in CED order (category.order_index, then
 * umbrella.order_index) and ask ONE placement question per umbrella, capped at
 * ~10 questions. Each answer marks that umbrella known/unknown.
 *
 *   - tier='umbrella' keywords in mcat_keywords (status='approved') give the
 *     placement order; we cap the asked list at MAX_QUESTIONS.
 *   - Question selection prefers a stored mid-difficulty mcat_questions row for
 *     the umbrella's category (and, when possible, carrying the umbrella id in
 *     keyword_weights); falls back to generation (fail-open).
 *
 * On completion (see /diagnostic/answer):
 *   - For each umbrella estimated KNOWN, its in_depth children are marked with a
 *     score (0.8) + state 'mastered' so auto-plan's frontier skips ahead.
 *   - Unknown umbrellas are left unset → auto mode starts there in course order.
 *
 * SIMPLIFICATION vs math: no prereq-edge propagation and no adaptive
 * binary-search over the chain — MCAT placement is a straight umbrella sweep
 * (one question each, in order). This is the "correct simpler version" called
 * for in the task; it keeps placement short and umbrella-level.
 *
 * Body: { session_id }
 * Response: { diagnostic_session_id, question, question_number, total_estimated, done:false }
 *           | { done:true } when nothing to ask.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  MAX_QUESTIONS,
  loadUmbrellaOrder,
  getQuestionForUmbrella,
  formatQuestion,
  type AskEntry,
} from "@/lib/mcatDiagnostic";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await request.json()) as { session_id?: string };
  const { session_id } = body;
  if (!session_id) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  // Build the ordered umbrella placement list (CED order).
  const umbrellas = await loadUmbrellaOrder(supabase);
  if (umbrellas.length === 0) {
    return NextResponse.json(
      { error: "No umbrella keywords found — MCAT taxonomy may not be seeded yet" },
      { status: 404 }
    );
  }

  // Reuse an existing in_progress session if present; else create one.
  const { data: existing } = await supabase
    .from("mcat_diagnostic_sessions")
    .select("id, asked, category_estimates")
    .eq("session_id", session_id)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let diagnosticId: string;
  if (existing?.id) {
    diagnosticId = existing.id as string;
  } else {
    const { data: created, error: createErr } = await supabase
      .from("mcat_diagnostic_sessions")
      .insert({
        session_id,
        status: "in_progress",
        asked: [],
        category_estimates: {},
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return NextResponse.json(
        { error: "Failed to create diagnostic session", detail: createErr?.message },
        { status: 500 }
      );
    }
    diagnosticId = created.id as string;
  }

  // Pick the first (or next unasked) umbrella for this session. Robustness: on a
  // cold question pool, generating a placement item can occasionally yield none —
  // so walk forward through umbrellas (in order) until one produces a question.
  // If NONE can (e.g. generation unavailable), end the diagnostic gracefully
  // (done:true) so the page routes into the in-order auto path rather than
  // dead-ending. We never skip BACKWARD, so course order is preserved.
  const askedUmbrellaIds = new Set(
    ((existing?.asked as AskEntry[] | undefined) ?? []).map((a) => a.umbrella_id)
  );
  const candidates = umbrellas.filter((u) => !askedUmbrellaIds.has(u.id));

  // Mark this diagnostic session completed. Used both when there is nothing left
  // to ask and when no umbrella can produce a (stored) placement question — so the
  // session never lingers as a zombie 'in_progress' row that re-gates auto mode.
  const markCompleted = async () => {
    await supabase
      .from("mcat_diagnostic_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", diagnosticId);
  };

  if (candidates.length === 0 || askedUmbrellaIds.size >= MAX_QUESTIONS) {
    await markCompleted();
    return NextResponse.json({ done: true, diagnostic_session_id: diagnosticId });
  }

  for (const next of candidates.slice(0, 3)) {
    // storedOnly: never block placement on OpenAI generation — fast-fail instead.
    const question = await getQuestionForUmbrella(supabase, next, [], {
      storedOnly: true,
    });
    if (!question) continue;

    // Append to existing asked (resume-safe) instead of overwriting prior entries.
    const newEntry: AskEntry = {
      umbrella_id: next.id,
      category_id: next.category_id,
      question_id: question.id,
    };
    const updatedAsked: AskEntry[] = [
      ...((existing?.asked as AskEntry[] | undefined) ?? []),
      newEntry,
    ];
    await supabase
      .from("mcat_diagnostic_sessions")
      .update({ asked: updatedAsked })
      .eq("id", diagnosticId);

    return NextResponse.json({
      done: false,
      diagnostic_session_id: diagnosticId,
      question_number: updatedAsked.length,
      total_estimated: Math.min(MAX_QUESTIONS, umbrellas.length),
      umbrella_id: next.id,
      question: formatQuestion(question),
    });
  }

  // No umbrella could produce a placement question → end gracefully AND mark the
  // session completed so auto-plan's hasCompletedDiagnostic clears the gate.
  await markCompleted();
  return NextResponse.json({ done: true, diagnostic_session_id: diagnosticId });
}

