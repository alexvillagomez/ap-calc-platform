/**
 * Shared helpers + types for the MCAT placement diagnostic, used by both
 * /api/mcat/diagnostic/start and /api/mcat/diagnostic/answer. Lives outside the
 * route files because Next.js route modules may only export HTTP handlers +
 * config (runtime/dynamic/etc.) — exporting helpers from a route breaks the
 * route type check.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { fetchTemplateCards } from "@/lib/mcatTemplateCards";
import {
  generateMcatQuestions,
  verifyQuestionsFast,
  McatGenError,
} from "@/lib/mcatGenerator";
import { loadTargetKeywords } from "@/lib/mcatTagging";
import { outlineContextForCategory } from "@/lib/mcatContentOutline";

/** Hard cap on placement questions — keep it short / umbrella-level. */
export const MAX_QUESTIONS = 10;

export function mcatAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

export type AskEntry = {
  umbrella_id: string;
  category_id: string;
  question_id: string;
  correct?: boolean;
  dont_know?: boolean;
};

export type UmbrellaRef = {
  id: string;
  label: string;
  category_id: string;
};

export type McatQuestionRow = {
  id: string;
  stem: string;
  choices: unknown;
  correct_index: number;
  explanation: string;
  keyword_weights: Record<string, number>;
  difficulty: number;
};

export function formatQuestion(q: McatQuestionRow) {
  return {
    id: q.id,
    stem: q.stem,
    choices: q.choices,
    correct_index: q.correct_index,
    explanation: q.explanation,
    keyword_weights: q.keyword_weights,
    difficulty: q.difficulty,
  };
}

/**
 * Ordered umbrella placement list: tier='umbrella', status='approved',
 * sorted by category.order_index then umbrella.order_index.
 */
export async function loadUmbrellaOrder(
  supabase: SupabaseClient
): Promise<UmbrellaRef[]> {
  const [{ data: cats }, { data: umbs }] = await Promise.all([
    supabase.from("mcat_categories").select("id, order_index"),
    supabase
      .from("mcat_keywords")
      .select("id, label, category_id, order_index")
      .eq("tier", "umbrella")
      .eq("status", "approved"),
  ]);

  const catOrder = new Map<string, number>();
  for (const c of cats ?? []) catOrder.set(c.id as string, (c.order_index as number) ?? 999);

  const list = (umbs ?? []).map((u) => ({
    id: u.id as string,
    label: u.label as string,
    category_id: u.category_id as string,
    _ord: (u.order_index as number) ?? 999,
  }));

  list.sort((a, b) => {
    const ca = catOrder.get(a.category_id) ?? 999;
    const cb = catOrder.get(b.category_id) ?? 999;
    if (ca !== cb) return ca - cb;
    return a._ord - b._ord;
  });

  return list.map(({ id, label, category_id }) => ({ id, label, category_id }));
}

/**
 * Get a mid-difficulty placement question for an umbrella.
 * Prefers stored mcat_questions for the umbrella's category that carry the
 * umbrella id in keyword_weights; falls back to any stored, then generation.
 * Fail-open: returns null if nothing can be produced.
 */
export async function getQuestionForUmbrella(
  supabase: SupabaseClient,
  umbrella: UmbrellaRef,
  excludeIds: string[],
  opts?: { storedOnly?: boolean }
): Promise<McatQuestionRow | null> {
  const cols =
    "id, stem, choices, correct_index, explanation, keyword_weights, difficulty";

  const { data: storedQs } = await supabase
    .from("mcat_questions")
    .select(cols)
    .eq("category_id", umbrella.category_id)
    .eq("status", "active")
    .limit(60);

  const available = (storedQs ?? []).filter(
    (q) => !excludeIds.includes(q.id as string)
  ) as McatQuestionRow[];

  if (available.length > 0) {
    const onUmbrella = available.filter(
      (q) =>
        q.keyword_weights &&
        Object.prototype.hasOwnProperty.call(q.keyword_weights, umbrella.id)
    );
    const pool = onUmbrella.length > 0 ? onUmbrella : available;
    const sorted = [...pool].sort(
      (a, b) =>
        Math.abs((a.difficulty ?? 0.5) - 0.55) -
        Math.abs((b.difficulty ?? 0.5) - 0.55)
    );
    return sorted[Math.floor(Math.random() * Math.min(sorted.length, 3))] ?? sorted[0];
  }

  // storedOnly: skip the (slow, network-bound) generation path entirely so the
  // caller can fast-fail. Used by the START route to keep placement quick.
  if (opts?.storedOnly) return null;

  // Generate (fail-open).
  try {
    const keywords = await loadTargetKeywords(supabase, [umbrella.category_id]);
    const children = keywords.filter((k) => k.parent_keyword_id === umbrella.id);
    const genKws = (children.length > 0 ? children : keywords)
      .slice(0, 2)
      .map((kw) => ({
        id: kw.id,
        label: kw.label,
        description: kw.description ?? "",
        blueprint: kw.concept_blueprint,
      }));
    if (genKws.length === 0) return null;

    const templateCards = await fetchTemplateCards(
      supabase,
      umbrella.category_id,
      genKws.map((k) => k.label)
    );
    const outlineContext = outlineContextForCategory(umbrella.category_id);

    const genResults = await generateMcatQuestions({
      keywords: genKws,
      templateCards,
      count: 2, // generate a couple; keep the first valid (better odds than 1)
      targetDifficulty: 0.55,
      difficultyTier: "medium",
      outlineContext,
    });
    if (genResults.length === 0) return null;
    const q = genResults[0];

    const verify = await verifyQuestionsFast([
      { stem: q.stem, choices: q.choices, correct_index: q.correct_index },
    ]);
    if (verify[0]?.ok && verify[0]?.agrees === false) {
      console.warn(
        `[mcat/diagnostic] generated question for umbrella ${umbrella.id} failed verify — serving best-effort`
      );
    }

    const { data: inserted } = await supabase
      .from("mcat_questions")
      .insert({
        category_id: umbrella.category_id,
        stem: q.stem,
        choices: q.choices,
        correct_index: q.correct_index,
        explanation: q.explanation,
        keyword_weights: q.keyword_weights,
        difficulty: q.difficulty,
        source: "generated",
        status: "active",
      })
      .select(cols)
      .single();

    return (inserted as McatQuestionRow | null) ?? null;
  } catch (err) {
    if (err instanceof McatGenError) {
      console.warn(
        `[mcat/diagnostic] generation failed for umbrella ${umbrella.id}:`,
        err.message
      );
    }
    return null;
  }
}
