/**
 * POST /api/math/next-question
 *
 * Serve-or-generate one math question.
 *
 * Body:
 *   session_id         required
 *   category_id        one of category_id | category_ids required
 *   category_ids       array of category ids
 *   keyword_id         narrow to a single keyword (highest precedence)
 *   keyword_ids        narrow to a set of keyword ids
 *   difficulty         "easy" | "medium" | "hard" — explicit tier override
 *   exclude_ids        question ids to skip (already shown this session)
 *   course             "precalc" | "calc_ab" — used for exemplar filtering
 *
 * Generation path:
 *   blueprint block + outline context + exemplar problems (fetchExemplarProblems,
 *   course-filtered) → generateMathQuestions → verifyMathQuestionsFast (fail-open)
 *   → store passing in math_questions (source 'generated') → serve.
 *
 * Mirrors MCAT next-question: stored-vs-generate preference, dedup, in-band
 * boost, difficulty escalation, yield-nudge on generation ordering.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  generateMathQuestions,
  verifyMathQuestionsFast,
  MathGenError,
} from "@/lib/mathGenerator";
import { loadTargetKeywords, embedText, tagByEmbedding } from "@/lib/mathTagging";
import { fetchExemplarProblems, buildExemplarBlock } from "@/lib/mathExemplars";
import { outlineContextForCategory } from "@/lib/mathContentOutline";
import { loadActivePriorities, PRIORITY_BOOST_FACTOR } from "@/lib/priorities";
import type { MathCourse } from "@/lib/mathTypes";

export const runtime = "nodejs";

/**
 * Boost a candidate's selection score when its top-weighted keyword is on the
 * student's active-priority list ("prioritize this topic"). Fail-soft: an empty
 * set leaves the score unchanged.
 */
function priorityBoost(
  keywordWeights: Record<string, number> | null,
  prioritizedIds: Set<string>
): number {
  if (prioritizedIds.size === 0 || !keywordWeights) return 1;
  const topKeyword = Object.entries(keywordWeights).sort(
    (a, b) => b[1] - a[1]
  )[0]?.[0];
  return topKeyword && prioritizedIds.has(topKeyword)
    ? PRIORITY_BOOST_FACTOR
    : 1;
}

// ─── Difficulty helpers ────────────────────────────────────────────────────────

type DifficultyTier = "easy" | "medium" | "hard";

function numericToTier(d: number): DifficultyTier {
  if (d < 0.45) return "easy";
  if (d < 0.70) return "medium";
  return "hard";
}

const TIER_TARGET: Record<DifficultyTier, number> = {
  easy: 0.30,
  medium: 0.55,
  hard: 0.80,
};

