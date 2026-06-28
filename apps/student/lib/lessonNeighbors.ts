/**
 * Light scope-context loader for lesson generation ("light-B").
 *
 * Returns the keyword's adjacent siblings in course order — a few EARLIER and a few
 * LATER subtopics under the same umbrella (or sibling umbrellas, for an umbrella-level
 * keyword). The generator injects these as REFERENCE context ("you may mention these
 * to clarify the current idea, but do NOT teach them"), which keeps an intro lesson
 * from drifting into later topics while still letting it foreshadow for clarity.
 *
 * Siblings share the SAME parent, so plain `order_index` ordering is correct here
 * (the per-parent order_index reset that bites whole-category queries does not apply).
 * Fails soft: any error → no neighbors (generation proceeds without the context).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LessonNeighbor {
  label: string;
  relation: "earlier" | "later";
}

const MAX_EACH_SIDE = 4;

export async function loadLessonNeighbors(
  supabase: SupabaseClient,
  table: "math_keywords" | "mcat_keywords",
  kw: {
    id: string;
    category_id: string | null;
    parent_keyword_id: string | null;
    order_index?: number | null;
  }
): Promise<LessonNeighbor[]> {
  if (!kw.category_id) return [];
  try {
    // Sibling set: same category + same parent (null parent = umbrella siblings).
    let query = supabase
      .from(table)
      .select("id, label, order_index")
      .eq("category_id", kw.category_id)
      .order("order_index", { ascending: true })
      .limit(200);
    query = kw.parent_keyword_id
      ? query.eq("parent_keyword_id", kw.parent_keyword_id)
      : query.is("parent_keyword_id", null);

    const { data, error } = await query;
    if (error || !Array.isArray(data)) return [];

    const rows = data as { id: string; label: string; order_index: number | null }[];
    const selfIdx = rows.findIndex((r) => r.id === kw.id);
    if (selfIdx < 0) return [];

    const earlier = rows
      .slice(Math.max(0, selfIdx - MAX_EACH_SIDE), selfIdx)
      .map((r): LessonNeighbor => ({ label: r.label, relation: "earlier" }));
    const later = rows
      .slice(selfIdx + 1, selfIdx + 1 + MAX_EACH_SIDE)
      .map((r): LessonNeighbor => ({ label: r.label, relation: "later" }));

    return [...earlier, ...later];
  } catch {
    return [];
  }
}
