/**
 * POST /api/math/diagnostic/answer
 *
 * Submit an answer during a diagnostic session.
 *
 * Applies the diagnostic algorithm step (see start/route.ts for full description):
 *   - Updates category priors based on correct/wrong/dont_know.
 *   - Propagates upstream (correct) or downstream (wrong) via prereq edges.
 *   - Advances position in the category chain.
 *   - Skips categories with confident priors (≥ 0.70 or ≤ 0.30).
 *   - Terminates when cap reached, chain exhausted, or all priors confident.
 *
 * On completion:
 *   - Writes umbrella-level priors into math_student_keyword_states (course set).
 *   - Returns { completed: true, starting_category, category_estimates }.
 *
 * During session:
 *   - Returns { completed: false, question, category_id, question_number }.
 *
 * Body:
 *   { diagnostic_id, session_id, question_id, selected_index?, dont_know? }
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
/** Prior threshold: confidently known (skip upstream) */
const CONF_HIGH = 0.70;
/** Prior threshold: confidently unknown (skip downstream) */
const CONF_LOW = 0.30;
/** Boost applied on correct answer */
const CORRECT_BOOST = 0.75;
/** Penalty applied on wrong/dont_know */
const WRONG_PENALTY = 0.30;
/** Upstream propagation factor via prereq edges */
const UPSTREAM_FACTOR = 0.60;
/** Downstream propagation factor via prereq edges */
const DOWNSTREAM_FACTOR = 0.60;

