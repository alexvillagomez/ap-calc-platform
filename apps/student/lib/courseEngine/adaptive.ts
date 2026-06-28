/**
 * Adaptive-engine helpers shared by the math + MCAT auto modes.
 *
 * Mastery drives BOTH the flashcard:question ratio and the question difficulty:
 * low mastery on the current keyword → weight toward FLASHCARDS + easier
 * questions; as mastery rises → shift toward QUESTIONS + harder questions. When
 * the student is struggling (≥2 consecutive wrong) we shift to flashcards until
 * they recover, then ease back in with an easy question.
 *
 * These are PURE functions/constants so both auto pages reuse identical behavior
 * rather than duplicating the curve.
 */

export type DifficultyTier = "easy" | "medium" | "hard";

/** Where a mastery-affecting answer came from. A QUESTION is worth more than a FLASHCARD. */
export type MasterySource = "question" | "flashcard";

// ════════════════════════════════════════════════════════════════════════════
//  MASTERY MODEL — the single tunable home for how a keyword's 0–1 mastery
//  score moves on each answer, and the threshold at which we advance to the
//  next keyword.  TUNE EVERYTHING HERE.  The update is LOGARITHMIC (diminishing
//  returns near the top) and context-aware (difficulty + source + how much the
//  item actually targeted this keyword).  There is deliberately NO "N correct in
//  a row" gate — advancement is purely `score ≥ MASTERY_ADVANCE`.
//
//  FUTURE (not built yet): once a keyword crosses MASTERY_ADVANCE we still keep
//  scoring it, so spaced/harder review can grow it past the threshold toward 1.0
//  — the curve already supports that; we just don't act on >threshold mastery.
// ════════════════════════════════════════════════════════════════════════════

/** Fresh keyword (no attempts yet) starts here. Below MASTERY_ADVANCE by design. */
export const MASTERY_START = 0.30;
/** Cross this 0–1 score → keyword is "mastered" and auto mode advances. Tunable; need not be high. */
export const MASTERY_ADVANCE = 0.70;

/** Base step size for a correct answer (before all the context multipliers below). */
export const BASE_GAIN = 0.22;
/**
 * The (1 − mastery) curve exponent — THE knob for "logarithmic feel".
 *   1.0 → gain ∝ (1 − mastery)        (fast early, smoothly slows near the top)
 *   >1  → slows down even harder as mastery approaches 1 (more logarithmic)
 *   <1  → flatter (more linear)
 */
export const GAIN_CURVE = 1.0;

/** Difficulty multiplier on a CORRECT answer — a correct HARD item boosts more than an easy one. */
export const DIFFICULTY_GAIN_WEIGHT: Record<DifficultyTier, number> = {
  easy: 0.7,
  medium: 1.0,
  hard: 1.4,
};

/** Source multiplier — a QUESTION moves mastery more than a FLASHCARD (applied to gain AND penalty). */
export const SOURCE_WEIGHT: Record<MasterySource, number> = {
  question: 1.0,
  flashcard: 0.55,
};

/** Base downgrade for a WRONG answer (scaled by current mastery + the weights below). */
export const WRONG_BASE_PENALTY = 0.18;
/** Difficulty multiplier on a WRONG answer — missing an EASY item hurts more than missing a hard one. */
export const WRONG_DIFFICULTY_WEIGHT: Record<DifficultyTier, number> = {
  easy: 1.5,
  medium: 1.0,
  hard: 0.6,
};

/** Small downgrade for an "I don't know"/skip (scaled by current mastery). */
export const DONT_KNOW_PENALTY = 0.10;

/** Bucket a stored 0–1 question difficulty into a tier for the weight tables. */
export function difficultyTierFromScore(d: number | null | undefined): DifficultyTier {
  const v = typeof d === "number" ? d : 0.5;
  if (v < 0.4) return "easy";
  if (v < 0.7) return "medium";
  return "hard";
}

/** True once a keyword's mastery score has crossed the advancement threshold. */
export function isMastered(score: number): boolean {
  return score >= MASTERY_ADVANCE;
}

