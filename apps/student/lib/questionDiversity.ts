/**
 * questionDiversity.ts
 *
 * Shared helpers for question-pool diversity in next-question and quiz routes.
 *
 * Three independent mechanisms:
 *
 * 1. KEYWORD-STREAK GUARD
 *    When a student has seen N or more consecutive questions whose primary keyword
 *    matches a single keyword, de-prioritise (but do not hard-exclude) further
 *    questions on that same keyword so a different in-scope keyword gets served.
 *    Default streak cap: 2 (i.e. block on the 3rd+ consecutive same-keyword item).
 *    Fallback: if filtering would leave zero candidates, return the full pool.
 *
 * 2. UMBRELLA-STREAK GUARD
 *    When a student has seen N or more consecutive questions whose primary keyword
 *    shares the same parent (umbrella) keyword, de-prioritise further questions
 *    from that umbrella. This prevents sub-keyword sprawl — e.g. alpha_helix has
 *    7+ child keywords each allowed 2 questions by the leaf-level cap, producing
 *    14+ consecutive alpha-helix questions. Default umbrella cap: 3.
 *    Fallback: if filtering would leave zero candidates, return the full pool.
 *
 * 3. STEM NEAR-DUPLICATE FILTER
 *    Avoid serving a question whose stem is "near-identical" to one already seen
 *    this session. Similarity = token Jaccard over whitespace-split tokens of a
 *    normalised stem (lower-case, strip punctuation, collapse numbers to "NUM").
 *    Threshold: Jaccard ≥ 0.55 → near-duplicate.
 *    Fallback: if filtering would leave zero candidates, return the full pool.
 *
 * All helpers are pure functions — no I/O, no LLM calls.
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
export const NEAR_DUP_THRESHOLD = 0.55;

/**
 * Filter `candidates` to remove near-duplicate stems.
 *
 * Two modes:
 *  - **Against a seen-list** (`seenStems` provided): drop any candidate whose
 *    stem near-duplicates an entry in `seenStems`.
 *  - **Intra-batch** (`seenStems` omitted): greedily drop any candidate whose
 *    stem near-duplicates an *earlier kept* candidate in this same batch, so a
 *    freshly-generated batch contains materially-different items.
 *
 * Stems that are empty strings are never filtered out. Falls back to the full
 * `candidates` array if filtering would leave nothing.
 *
 * @param candidates - array of objects that include a `stem` string
 * @param seenStems  - normalised stems already seen; omit for intra-batch dedup
 * @returns the filtered array (never empty if `candidates` is non-empty)
 */
export function filterNearDuplicates<T extends { stem: string }>(
  candidates: T[],
  seenStems?: string[]
): T[] {
  // Intra-batch mode: no external seen-list — dedup the batch against itself,
  // keeping the first occurrence of each near-duplicate cluster.
  if (seenStems === undefined) {
    const keptNorms: string[] = [];
    const kept = candidates.filter((q) => {
      const norm = normalizeStem(q.stem);
      if (!norm) return true; // empty stem — keep
      for (const seen of keptNorms) {
        if (jaccardSimilarity(norm, seen) >= NEAR_DUP_THRESHOLD) return false;
      }
      keptNorms.push(norm);
      return true;
    });
    return kept.length === 0 ? candidates : kept;
  }

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

// ─── Embedding-based MMR / diversity-aware serving ────────────────────────────
//
// Stem-Jaccard (above) only catches near-identical wording. Two items can share
// almost no stem tokens yet be the SAME task ("evaluate a 0/0 limit by
// factoring") in a different dress. To serve materially-different consecutive
// items WITHIN a subtopic, we measure conceptual distance on the descriptions
// the enrichment pipeline already embeds — primarily the ACTION and
// REPRESENTATION dimensions ("what kind of question is this?"), falling back to
// the PROBLEM-description embedding. This is pure math over already-stored
// vectors — NO hot-path LLM call. It degrades to a no-op when embeddings are
// absent (e.g. a freshly generated question not yet enriched).

/** Parse a stored jsonb/array embedding into number[] (or null if unusable). */
export function parseEmbedding(v: unknown): number[] | null {
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") {
    return v as number[];
  }
  return null;
}

