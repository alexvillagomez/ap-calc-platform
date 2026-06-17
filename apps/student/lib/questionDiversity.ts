/**
 * questionDiversity.ts
 *
 * Shared helpers for question-pool diversity in next-question and quiz routes.
 *
 * Two independent mechanisms:
 *
 * 1. KEYWORD-STREAK GUARD
 *    When a student has seen N or more consecutive questions whose primary keyword
 *    matches a single keyword, de-prioritise (but do not hard-exclude) further
 *    questions on that same keyword so a different in-scope keyword gets served.
 *    Default streak cap: 2 (i.e. block on the 3rd+ consecutive same-keyword item).
 *    Fallback: if filtering would leave zero candidates, return the full pool.
 *
 * 2. STEM NEAR-DUPLICATE FILTER
 *    Avoid serving a question whose stem is "near-identical" to one already seen
 *    this session. Similarity = token Jaccard over whitespace-split tokens of a
 *    normalised stem (lower-case, strip punctuation, collapse numbers to "NUM").
 *    Threshold: Jaccard ≥ 0.72 → near-duplicate.
 *    Fallback: if filtering would leave zero candidates, return the full pool.
 *
 * Both helpers are pure functions — no I/O, no LLM calls.
 */

// ─── Stem normalisation ───────────────────────────────────────────────────────

/**
 * Normalise a question stem for near-duplicate detection:
 *   - lower-case
 *   - collapse LaTeX-delimited numbers and bare numbers to a single token "NUM"
 *   - strip punctuation (keep alphanumerics, spaces, underscores)
 *   - collapse whitespace
 */
export function normalizeStem(stem: string): string {
  return stem
    .toLowerCase()
    // strip punctuation — keep alphanumerics, spaces, underscores
    // Do this BEFORE replacing numbers so digits are kept for the next step
    .replace(/[^a-z0-9 ]/g, " ")
    // replace digit sequences (including decimals) with NUM
    .replace(/\b\d+(\s*\.\s*\d+)?\b/g, "NUM")
    // collapse runs of whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenise a normalised stem into a Set of tokens (used for Jaccard). */
function tokenSet(normalised: string): Set<string> {
  const tokens = normalised.split(" ").filter(Boolean);
  return new Set(tokens);
}

/**
 * Token-level Jaccard similarity between two (already-normalised) stems.
 * Returns 0 for empty inputs.
 */
export function jaccardSimilarity(normA: string, normB: string): number {
  const a = tokenSet(normA);
  const b = tokenSet(normB);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Near-duplicate filter ─────────────────────────────────────────────────────

/** Jaccard threshold above which two stems are considered near-duplicates. */
export const NEAR_DUP_THRESHOLD = 0.72;

/**
 * Filter `candidates` to remove items whose stem is a near-duplicate of any
 * stem in `seenStems`. Stems that are empty strings are never filtered out.
 *
 * Falls back to the full `candidates` array if filtering would leave nothing.
 *
 * @param candidates - array of objects that include a `stem` string
 * @param seenStems  - normalised stems already seen this session
 * @returns the filtered array (never empty if `candidates` is non-empty)
 */
export function filterNearDuplicates<T extends { stem: string }>(
  candidates: T[],
  seenStems: string[]
): T[] {
  if (seenStems.length === 0) return candidates;

  const filtered = candidates.filter((q) => {
    const norm = normalizeStem(q.stem);
    if (!norm) return true; // empty stem — keep
    for (const seen of seenStems) {
      if (jaccardSimilarity(norm, seen) >= NEAR_DUP_THRESHOLD) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    console.warn(
      "[questionDiversity] near-dup filter removed all candidates; falling back to unfiltered pool"
    );
    return candidates;
  }
  return filtered;
}

// ─── Keyword-streak guard ─────────────────────────────────────────────────────

/** Maximum consecutive same-primary-keyword items before we try to break the streak. */
export const KEYWORD_STREAK_CAP = 2;

/**
 * Given the list of `recentKeywords` (the primary keyword id of each of the
 * last N questions served, most-recent last), return the keyword id that is
 * currently on a streak ≥ KEYWORD_STREAK_CAP, or null if there is no such streak.
 */
export function streakKeyword(recentKeywords: string[]): string | null {
  if (recentKeywords.length < KEYWORD_STREAK_CAP) return null;
  const last = recentKeywords[recentKeywords.length - 1];
  // Check that the last KEYWORD_STREAK_CAP items are all the same keyword
  const window = recentKeywords.slice(-KEYWORD_STREAK_CAP);
  if (window.every((k) => k === last)) return last;
  return null;
}

/**
 * Filter `candidates` to exclude items whose primary keyword (the highest-weight
 * keyword in `keyword_weights`) matches `blockedKeyword`.
 *
 * Falls back to the full `candidates` array if filtering would leave nothing.
 *
 * @param candidates      - array of questions with a `keyword_weights` map
 * @param blockedKeyword  - keyword id to de-prioritise (null = no filter)
 * @returns filtered array (never empty if `candidates` is non-empty)
 */
export function filterStreakKeyword<
  T extends { keyword_weights: Record<string, number> | null }
>(candidates: T[], blockedKeyword: string | null): T[] {
  if (!blockedKeyword) return candidates;

  const filtered = candidates.filter((q) => {
    const kw = q.keyword_weights ?? {};
    const entries = Object.entries(kw).filter(([, w]) => w > 0);
    if (entries.length === 0) return true; // untagged — keep
    const top = entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    return top[0] !== blockedKeyword;
  });

  if (filtered.length === 0) {
    console.warn(
      `[questionDiversity] keyword-streak filter for "${blockedKeyword}" removed all candidates; falling back to unfiltered pool`
    );
    return candidates;
  }
  return filtered;
}
