import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchTemplateCards } from "@/lib/mcatTemplateCards";
import { generateMcatQuestions, McatGenError, verifyQuestionsFast } from "@/lib/mcatGenerator";
import { loadTargetKeywords, embedText, tagByEmbedding } from "@/lib/mcatTagging";
import { sectionFromId } from "@/lib/mcatSection";
import { outlineContextForCategory } from "@/lib/mcatContentOutline";
import { loadActivePriorities, PRIORITY_BOOST_FACTOR } from "@/lib/priorities";
import { bestKeywordForQuestion } from "@/lib/bestKeyword";
import { primaryKeywordId as maxWeightKeyword } from "@/lib/primaryKeyword";
import { enrichQuestionsInBackground } from "@/lib/questionEnrichment";
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

/** Map a numeric difficulty to its tier name. */
function numericToTier(d: number): DifficultyTier {
  if (d < 0.45) return "easy";
  if (d < 0.70) return "medium";
  return "hard";
}

/** Representative numeric target for each named tier. */
const TIER_TARGET: Record<DifficultyTier, number> = {
  easy: 0.30,
  medium: 0.55,
  hard: 0.80,
};

/** Band bounds for each tier — used to boost in-band candidates. */
const TIER_BAND: Record<DifficultyTier, [number, number]> = {
  easy: [0.20, 0.40],
  medium: [0.45, 0.65],
  hard: [0.70, 0.90],
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ─── Scoring helpers ───────────────────────────────────────────────────────────

// Gaussian difficulty-fit score (σ = 0.2)
function difficultyFit(candidateDiff: number, target: number): number {
  const d = candidateDiff - target;
  return Math.exp(-0.5 * (d / 0.2) * (d / 0.2));
}

// Weighted random pick from scored items
function weightedRandomPick<T extends { score: number }>(
  items: T[]
): T | null {
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
  stem: string;
  choices: string[];
  correct_index: number;
  explanation: string;
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
    stem: q.stem,
    choices: q.choices,
    correct_index: q.correct_index,
    explanation: q.explanation,
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
    exclude_ids?: string[];
    keyword_id?: string;
    keyword_ids?: string[];
    difficulty?: DifficultyTier;
    /** Primary keyword ids of the last N questions served (most-recent last). */
    recent_keyword_ids?: string[];
    /** Normalised stems of questions already seen this session. */
    seen_stems?: string[];
    /** Question ids of the last N served items — drives embedding-based MMR. */
    recent_question_ids?: string[];
  };

  const { session_id, exclude_ids = [], keyword_id } = body;
  const recentKeywordIds: string[] = Array.isArray(body.recent_keyword_ids)
    ? body.recent_keyword_ids
    : [];
  const recentQuestionIds: string[] = Array.isArray(body.recent_question_ids)
    ? body.recent_question_ids.slice(-10)
    : [];
  const seenStems: string[] = Array.isArray(body.seen_stems)
    ? body.seen_stems
    : [];

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

  // Use first category_id for single-category helpers (template cards, etc.)
  const primaryCategoryId = categoryIds[0];

  const supabase = createClient(supabaseUrl, key);

  // 1. Load keywords via loadTargetKeywords (in_depth preferred)
  // excludeIntros: intro keywords (order_index -1) are framing-only, never questioned.
  const keywords = await loadTargetKeywords(supabase, categoryIds, { excludeIntros: true });
  if (keywords.length === 0) {
    return NextResponse.json(
      { error: "Unknown category or no keywords seeded for it" },
      { status: 404 }
    );
  }

  // Resolve keyword_ids scope (only used when keyword_id single is absent)
  // Filter to ids that actually belong to this category's keyword set
  const categoryKeywordIdSet = new Set(keywords.map((k) => k.id));
  const rawKeywordIds = Array.isArray(body.keyword_ids) ? body.keyword_ids : [];
  const filteredKeywordIds = rawKeywordIds.filter((id) =>
    categoryKeywordIdSet.has(id)
  );
  // Effective set scope: non-empty filtered list, or null (fall back to category)
  const scopedKeywordIds: Set<string> | null =
    !keyword_id && filteredKeywordIds.length > 0
      ? new Set(filteredKeywordIds)
      : null;

  // Fetch student keyword states — include consecutive_correct for escalation bump
  const [statesRes, attemptsRes] = await Promise.all([
    supabase
      .from("mcat_student_keyword_states")
      .select("keyword_id, score, consecutive_correct, last_review_at, floor")
      .eq("session_id", session_id),
    supabase
      .from("mcat_question_attempts")
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

  // 2. Build set of seen question ids
  const seenIds = new Set<string>(
    (attemptsRes.data ?? []).map((a) => a.question_id as string)
  );
  for (const id of exclude_ids) seenIds.add(id);

  // Active "prioritize this topic" keywords for this session (fail-soft).
  const { ids: prioritizedIds } = await loadActivePriorities(
    supabase,
    session_id,
    "mcat"
  );

  // 3. Compute effective target difficulty
  //    — use scoped keyword set when active
  const strengthSource = scopedKeywordIds
    ? keywords.filter((kw) => scopedKeywordIds.has(kw.id))
    : keywords;
  const allStrengths = strengthSource.map((kw) => strengths[kw.id] ?? 0.5);
  const avgStrength =
    allStrengths.length > 0
      ? allStrengths.reduce((a, b) => a + b, 0) / allStrengths.length
      : 0.5;

  // Explicit difficulty override vs. adaptive with escalation
  let effectiveTarget: number;
  let explicitTier: DifficultyTier | null = null;

  if (body.difficulty) {
    explicitTier = body.difficulty;
    effectiveTarget = TIER_TARGET[explicitTier];
  } else {
    // Adaptive base
    const base = 0.2 + avgStrength * 0.6;
    // Escalation bump: max consecutive_correct among scoped keywords
    const scopedKws = scopedKeywordIds
      ? keywords.filter((kw) => scopedKeywordIds.has(kw.id))
      : keyword_id
      ? keywords.filter((kw) => kw.id === keyword_id)
      : keywords;
    const maxConsecutive = scopedKws.reduce((mx, kw) => {
      return Math.max(mx, consecutiveCorrectMap[kw.id] ?? 0);
    }, 0);
    const escalationBump = Math.min(0.15, 0.05 * maxConsecutive);
    effectiveTarget = clamp(base + escalationBump, 0.2, 0.9);
  }

  // Derive tier from effective target (used for generation and in-band boosting)
  const effectiveTier: DifficultyTier = explicitTier ?? numericToTier(effectiveTarget);

  // 4. Load active stored questions, excluding seen. LIGHT columns only — the 4
  //    embedding columns are large and not needed to score; they're fetched in a
  //    second, tightly-scoped query (step 5b) for just the top-N candidates.
  const questionsQuery = supabase
    .from("mcat_questions")
    .select(
      "id, stem, choices, correct_index, explanation, keyword_weights, difficulty, parent_question_id, avg_rating"
    )
    .in("category_id", categoryIds)
    .eq("status", "active");

  const { data: allQs } = await questionsQuery;

  let candidates: DbQuestion[] = (allQs ?? []).filter(
    (q) => !seenIds.has(q.id as string)
  ) as DbQuestion[];

  // Filter by scope — precedence: keyword_id (single) > keyword_ids > category.
  //
  // IN-SCOPE GUARANTEE: a question merely *carrying* the target keyword at a tiny
  // weight is NOT in scope — its dominant subject is something else, which is how
  // out-of-scope questions leaked into auto mode. Require the target keyword to be
  // the question's PRIMARY (argmax) weight, or at least a substantial share, and
  // fall back to looser tiers only if the strict pool is empty so we never starve.
  const SCOPE_MIN_WEIGHT = 0.34;
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
    // Set scope: prefer questions whose PRIMARY keyword is in scope; fall back to
    // any in-scope membership only if that's empty.
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

  // 5. Score candidates (with rating nudge + in-band boost when explicit difficulty)
  const [bandMin, bandMax] = TIER_BAND[effectiveTier];

  type ScoredQ = DbQuestion & { score: number };
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
    const weakness =
      totalWeight > 0 ? weightedWeakness / totalWeight : 0.5;
    const diffScore = difficultyFit(
      (q.difficulty as number) ?? 0.5,
      effectiveTarget
    );
    // Rating nudge: multiply score by (0.7 + 0.3 * (avg_rating ?? 3) / 5)
    const ratingNudge = 0.7 + 0.3 * ((q.avg_rating ?? 3) / 5);
    // In-band boost when an explicit difficulty override is present:
    // candidates whose difficulty falls within the tier's band get a 2x multiplier
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
  //     LOWER a score, so ranking just the top-N is behaviour-equivalent.
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
      .from("mcat_questions")
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
  // BUG-FIX: filterNearDuplicates compares normalized stems, but the normalized stem
  // must NOT replace the original — otherwise the display stem sent to the client
  // shows artifacts like "i to i NUM hydrogen bonds" instead of "i to i+4 hydrogen bonds".
  // Strategy: normalize stems on copies for filtering, then restore originals by id.
  const afterStreakFilters = filterStreakUmbrella(
    filterStreakKeyword(ranked, blockedKw),
    blockedUmbrella,
    kwParentMap
  );
  const originalStemById = new Map(afterStreakFilters.map((q) => [q.id, q.stem]));
  const diverseScored = filterNearDuplicates(
    afterStreakFilters.map((q) => ({ ...q, stem: normalizeStem(q.stem ?? "") })),
    seenStems
  ).map((q) => ({ ...q, stem: originalStemById.get(q.id) ?? q.stem }));

  const top5 = diverseScored.slice(0, 5);

  // When explicit difficulty: check if any in-band candidates exist in top5
  // If none, we skip stored selection and go straight to generation at that tier
  const hasInBandCandidate =
    !explicitTier ||
    top5.some((q) => {
      const d = (q.difficulty as number) ?? 0.5;
      return d >= bandMin && d <= bandMax;
    });

  // 6. If enough candidates and in-band (or adaptive), pick and return
  if (candidates.length >= 3 && top5.length > 0 && hasInBandCandidate) {
    const selected = weightedRandomPick(top5) ?? top5[0];
    // Authoritative toolbar keyword: closest keyword (embedding) to the question,
    // not just the max stored weight. Fail-soft to max-weight.
    const primaryKeywordId = await bestKeywordForQuestion(supabase, {
      system: "mcat",
      table: "mcat_questions",
      keywordTable: "mcat_keywords",
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
  const genCellKey = `mcat:${primaryCategoryId}:${genBand}`;
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
  // Generate a BATCH of distinct questions: serve 1 now, store the rest. 5 is the
  // standard batch (serve 1 + store 4); a cold cell warms with a bigger buffer.
  // The dedup pass below keeps the stored items materially different.
  const batchCount = gotGenLock ? (coldCell ? 6 : 5) : 1;

  const { data: kwStatesDetailed } = await supabase
    .from("mcat_student_keyword_states")
    .select("keyword_id, score, total_attempts")
    .eq("session_id", session_id)
    .in(
      "keyword_id",
      keywords.map((k) => k.id)
    );

  const kwStateMap = new Map(
    (kwStatesDetailed ?? []).map((s) => [s.keyword_id as string, s])
  );

  // Determine generation pool — precedence mirrors candidate filtering above
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
    // Set scope: restrict generation pool to the scoped set
    genKeywords = keywords.filter((k) => scopedKeywordIds.has(k.id));
  }

  // Yield-level nudge: among comparably-weak keywords, AAMC high-yield topics
  // sort earlier (lower effective score) and low-yield topics sort later.
  // NULL yield_level is treated as "medium" (zero adjustment).
  // Guard: only apply when selection is automatic (category-wide or set-scoped).
  // When keyword_id is present the user picked a single keyword explicitly —
  // leave ordering unchanged so the intent is respected.
  const YIELD_ADJ: Record<string, number> = { high: -0.12, medium: 0, low: 0.10 };
  const applyYield = !keyword_id;

  const kwSorted = [...genKeywords].sort((a, b) => {
    const aState = kwStateMap.get(a.id);
    const bState = kwStateMap.get(b.id);
    const rawA = (aState?.score as number) ?? 0.5;
    const rawB = (bState?.score as number) ?? 0.5;
    const aScore = applyYield
      ? rawA + (YIELD_ADJ[a.yield_level ?? "medium"] ?? 0)
      : rawA;
    const bScore = applyYield
      ? rawB + (YIELD_ADJ[b.yield_level ?? "medium"] ?? 0)
      : rawB;
    if (Math.abs(aScore - bScore) > 0.01) return aScore - bScore;
    const aAttempts = (aState?.total_attempts as number) ?? 0;
    const bAttempts = (bState?.total_attempts as number) ?? 0;
    return aAttempts - bAttempts;
  });

  const weakestKws = kwSorted.slice(0, 2).map((kw) => ({
    id: kw.id,
    label: kw.label,
    description: kw.description ?? "",
    blueprint: kw.concept_blueprint,
  }));

  const templateCards = await fetchTemplateCards(
    supabase,
    primaryCategoryId,
    weakestKws.map((k) => k.label)
  );

  const outlineContext = outlineContextForCategory(primaryCategoryId);

  let generated: ScoredQ[] = [];
  try {
    let genResults = await generateMcatQuestions({
      keywords:
        weakestKws.length > 0
          ? weakestKws
          : keywords.slice(0, 3).map((k) => ({
              id: k.id,
              label: k.label,
              description: k.description ?? "",
              blueprint: k.concept_blueprint,
            })),
      templateCards,
      count: batchCount,
      targetDifficulty: effectiveTarget,
      difficultyTier: effectiveTier,
      outlineContext,
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

    // DEDUP PASS: drop generated items whose stem near-duplicates an earlier one
    // in THIS batch (Jaccard ≥ NEAR_DUP_THRESHOLD), so stored items are materially
    // different. Index-preserving to keep the verify/embed pipeline aligned.
    genResults = filterNearDuplicates(
      genResults.map((q, i) => ({ stem: q.stem, idx: i }))
    ).map((d) => genResults[d.idx]);

    // Embed + retag each generated question before insert
    const sourceCardIds = templateCards.map((c) => c.id);
    const keywordsWithEmbed = keywords.filter((k) => k.embedding !== null);

    // Run embedding AND fast verification concurrently so their latencies overlap
    const [rows, verifyResults] = await Promise.all([
      Promise.all(
        genResults.map(async (q) => {
          let embedding: number[] | null = null;
          let finalWeights = q.keyword_weights;

          try {
            embedding = await embedText(
              `${q.stem} | ${q.choices[q.correct_index]}`
            );
            const retagged = tagByEmbedding(embedding, keywordsWithEmbed);
            if (!keyword_id && Object.keys(retagged).length > 0) {
              finalWeights = retagged;
            }
          } catch {
            // Embedding failure is non-fatal — keep LLM weights
          }

          return {
            section: sectionFromId(primaryCategoryId) as string,
            category_id: primaryCategoryId,
            stem: q.stem,
            choices: q.choices,
            correct_index: q.correct_index,
            explanation: q.explanation,
            keyword_weights: finalWeights,
            difficulty: q.difficulty,
            source_card_ids: sourceCardIds,
            generated_by: "gpt-5.4-mini",
            status: "active",
            embedding: embedding as unknown,
          };
        })
      ),
      verifyQuestionsFast(
        genResults.map((q) => ({
          stem: q.stem,
          choices: q.choices,
          correct_index: q.correct_index,
        }))
      ),
    ]);

    // Determine which questions passed verification (agrees === true)
    // Fail-safe: if all fail, keep all and warn so the student still gets a question
    let keptIndices = verifyResults
      .map((r, i) => (r.agrees ? i : -1))
      .filter((i) => i !== -1);
    if (keptIndices.length === 0) {
      console.warn(
        "[next-question] all generated questions failed fast-verify; serving best-effort"
      );
      keptIndices = rows.map((_, i) => i);
    }
    const keptSet = new Set(keptIndices);

    const { data: inserted } = await supabase
      .from("mcat_questions")
      .insert(rows.filter((_, i) => keptSet.has(i)))
      .select(
        "id, stem, choices, correct_index, explanation, keyword_weights, difficulty, parent_question_id, avg_rating"
      );

    if (inserted && inserted.length > 0) {
      // Fire-and-forget four-dimension grounding of the new questions.
      enrichQuestionsInBackground(
        supabase,
        "mcat",
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
        const weakness =
          totalWeight > 0 ? weightedWeakness / totalWeight : 0.5;
        const diffScore = difficultyFit(
          (q.difficulty as number) ?? 0.5,
          effectiveTarget
        );
        const ratingNudge = 0.7 + 0.3 * ((q.avg_rating ?? 3) / 5);
        const prioBoost = priorityBoost(q.keyword_weights, prioritizedIds);
        return { ...q, score: weakness * diffScore * ratingNudge * prioBoost };
      });
      generated = insertedScored;
    }
  } catch (err) {
    if (err instanceof McatGenError) {
      return NextResponse.json(
        { error: "Question generation failed", detail: err.message },
        { status: err.status }
      );
    }
    throw err;
  }

  // Merge existing + newly generated; apply diversity filters to generated too, pick best
  const afterStreakFiltersGen = filterStreakUmbrella(
    filterStreakKeyword(generated, blockedKw),
    blockedUmbrella,
    kwParentMap
  );
  const origStemGenById = new Map(afterStreakFiltersGen.map((q) => [q.id, q.stem]));
  const diverseGenerated = filterNearDuplicates(
    afterStreakFiltersGen.map((q) => ({ ...q, stem: normalizeStem(q.stem ?? "") })),
    seenStems
  ).map((q) => ({ ...q, stem: origStemGenById.get(q.id) ?? q.stem }));
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
    system: "mcat",
    table: "mcat_questions",
    keywordTable: "mcat_keywords",
    questionId: selected.id,
    categoryId: primaryCategoryId,
    fallbackWeights: selected.keyword_weights,
  });

  return NextResponse.json({
    question: shapeQuestion(selected, primaryKeywordId),
    // Serve 1, hand back the rest of the freshly generated+stored batch (and any
    // remaining stored candidates) so the next items need NO round-trip.
    buffer: bufferItems(finalPool, selected.id),
    generated: isNewlyGenerated,
  });
}
