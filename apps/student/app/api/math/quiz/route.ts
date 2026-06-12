/**
 * POST /api/math/quiz
 *
 * Return N questions (default 8, max 12) for a math quiz.
 * Stored questions are preferred; shortfall is filled by generation.
 * mixed:true (default false) generates easy/medium/hard spread sorted
 * easy → medium → hard so the quiz progresses in difficulty.
 *
 * Body:
 *   session_id    required
 *   category_id   required (single category for quiz)
 *   count         default 8, max 12
 *   keyword_ids   optional scope filter
 *   difficulty    explicit tier override ("easy" | "medium" | "hard")
 *   mixed         boolean — spread easy/medium/hard (ignored when difficulty is set)
 *   course        "precalc" | "calc_ab"
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  generateMathQuestions,
  verifyMathQuestionsFast,
  MathGenError,
} from "@/lib/mathGenerator";
import { loadTargetKeywords } from "@/lib/mathTagging";
import { fetchExemplarProblems, buildExemplarBlock } from "@/lib/mathExemplars";
import { outlineContextForCategory } from "@/lib/mathContentOutline";
import type { MathCourse } from "@/lib/mathTypes";

export const runtime = "nodejs";

const DEFAULT_COUNT = 8;
const MAX_COUNT = 12;

type DifficultyTier = "easy" | "medium" | "hard";

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
    count?: number;
    keyword_ids?: string[];
    difficulty?: DifficultyTier;
    mixed?: boolean;
    course?: MathCourse;
  };

  const { session_id, category_id } = body;
  const count = Math.min(body.count ?? DEFAULT_COUNT, MAX_COUNT);
  const explicitTier: DifficultyTier | null = body.difficulty ?? null;
  const mixed = !explicitTier && (body.mixed ?? false);
  const course: MathCourse = body.course ?? "precalc";

  if (!session_id || !category_id) {
    return NextResponse.json(
      { error: "session_id and category_id are required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  const [allKeywords, statesRes, attemptsRes] = await Promise.all([
    loadTargetKeywords(supabase, [category_id], course),
    supabase
      .from("math_student_keyword_states")
      .select("keyword_id, score, total_attempts")
      .eq("session_id", session_id),
    supabase
      .from("math_question_attempts")
      .select("question_id")
      .eq("session_id", session_id),
  ]);

  if (allKeywords.length === 0) {
    return NextResponse.json(
      { error: "No keywords found for this category — taxonomy may not be seeded yet" },
      { status: 404 }
    );
  }

  const categoryKeywordIdSet = new Set(allKeywords.map((k) => k.id));
  const rawKeywordIds = Array.isArray(body.keyword_ids) ? body.keyword_ids : [];
  const filteredKeywordIds = rawKeywordIds.filter((id) => categoryKeywordIdSet.has(id));
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

  // Yield nudge (same formula as practice-queue spec)
  const yieldNudge = (y: number | null): number => 0.10 - 0.22 * (y ?? 0.5);
  const applyYield = scopedKeywordIds === null;

  const kwStateMap = new Map(
    (statesRes.data ?? []).map((s) => [s.keyword_id as string, s])
  );

  const rankedKws = [...keywords].sort((a, b) => {
    const rawA = (kwStateMap.get(a.id)?.score as number) ?? 0.5;
    const rawB = (kwStateMap.get(b.id)?.score as number) ?? 0.5;
    const aScore = applyYield ? rawA + yieldNudge(a.yield_score) : rawA;
    const bScore = applyYield ? rawB + yieldNudge(b.yield_score) : rawB;
    return aScore - bScore;
  });

  const allStrengths = keywords.map((kw) => strengths[kw.id] ?? 0.5);
  const avgStrength =
    allStrengths.length > 0
      ? allStrengths.reduce((a, b) => a + b, 0) / allStrengths.length
      : 0.5;

  const targetDifficulty: number = explicitTier
    ? TIER_TARGET[explicitTier]
    : 0.2 + avgStrength * 0.6;
  const effectiveTier: DifficultyTier =
    explicitTier ??
    (targetDifficulty < 0.45 ? "easy" : targetDifficulty < 0.70 ? "medium" : "hard");

  // Load unseen stored questions
  const { data: allQs } = await supabase
    .from("math_questions")
    .select(
      "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty, parent_question_id, avg_rating"
    )
    .eq("category_id", category_id)
    .eq("status", "active");

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

  function inBandMultiplier(q: DbQuestion): number {
    if (!explicitTier) return 1.0;
    const [bandMin, bandMax] = TIER_BAND[explicitTier];
    const d = (q.difficulty as number) ?? 0.5;
    return d >= bandMin && d <= bandMax ? 2.0 : 1.0;
  }

  // Gather stored questions (≤2 per keyword, weakness-first)
  const selectedIds = new Set<string>();
  const selectedQs: DbQuestion[] = [];
  const kwCoverage = new Map<string, number>();

  for (const kw of rankedKws) {
    if (selectedQs.length >= count) break;
    const kwId = kw.id;
    if ((kwCoverage.get(kwId) ?? 0) >= 2) continue;

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
          -0.5 *
            ((((q.difficulty as number) ?? 0.5) - targetDifficulty) / 0.2) ** 2
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

  // Fill shortfall by generating
  const shortfall = count - selectedQs.length;
  if (shortfall > 0) {
    const genKws = rankedKws.slice(0, 3).map((kw) => ({
      id: kw.id,
      label: kw.label,
      description: kw.description ?? "",
      blueprint: kw.concept_blueprint,
    }));

    if (genKws.length > 0) {
      // Exemplar block (fail-open)
      let exemplarBlock = "";
      try {
        const exemplars = await fetchExemplarProblems(supabase, null, course, 3);
        exemplarBlock = buildExemplarBlock(exemplars);
      } catch {
        // ignore
      }

      const outlineContext = outlineContextForCategory(category_id);

      // Helper: generate + verify + insert for one tier
      const genAndInsert = async (
        n: number,
        tier: DifficultyTier
      ): Promise<DbQuestion[]> => {
        const genResults = await generateMathQuestions({
          keywords: genKws,
          count: n,
          targetDifficulty: TIER_TARGET[tier],
          difficultyTier: tier,
          outlineContext,
          exemplarBlock: exemplarBlock || undefined,
        });

        if (genResults.length === 0) return [];

        const allRows = genResults.map((q) => ({
          category_id,
          stem_latex: q.stem_latex,
          choices: q.choices,
          correct_index: q.correct_index,
          solution_latex: q.solution_latex,
          hint_latex: q.hint_latex,
          keyword_weights: q.keyword_weights,
          difficulty: q.difficulty,
          source: "generated",
          status: "active",
        }));

        const verifyResults = await verifyMathQuestionsFast(
          genResults.map((q) => ({
            stem_latex: q.stem_latex,
            choices: q.choices,
            correct_index: q.correct_index,
          }))
        );
        let keptIndices = verifyResults
          .map((r, i) => (r.agrees ? i : -1))
          .filter((i) => i !== -1);
        if (keptIndices.length === 0) {
          console.warn(
            `[math/quiz] tier=${tier}: all generated questions failed fast-verify; serving best-effort`
          );
          keptIndices = allRows.map((_, i) => i);
        }
        const keptSet = new Set(keptIndices);
        const rows = allRows.filter((_, i) => keptSet.has(i));

        const { data: inserted } = await supabase
          .from("math_questions")
          .insert(rows)
          .select(
            "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty, parent_question_id, avg_rating"
          );

        return (inserted ?? []) as DbQuestion[];
      };

      try {
        if (mixed && shortfall >= 3) {
          const tierOrder: DifficultyTier[] = ["easy", "medium", "hard"];
          const base = Math.floor(shortfall / 3);
          const remainder = shortfall - base * 3;
          const tierCounts: Record<DifficultyTier, number> = {
            easy: base,
            medium: base + (remainder >= 2 ? 1 : 0),
            hard: base + (remainder >= 1 ? 1 : 0),
          };

          for (const tier of tierOrder) {
            const n = tierCounts[tier];
            if (n <= 0) continue;
            const items = await genAndInsert(n, tier);
            for (const q of items) {
              if (selectedQs.length >= count) break;
              selectedQs.push(q);
            }
          }
        } else {
          const items = await genAndInsert(shortfall, effectiveTier);
          for (const q of items) {
            if (selectedQs.length >= count) break;
            selectedQs.push(q);
          }
        }
      } catch (err) {
        if (err instanceof MathGenError) {
          console.error("math/quiz: generation failed:", err.message);
          // partial failure — return what we have
        } else {
          throw err;
        }
      }
    }
  }

  // Sort easy → medium → hard when mixed
  const finalQs = selectedQs.slice(0, count);
  if (mixed) {
    finalQs.sort((a, b) => (a.difficulty ?? 0.5) - (b.difficulty ?? 0.5));
  }

  const questions = finalQs.map((q) => ({
    id: q.id,
    stem_latex: q.stem_latex,
    choices: q.choices,
    correct_index: q.correct_index,
    solution_latex: q.solution_latex,
    hint_latex: q.hint_latex ?? null,
    keyword_weights: q.keyword_weights,
    difficulty: q.difficulty,
    parent_question_id: q.parent_question_id ?? null,
  }));

  return NextResponse.json({ questions });
}
