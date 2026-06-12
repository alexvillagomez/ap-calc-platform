/**
 * POST /api/math/diagnostic/start
 *
 * Start a short adaptive placement diagnostic for a math course.
 *
 * ─── DIAGNOSTIC ALGORITHM ────────────────────────────────────────────────────
 *
 * GOAL: 8–14 questions; hard cap 16. Place the student at a starting category
 * and assign umbrella-level prior scores (0–1) for all categories.
 *
 * INPUTS:
 *   - math_prereq_edges: directed edges (from_category_id → to_category_id,
 *     strength 0–1). An edge means "failing `from` implies likely failing `to`".
 *   - math_course_categories: ordered list of categories in the course.
 *   - math_questions: stored questions for initial question selection.
 *
 * ALGORITHM (simple + deterministic):
 *
 *   1. CATEGORY CHAIN CONSTRUCTION
 *      Sort course categories by order_index → linear chain C[0..N-1].
 *      Starting position = floor(N/2) (binary-search mid-chain entry point).
 *      All category priors initialized to 0.5 (unknown).
 *
 *   2. QUESTION SELECTION (per step)
 *      For the current category, prefer a stored medium-difficulty question
 *      (difficulty 0.45–0.65) from the highest-yield umbrella keywords.
 *      If no stored questions exist, generate one (generateMathQuestions,
 *      medium difficulty, fail-open).
 *
 *   3. ANSWER PROCESSING (see /diagnostic/answer)
 *      - CORRECT (strong signal: first-time correct at medium difficulty):
 *          • current category prior ← max(current, 0.75)
 *          • propagate upstream via prereq edges (skip earlier categories)
 *          • next position = current - 1 (move toward harder/earlier)
 *      - WRONG / DONT_KNOW (weak signal):
 *          • current category prior ← min(current, 0.30)
 *          • propagate downstream via prereq edges (skip later categories)
 *          • next position = current + 1 (move toward easier)
 *
 *   4. SKIPPING HEURISTIC
 *      If a category's prior is already confidently set (≥ 0.70 or ≤ 0.30),
 *      skip it and move in the same direction without asking a question.
 *      This keeps the diagnostic short.
 *
 *   5. TERMINATION
 *      Stop when:
 *        (a) hard cap reached (16 questions asked), OR
 *        (b) we've traversed both ends of the chain (position < 0 and > N-1), OR
 *        (c) all categories have confident priors (≥ 0.70 or ≤ 0.30).
 *
 *   6. COMPLETION
 *      On completion: write priors as scores into math_student_keyword_states
 *      (umbrella tier, course set) for all categories with ≥ 1 umbrella keyword.
 *      starting_category = first category with prior ≥ 0.45 (where to begin
 *      the practice loop; defaults to first category if all are low).
 *
 * FAIL-OPEN: if math_categories is empty (taxonomy not seeded), returns 404
 * with a clear message — never crashes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Body: { session_id, course }
 * Response: { diagnostic_id, question, category_id, question_number }
 */
import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  generateMathQuestions,
  verifyMathQuestionsFast,
  MathGenError,
} from "@/lib/mathGenerator";
import { loadTargetKeywords } from "@/lib/mathTagging";
import { outlineContextForCategory } from "@/lib/mathContentOutline";
import type { MathCourse } from "@/lib/mathTypes";

export const runtime = "nodejs";