export type MasteryUpdateInput = {
  /** Was the answer correct? (ignored when dontKnow is true) */
  correct: boolean;
  /** "I don't know"/skip — a small downgrade, overrides correct/wrong. */
  dontKnow?: boolean;
  /** Difficulty tier of the item (questions: from stored difficulty; flashcards: "medium"/recall). */
  difficulty?: DifficultyTier;
  /** A question is worth more than a flashcard toward mastery. */
  source?: MasterySource;
  /** How much THIS item targeted THIS keyword (0–1 keyword weight). Scales the whole move. */
  keywordWeight?: number;
};

/**
 * The core mastery update for ONE keyword. Pure + logarithmic + context-aware.
 *
 *   CORRECT  → gain = BASE_GAIN · (1−m)^GAIN_CURVE · diffGain · source · kwWeight
 *              (fast early, asymptotically slow near 1; harder + question = bigger)
 *   WRONG    → drop = WRONG_BASE_PENALTY · m · diffMiss · source · kwWeight
 *              (proportional to current mastery; missing an EASY item drops more)
 *   DONT_KNOW→ drop = DONT_KNOW_PENALTY · m · kwWeight   (small)
 *
 * Returns the new score clamped to [0, 1].
 */
export function updateMastery(current: number, input: MasteryUpdateInput): number {
  const m = Math.min(1, Math.max(0, current));
  const w = Math.min(1, Math.max(0, input.keywordWeight ?? 1));
  if (w <= 0) return m;
  const tier = input.difficulty ?? "medium";
  const source = input.source ?? "question";

  if (input.dontKnow) {
    return Math.max(0, m - DONT_KNOW_PENALTY * m * w);
  }
  if (input.correct) {
    const gain =
      BASE_GAIN *
      Math.pow(1 - m, GAIN_CURVE) *
      DIFFICULTY_GAIN_WEIGHT[tier] *
      SOURCE_WEIGHT[source] *
      w;
    return Math.min(1, m + gain);
  }
  const drop =
    WRONG_BASE_PENALTY *
    m *
    WRONG_DIFFICULTY_WEIGHT[tier] *
    SOURCE_WEIGHT[source] *
    w;
  return Math.max(0, m - drop);
}

/**
 * Apply {@link updateMastery} across a question/flashcard's keyword_weights map,
 * mirroring the old `updateStrengths` signature so callers swap in cleanly.
 * Missing keywords initialize at MASTERY_START. `correct`/`dontKnow`/difficulty/
 * source are shared across all keywords on the item; the per-keyword weight scales
 * each move. Returns a NEW map (input untouched).
 */
export function updateMasteryMap(
  strengths: Record<string, number>,
  keywordWeights: Record<string, number>,
  opts: Omit<MasteryUpdateInput, "keywordWeight">
): Record<string, number> {
  const updated = { ...strengths };
  for (const [id, w] of Object.entries(keywordWeights)) {
    if (w <= 0) continue;
    const current = updated[id] ?? MASTERY_START;
    updated[id] = updateMastery(current, { ...opts, keywordWeight: w });
  }
  return updated;
}

/**
 * Probability the next CURRENT-keyword item is a FLASHCARD (vs a question),
 * from the keyword's mastery score: 0 → 0.50, 0.5 → 0.25, 0.84+ → 0.08.
 */
export function flashcardShareForMastery(score: number): number {
  return Math.max(0.08, Math.min(0.5, 0.5 - 0.5 * score));
}

/**
 * Question difficulty tier from the current keyword's mastery (and whether the
 * student is currently struggling). easy → hard as mastery rises; easy when bad.
 */
export function tierForMastery(score: number, recentlyBad: boolean): DifficultyTier {
  if (recentlyBad) return "easy";
  if (score < 0.45) return "easy";
  if (score < 0.72) return "medium";
  return "hard";
}

/** Probability an interleaved spaced-review item is a FLASHCARD (vs a question). */
export const REVIEW_FLASHCARD_SHARE = 0.4;

/** Max flashcards served back-to-back while struggling before forcing an (easy) question. */
export const MAX_FLASHCARDS_IN_ROW = 2;
