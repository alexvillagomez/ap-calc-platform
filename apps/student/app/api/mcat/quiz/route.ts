import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchTemplateCards } from "@/lib/mcatTemplateCards";
import { generateMcatQuestions, McatGenError, verifyQuestionsFast } from "@/lib/mcatGenerator";
import { loadTargetKeywords } from "@/lib/mcatTagging";
import { outlineContextForCategory } from "@/lib/mcatContentOutline";

export const runtime = "nodejs";

const DEFAULT_COUNT = 8;
const MAX_COUNT = 12;

// ─── Difficulty helpers ────────────────────────────────────────────────────────

type DifficultyTier = "easy" | "medium" | "hard";

/** Representative numeric target for each named tier. */
const TIER_TARGET: Record<DifficultyTier, number> = {
  easy: 0.30,
  medium: 0.55,
  hard: 0.80,
};

/** Band bounds for each tier. */
const TIER_BAND: Record<DifficultyTier, [number, number]> = {
  easy: [0.20, 0.40],
  medium: [0.45, 0.65],
  hard: [0.70, 0.90],
};

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
    count?: number;
    keyword_ids?: string[];
    difficulty?: DifficultyTier;
    mixed?: boolean;
  };

  const { session_id, category_id } = body;
  const count = Math.min(body.count ?? DEFAULT_COUNT, MAX_COUNT);
  const explicitTier: DifficultyTier | null = body.difficulty ?? null;
  // mixed only applies when no explicit difficulty override
  const mixed = !explicitTier && (body.mixed ?? false);

  if (!session_id || !category_id) {
    return NextResponse.json(
      { error: "session_id and category_id are required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // Load keywords via loadTargetKeywords (in_depth preferred) + student states + seen
  const [allKeywords, statesRes, attemptsRes] = await Promise.all([
    loadTargetKeywords(supabase, [category_id]),
    supabase
      .from("mcat_student_keyword_states")
      .select("keyword_id, score, total_attempts")
      .eq("session_id", session_id),
    supabase
      .from("mcat_question_attempts")
      .select("question_id")
      .eq("session_id", session_id),
  ]);

  if (allKeywords.length === 0) {
    return NextResponse.json(
      { error: "Unknown category or no keywords seeded for it" },
      { status: 404 }
    );
  }

  // Resolve keyword_ids scope — filter to ids that exist in this category
  const categoryKeywordIdSet = new Set(allKeywords.map((k) => k.id));
  const rawKeywordIds = Array.isArray(body.keyword_ids) ? body.keyword_ids : [];
  const filteredKeywordIds = rawKeywordIds.filter((id) =>
    categoryKeywordIdSet.has(id)
  );
  // When the filtered set is non-empty, use it; otherwise fall back to all keywords
  const keywords =
    filteredKeywordIds.length > 0
      ? allKeywords.filter((k) => filteredKeywordIds.includes(k.id))
      : allKeywords;
  const scopedKeywordIds: Set<string> | null =
    filteredKeywordIds.length > 0 ? new Set(filteredKeywordIds) : null;

  const strengths: Record<string, number> = Object.fromEntries(
    (statesRes.data ?? []).map((s) => [
      s.keyword_id as string,
      (s.score as number) ?? 0.5,
    ])
  );

  const seenIds = new Set<string>(
    (attemptsRes.data ?? []).map((a) => a.question_id as string)
  );

  // Rank keywords by weakness (lowest strength first) — within scoped set.
  // Yield-level nudge: when the quiz is in automatic/category-wide mode (the
  // user did NOT pick a specific keyword_ids set), AAMC high-yield keywords sort
  // slightly earlier so they get covered preferentially among comparably-weak
  // topics.  NULL yield_level behaves as "medium" (zero adjustment).
  // Guard: skip the nudge when scopedKeywordIds is non-null — the user explicitly
  // chose those keywords and we should not reorder their intent.
  const YIELD_ADJ: Record<string, number> = { high: -0.12, medium: 0, low: 0.10 };
  const applyYield = scopedKeywordIds === null;

  const kwStateMap = new Map(
    (statesRes.data ?? []).map((s) => [s.keyword_id as string, s])
  );

  const rankedKws = [...keywords].sort((a, b) => {
    const rawA = (kwStateMap.get(a.id)?.score as number) ?? 0.5;
    const rawB = (kwStateMap.get(b.id)?.score as number) ?? 0.5;
    const aScore = applyYield
      ? rawA + (YIELD_ADJ[a.yield_level ?? "medium"] ?? 0)
      : rawA;
    const bScore = applyYield
      ? rawB + (YIELD_ADJ[b.yield_level ?? "medium"] ?? 0)
      : rawB;
    return aScore - bScore;
  });

  // Average strength for adaptive target difficulty — within scoped set
  const allStrengths = keywords.map((kw) => strengths[kw.id] ?? 0.5);
  const avgStrength =
    allStrengths.length > 0
      ? allStrengths.reduce((a, b) => a + b, 0) / allStrengths.length
      : 0.5;

  // Effective target and tier
  const targetDifficulty: number = explicitTier
    ? TIER_TARGET[explicitTier]
    : 0.2 + avgStrength * 0.6;
  const effectiveTier: DifficultyTier = explicitTier ?? (
    targetDifficulty < 0.45 ? "easy" : targetDifficulty < 0.70 ? "medium" : "hard"
  );

  // Load unseen stored questions with avg_rating
  const { data: allQs } = await supabase
    .from("mcat_questions")
    .select(
      "id, stem, choices, correct_index, explanation, keyword_weights, difficulty, parent_question_id, avg_rating"
    )
    .eq("category_id", category_id)
    .eq("status", "active");

  // When scoped: restrict to questions that carry at least one scoped keyword id
  const unseenQs: DbQuestion[] = ((allQs ?? []) as DbQuestion[]).filter((q) => {
    if (seenIds.has(q.id)) return false;
    if (scopedKeywordIds) {
      return (
        q.keyword_weights &&
        Object.keys(q.keyword_weights).some((id) => scopedKeywordIds.has(id))
      );
    }
    return true;
  });

  // Helper: in-band boost multiplier
  function inBandMultiplier(q: DbQuestion): number {
    if (!explicitTier) return 1.0;
    const [bandMin, bandMax] = TIER_BAND[explicitTier];
    const d = (q.difficulty as number) ?? 0.5;
    return d >= bandMin && d <= bandMax ? 2.0 : 1.0;
  }

  // Gather questions covering weakest keywords (≤2 per keyword)
  // Apply rating nudge + in-band boost when ranking
  const selectedIds = new Set<string>();
  const selectedQs: DbQuestion[] = [];
  const kwCoverage = new Map<string, number>();

  for (const kw of rankedKws) {
    if (selectedQs.length >= count) break;
    const kwId = kw.id;
    const coverage = kwCoverage.get(kwId) ?? 0;
    if (coverage >= 2) continue;

    // Score candidates for this keyword with rating nudge + in-band boost
    const matching = unseenQs
      .filter(
        (q) =>
          !selectedIds.has(q.id) &&
          q.keyword_weights &&
          Object.prototype.hasOwnProperty.call(q.keyword_weights, kwId)
      )
      .map((q) => {
        const kw2 = (q.keyword_weights as Record<string, number>) ?? {};
        let weightedWeakness = 0, totalWeight = 0;
        for (const [id, w] of Object.entries(kw2)) {
          if (w > 0) {
            weightedWeakness += w * (1 - (strengths[id] ?? 0.5));
            totalWeight += w;
          }
        }
        const weakness = totalWeight > 0 ? weightedWeakness / totalWeight : 0.5;
        const diffScore = Math.exp(
          -0.5 * ((((q.difficulty as number) ?? 0.5) - targetDifficulty) / 0.2) ** 2
        );
        const ratingNudge = 0.7 + 0.3 * ((q.avg_rating ?? 3) / 5);
        const bandBoost = inBandMultiplier(q);
        return { q, score: weakness * diffScore * ratingNudge * bandBoost };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.q);

    for (const q of matching) {
      if (selectedQs.length >= count) break;
      if (selectedIds.has(q.id)) continue;
      selectedQs.push(q);
      selectedIds.add(q.id);
      for (const id of Object.keys(
        (q.keyword_weights as Record<string, number>) ?? {}
      )) {
        kwCoverage.set(id, (kwCoverage.get(id) ?? 0) + 1);
      }
    }
  }

  // Fill remainder by generating
  const shortfall = count - selectedQs.length;
  if (shortfall > 0) {
    const genKws = rankedKws.slice(0, 3).map((kw) => ({
      id: kw.id,
      label: kw.label,
      description: kw.description ?? "",
      blueprint: kw.concept_blueprint,
    }));

    if (genKws.length > 0) {
      const templateCards = await fetchTemplateCards(
        supabase,
        category_id,
        genKws.map((k) => k.label)
      );

      const outlineContext = outlineContextForCategory(category_id);

      try {
        if (mixed && shortfall >= 3) {
          // Mixed mode: split the shortfall across easy / medium / hard tiers
          // Allocate roughly 1/3 each; use floor/ceil to fill exactly `shortfall`
          const tierOrder: DifficultyTier[] = ["easy", "medium", "hard"];
          const base = Math.floor(shortfall / 3);
          const remainder = shortfall - base * 3;
          // Assign +1 to hard first, then medium (hardest tiers benefit most from extra)
          const tierCounts: Record<DifficultyTier, number> = {
            easy: base,
            medium: base + (remainder >= 2 ? 1 : 0),
            hard: base + (remainder >= 1 ? 1 : 0),
          };

          for (const tier of tierOrder) {
            const n = tierCounts[tier];
            if (n <= 0) continue;
            const genResults = await generateMcatQuestions({
              keywords: genKws,
              templateCards,
              count: n,
              targetDifficulty: TIER_TARGET[tier],
              difficultyTier: tier,
              outlineContext,
            });

            if (genResults.length > 0) {
              const sourceCardIds = templateCards.map((c) => c.id);
              const allRows = genResults.map((q) => ({
                section: "biology",
                category_id,
                stem: q.stem,
                choices: q.choices,
                correct_index: q.correct_index,
                explanation: q.explanation,
                keyword_weights: q.keyword_weights,
                difficulty: q.difficulty,
                source_card_ids: sourceCardIds,
                generated_by: "gpt-5.4-mini",
                status: "active",
              }));

              // Verify concurrently — fail-open if all fail
              const verifyResults = await verifyQuestionsFast(
                genResults.map((q) => ({
                  stem: q.stem,
                  choices: q.choices,
                  correct_index: q.correct_index,
                }))
              );
              let keptIndices = verifyResults
                .map((r, i) => (r.agrees ? i : -1))
                .filter((i) => i !== -1);
              if (keptIndices.length === 0) {
                console.warn(
                  `[quiz] mixed tier=${tier}: all generated questions failed fast-verify; serving best-effort`
                );
                keptIndices = allRows.map((_, i) => i);
              }
              const keptSet = new Set(keptIndices);
              const rows = allRows.filter((_, i) => keptSet.has(i));

              const { data: inserted } = await supabase
                .from("mcat_questions")
                .insert(rows)
                .select(
                  "id, stem, choices, correct_index, explanation, keyword_weights, difficulty, parent_question_id, avg_rating"
                );

              for (const q of inserted ?? []) {
                if (selectedQs.length >= count) break;
                selectedQs.push(q as DbQuestion);
              }
            }
          }
        } else {
          // Normal fill: generate at the effective tier/target
          const genResults = await generateMcatQuestions({
            keywords: genKws,
            templateCards,
            count: shortfall,
            targetDifficulty,
            difficultyTier: effectiveTier,
            outlineContext,
          });

          if (genResults.length > 0) {
            const sourceCardIds = templateCards.map((c) => c.id);
            const allRows = genResults.map((q) => ({
              section: "biology",
              category_id,
              stem: q.stem,
              choices: q.choices,
              correct_index: q.correct_index,
              explanation: q.explanation,
              keyword_weights: q.keyword_weights,
              difficulty: q.difficulty,
              source_card_ids: sourceCardIds,
              generated_by: "gpt-5.4-mini",
              status: "active",
            }));

            // Verify concurrently — fail-open if all fail
            const verifyResults = await verifyQuestionsFast(
              genResults.map((q) => ({
                stem: q.stem,
                choices: q.choices,
                correct_index: q.correct_index,
              }))
            );
            let keptIndices = verifyResults
              .map((r, i) => (r.agrees ? i : -1))
              .filter((i) => i !== -1);
            if (keptIndices.length === 0) {
              console.warn(
                "[quiz] all generated questions failed fast-verify; serving best-effort"
              );
              keptIndices = allRows.map((_, i) => i);
            }
            const keptSet = new Set(keptIndices);
            const rows = allRows.filter((_, i) => keptSet.has(i));

            const { data: inserted } = await supabase
              .from("mcat_questions")
              .insert(rows)
              .select(
                "id, stem, choices, correct_index, explanation, keyword_weights, difficulty, parent_question_id, avg_rating"
              );

            for (const q of inserted ?? []) {
              if (selectedQs.length >= count) break;
              selectedQs.push(q as DbQuestion);
            }
          }
        }
      } catch (err) {
        if (err instanceof McatGenError) {
          // Partial failure — return what we have
          console.error("mcat/quiz: generation failed:", err.message);
        } else {
          throw err;
        }
      }
    }
  }

  // When mixed: sort so quiz progresses easy → medium → hard
  const finalQs = selectedQs.slice(0, count);
  if (mixed) {
    finalQs.sort((a, b) => (a.difficulty ?? 0.5) - (b.difficulty ?? 0.5));
  }

  const questions = finalQs.map((q) => ({
    id: q.id,
    stem: q.stem,
    choices: q.choices,
    correct_index: q.correct_index,
    explanation: q.explanation,
    keyword_weights: q.keyword_weights,
    difficulty: q.difficulty,
    parent_question_id: q.parent_question_id ?? null,
  }));

  return NextResponse.json({ questions });
}