const HARD_CAP = 16;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as {
    session_id?: string;
    course?: MathCourse;
  };

  const { session_id } = body;
  const course: MathCourse = body.course ?? "precalc";

  if (!session_id) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 }
    );
  }

  if (course !== "precalc" && course !== "calc_ab") {
    return NextResponse.json(
      { error: "course must be 'precalc' or 'calc_ab'" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // Load course categories (ordered)
  const { data: memberships, error: membErr } = await supabase
    .from("math_course_categories")
    .select("category_id, role, order_index")
    .eq("course", course)
    .order("order_index");

  if (membErr || !memberships || memberships.length === 0) {
    return NextResponse.json(
      {
        error: "No categories found for this course — taxonomy may not be seeded yet",
        detail: membErr?.message,
      },
      { status: 404 }
    );
  }

  const categoryChain = memberships.map((m) => m.category_id as string);
  const N = categoryChain.length;
  const startPos = Math.floor(N / 2);
  const startCategoryId = categoryChain[startPos];

  // Initialize all priors at 0.5
  const priors: Record<string, number> = {};
  for (const catId of categoryChain) {
    priors[catId] = 0.5;
  }

  // Create diagnostic session
  const { data: diagSession, error: diagErr } = await supabase
    .from("math_diagnostic_sessions")
    .insert({
      session_id,
      course,
      status: "in_progress",
      asked: [],
      category_estimates: priors,
    })
    .select("id")
    .single();

  if (diagErr || !diagSession) {
    return NextResponse.json(
      { error: "Failed to create diagnostic session", detail: diagErr?.message },
      { status: 500 }
    );
  }

  const diagnosticId = diagSession.id as string;

  // Get the first question for the start category
  const questionResult = await getQuestionForCategory(
    supabase,
    startCategoryId,
    course,
    []
  );

  if (!questionResult) {
    return NextResponse.json(
      {
        error: "No questions available for starting category",
        diagnostic_id: diagnosticId,
      },
      { status: 404 }
    );
  }

  // Update diagnostic session with initial state
  const asked = [
    {
      category_id: startCategoryId,
      question_id: questionResult.id,
      position: startPos,
    },
  ];

  await supabase
    .from("math_diagnostic_sessions")
    .update({
      asked,
      category_estimates: priors,
    })
    .eq("id", diagnosticId);

  return NextResponse.json({
    diagnostic_id: diagnosticId,
    question_number: 1,
    total_estimated: Math.min(HARD_CAP, Math.ceil(N * 0.7)),
    category_id: startCategoryId,
    question: {
      id: questionResult.id,
      stem_latex: questionResult.stem_latex,
      choices: questionResult.choices,
      correct_index: questionResult.correct_index,
      solution_latex: questionResult.solution_latex,
      hint_latex: questionResult.hint_latex ?? null,
      keyword_weights: questionResult.keyword_weights,
      difficulty: questionResult.difficulty,
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type QuestionRow = {
  id: string;
  stem_latex: string;
  choices: unknown;
  correct_index: number;
  solution_latex: string;
  hint_latex: string | null;
  keyword_weights: Record<string, number>;
  difficulty: number;
};

/**
 * Get a mid-difficulty (0.45–0.65) question for a category.
 * Prefers stored questions from highest-yield umbrella keywords.
 * Falls back to generation if none found.
 */
async function getQuestionForCategory(
  supabase: SupabaseClient,
  categoryId: string,
  course: MathCourse,
  excludeIds: string[]
): Promise<QuestionRow | null> {
  // Try stored mid-difficulty questions
  const { data: storedQs } = await supabase
    .from("math_questions")
    .select(
      "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty, avg_rating"
    )
    .eq("category_id", categoryId)
    .eq("status", "active")
    .gte("difficulty", 0.35)
    .lte("difficulty", 0.70)
    .not("id", "in", excludeIds.length > 0 ? `(${excludeIds.join(",")})` : "(null)")
    .order("avg_rating", { ascending: false })
    .limit(10);

  const available = (storedQs ?? []).filter((q) => !excludeIds.includes(q.id as string));

  if (available.length > 0) {
    // Pick one weighted by avg_rating
    const picked = available[Math.floor(Math.random() * Math.min(available.length, 3))];
    return picked as QuestionRow;
  }

  // Also try without the difficulty filter
  const { data: anyQs } = await supabase
    .from("math_questions")
    .select(
      "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty, avg_rating"
    )
    .eq("category_id", categoryId)
    .eq("status", "active")
    .limit(20);

  const anyAvailable = (anyQs ?? []).filter((q) => !excludeIds.includes(q.id as string));
  if (anyAvailable.length > 0) {
    // Prefer closest to medium difficulty
    const sorted = [...anyAvailable].sort((a, b) =>
      Math.abs((a.difficulty as number) - 0.55) -
      Math.abs((b.difficulty as number) - 0.55)
    );
    return sorted[0] as QuestionRow;
  }

  // Generate one (fail-open)
  try {
    const keywords = await loadTargetKeywords(supabase, [categoryId], course);
    if (keywords.length === 0) return null;

    // Pick highest-yield keywords for generation
    const topKws = [...keywords]
      .sort((a, b) => ((b.yield_score ?? 0) - (a.yield_score ?? 0)))
      .slice(0, 2)
      .map((kw) => ({
        id: kw.id,
        label: kw.label,
        description: kw.description ?? "",
        blueprint: kw.concept_blueprint,
      }));

    const outlineContext = outlineContextForCategory(categoryId);
    const genResults = await generateMathQuestions({
      keywords: topKws,
      count: 1,
      targetDifficulty: 0.55,
      difficultyTier: "medium",
      outlineContext,
    });

    if (genResults.length === 0) return null;

    const q = genResults[0];

    // Verify (fail-open)
    const verifyResults = await verifyMathQuestionsFast([
      {
        stem_latex: q.stem_latex,
        choices: q.choices,
        correct_index: q.correct_index,
      },
    ]);
    const passes = verifyResults[0]?.agrees !== false || !verifyResults[0]?.ok;

    if (!passes) {
      console.warn(
        `[diagnostic/start] Generated question for ${categoryId} failed verify — serving best-effort`
      );
    }

    // Insert
    const { data: inserted } = await supabase
      .from("math_questions")
      .insert({
        category_id: categoryId,
        stem_latex: q.stem_latex,
        choices: q.choices,
        correct_index: q.correct_index,
        solution_latex: q.solution_latex,
        hint_latex: q.hint_latex,
        keyword_weights: q.keyword_weights,
        difficulty: q.difficulty,
        source: "generated",
        status: "active",
      })
      .select(
        "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty"
      )
      .single();

    return (inserted as QuestionRow | null) ?? null;
  } catch (err) {
    if (err instanceof MathGenError) {
      console.warn(
        `[diagnostic/start] Generation failed for ${categoryId}:`,
        err.message
      );
    }
    return null;
  }
}
