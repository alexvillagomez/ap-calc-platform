/**
 * Single source of truth for mapping an mcat id → its discipline section.
 *
 * Works for BOTH category ids (`mcat_<section>_*`) and keyword ids (namespaced
 * prefixes per section). Default is `biology` so every existing Biology flow is
 * byte-for-byte unchanged.
 *
 * Sections + id namespaces:
 *   biology    — category `mcat_biology_*`     / keyword: bare slug
 *   psych_soc  — category `mcat_psychsoc_*`    / keyword `ps_*`
 *   physics    — category `mcat_physics_*`     / keyword `ph_*`
 *   chemistry  — category `mcat_chemistry_*`   / keyword `ch_*`
 */
export type McatSection = "biology" | "psych_soc" | "physics" | "chemistry";

export function sectionFromId(id: string | null | undefined): McatSection {
  const s = String(id ?? "");
  if (s.startsWith("mcat_psychsoc_") || s.startsWith("ps_")) return "psych_soc";
  if (s.startsWith("mcat_physics_") || s.startsWith("ph_")) return "physics";
  if (s.startsWith("mcat_chemistry_") || s.startsWith("ch_")) return "chemistry";
  return "biology";
}

/** Canonical display order of the four MCAT sections ("the four courses"). */
export const MCAT_SECTION_ORDER: McatSection[] = [
  "biology",
  "psych_soc",
  "chemistry",
  "physics",
];

/** Human labels for each section header. */
export const MCAT_SECTION_LABELS: Record<McatSection, string> = {
  biology: "Biology",
  psych_soc: "Psych/Soc",
  chemistry: "Chemistry",
  physics: "Physics",
};

/**
 * Group categories into the four sections in canonical order, with the
 * categories inside each section sorted by curriculum order (`order_index`).
 * Sections with no categories are omitted. Section is read from `cat.section`
 * when present, else inferred from the id — so the order is deterministic and
 * navigable instead of the taxonomy's cross-section interleave.
 */
export function groupCategoriesBySection<
  T extends { id: string; section?: string | null; order_index?: number | null }
>(cats: T[]): { section: McatSection; label: string; categories: T[] }[] {
  const buckets = new Map<McatSection, T[]>();
  for (const s of MCAT_SECTION_ORDER) buckets.set(s, []);

  for (const c of cats) {
    const declared = c.section as McatSection | undefined;
    const sec =
      declared && MCAT_SECTION_ORDER.includes(declared)
        ? declared
        : sectionFromId(c.id);
    buckets.get(sec)!.push(c);
  }

  const groups: { section: McatSection; label: string; categories: T[] }[] = [];
  for (const s of MCAT_SECTION_ORDER) {
    const list = buckets.get(s)!;
    if (list.length === 0) continue;
    list.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    groups.push({ section: s, label: MCAT_SECTION_LABELS[s], categories: list });
  }
  return groups;
}
