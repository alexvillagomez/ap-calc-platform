import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchTemplateCards } from "@/lib/mcatTemplateCards";
import { generateMcatQuestions, McatGenError, verifyQuestionsFast } from "@/lib/mcatGenerator";
import { loadTargetKeywords, embedText, tagByEmbedding } from "@/lib/mcatTagging";
import { outlineContextForCategory } from "@/lib/mcatContentOutline";
import { loadActivePriorities, PRIORITY_BOOST_FACTOR } from "@/lib/priorities";
import { bestKeywordForQuestion } from "@/lib/bestKeyword";

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
    exclude_ids?: string[];
    keyword_id?: string;
    keyword_ids?: string[];
    difficulty?: DifficultyTier;
  };

  const { session_id, exclude_ids = [], keyword_id } = body;

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
  const keywords = await loadTargetKeywords(supabase, categoryIds);
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
      .select("keyword_id, score, consecutive_correct")
      .eq("session_id", session_id),
    supabase
      .from("mcat_question_attempts")
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

  // 4. Load active stored questions, excluding seen
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

  // Filter by scope — precedence: keyword_id (single) > keyword_ids > category
  if (keyword_id) {
    // Single-keyword: restrict to questions whose keyword_weights contains it
    candidates = candidates.filter(
      (q) =>
        q.keyword_weights &&
        Object.prototype.hasOwnProperty.call(q.keyword_weights, keyword_id)
    );
  } else if (scopedKeywordIds) {
    // Set scope: restrict to questions that carry at least one id in the set
    candidates = candidates.filter(
      (q) =>
        q.keyword_weights &&
        Object.keys(q.keyword_weights).some((id) => scopedKeywordIds.has(id))
    );
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

  scored.sort((a, b) => b.score - a.score);
  const top5 = scored.slice(0, 5);

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
      question: {
        id: selected.id,
        stem: selected.stem,
        choices: selected.choices,
        correct_index: selected.correct_index,
        explanation: selected.explanation,
        keyword_weights: selected.keyword_weights,
        difficulty: selected.difficulty,
        parent_question_id: selected.parent_question_id ?? null,
        primary_keyword_id: primaryKeywordId,
      },
      generated: false,
    });
  }

  // 7. Not enough candidates — generate new questions
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
    // Single keyword: use that keyword + up to 2 siblings (same parent)
    const targetKw = keywords.find((k) => k.id === keyword_id);
    if (targetKw) {
      const parentId = targetKw.parent_keyword_id;
      const siblings = parentId
        ? keywords
            .filter(
              (k) => k.parent_keyword_id === parentId && k.id !== keyword_id
            )
            .slice(0, 2)
        : [];
      genKeywords = [targetKw, ...siblings];
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
    const genResults = await generateMcatQuestions({
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
      count: 3,
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
            if (Object.keys(retagged).length > 0) {
              finalWeights = retagged;
            }
          } catch {
            // Embedding failure is non-fatal — keep LLM weights
          }

          return {
            section: "biology" as string,
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

  // Merge existing + newly generated, pick best
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

  const primaryKeywordId = await bestKeywordForQuestion(supabase, {
    system: "mcat",
    table: "mcat_questions",
    keywordTable: "mcat_keywords",
    questionId: selected.id,
    categoryId: primaryCategoryId,
    fallbackWeights: selected.keyword_weights,
  });

  return NextResponse.json({
    question: {
      id: selected.id,
      stem: selected.stem,
      choices: selected.choices,
      correct_index: selected.correct_index,
      explanation: selected.explanation,
      keyword_weights: selected.keyword_weights,
      difficulty: selected.difficulty,
      parent_question_id: selected.parent_question_id ?? null,
      primary_keyword_id: primaryKeywordId,
    },
    generated: isNewlyGenerated,
  });
}
