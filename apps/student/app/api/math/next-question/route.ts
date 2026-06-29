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
import { bestKeywordForQuestion } from "@/lib/bestKeyword";
import { primaryKeywordId as maxWeightKeyword } from "@/lib/primaryKeyword";
import { enrichQuestionsInBackground } from "@/lib/questionEnrichment";
import type { MathCourse } from "@/lib/mathTypes";
import {
  normalizeStem,
  filterNearDuplicates,
  streakKeyword,
  filterStreakKeyword,
  streakUmbrellaKeyword,
  filterStreakUmbrella,
  parseEmbedding,
  mmrRerank,
  type DiversityDims,
} from "@/lib/questionDiversity";
import {
  decayedScore,
  type KeywordState,
} from "@/lib/courseEngine/adaptive";

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
  // Optional embedding columns (populated by async enrichment) used for MMR.
  problem_description_embedding?: unknown;
  action_description_embedding?: unknown;
  representation_description_embedding?: unknown;
  embedding?: unknown;
};

/** Build the MMR diversity dimensions for a question row. */
function dimsOf(q: {
  problem_description_embedding?: unknown;
  action_description_embedding?: unknown;
  representation_description_embedding?: unknown;
  embedding?: unknown;
}): DiversityDims {
  return {
    action: parseEmbedding(q.action_description_embedding),
    representation: parseEmbedding(q.representation_description_embedding),
    problem:
      parseEmbedding(q.problem_description_embedding) ??
      parseEmbedding(q.embedding),
  };
}

/** Client-facing question shape (served item + every buffered extra). */
function shapeQuestion(q: DbQuestion, primaryKeywordId: string | null) {
  return {
    id: q.id,
    stem_latex: q.stem_latex,
    choices: q.choices,
    correct_index: q.correct_index,
    solution_latex: q.solution_latex,
    hint_latex: q.hint_latex ?? null,
    keyword_weights: q.keyword_weights,
    difficulty: q.difficulty,
    parent_question_id: q.parent_question_id ?? null,
    primary_keyword_id: primaryKeywordId,
  };
}

