/**
 * Math tagging helpers (precalc + calc_ab).
 *
 * - cosineSimilarity: identical to mcatTagging.ts
 * - embedText: text-embedding-3-small via OpenAI (same as MCAT)
 * - tagByEmbedding: top-4 cosine match, threshold 0.25 (fallback top-2), normalized
 * - loadTargetKeywords: in_depth preferred, umbrella fallback per category
 *   — uses math_keywords table with course/category filters
 *
 * Port of mcatTagging.ts adapted for math_keywords instead of mcat_keywords.
 * Does NOT import from mcatTagging to keep the two systems fully decoupled.
 */
import { SupabaseClient } from "@supabase/supabase-js";
import { MathGenError } from "@/lib/mathGenerator";
import type { ConceptBlueprint, MathCourse } from "@/lib/mathTypes";
import { fetchAllPages } from "@/lib/mathPagedQuery";
import {
  cosineSimilarity,
  tagByEmbedding,
  embedTextRaw,
  EmbeddingError,
} from "@/lib/courseEngine/embeddings";
import { buildContractsForSet } from "@/lib/scopeContract";
import { cached } from "@/lib/serverCache";

// Shared embedding/tagging primitives (single impl in courseEngine), re-exported
// so existing importers of mathTagging keep working unchanged.
export { cosineSimilarity, tagByEmbedding };

// ─── Embedding ─────────────────────────────────────────────────────────────────

/** Wraps the shared embedding call in MathGenError to preserve the soft-fail contract. */
export async function embedText(text: string): Promise<number[]> {
  try {
    return await embedTextRaw(text);
  } catch (err) {
    if (err instanceof EmbeddingError) {
      throw new MathGenError(err.message, err.kind === "no_key" ? 500 : undefined);
    }
    throw err;
  }
}

// ─── Target keyword loader ─────────────────────────────────────────────────────

export type TargetMathKeyword = {
  id: string;
  label: string;
  description: string;
  tier: string;
  parent_keyword_id: string | null;
  category_id: string;
  embedding: unknown;
  concept_blueprint: ConceptBlueprint | null;
  yield_score: number | null;
};

/**
 * Load approved math_keywords for the given category IDs.
 * Prefers in_depth tier when it exists for a category,
 * falls back to umbrella tier when the category has no in_depth keywords.
 *
 * When `course` is provided, also restricts to categories that belong to that
 * course (via math_course_categories) so that generated fallback questions are
 * always course-appropriate. This prevents calc_ab from generating precalc-only
 * questions when no stored questions exist.
 */
export async function loadTargetKeywords(
  supabase: SupabaseClient,
  categoryIds: string[],
  course?: MathCourse
): Promise<TargetMathKeyword[]> {
  if (categoryIds.length === 0) return [];

  // Taxonomy is static per (course, category-set) — it carries no per-session data,
  // so cache the whole derivation (membership filter + paginated load + scope-contract
  // stamping) to take this off the hot path. Otherwise EVERY next-question/quiz request
  // re-paginates the whole-course keyword set (1700+ rows). TTL matches taxonomy/route.
  const cacheKey = `math:targetkw:${course ?? "none"}:${[...categoryIds].sort().join(",")}`;
  return cached<TargetMathKeyword[]>(cacheKey, 5 * 60 * 1000, () =>
    loadTargetKeywordsUncached(supabase, categoryIds, course)
  );
}

async function loadTargetKeywordsUncached(
  supabase: SupabaseClient,
  categoryIds: string[],
  course?: MathCourse
): Promise<TargetMathKeyword[]> {
  // When course is specified, filter categoryIds to only those that belong to
  // the requested course — prevents off-course keyword contamination
  let effectiveCategoryIds = categoryIds;
  if (course) {
    try {
      const { data: memberships } = await supabase
        .from("math_course_categories")
        .select("category_id")
        .eq("course", course)
        .in("category_id", categoryIds);
      if (memberships && memberships.length > 0) {
        const courseSet = new Set(memberships.map((m) => m.category_id as string));
        effectiveCategoryIds = categoryIds.filter((id) => courseSet.has(id));
      }
      // If no memberships found (e.g. taxonomy not seeded), fall back to all categoryIds
    } catch {
      // fail-open — use all categoryIds
    }
  }

  // Paginated — a whole-course scope (1700+ keywords) exceeds PostgREST's 1000-row cap
  let data: TargetMathKeyword[];
  try {
    data = await fetchAllPages<TargetMathKeyword>((from, to) =>
      supabase
        .from("math_keywords")
        .select(
          "id, label, description, tier, parent_keyword_id, category_id, embedding, concept_blueprint, yield_score"
        )
        .in("category_id", effectiveCategoryIds)
        .eq("status", "approved")
        .order("order_index")
        .range(from, to)
    );
  } catch {
    return [];
  }
  if (!data) return [];

  // Group by category
  const byCat = new Map<string, TargetMathKeyword[]>();
  for (const row of data as TargetMathKeyword[]) {
    const catId = row.category_id;
    if (!byCat.has(catId)) byCat.set(catId, []);
    byCat.get(catId)!.push(row);
  }

  const result: TargetMathKeyword[] = [];
  for (const catId of effectiveCategoryIds) {
    const rows = byCat.get(catId) ?? [];
    const inDepth = rows.filter((r) => r.tier === "in_depth");
    if (inDepth.length > 0) {
      result.push(...inDepth);
    } else {
      // Fallback: use umbrella keywords for this category
      const umbrella = rows.filter((r) => r.tier === "umbrella");
      result.push(...umbrella);
    }
  }

  // UNIVERSAL SCOPE CONTRACT: stamp an always-present scope contract onto every
  // returned keyword, derived in-memory from the full category set (`data`, which
  // still holds umbrellas + in_depth pre-sorted by order_index). This guarantees
  // every downstream generator (question/similar/quiz/flashcard) that reads
  // `concept_blueprint` gets a strict in/out-of-scope + forward fence — even for
  // umbrellas and intro keywords whose stored blueprint is null. See lib/scopeContract.ts.
  const contracts = buildContractsForSet(
    result.map((r) => ({
      id: r.id,
      label: r.label,
      tier: r.tier,
      parent_keyword_id: r.parent_keyword_id,
      category_id: r.category_id,
      concept_blueprint: r.concept_blueprint,
    })),
    (data as TargetMathKeyword[]).map((r) => ({
      id: r.id,
      label: r.label,
      tier: r.tier,
      parent_keyword_id: r.parent_keyword_id,
      category_id: r.category_id,
    }))
  );
  for (const r of result) {
    const c = contracts.get(r.id);
    if (c) r.concept_blueprint = c as ConceptBlueprint;
  }

  return result;
}