const TIER_BAND: Record<DifficultyTier, [number, number]> = {
  easy: [0.20, 0.40],
  medium: [0.45, 0.65],
  hard: [0.70, 0.90],
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Gaussian difficulty-fit score (σ = 0.2)
function difficultyFit(candidateDiff: number, target: number): number {
  const d = candidateDiff - target;
  return Math.exp(-0.5 * (d / 0.2) * (d / 0.2));
}

// Weighted random pick from scored items
function weightedRandomPick<T extends { score: number }>(items: T[]): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((a, b) => a + Math.max(0, b.score), 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (const item of items) {
    r -= Math.max(0, item.score);
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

type DbQuestion = {
  id: string;
  stem_latex: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
  hint_latex: string | null;
  keyword_weights: Record<string, number>;
  difficulty: number;
  parent_question_id: string | null;
  avg_rating: number | null;
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
    session_id?: string;
    category_id?: string;
    category_ids?: string[];
    keyword_id?: string;
    keyword_ids?: string[];
    difficulty?: DifficultyTier;
    exclude_ids?: string[];
    course?: MathCourse;
  };

  const { session_id, keyword_id, exclude_ids = [] } = body;
  const course: MathCourse = body.course ?? "precalc";

  // Normalize category_id / category_ids → array
  let categoryIds: string[] = [];
  if (Array.isArray(body.category_ids) && body.category_ids.length > 0) {
    categoryIds = body.category_ids;
  } else if (body.category_id) {
    categoryIds = [body.category_id];
  }

  if (!session_id || categoryIds.length === 0) {
    return NextResponse.json(
      { error: "session_id and category_id (or category_ids) are required" },
      { status: 400 }
    );
  }

  const primaryCategoryId = categoryIds[0];
  const supabase = createClient(supabaseUrl, key);

  // 1. Load keywords
  const keywords = await loadTargetKeywords(supabase, categoryIds, course);
  if (keywords.length === 0) {
    return NextResponse.json(
      { error: "No keywords found for this category — taxonomy may not be seeded yet" },
      { status: 404 }
    );
  }

  // Keyword scope
  const categoryKeywordIdSet = new Set(keywords.map((k) => k.id));
  const rawKeywordIds = Array.isArray(body.keyword_ids) ? body.keyword_ids : [];
  const filteredKeywordIds = rawKeywordIds.filter((id) => categoryKeywordIdSet.has(id));
  const scopedKeywordIds: Set<string> | null =
    !keyword_id && filteredKeywordIds.length > 0
      ? new Set(filteredKeywordIds)
      : null;

  // 2. Load session states + seen questions
  const [statesRes, attemptsRes] = await Promise.all([
    supabase
      .from("math_student_keyword_states")
      .select("keyword_id, score, consecutive_correct, total_attempts")
      .eq("session_id", session_id),
    supabase
      .from("math_question_attempts")
      .select("question_id")
      .eq("session_id", session_id),
  ]);

  const strengths: Record<string, number> = Object.fromEntries(
    (statesRes.data ?? []).map((s) => [
      s.keyword_id as string,
      (s.score as number) ?? 0.5,
    ])
  );

  const consecutiveCorrectMap: Record<string, number> = Object.fromEntries(
    (statesRes.data ?? []).map((s) => [
      s.keyword_id as string,
      (s.consecutive_correct as number) ?? 0,
    ])
  );

  const seenIds = new Set<string>(
    (attemptsRes.data ?? []).map((a) => a.question_id as string)
  );
  for (const id of exclude_ids) seenIds.add(id);

  // Active "prioritize this topic" keywords for this session (fail-soft).
  const { ids: prioritizedIds } = await loadActivePriorities(
    supabase,
    session_id,
    "math"
  );

  // 3. Compute effective target difficulty
  const strengthSource = scopedKeywordIds
    ? keywords.filter((kw) => scopedKeywordIds.has(kw.id))
    : keywords;
  const allStrengths = strengthSource.map((kw) => strengths[kw.id] ?? 0.5);
  const avgStrength =
    allStrengths.length > 0
      ? allStrengths.reduce((a, b) => a + b, 0) / allStrengths.length
      : 0.5;

  let effectiveTarget: number;
  let explicitTier: DifficultyTier | null = null;

  if (body.difficulty) {
    explicitTier = body.difficulty;
    effectiveTarget = TIER_TARGET[explicitTier];
  } else {
    const base = 0.2 + avgStrength * 0.6;
    const scopedKws = scopedKeywordIds
      ? keywords.filter((kw) => scopedKeywordIds.has(kw.id))
      : keyword_id
      ? keywords.filter((kw) => kw.id === keyword_id)
      : keywords;
    const maxConsecutive = scopedKws.reduce(
      (mx, kw) => Math.max(mx, consecutiveCorrectMap[kw.id] ?? 0),
      0
    );
    const escalationBump = Math.min(0.15, 0.05 * maxConsecutive);
    effectiveTarget = clamp(base + escalationBump, 0.2, 0.9);
  }

  const effectiveTier: DifficultyTier = explicitTier ?? numericToTier(effectiveTarget);
  const [bandMin, bandMax] = TIER_BAND[effectiveTier];

  // 4. Load stored active questions, exclude seen
  const { data: allQs } = await supabase
    .from("math_questions")
    .select(
      "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty, parent_question_id, avg_rating"
    )
    .in("category_id", categoryIds)
    .eq("status", "active");

  type ScoredQ = DbQuestion & { score: number };

  let candidates: DbQuestion[] = ((allQs ?? []) as DbQuestion[]).filter(
    (q) => !seenIds.has(q.id)
  );

  // Filter by scope
  if (keyword_id) {
    candidates = candidates.filter(
      (q) =>
        q.keyword_weights &&
        Object.prototype.hasOwnProperty.call(q.keyword_weights, keyword_id)
    );
  } else if (scopedKeywordIds) {
    candidates = candidates.filter(
      (q) =>
        q.keyword_weights &&
        Object.keys(q.keyword_weights).some((id) => scopedKeywordIds.has(id))
    );
  }

  // 5. Score candidates
  const scored: ScoredQ[] = candidates.map((q) => {
    const kw = (q.keyword_weights as Record<string, number>) ?? {};
    let weightedWeakness = 0;
    let totalWeight = 0;
    for (const [id, w] of Object.entries(kw)) {
      if (w > 0) {
        weightedWeakness += w * (1 - (strengths[id] ?? 0.5));
        totalWeight += w;
      }
    }
    const weakness = totalWeight > 0 ? weightedWeakness / totalWeight : 0.5;
    const diffScore = difficultyFit((q.difficulty as number) ?? 0.5, effectiveTarget);
    const ratingNudge = 0.7 + 0.3 * ((q.avg_rating ?? 3) / 5);
    const qDiff = (q.difficulty as number) ?? 0.5;
    const inBandBoost =
      explicitTier && qDiff >= bandMin && qDiff <= bandMax ? 2.0 : 1.0;
    const prioBoost = priorityBoost(q.keyword_weights, prioritizedIds);
    return {
      ...q,
      score: weakness * diffScore * ratingNudge * inBandBoost * prioBoost,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const top5 = scored.slice(0, 5);

  const hasInBandCandidate =
    !explicitTier ||
    top5.some((q) => {
      const d = (q.difficulty as number) ?? 0.5;
      return d >= bandMin && d <= bandMax;
    });

  // 6. If enough candidates exist, serve from stored
  if (candidates.length >= 3 && top5.length > 0 && hasInBandCandidate) {
    const selected = weightedRandomPick(top5) ?? top5[0];
    return NextResponse.json({
      question: {
        id: selected.id,
        stem_latex: selected.stem_latex,
        choices: selected.choices,
        correct_index: selected.correct_index,
        solution_latex: selected.solution_latex,
        hint_latex: selected.hint_latex ?? null,
        keyword_weights: selected.keyword_weights,
        difficulty: selected.difficulty,
        parent_question_id: selected.parent_question_id ?? null,
      },
      generated: false,
    });
  }

  // 7. Generate new questions
  const kwStateMap = new Map(
    (statesRes.data ?? []).map((s) => [s.keyword_id as string, s])
  );

  // Pick generation keywords — yield-nudged weakness-first
  let genKeywords = keywords;

  if (keyword_id) {
    const targetKw = keywords.find((k) => k.id === keyword_id);
    if (targetKw) {
      const parentId = targetKw.parent_keyword_id;
      const siblings = parentId
        ? keywords
            .filter((k) => k.parent_keyword_id === parentId && k.id !== keyword_id)
            .slice(0, 2)
        : [];
      genKeywords = [targetKw, ...siblings];
    }
  } else if (scopedKeywordIds) {
    genKeywords = keywords.filter((k) => scopedKeywordIds.has(k.id));
  }

  // Yield nudge (numeric yield_score; spec: yield 1.0 → −0.12, yield 0.0 → +0.10)
  const yieldNudge = (y: number | null): number => 0.10 - 0.22 * (y ?? 0.5);
  const applyYield = !keyword_id;

  const kwSorted = [...genKeywords].sort((a, b) => {
    const aState = kwStateMap.get(a.id);
    const bState = kwStateMap.get(b.id);
    const rawA = (aState?.score as number) ?? 0.5;
    const rawB = (bState?.score as number) ?? 0.5;
    const aScore = applyYield ? rawA + yieldNudge(a.yield_score) : rawA;
    const bScore = applyYield ? rawB + yieldNudge(b.yield_score) : rawB;
    if (Math.abs(aScore - bScore) > 0.01) return aScore - bScore;
    return ((aState?.total_attempts as number) ?? 0) - ((bState?.total_attempts as number) ?? 0);
  });

  const weakestKws = kwSorted.slice(0, 2).map((kw) => ({
    id: kw.id,
    label: kw.label,
    description: kw.description ?? "",
    blueprint: kw.concept_blueprint,
  }));

  // Fetch exemplar problems for grounding (course-filtered)
  let exemplarBlock = "";
  try {
    // Use first keyword embedding for nearest-exemplar lookup
    const firstKwWithEmbed = weakestKws.length > 0
      ? (await supabase
          .from("math_keywords")
          .select("embedding")
          .eq("id", weakestKws[0].id)
          .maybeSingle()).data
      : null;
    const kwEmbedding = Array.isArray(firstKwWithEmbed?.embedding)
      ? (firstKwWithEmbed!.embedding as number[])
      : null;
    const exemplars = await fetchExemplarProblems(supabase, kwEmbedding, course, 4);
    exemplarBlock = buildExemplarBlock(exemplars);
  } catch {
    // fail-open — proceed without exemplars
  }

  const outlineContext = outlineContextForCategory(primaryCategoryId);

  let generated: ScoredQ[] = [];
  try {
    const genResults = await generateMathQuestions({
      keywords:
        weakestKws.length > 0
          ? weakestKws
          : keywords.slice(0, 3).map((k) => ({
              id: k.id,
              label: k.label,
              description: k.description ?? "",
              blueprint: k.concept_blueprint,
            })),
      count: 3,
      targetDifficulty: effectiveTarget,
      difficultyTier: effectiveTier,
      outlineContext,
      exemplarBlock: exemplarBlock || undefined,
    });

    if (genResults.length === 0) {
      return NextResponse.json(
        {
          error: "No questions available for this category",
          detail: "Generation produced no valid items",
        },
        { status: 502 }
      );
    }

    // Embed + retag + verify concurrently
    const keywordsWithEmbed = keywords.filter((k) => k.embedding !== null);

    const [rows, verifyResults] = await Promise.all([
      Promise.all(
        genResults.map(async (q) => {
          let embedding: number[] | null = null;
          let finalWeights = q.keyword_weights;

          try {
            embedding = await embedText(
              `${q.stem_latex} | ${q.choices[q.correct_index]}`
            );
            const retagged = tagByEmbedding(embedding, keywordsWithEmbed);
            if (Object.keys(retagged).length > 0) {
              finalWeights = retagged;
            }
          } catch {
            // non-fatal — keep LLM weights
          }

          return {
            category_id: primaryCategoryId,
            stem_latex: q.stem_latex,
            choices: q.choices,
            correct_index: q.correct_index,
            solution_latex: q.solution_latex,
            hint_latex: q.hint_latex,
            keyword_weights: finalWeights,
            difficulty: q.difficulty,
            source: "generated",
            status: "active",
            embedding: embedding as unknown,
          };
        })
      ),
      verifyMathQuestionsFast(
        genResults.map((q) => ({
          stem_latex: q.stem_latex,
          choices: q.choices,
          correct_index: q.correct_index,
        }))
      ),
    ]);

    let keptIndices = verifyResults
      .map((r, i) => (r.agrees ? i : -1))
      .filter((i) => i !== -1);
    if (keptIndices.length === 0) {
      console.warn(
        "[math/next-question] all generated questions failed fast-verify; serving best-effort"
      );
      keptIndices = rows.map((_, i) => i);
    }
    const keptSet = new Set(keptIndices);

    const { data: inserted } = await supabase
      .from("math_questions")
      .insert(rows.filter((_, i) => keptSet.has(i)))
      .select(
        "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty, parent_question_id, avg_rating"
      );

    if (inserted && inserted.length > 0) {
      const insertedScored: ScoredQ[] = (inserted as DbQuestion[]).map((q) => {
        const kw = (q.keyword_weights as Record<string, number>) ?? {};
        let weightedWeakness = 0;
        let totalWeight = 0;
        for (const [id, w] of Object.entries(kw)) {
          if (w > 0) {
            weightedWeakness += w * (1 - (strengths[id] ?? 0.5));
            totalWeight += w;
          }
        }
        const weakness = totalWeight > 0 ? weightedWeakness / totalWeight : 0.5;
        const diffScore = difficultyFit((q.difficulty as number) ?? 0.5, effectiveTarget);
        const ratingNudge = 0.7 + 0.3 * ((q.avg_rating ?? 3) / 5);
        const prioBoost = priorityBoost(q.keyword_weights, prioritizedIds);
        return { ...q, score: weakness * diffScore * ratingNudge * prioBoost };
      });
      generated = insertedScored;
    }
  } catch (err) {
    if (err instanceof MathGenError) {
      return NextResponse.json(
        { error: "Question generation failed", detail: err.message },
        { status: err.status }
      );
    }
    throw err;
  }

  // 8. Merge stored + generated, pick best
  const allPool = [...top5, ...generated];
  allPool.sort((a, b) => b.score - a.score);
  const finalPool = allPool.slice(0, 5);

  if (finalPool.length === 0) {
    return NextResponse.json(
      { error: "No questions available for this category" },
      { status: 404 }
    );
  }

  const selected = weightedRandomPick(finalPool) ?? finalPool[0];
  const isNewlyGenerated = generated.some((g) => g.id === selected.id);

  return NextResponse.json({
    question: {
      id: selected.id,
      stem_latex: selected.stem_latex,
      choices: selected.choices,
      correct_index: selected.correct_index,
      solution_latex: selected.solution_latex,
      hint_latex: selected.hint_latex ?? null,
      keyword_weights: selected.keyword_weights,
      difficulty: selected.difficulty,
      parent_question_id: selected.parent_question_id ?? null,
    },
    generated: isNewlyGenerated,
  });
}
