/**
 * GET /api/math/sample-question
 *
 * Returns ONE curated, publicly-accessible math question for the free-trial
 * "try a question" onboarding flow.
 *
 * Safety contract:
 *  - No auth required (explicitly public).
 *  - Read-only: zero writes to any table.
 *  - Uses service-role key server-side — never exposed to the client.
 *  - Returns a fixed question (by stable question_id anchor) so the copy is
 *    always high-quality and well-understood. Falls back to the best-rated
 *    active question if the anchor is missing (e.g. fresh DB seed).
 *  - No student data is read or written.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// A well-known, broadly-accessible precalc question used as the trial anchor.
// If absent in the DB (empty seed), the route falls back to the top-rated
// active question — the anchor is NEVER required to exist.
const ANCHOR_STEM_CONTAINS = "slope";

type DbQuestion = {
  id: string;
  stem_latex: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
  hint_latex: string | null;
  keyword_weights: Record<string, number>;
  difficulty: number;
};

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Service-role key: stays server-side, never sent to the browser.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, key);

  // Try to find a well-known accessible question first (anchor by stem keyword)
  const { data: anchorRows } = await supabase
    .from("math_questions")
    .select("id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty")
    .eq("status", "active")
    .ilike("stem_latex", `%${ANCHOR_STEM_CONTAINS}%`)
    .order("avg_rating", { ascending: false, nullsFirst: false })
    .limit(5);

  let question: DbQuestion | null = (anchorRows ?? [])[0] ?? null;

  // Fallback: grab the best-rated easy active question
  if (!question) {
    const { data: fallbackRows } = await supabase
      .from("math_questions")
      .select("id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty")
      .eq("status", "active")
      .lte("difficulty", 0.45)
      .order("avg_rating", { ascending: false, nullsFirst: false })
      .limit(1);

    question = (fallbackRows ?? [])[0] ?? null;
  }

  // Last-resort: any active question
  if (!question) {
    const { data: anyRows } = await supabase
      .from("math_questions")
      .select("id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty")
      .eq("status", "active")
      .limit(1);

    question = (anyRows ?? [])[0] ?? null;
  }

  if (!question) {
    return NextResponse.json({ error: "No sample question available" }, { status: 404 });
  }

  // Return a clean, minimal shape — no internal scoring fields.
  return NextResponse.json({
    question: {
      id: question.id,
      stem_latex: question.stem_latex,
      choices: question.choices,
      correct_index: question.correct_index,
      solution_latex: question.solution_latex,
      hint_latex: question.hint_latex,
      difficulty: question.difficulty,
    },
  });
}
