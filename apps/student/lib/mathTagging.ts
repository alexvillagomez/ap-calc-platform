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
import OpenAI from "openai";
import { SupabaseClient } from "@supabase/supabase-js";
import { MathGenError } from "@/lib/mathGenerator";
import type { ConceptBlueprint, MathCourse } from "@/lib/mathTypes";
import { fetchAllPages } from "@/lib/mathPagedQuery";

// ─── Cosine similarity ─────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Embedding ─────────────────────────────────────────────────────────────────

export async function embedText(text: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new MathGenError("OPENAI_API_KEY not set", 500);
  const client = new OpenAI({ apiKey: key });
  try {
    const res = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    });
    return res.data[0].embedding;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MathGenError(`Embedding request failed: ${msg}`);
  }
}

// ─── Tagging by embedding ──────────────────────────────────────────────────────

/**
 * Tag an embedding against a keyword pool.
 * Returns normalized weights for top-4 keywords with sim > 0.25.
 * Falls back to top-2 (no threshold) if none pass.
 * Returns {} if no keyword has a valid array embedding.
 */
export function tagByEmbedding(
  embedding: number[],
  keywords: { id: string; embedding: unknown }[]
): Record<string, number> {
  const withEmbed = keywords.filter(
    (k) =>
      Array.isArray(k.embedding) && (k.embedding as unknown[]).length > 0
  );
  if (withEmbed.length === 0) return {};

  const scored = withEmbed
    .map((kw) => ({
      id: kw.id,
      sim: cosineSimilarity(embedding, kw.embedding as number[]),
    }))
    .sort((a, b) => b.sim - a.sim);

  // Top 4 with threshold
  let top = scored.slice(0, 4).filter((k) => k.sim > 0.25);

  // Fallback: top 2 regardless of threshold
  if (top.length === 0) {
    top = scored.slice(0, 2);
  }

  if (top.length === 0) return {};

  const total = top.reduce((acc, k) => acc + k.sim, 0);
  if (total === 0) return {};

  return Object.fromEntries(top.map((k) => [k.id, k.sim / total]));
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

  return result;
}
