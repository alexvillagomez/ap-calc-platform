/**
 * MCAT Biology tagging helpers.
 * - cosineSimilarity: identical to app/api/lookup/route.ts lines 18–28.
 * - embedText: text-embedding-3-small via OpenAI.
 * - tagByEmbedding: top-4 cosine match, threshold 0.25 (fallback top-2), normalized.
 * - loadTargetKeywords: in_depth preferred, umbrella fallback per category.
 */
import { SupabaseClient } from "@supabase/supabase-js";
import { McatGenError } from "@/lib/mcatGenerator";
import { ConceptBlueprint } from "@/lib/mcatBlueprint";
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
// so existing importers of mcatTagging keep working unchanged.
export { cosineSimilarity, tagByEmbedding };

// ─── Embedding ────────────────────────────────────────────────────────────────

/** Wraps the shared embedding call in McatGenError to preserve the soft-fail contract. */
export async function embedText(text: string): Promise<number[]> {
  try {
    return await embedTextRaw(text);
  } catch (err) {
    if (err instanceof EmbeddingError) {
      throw new McatGenError(err.message, err.kind === "no_key" ? 500 : undefined);
    }
    throw err;
  }
}

// ─── Target keyword loader ────────────────────────────────────────────────────

export type TargetKeyword = {
  id: string;
  label: string;
  description: string;
  tier: string;
  parent_keyword_id: string | null;
  category_id: string;
  embedding: unknown;
  concept_blueprint: ConceptBlueprint | null;
  yield_level: "high" | "medium" | "low" | null;
  /** -1 marks an umbrella INTRO keyword (framing-only; never a question target). */
  order_index: number | null;
};

/**
 * Load approved keywords for the given category IDs.
 * Prefers in_depth tier when it exists for a category,
 * falls back to umbrella tier when the category has no in_depth keywords.
 */
export async function loadTargetKeywords(
  supabase: SupabaseClient,
  categoryIds: string[],
  opts?: { excludeIntros?: boolean }
): Promise<TargetKeyword[]> {
  if (categoryIds.length === 0) return [];

  // INTRO keywords (order_index === -1) are framing-only and must NEVER be a
  // question/quiz target — pass excludeIntros from any QUESTION-selection caller
  // (next-question, quiz). Flashcard/lesson callers leave it off (intros still get
  // their own lesson + framing flashcards).
  const excludeIntros = opts?.excludeIntros === true;

  // Taxonomy is static per category-set — no per-session data — so cache the whole
  // derivation to take it off the hot path (every next-question/quiz re-loads it today).
  const cacheKey = `mcat:targetkw:${excludeIntros ? "nointro:" : ""}${[...categoryIds].sort().join(",")}`;
  return cached<TargetKeyword[]>(cacheKey, 5 * 60 * 1000, () =>
    loadTargetKeywordsUncached(supabase, categoryIds, excludeIntros)
  );
}

async function loadTargetKeywordsUncached(
  supabase: SupabaseClient,
  categoryIds: string[],
  excludeIntros: boolean
): Promise<TargetKeyword[]> {
  // Paginate: across many categories the keyword set can exceed PostgREST's
  // 1000-row cap, which would silently drop keywords from the target pool.
  let data: TargetKeyword[];
  try {
    data = await fetchAllPages<TargetKeyword>((from, to) =>
      supabase
        .from("mcat_keywords")
        .select(
          "id, label, description, tier, parent_keyword_id, category_id, embedding, concept_blueprint, yield_level, order_index"
        )
        .in("category_id", categoryIds)
        .eq("status", "approved")
        .order("order_index")
        .order("id")
        .range(from, to)
    );
  } catch {
    return [];
  }

  // Drop INTRO keywords (order_index === -1) from the question-target pool when asked.
  if (excludeIntros) {
    data = (data as TargetKeyword[]).filter((r) => r.order_index !== -1);
  }

  // Group by category
  const byCat = new Map<string, TargetKeyword[]>();
  for (const row of data as TargetKeyword[]) {
    const catId = row.category_id;
    if (!byCat.has(catId)) byCat.set(catId, []);
    byCat.get(catId)!.push(row);
  }

  const result: TargetKeyword[] = [];
  for (const catId of categoryIds) {
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

  // UNIVERSAL SCOPE CONTRACT — stamp an always-present scope contract onto every
  // returned keyword, derived in-memory from the full category set. Guarantees
  // every downstream generator that reads `concept_blueprint` gets a strict
  // in/out-of-scope + forward fence even when the stored blueprint is null.
  // See lib/scopeContract.ts.
  const contracts = buildContractsForSet(
    result.map((r) => ({
      id: r.id,
      label: r.label,
      tier: r.tier,
      parent_keyword_id: r.parent_keyword_id,
      category_id: r.category_id,
      concept_blueprint: r.concept_blueprint,
    })),
    (data as TargetKeyword[]).map((r) => ({
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
