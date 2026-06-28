/**
 * POST /api/mcat/diagnostic/answer
 *
 * Submit an answer during an MCAT placement diagnostic (mirrors the math
 * diagnostic answer route, adapted to mcat_* tables + umbrella-level placement).
 *
 * Records the result for the current umbrella in `asked`, updates
 * `category_estimates` (umbrella_id → estimated 0–1 score), then either serves
 * the next unasked umbrella's question or finishes.
 *
 * ON FINISH:
 *   - status='completed', completed_at=now().
 *   - HAND-OFF TO AUTO MODE: for every umbrella estimated KNOWN, write
 *     mcat_student_keyword_states rows for its in_depth children with
 *     score≈0.8 + state='mastered'. auto-plan's frontier advances past topics
 *     whose in_depth skills are all 'mastered', so the student starts at the
 *     first NOT-known umbrella in course order. Unknown umbrellas are left
 *     unset so auto begins there.
 *   - The completed mcat_diagnostic_sessions row also makes auto-plan treat the
 *     diagnostic as taken (needs_diagnostic=false).
 *
 * "I don't know" → treated as NOT known (same as wrong).
 *
 * Body: { session_id, diagnostic_session_id, question_id, selected_index?, dont_know? }
 * Response: { done:false, question, ... } during the sweep; { done:true, category_estimates } on finish.
 */
import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  loadUmbrellaOrder,
  getQuestionForUmbrella,
  formatQuestion,
  MAX_QUESTIONS,
  type AskEntry,
} from "@/lib/mcatDiagnostic";

export const runtime = "nodejs";

