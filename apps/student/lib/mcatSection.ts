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