/** Cosine similarity of two equal-length vectors; 0 if unusable. */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** The per-question diversity vectors used for MMR (any may be null/absent). */
export type DiversityDims = {
  action: number[] | null;
  representation: number[] | null;
  problem: number[] | null;
};

/**
 * Conceptual similarity between two questions across the diversity dimensions.
 * Takes the MAX cosine over the dimensions BOTH questions share (dimension-safe
 * — never compares mismatched vectors). Action/representation define "kind of
 * question"; problem-description is the topical fallback. Returns 0 when no
 * shared dimension exists (treated as fully diverse).
 */
export function dimsSimilarity(a: DiversityDims, b: DiversityDims): number {
  const sims: number[] = [];
  if (a.action && b.action) sims.push(cosineSim(a.action, b.action));
  if (a.representation && b.representation)
    sims.push(cosineSim(a.representation, b.representation));
  if (a.problem && b.problem) sims.push(cosineSim(a.problem, b.problem));
  return sims.length > 0 ? Math.max(...sims) : 0;
}

/** MMR penalty weight: final = relevance · (1 − λ · maxSimToRecent). */
export const MMR_LAMBDA = 0.5;

/**
 * Re-rank scored candidates by max-marginal-relevance against recently-served
 * items: penalise candidates that are conceptually close (action/representation/
 * problem embeddings) to anything in `recentDims`. Pure re-weighting of the
 * existing relevance score; preserves the input array. No-op (returns inputs
 * with unchanged score) when there are no recent vectors or no embeddings.
 */
export function mmrRerank<T extends { score: number; dims: DiversityDims }>(
  items: T[],
  recentDims: DiversityDims[],
  lambda: number = MMR_LAMBDA
): T[] {
  if (recentDims.length === 0) return items;
  return items.map((it) => {
    let maxSim = 0;
    for (const r of recentDims) {
      const s = dimsSimilarity(it.dims, r);
      if (s > maxSim) maxSim = s;
    }
    return { ...it, score: it.score * (1 - lambda * maxSim) };
  });
}

// ─── Keyword-streak guard ─────────────────────────────────────────────────────

/** Maximum consecutive same-primary-keyword items before we try to break the streak. */
export const KEYWORD_STREAK_CAP = 2;

/** Maximum consecutive questions from the same umbrella/parent keyword. */
export const UMBRELLA_STREAK_CAP = 3;

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

// ─── Umbrella-streak guard ─────────────────────────────────────────────────────

/**
 * Given the list of `recentKeywords` (primary keyword ids, most-recent last) and
 * a map of keyword id → parent keyword id (null for top-level), return the parent
 * keyword id that is currently on a streak ≥ UMBRELLA_STREAK_CAP, or null.
 *
 * A keyword with no parent (null) counts against the "null" umbrella — this
 * prevents a cluster of top-level umbrella keywords from dominating either.
 */
export function streakUmbrellaKeyword(
  recentKeywords: string[],
  kwParentMap: Record<string, string | null>
): string | null {
  if (recentKeywords.length < UMBRELLA_STREAK_CAP) return null;
  const window = recentKeywords.slice(-UMBRELLA_STREAK_CAP);
  const parents = window.map((k) => kwParentMap[k] ?? null);
  const first = parents[0];
  if (first !== null && parents.every((p) => p === first)) return first;
  return null;
}

/**
 * Filter `candidates` to exclude questions whose top-weight keyword's parent
 * matches `blockedUmbrella`. Falls back to the full pool if filtering would
 * leave nothing.
 */
export function filterStreakUmbrella<
  T extends { keyword_weights: Record<string, number> | null }
>(
  candidates: T[],
  blockedUmbrella: string | null,
  kwParentMap: Record<string, string | null>
): T[] {
  if (!blockedUmbrella) return candidates;

  const filtered = candidates.filter((q) => {
    const kw = q.keyword_weights ?? {};
    const entries = Object.entries(kw).filter(([, w]) => w > 0);
    if (entries.length === 0) return true;
    const top = entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    const parent = kwParentMap[top[0]] ?? null;
    return parent !== blockedUmbrella;
  });

  if (filtered.length === 0) {
    console.warn(
      `[questionDiversity] umbrella-streak filter for "${blockedUmbrella}" removed all candidates; falling back to unfiltered pool`
    );
    return candidates;
  }
  return filtered;
}