/** Score written for in_depth children of a KNOWN umbrella (mastered-ish). */
const KNOWN_SCORE = 0.8;

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
    diagnostic_session_id?: string;
    question_id?: string;
    selected_index?: number;
    dont_know?: boolean;
  };
  const {
    session_id,
    diagnostic_session_id,
    question_id,
    selected_index,
    dont_know = false,
  } = body;

  if (!session_id || !diagnostic_session_id || !question_id) {
    return NextResponse.json(
      { error: "session_id, diagnostic_session_id, and question_id are required" },
      { status: 400 }
    );
  }
  if (!dont_know && typeof selected_index !== "number") {
    return NextResponse.json(
      { error: "selected_index is required when dont_know is false" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  const { data: diag, error: diagErr } = await supabase
    .from("mcat_diagnostic_sessions")
    .select("id, session_id, status, asked, category_estimates")
    .eq("id", diagnostic_session_id)
    .maybeSingle();

  if (diagErr || !diag) {
    return NextResponse.json({ error: "Diagnostic session not found" }, { status: 404 });
  }
  if (diag.session_id !== session_id) {
    return NextResponse.json({ error: "session_id mismatch" }, { status: 403 });
  }
  if ((diag.status as string) !== "in_progress") {
    return NextResponse.json(
      { error: "Diagnostic session is already completed" },
      { status: 409 }
    );
  }

  const asked = (diag.asked as AskEntry[]) ?? [];
  const estimates = { ...((diag.category_estimates as Record<string, number>) ?? {}) };

  const last = asked[asked.length - 1];
  if (!last) {
    return NextResponse.json(
      { error: "No pending question found in diagnostic session" },
      { status: 400 }
    );
  }

  // Determine correctness from the stored answer key.
  const { data: qRow, error: qErr } = await supabase
    .from("mcat_questions")
    .select("correct_index")
    .eq("id", question_id)
    .maybeSingle();
  if (qErr || !qRow) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  const correct = dont_know ? false : selected_index === (qRow.correct_index as number);

  // Record the result on the current umbrella.
  estimates[last.umbrella_id] = correct ? KNOWN_SCORE : 0.25;
  const updatedAsked: AskEntry[] = asked.map((a, i) =>
    i === asked.length - 1 ? { ...a, correct, dont_know } : a
  );

  // Build the ordered umbrella sweep and find the next unasked one.
  const umbrellas = await loadUmbrellaOrder(supabase);
  const askedIds = new Set(updatedAsked.map((a) => a.umbrella_id));
  const next = umbrellas.find((u) => !askedIds.has(u.id));
  const reachedCap = updatedAsked.length >= MAX_QUESTIONS;

  const shouldComplete = !next || reachedCap;

  if (shouldComplete) {
    await writeHandoffStates(supabase, session_id, updatedAsked, estimates);
    await supabase
      .from("mcat_diagnostic_sessions")
      .update({
        status: "completed",
        asked: updatedAsked,
        category_estimates: estimates,
        completed_at: new Date().toISOString(),
      })
      .eq("id", diagnostic_session_id);
    return NextResponse.json({ done: true, category_estimates: estimates });
  }

  // Serve the next umbrella's question.
  const seenIds = updatedAsked.map((a) => a.question_id);
  const nextQuestion = await getQuestionForUmbrella(supabase, next!, seenIds);

  if (!nextQuestion) {
    // No question for this umbrella — finish gracefully (better short than stuck).
    await writeHandoffStates(supabase, session_id, updatedAsked, estimates);
    await supabase
      .from("mcat_diagnostic_sessions")
      .update({
        status: "completed",
        asked: updatedAsked,
        category_estimates: estimates,
        completed_at: new Date().toISOString(),
      })
      .eq("id", diagnostic_session_id);
    return NextResponse.json({ done: true, category_estimates: estimates });
  }

  const nextAsked: AskEntry[] = [
    ...updatedAsked,
    { umbrella_id: next!.id, category_id: next!.category_id, question_id: nextQuestion.id },
  ];
  await supabase
    .from("mcat_diagnostic_sessions")
    .update({ asked: nextAsked, category_estimates: estimates })
    .eq("id", diagnostic_session_id);

  return NextResponse.json({
    done: false,
    question_number: nextAsked.length,
    total_estimated: Math.min(MAX_QUESTIONS, umbrellas.length),
    umbrella_id: next!.id,
    question: formatQuestion(nextQuestion),
  });
}

/**
 * Hand off to auto mode: for each KNOWN umbrella, mark its in_depth children as
 * mastered so auto-plan's frontier skips ahead. Fail-open.
 */
async function writeHandoffStates(
  supabase: SupabaseClient,
  session_id: string,
  asked: AskEntry[],
  estimates: Record<string, number>
): Promise<void> {
  try {
    const knownUmbrellaIds = asked
      .filter((a) => (estimates[a.umbrella_id] ?? 0) >= 0.6 && a.correct === true)
      .map((a) => a.umbrella_id);

    if (knownUmbrellaIds.length === 0) return;

    // in_depth children of the known umbrellas.
    const { data: children } = await supabase
      .from("mcat_keywords")
      .select("id, category_id, parent_keyword_id")
      .eq("tier", "in_depth")
      .eq("status", "approved")
      .in("parent_keyword_id", knownUmbrellaIds);

    if (!children || children.length === 0) return;

    const now = new Date().toISOString();
    const upserts = children.map((c) => ({
      session_id,
      keyword_id: c.id as string,
      category_id: c.category_id as string,
      score: KNOWN_SCORE,
      total_attempts: 0,
      correct_attempts: 0,
      consecutive_correct: 0,
      dont_know_count: 0,
      state: "mastered",
      updated_at: now,
    }));

    const BATCH = 100;
    for (let i = 0; i < upserts.length; i += BATCH) {
      const { error } = await supabase
        .from("mcat_student_keyword_states")
        .upsert(upserts.slice(i, i + BATCH), {
          onConflict: "session_id,keyword_id",
          ignoreDuplicates: false,
        });
      if (error) {
        console.error("[mcat/diagnostic/answer] handoff upsert error:", error.message);
      }
    }

    console.log(
      `[mcat/diagnostic/answer] handoff: marked ${upserts.length} in_depth skills mastered ` +
        `across ${knownUmbrellaIds.length} known umbrellas`
    );
  } catch (err) {
    console.error(
      "[mcat/diagnostic/answer] writeHandoffStates failed:",
      err instanceof Error ? err.message : String(err)
    );
    // fail-open — diagnostic still completes
  }
}