// How many ready extras to hand back alongside the served question so the client
// can serve the next few items with NO round-trip. Buffered extras use the cheap
// in-code max-weight keyword (no per-item embedding lookup) — only the SERVED item
// pays for the precise embedding-pinpointed keyword.
const BUFFER_MAX = 4;
function bufferItems(pool: DbQuestion[], selectedId: string) {
  return pool
    .filter((q) => q.id !== selectedId)
    .slice(0, BUFFER_MAX)
    .map((q) => shapeQuestion(q, maxWeightKeyword(q.keyword_weights)));
}

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
    /** Primary keyword ids of the last N questions served (most-recent last). */
    recent_keyword_ids?: string[];
    /** Normalised stems of questions already seen this session. */
    seen_stems?: string[];
    /** Question ids of the last N served items — drives embedding-based MMR. */
    recent_question_ids?: string[];
  };

  const { session_id, keyword_id, exclude_ids = [] } = body;
  const recentKeywordIds: string[] = Array.isArray(body.recent_keyword_ids)
    ? body.recent_keyword_ids
    : [];
  const recentQuestionIds: string[] = Array.isArray(body.recent_question_ids)
    ? body.recent_question_ids.slice(-10)
    : [];
  const seenStems: string[] = Array.isArray(body.seen_stems)
    ? body.seen_stems
    : [];
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
      .select("keyword_id, score, consecutive_correct, total_attempts, last_review_at, floor")
      .eq("session_id", session_id),
    supabase
      .from("math_question_attempts")
      .select("question_id")
      .eq("session_id", session_id),
  ]);

  const nowMs = Date.now();

  // Build decayed strengths map: apply time-decay on read so selection sees live mastery.
  const strengths: Record<string, number> = Object.fromEntries(
    (statesRes.data ?? []).map((s) => {
      const state: KeywordState = {
        score: (s.score as number) ?? 0.5,
        floor: (s.floor as number | undefined) ?? undefined,
        last_review_at: (s.last_review_at as string | null | undefined) ?? null,
      };
      return [s.keyword_id as string, decayedScore(state, nowMs)];
    })
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

  // 4. Load stored active questions, exclude seen. LIGHT columns only — the 4
  //    embedding columns are large (4×1536 floats per row) and are NOT needed to
  //    score; we fetch them in a second, tightly-scoped query (step 5b) only for
  //    the handful of candidates that can actually reach the served pool.
  const QCOLS =
    "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty, parent_question_id, avg_rating";
  const { data: allQs } = await supabase
    .from("math_questions")
    .select(QCOLS)
    .in("category_id", categoryIds)
    .eq("status", "active");

  type ScoredQ = DbQuestion & { score: number };

  let candidates: DbQuestion[] = ((allQs ?? []) as DbQuestion[]).filter(
    (q) => !seenIds.has(q.id)
  );

  // Filter by scope.
  //
  // IN-SCOPE GUARANTEE: a question merely *carrying* the target keyword at a tiny
  // weight is NOT in scope — its dominant subject is something else, which is how
  // out-of-scope questions leaked into auto mode. Require the target keyword to be
  // the question's PRIMARY (argmax) weight, or at least a substantial share. Fall
  // back to looser tiers only if the strict pool is empty so we never starve.
  const SCOPE_MIN_WEIGHT = 0.34; // a "substantial" share of the question's tags
  const dominantKeyword = (
    kw: Record<string, number> | null | undefined
  ): string | null => {
    if (!kw) return null;
    let best: string | null = null;
    let bestW = -Infinity;
    for (const [id, w] of Object.entries(kw)) {
      if (w > bestW) {
        bestW = w;
        best = id;
      }
    }
    return best;
  };

  if (keyword_id) {
    const primary = candidates.filter(
      (q) => dominantKeyword(q.keyword_weights as Record<string, number>) === keyword_id
    );
    const substantial = candidates.filter(
      (q) => ((q.keyword_weights as Record<string, number>)?.[keyword_id] ?? 0) >= SCOPE_MIN_WEIGHT
    );
    const present = candidates.filter(
      (q) =>
        q.keyword_weights &&
        Object.prototype.hasOwnProperty.call(q.keyword_weights, keyword_id)
    );
    candidates = primary.length > 0 ? primary : substantial.length > 0 ? substantial : present;
  } else if (scopedKeywordIds) {
    // Scoped set (e.g. a topic's skills): prefer questions whose PRIMARY keyword
    // is in scope; fall back to any in-scope membership only if that's empty.
    const primary = candidates.filter((q) => {
      const dom = dominantKeyword(q.keyword_weights as Record<string, number>);
      return dom != null && scopedKeywordIds.has(dom);
    });
    const member = candidates.filter(
      (q) =>
        q.keyword_weights &&
        Object.keys(q.keyword_weights).some((id) => scopedKeywordIds.has(id))
    );
    candidates = primary.length > 0 ? primary : member;
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

  // 5b. MMR / diversity-aware re-rank: penalise candidates conceptually close
  //     (action/representation/problem embeddings) to recently-served items, so
  //     consecutive within-subtopic questions are materially different — not just
  //     non-duplicate stems. No LLM call; no-op when embeddings/recents absent.
  //
  //     Embeddings are NOT loaded for the whole category (step 4 is light). We
  //     fetch them in ONE targeted query only for the items that can actually reach
  //     the served pool: the top-N scored candidates + the recently-served items.
  //     mmrRerank is a per-item rescale (no cross-candidate dependency) and can only
  //     LOWER a score, so ranking just the top-N is behaviour-equivalent to ranking
  //     all of them — anything outside the window was already lower-scoring.
  const MMR_WINDOW = 30;
  const byScoreDesc = [...scored].sort((a, b) => b.score - a.score);
  const windowQs = byScoreDesc.slice(0, MMR_WINDOW);
  const restQs = byScoreDesc.slice(MMR_WINDOW);

  const embIds = Array.from(
    new Set<string>([...windowQs.map((q) => q.id), ...recentQuestionIds])
  );
  const dimsById = new Map<string, DiversityDims>();
  if (embIds.length > 0) {
    const { data: embRows } = await supabase
      .from("math_questions")
      .select(
        "id, problem_description_embedding, action_description_embedding, representation_description_embedding, embedding"
      )
      .in("id", embIds);
    for (const r of (embRows ?? []) as DbQuestion[]) {
      dimsById.set(r.id, dimsOf(r));
    }
  }
  const recentDims: DiversityDims[] = recentQuestionIds
    .map((id) => dimsById.get(id))
    .filter((d): d is DiversityDims => d != null);

  const rankedWindow = mmrRerank(
    windowQs.map((q) => ({ ...q, dims: dimsById.get(q.id) ?? dimsOf(q) })),
    recentDims
  );
  const ranked = [
    ...rankedWindow,
    ...restQs.map((q) => ({ ...q, dims: dimsOf(q) })),
  ];
  ranked.sort((a, b) => b.score - a.score);

  // 5a. Diversity filters (streak + umbrella-streak + near-dup) before final pool.
  // Each filter degrades gracefully: if it would remove all candidates it falls
  // back to the unfiltered set and logs a console warning.
  const kwParentMap: Record<string, string | null> = Object.fromEntries(
    keywords.map((k) => [k.id, k.parent_keyword_id ?? null])
  );
  const blockedKw = streakKeyword(recentKeywordIds);
  const blockedUmbrella = streakUmbrellaKeyword(recentKeywordIds, kwParentMap);
  // BUG-FIX: preserve original stems — see mcat/next-question/route.ts for full comment.
  const afterStreakFilters = filterStreakUmbrella(
    filterStreakKeyword(ranked, blockedKw),
    blockedUmbrella,
    kwParentMap
  );
  const originalStemLatexById = new Map(afterStreakFilters.map((q) => [q.id, q.stem_latex]));
  const diverseScored = filterNearDuplicates(
    afterStreakFilters.map((q) => ({ ...q, stem: normalizeStem(q.stem_latex ?? "") })),
    seenStems
  ).map((q) => ({ ...q, stem_latex: originalStemLatexById.get(q.id) ?? q.stem_latex }));

  const top5 = diverseScored.slice(0, 5);

  const hasInBandCandidate =
    !explicitTier ||
    top5.some((q) => {
      const d = (q.difficulty as number) ?? 0.5;
      return d >= bandMin && d <= bandMax;
    });

  // 6. If enough candidates exist, serve from stored
  if (candidates.length >= 3 && top5.length > 0 && hasInBandCandidate) {
    const selected = weightedRandomPick(top5) ?? top5[0];
    // Authoritative toolbar keyword: closest keyword (embedding) to the question,
    // not just the max stored weight. Fail-soft to max-weight.
    const primaryKeywordId = await bestKeywordForQuestion(supabase, {
      system: "math",
      table: "math_questions",
      keywordTable: "math_keywords",
      questionId: selected.id,
      categoryId: primaryCategoryId,
      fallbackWeights: selected.keyword_weights,
    });
    return NextResponse.json({
      question: shapeQuestion(selected, primaryKeywordId),
      // Hand back the next few in-scope, already-filtered candidates so the client
      // serves the next items instantly — one fetch covers several questions.
      buffer: bufferItems(top5, selected.id),
      generated: false,
    });
  }

  // 7. Generate new questions — BATCH-ON-MISS RECYCLE MODEL (diversity design,
  //    Phase 2). We generate a deliberate batch, serve ONE now, and persist the
  //    rest as `active` so they become this user's subsequent questions AND are
  //    recycled for everyone after — the user never waits on the extras.
  //
  //    A per-cell claim/lock (try_claim_gen_lock) + soft global cap stops a cold
  //    catalog from spawning duplicate/explosive batches: the winner generates a
  //    full batch; a concurrent miss on the same cell falls back to a single item
  //    so it is never blocked. "cold" cell (nothing stored yet) → larger
  //    bootstrap batch; "warm" cell (stored exist but all seen) → small top-up.
  const coldCell = (allQs?.length ?? 0) === 0;
  const genBand: string =
    effectiveTier ??
    (effectiveTarget < 0.4 ? "easy" : effectiveTarget < 0.65 ? "medium" : "hard");
  const genCellKey = `math:${course}:${primaryCategoryId}:${genBand}`;
  let gotGenLock = false;
  try {
    const { data: claimed } = await supabase.rpc("try_claim_gen_lock", {
      p_cell: genCellKey,
      p_ttl_seconds: 90,
      p_max_concurrent: 4,
    });
    gotGenLock = claimed === true;
  } catch {
    // RPC missing / transient → behave as un-locked (generate a single item).
    gotGenLock = false;
  }
  // Generate a BATCH of distinct questions: serve 1 now, store the rest for
  // instant future serves. 5 is the standard batch (serve 1 + store 4); a cold
  // cell warms with a slightly bigger buffer. A near-duplicate dedup pass below
  // guarantees the stored items are materially different from one another.
  const batchCount = gotGenLock ? (coldCell ? 6 : 5) : 1;

  const kwStateMap = new Map(
    (statesRes.data ?? []).map((s) => [s.keyword_id as string, s])
  );

  // Pick generation keywords — yield-nudged weakness-first
  let genKeywords = keywords;

  if (keyword_id) {
    const targetKw = keywords.find((k) => k.id === keyword_id);
    if (targetKw) {
      // in_depth keyword → generate for it ONLY (its own scope contract).
      genKeywords = [targetKw];
    } else {
      // keyword_id is an UMBRELLA (not in the in_depth set) → scope generation to
      // its children so we never widen to the whole category and serve off-topic.
      const children = keywords.filter((k) => k.parent_keyword_id === keyword_id);
      if (children.length > 0) genKeywords = children;
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
    let genResults = await generateMathQuestions({
      keywords:
        weakestKws.length > 0
          ? weakestKws
          : keywords.slice(0, 3).map((k) => ({
              id: k.id,
              label: k.label,
              description: k.description ?? "",
              blueprint: k.concept_blueprint,
            })),
      count: batchCount,
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

    // DEDUP PASS: drop any generated item whose stem is a near-duplicate of an
    // earlier one in THIS batch (Jaccard ≥ NEAR_DUP_THRESHOLD on normalized
    // stems), so the items we store are materially different — not the same task
    // in different clothing. Index-preserving so the verify/embed pipeline below
    // stays aligned to the surviving items.
    genResults = filterNearDuplicates(
      genResults.map((q, i) => ({ stem: q.stem_latex, idx: i }))
    ).map((d) => genResults[d.idx]);

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
            if (!keyword_id && Object.keys(retagged).length > 0) {
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
      // Fire-and-forget: ground each new question along the four dimensions
      // (problem / wrong-answer / action / representation descriptions + embeddings
      // + tagging). Never awaited — adds no latency to this response.
      enrichQuestionsInBackground(
        supabase,
        "math",
        (inserted as { id: string }[]).map((r) => r.id)
      );

      // Release the cell lock now that the batch is persisted (best-effort; the
      // lock also self-expires via TTL on any early-return/error path).
      if (gotGenLock) {
        void supabase.rpc("release_gen_lock", { p_cell: genCellKey });
      }

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

  // 8. Merge stored + generated, apply diversity filters to generated too, pick best
  const afterStreakFiltersGen = filterStreakUmbrella(
    filterStreakKeyword(generated, blockedKw),
    blockedUmbrella,
    kwParentMap
  );
  const origStemLatexGenById = new Map(afterStreakFiltersGen.map((q) => [q.id, q.stem_latex]));
  const diverseGenerated = filterNearDuplicates(
    afterStreakFiltersGen.map((q) => ({ ...q, stem: normalizeStem(q.stem_latex ?? "") })),
    seenStems
  ).map((q) => ({ ...q, stem_latex: origStemLatexGenById.get(q.id) ?? q.stem_latex }));
  const allPool = [...top5, ...diverseGenerated];
  allPool.sort((a, b) => b.score - a.score);
  const finalPool = allPool.slice(0, 5);

  if (finalPool.length === 0) {
    return NextResponse.json(
      { error: "No questions available for this category" },
      { status: 404 }
    );
  }

  const selected = weightedRandomPick(finalPool) ?? finalPool[0];
  const isNewlyGenerated = diverseGenerated.some((g) => g.id === selected.id);

  const primaryKeywordId = await bestKeywordForQuestion(supabase, {
    system: "math",
    table: "math_questions",
    keywordTable: "math_keywords",
    questionId: selected.id,
    categoryId: primaryCategoryId,
    fallbackWeights: selected.keyword_weights,
  });

  return NextResponse.json({
    question: shapeQuestion(selected, primaryKeywordId),
    // Serve 1, hand back the rest of the freshly generated+stored batch (and any
    // remaining stored candidates) so the next items need NO round-trip — this is
    // how the just-generated extras become the student's subsequent questions.
    buffer: bufferItems(finalPool, selected.id),
    generated: isNewlyGenerated,
  });
}
