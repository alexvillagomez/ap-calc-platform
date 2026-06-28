/**
 * humanize.ts — slug-to-human-label utilities.
 *
 * Used as a fallback when a DB `label` field is not available. For example,
 * route params like `mcat_biology_amino_acids_and_proteins`, `calc_unit_1`,
 * or `polynomial_and_rational_functions` should never be shown raw.
 *
 * Priority: always prefer a DB `label` when available. Call `humanizeSlug()`
 * only when a label is absent or still loading.
 */

/** Known prefix patterns to strip, ordered from longest to shortest. */
const STRIP_PREFIXES = [
  "mcat_psychsoc_",
  "mcat_biology_",
  "mcat_physics_",
  "mcat_chemistry_",
  "mcat_",
  "calc_ab_",
  "calc_unit_",
  "calc_",
  "ap_precalc_",
  "precalc_",
  "math_",
];

/** Known suffix patterns to strip. */
const STRIP_SUFFIXES: string[] = [];

/**
 * Convert a raw id/slug to a human-readable label.
 *
 * Examples:
 *   "mcat_biology_amino_acids_and_proteins" → "Amino Acids and Proteins"
 *   "calc_unit_1"                            → "Unit 1"
 *   "polynomial_and_rational_functions"      → "Polynomial and Rational Functions"
 *   "calc_ab"                                → "Ab"  (course ids should use COURSE_LABELS)
 *
 * The function:
 * 1. Strips known prefixes (longest match wins, case-insensitive).
 * 2. Strips known suffixes.
 * 3. Replaces `-` and `_` with spaces.
 * 4. Title-cases every word, but keeps common lowercase conjunctions/prepositions
 *    (and, or, of, the, a, an, in, on, at, to, for, by, with) lowercase unless
 *    they are the first word.
 */
export function humanizeSlug(slug: string): string {
  if (!slug) return slug;

  let s = slug.toLowerCase();

  // Strip known prefixes (try longest first to avoid partial matches)
  const sortedPrefixes = [...STRIP_PREFIXES].sort((a, b) => b.length - a.length);
  for (const prefix of sortedPrefixes) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }

  // Strip a leading umbrella/topic prefix like "limit_1_", "deriv_3_", "integ_6_"
  // (an abbrev + unit number that prefixes math calc keyword ids). These are
  // internal grouping slugs, never meaningful display text. Only strip when at
  // least one real word remains after it.
  {
    const stripped = s.replace(/^[a-z]+_\d+_(?=[a-z])/, "");
    if (stripped) s = stripped;
  }

  // Strip known suffixes
  for (const suffix of STRIP_SUFFIXES) {
    if (s.endsWith(suffix)) {
      s = s.slice(0, s.length - suffix.length);
      break;
    }
  }

  // Replace underscores and hyphens with spaces, collapse multiple spaces
  s = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  if (!s) return slug;

  // Title-case with minor-word exceptions
  const MINOR_WORDS = new Set([
    "and", "or", "of", "the", "a", "an", "in", "on", "at", "to",
    "for", "by", "with", "but", "nor", "so", "yet", "as", "if",
  ]);

  const words = s.split(" ");
  return words
    .map((word, i) => {
      if (!word) return word;
      // Always capitalize the first word, no matter what
      if (i === 0) return word[0]!.toUpperCase() + word.slice(1);
      // Minor words stay lowercase in the middle
      if (MINOR_WORDS.has(word)) return word;
      return word[0]!.toUpperCase() + word.slice(1);
    })
    .join(" ");
}