type AskEntry = {
  category_id: string;
  question_id: string;
  position: number;
};

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
    diagnostic_id?: string;
    session_id?: string;
    question_id?: string;
    selected_index?: number;
    dont_know?: boolean;
  };

  const {
    diagnostic_id,
    session_id,
    question_id,
    selected_index,
    dont_know = false,
  } = body;

  if (!diagnostic_id || !session_id || !question_id) {
    return NextResponse.json(
      { error: "diagnostic_id, session_id, and question_id are required" },
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

  // Load diagnostic session
  const { data: diagSession, error: diagErr } = await supabase
    .from("math_diagnostic_sessions")
    .select("id, session_id, course, status, asked, category_estimates")
    .eq("id", diagnostic_id)
    .maybeSingle();

  if (diagErr || !diagSession) {
    return NextResponse.json(
      { error: "Diagnostic session not found" },
      { status: 404 }
    );
  }

  if (diagSession.session_id !== session_id) {
    return NextResponse.json({ error: "session_id mismatch" }, { status: 403 });
  }

  if ((diagSession.status as string) !== "in_progress") {
    return NextResponse.json(
      { error: "Diagnostic session is already completed" },
      { status: 409 }
    );
  }

  const course = diagSession.course as MathCourse;
  const asked = (diagSession.asked as AskEntry[]) ?? [];
  let priors = (diagSession.category_estimates as Record<string, number>) ?? {};

  // Load question to check correct_index
  const { data: qRow, error: qErr } = await supabase
    .from("math_questions")
    .select("correct_index, category_id")
    .eq("id", question_id)
    .maybeSingle();

  if (qErr || !qRow) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const correct = dont_know
    ? false
    : selected_index === (qRow.correct_index as number);

  // Determine current position from last asked entry
  const lastAsked = asked[asked.length - 1];
  if (!lastAsked) {
    return NextResponse.json(
      { error: "No pending question found in diagnostic session" },
      { status: 400 }
    );
  }

  const currentCategoryId = lastAsked.category_id;
  const currentPos = lastAsked.position;

  // Load course category chain + prereq edges in parallel
  const [membershipsRes, prereqEdgesRes] = await Promise.all([
    supabase
      .from("math_course_categories")
      .select("category_id, role, order_index")
      .eq("course", course)
      .order("order_index"),
    supabase
      .from("math_prereq_edges")
      .select("from_category_id, to_category_id, strength"),
  ]);

  const memberships = membershipsRes.data ?? [];
  const categoryChain = memberships.map((m) => m.category_id as string);
  // For diagnostic logging: track which categories are 'core' vs 'foundation'
  const coreCategories = new Set(
    memberships
      .filter((m) => (m.role as string) === "core")
      .map((m) => m.category_id as string)
  );
  void coreCategories; // used in debug logging below
  const N = categoryChain.length;

  // Build prereq edge maps
  type EdgeEntry = { from_category_id: string; to_category_id: string; strength: number };
  const edges = (prereqEdgesRes.data ?? []) as EdgeEntry[];

  // upstreamOf[cat] = categories that cat depends on (i.e., cat is a `to`, they are `from`)
  const upstreamOf: Record<string, string[]> = {};
  // downstreamOf[cat] = categories that depend on cat (i.e., cat is a `from`, they are `to`)
  const downstreamOf: Record<string, string[]> = {};

  for (const edge of edges) {
    if (!upstreamOf[edge.to_category_id]) upstreamOf[edge.to_category_id] = [];
    upstreamOf[edge.to_category_id].push(edge.from_category_id);

    if (!downstreamOf[edge.from_category_id]) downstreamOf[edge.from_category_id] = [];
    downstreamOf[edge.from_category_id].push(edge.to_category_id);
  }

  // ── Update priors for current category ────────────────────────────────────
  priors = { ...priors };

  if (correct) {
    // Correct: boost current category + propagate upstream
    priors[currentCategoryId] = Math.max(
      priors[currentCategoryId] ?? 0.5,
      CORRECT_BOOST
    );

    // Propagate upstream (prereqs of current category are likely known too)
    const upstream = upstreamOf[currentCategoryId] ?? [];
    for (const upCat of upstream) {
      if (priors[upCat] !== undefined) {
        priors[upCat] = Math.max(
          priors[upCat],
          CORRECT_BOOST * UPSTREAM_FACTOR
        );
      }
    }
  } else {
    // Wrong/dont_know: penalize current + propagate downstream
    priors[currentCategoryId] = Math.min(
      priors[currentCategoryId] ?? 0.5,
      WRONG_PENALTY
    );

    // Propagate downstream (categories that depend on current are likely weak too)
    const downstream = downstreamOf[currentCategoryId] ?? [];
    for (const downCat of downstream) {
      if (priors[downCat] !== undefined) {
        priors[downCat] = Math.min(
          priors[downCat],
          WRONG_PENALTY * DOWNSTREAM_FACTOR + (1 - DOWNSTREAM_FACTOR) * 0.5
        );
      }
    }
  }

  // ── Determine next position ────────────────────────────────────────────────
  // Correct → move toward harder/earlier in chain (lower index)
  // Wrong   → move toward easier/later in chain (higher index)
  let nextPos = correct ? currentPos - 1 : currentPos + 1;

  // Skip categories with confident priors
  const seenIds = new Set(asked.map((a) => a.question_id));

  // Find a non-confident category at nextPos (or further in the same direction)
  const direction = correct ? -1 : 1;

  while (
    nextPos >= 0 &&
    nextPos < N &&
    isConfident(priors[categoryChain[nextPos]] ?? 0.5)
  ) {
    nextPos += direction;
  }

  // ── Check termination conditions ──────────────────────────────────────────
  const questionCount = asked.length;
  const cappedOrExhausted =
    questionCount >= HARD_CAP ||
    nextPos < 0 ||
    nextPos >= N;
  const allConfident = categoryChain.every((catId) =>
    isConfident(priors[catId] ?? 0.5)
  );

  const shouldComplete = cappedOrExhausted || allConfident;

  // ── Store the answer in asked ──────────────────────────────────────────────
  // Mark question as answered (add correct flag for record-keeping)
  const updatedAsked: (AskEntry & { correct: boolean; dont_know: boolean })[] = [
    ...asked.map((a) => ({ ...a, correct: false, dont_know: false })),
  ];
  // Update last entry with result
  if (updatedAsked.length > 0) {
    const last = updatedAsked[updatedAsked.length - 1];
    updatedAsked[updatedAsked.length - 1] = {
      ...last,
      correct,
      dont_know,
    };
  }

  if (shouldComplete) {
    // ── COMPLETION ────────────────────────────────────────────────────────────
    // Determine starting category:
    // For calc_ab: prefer starting in the core (calc) section at the first
    //   core category with prior ≥ 0.45. Fall back to first core category,
    //   then first category overall.
    // For precalc: first category with prior ≥ 0.45, or first overall.
    const coreChain = categoryChain.filter((c) => coreCategories.has(c));
    const searchChain = coreChain.length > 0 ? coreChain : categoryChain;
    const goodStart = searchChain.find((c) => (priors[c] ?? 0.5) >= 0.45);
    const startingCategory = goodStart ?? searchChain[0] ?? categoryChain[0]!;

    // Log sampled categories for verification
    const sampledCats = new Set(updatedAsked.map((a) => a.category_id));
    const sampledCore = [...sampledCats].filter((c) => coreCategories.has(c));
    console.log(
      `[diagnostic/answer] Completing diagnostic: course=${course}, asked=${asked.length}, ` +
      `sampledCategories=${[...sampledCats].join(",")}, ` +
      `sampledCoreCategories=${sampledCore.join(",")}, ` +
      `startingCategory=${startingCategory}`
    );

    // Write umbrella-level priors into math_student_keyword_states
    await writeUmbrellaPriors(supabase, session_id, course, categoryChain, priors);

    // Mark diagnostic session as completed
    await supabase
      .from("math_diagnostic_sessions")
      .update({
        status: "completed",
        asked: updatedAsked,
        category_estimates: priors,
        completed_at: new Date().toISOString(),
      })
      .eq("id", diagnostic_id);

    return NextResponse.json({
      completed: true,
      starting_category: startingCategory,
      category_estimates: priors,
    });
  }

  // ── Get next question ─────────────────────────────────────────────────────
  const nextCategoryId = categoryChain[nextPos];
  const nextQuestion = await getQuestionForCategory(
    supabase,
    nextCategoryId,
    course,
    [...seenIds]
  );

  if (!nextQuestion) {
    // Can't get a question for this category — skip forward
    const skipPos = findNextAvailableCategory(
      categoryChain,
      priors,
      nextPos,
      direction,
      [...seenIds]
    );

    if (skipPos === null) {
      // No more questions anywhere — complete
      const _coreChainA = categoryChain.filter((c) => coreCategories.has(c));
      const _searchChainA = _coreChainA.length > 0 ? _coreChainA : categoryChain;
      const startingCategory =
        _searchChainA.find((c) => (priors[c] ?? 0.5) >= 0.45) ?? _searchChainA[0] ?? categoryChain[0];
      await writeUmbrellaPriors(supabase, session_id, course, categoryChain, priors);
      await supabase
        .from("math_diagnostic_sessions")
        .update({
          status: "completed",
          asked: updatedAsked,
          category_estimates: priors,
          completed_at: new Date().toISOString(),
        })
        .eq("id", diagnostic_id);

      return NextResponse.json({
        completed: true,
        starting_category: startingCategory,
        category_estimates: priors,
      });
    }

    // Re-try with the skipped category
    const skipCategoryId = categoryChain[skipPos];
    const skipQuestion = await getQuestionForCategory(
      supabase,
      skipCategoryId,
      course,
      [...seenIds]
    );

    if (!skipQuestion) {
      // Still nothing — complete
      const _coreChainB = categoryChain.filter((c) => coreCategories.has(c));
      const _searchChainB = _coreChainB.length > 0 ? _coreChainB : categoryChain;
      const startingCategory =
        _searchChainB.find((c) => (priors[c] ?? 0.5) >= 0.45) ?? _searchChainB[0] ?? categoryChain[0];
      await writeUmbrellaPriors(supabase, session_id, course, categoryChain, priors);
      await supabase
        .from("math_diagnostic_sessions")
        .update({
          status: "completed",
          asked: updatedAsked,
          category_estimates: priors,
          completed_at: new Date().toISOString(),
        })
        .eq("id", diagnostic_id);

      return NextResponse.json({
        completed: true,
        starting_category: startingCategory,
        category_estimates: priors,
      });
    }

    const nextAsked = [
      ...updatedAsked,
      { category_id: skipCategoryId, question_id: skipQuestion.id, position: skipPos, correct: false, dont_know: false },
    ];
    await supabase
      .from("math_diagnostic_sessions")
      .update({ asked: nextAsked, category_estimates: priors })
      .eq("id", diagnostic_id);

    return NextResponse.json({
      completed: false,
      question_number: questionCount + 1,
      total_estimated: Math.min(HARD_CAP, Math.ceil(N * 0.7)),
      category_id: skipCategoryId,
      question: formatQuestion(skipQuestion),
    });
  }

  // Store updated state and next question
  const nextAsked = [
    ...updatedAsked,
    { category_id: nextCategoryId, question_id: nextQuestion.id, position: nextPos, correct: false, dont_know: false },
  ];

  await supabase
    .from("math_diagnostic_sessions")
    .update({ asked: nextAsked, category_estimates: priors })
    .eq("id", diagnostic_id);

  return NextResponse.json({
    completed: false,
    question_number: questionCount + 1,
    total_estimated: Math.min(HARD_CAP, Math.ceil(N * 0.7)),
    category_id: nextCategoryId,
    question: formatQuestion(nextQuestion),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isConfident(prior: number): boolean {
  return prior >= CONF_HIGH || prior <= CONF_LOW;
}

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

function formatQuestion(q: QuestionRow) {
  return {
    id: q.id,
    stem_latex: q.stem_latex,
    choices: q.choices,
    correct_index: q.correct_index,
    solution_latex: q.solution_latex,
    hint_latex: q.hint_latex ?? null,
    keyword_weights: q.keyword_weights,
    difficulty: q.difficulty,
  };
}

function findNextAvailableCategory(
  chain: string[],
  priors: Record<string, number>,
  startPos: number,
  direction: number,
  excludeQuestions: string[]
): number | null {
  void excludeQuestions; // future: could filter out categories with all seen questions
  let pos = startPos + direction;
  while (pos >= 0 && pos < chain.length) {
    if (!isConfident(priors[chain[pos]] ?? 0.5)) return pos;
    pos += direction;
  }
  // Try the other direction
  pos = startPos - direction;
  while (pos >= 0 && pos < chain.length) {
    if (!isConfident(priors[chain[pos]] ?? 0.5)) return pos;
    pos -= direction;
  }
  return null;
}

/**
 * Write umbrella-level priors into math_student_keyword_states.
 *
 * Strategy (robust to categories with no approved umbrella keywords):
 *   1. Prefer umbrella keywords — one state row per umbrella captures the
 *      category's prior and is what the taxonomy read uses for display scores.
 *   2. For categories that have NO approved umbrella keywords, fall back to
 *      whichever approved keywords exist (in_depth or any tier) so that the
 *      category still surfaces a score on the course home.
 *   3. If a category has NO approved keywords at all, skip it (cannot write
 *      a state without a keyword_id FK).
 *
 * The taxonomy read (GET /api/math/taxonomy) computes categoryMasteryPct from
 * umbrella.score / umbrella.implied_score — so we must populate umbrella rows.
 * Writing to in_depth keywords is a best-effort fallback that at minimum keeps
 * the practice loop from treating the category as "never touched".
 */
async function writeUmbrellaPriors(
  supabase: SupabaseClient,
  session_id: string,
  course: MathCourse,
  categoryChain: string[],
  priors: Record<string, number>
): Promise<void> {
  try {
    // Load ALL approved keywords for these categories (all tiers)
    const { data: allKws } = await supabase
      .from("math_keywords")
      .select("id, category_id, tier")
      .in("category_id", categoryChain)
      .eq("status", "approved");

    if (!allKws || allKws.length === 0) {
      console.warn("[diagnostic/answer] writeUmbrellaPriors: no approved keywords found for any category in chain");
      return;
    }

    // Group keywords by category
    const kwsByCategory = new Map<string, { id: string; tier: string }[]>();
    for (const kw of allKws) {
      const catId = kw.category_id as string;
      if (!kwsByCategory.has(catId)) kwsByCategory.set(catId, []);
      kwsByCategory.get(catId)!.push({ id: kw.id as string, tier: kw.tier as string });
    }

    const now = new Date().toISOString();
    const upserts: {
      session_id: string;
      keyword_id: string;
      category_id: string;
      score: number;
      total_attempts: number;
      correct_attempts: number;
      consecutive_correct: number;
      dont_know_count: number;
      state: string;
      course: MathCourse;
      updated_at: string;
    }[] = [];

    for (const catId of categoryChain) {
      const catPrior = Math.min(1, Math.max(0, priors[catId] ?? 0.5));
      const state = catPrior >= 0.8 ? "mastered" : "in_progress";
      const kws = kwsByCategory.get(catId) ?? [];

      if (kws.length === 0) {
        // No approved keywords — cannot write state rows for this category.
        // The course home will show "Not started" for it, which is acceptable.
        console.warn(
          `[diagnostic/answer] writeUmbrellaPriors: category ${catId} has no approved keywords — cannot write prior`
        );
        continue;
      }

      // Prefer umbrella keywords; fall back to anything else
      const umbrellaKws = kws.filter((k) => k.tier === "umbrella");
      const targetKws = umbrellaKws.length > 0 ? umbrellaKws : kws;

      for (const kw of targetKws) {
        upserts.push({
          session_id,
          keyword_id: kw.id,
          category_id: catId,
          score: catPrior,
          total_attempts: 0,
          correct_attempts: 0,
          consecutive_correct: 0,
          dont_know_count: 0,
          state,
          course,
          updated_at: now,
        });
      }
    }

    if (upserts.length === 0) return;

    const BATCH = 50;
    for (let i = 0; i < upserts.length; i += BATCH) {
      const { error: upsertErr } = await supabase
        .from("math_student_keyword_states")
        .upsert(upserts.slice(i, i + BATCH), {
          onConflict: "session_id,keyword_id",
          ignoreDuplicates: false,
        });
      if (upsertErr) {
        console.error(
          "[diagnostic/answer] writeUmbrellaPriors upsert batch error:",
          upsertErr.message
        );
      }
    }

    console.log(
      `[diagnostic/answer] writeUmbrellaPriors: wrote ${upserts.length} keyword state rows for ${categoryChain.length} categories (course=${course})`
    );
  } catch (err) {
    console.error(
      "[diagnostic/answer] writeUmbrellaPriors failed:",
      err instanceof Error ? err.message : String(err)
    );
    // fail-open — diagnostic still completes
  }
}

/**
 * Get a medium-difficulty question for a category.
 * Prefers stored; falls back to generation (fail-open).
 */
async function getQuestionForCategory(
  supabase: SupabaseClient,
  categoryId: string,
  course: MathCourse,
  excludeIds: string[]
): Promise<QuestionRow | null> {
  // Try stored mid-difficulty first
  const { data: storedQs } = await supabase
    .from("math_questions")
    .select(
      "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty"
    )
    .eq("category_id", categoryId)
    .eq("status", "active")
    .gte("difficulty", 0.35)
    .lte("difficulty", 0.70)
    .limit(20);

  const available = (storedQs ?? []).filter(
    (q) => !excludeIds.includes(q.id as string)
  );

  if (available.length > 0) {
    return available[
      Math.floor(Math.random() * Math.min(available.length, 3))
    ] as QuestionRow;
  }

  // Try without difficulty filter
  const { data: anyQs } = await supabase
    .from("math_questions")
    .select(
      "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty"
    )
    .eq("category_id", categoryId)
    .eq("status", "active")
    .limit(20);

  const anyAvailable = (anyQs ?? []).filter(
    (q) => !excludeIds.includes(q.id as string)
  );

  if (anyAvailable.length > 0) {
    const sorted = [...anyAvailable].sort(
      (a, b) =>
        Math.abs((a.difficulty as number) - 0.55) -
        Math.abs((b.difficulty as number) - 0.55)
    );
    return sorted[0] as QuestionRow;
  }

  // Generate (fail-open)
  try {
    const keywords = await loadTargetKeywords(supabase, [categoryId], course);
    if (keywords.length === 0) return null;

    const topKws = [...keywords]
      .sort((a, b) => (b.yield_score ?? 0) - (a.yield_score ?? 0))
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
    const verifyResults = await verifyMathQuestionsFast([
      { stem_latex: q.stem_latex, choices: q.choices, correct_index: q.correct_index },
    ]);
    const passes = verifyResults[0]?.agrees !== false || !verifyResults[0]?.ok;
    if (!passes) {
      console.warn(
        `[diagnostic/answer] Generated question for ${categoryId} failed verify — serving best-effort`
      );
    }

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
        `[diagnostic/answer] Generation failed for ${categoryId}:`,
        err.message
      );
    }
    return null;
  }
}
