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
 *
 * v2 additions (2026-06-28): time-decay, rising floor, goal-driven scheduling,
 * probabilistic flashcard mix, within-deck card weights, cohort moderation.
 * ALL tunable knobs live here so HMR sees them instantly.
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

/**
 * Base downgrade for a WRONG answer (scaled by current mastery + the weights below).
 * Raised from 0.18 → 0.26 (v2) so short-term recall doesn't masquerade as long-term memory.
 */
export const WRONG_BASE_PENALTY = 0.26;
/**
 * Difficulty multiplier on a WRONG answer — missing an EASY item hurts more than missing a hard one.
 * Easy weight raised from 1.5 → 1.8 (v2) for same reason.
 */
export const WRONG_DIFFICULTY_WEIGHT: Record<DifficultyTier, number> = {
  easy: 1.8,
  medium: 1.0,
  hard: 0.6,
};

/** Small downgrade for an "I don't know"/skip (scaled by current mastery). */
export const DONT_KNOW_PENALTY = 0.10;

// ════════════════════════════════════════════════════════════════════════════
//  TIME DECAY (v2)
//  Mastery decays between sessions: m(t) = m_lastReview − DECAY_BETA·log(1 + Δt_min).
//  Fast at first, slows over time (logarithmic). Clamped at the keyword's `floor`.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Logarithmic decay rate per minute of elapsed time.
 * At DECAY_BETA=0.004: after 60 min Δ≈0.017, after 1 day Δ≈0.068, after 1 week Δ≈0.11.
 * Tune up to make forgetting faster, down to slow it.
 */
export const DECAY_BETA = 0.004;

// ════════════════════════════════════════════════════════════════════════════
//  RISING FLOOR (v2)
//  A per-keyword floor acts as a lower bound on decayedScore.
//  The floor rises with each spaced correct review and drops on a miss,
//  so early reps see fast decay but sustained success → long retention.
// ════════════════════════════════════════════════════════════════════════════

/** Starting floor (no reviews yet). Low so early mistakes drop score visibly. */
export const FLOOR_START = 0.40;
/** Maximum the floor can ever reach (ceiling for retention after many successes). */
export const FLOOR_MAX = 0.85;
/** How much the floor rises per correctly-spaced review (toward FLOOR_MAX). */
export const FLOOR_RISE_PER_REP = 0.05;
/** How much the floor drops on a miss (toward FLOOR_START). */
export const FLOOR_DROP_ON_MISS = 0.08;
/**
 * Minimum elapsed time (ms) between reviews for a correct answer to count as
 * "spaced" (i.e., eligible for a floor rise). Below this → massed practice →
 * the floor barely moves.
 */
export const FLOOR_SPACED_MIN_MS = 5 * 60 * 1000; // 5 minutes

// ════════════════════════════════════════════════════════════════════════════
//  MASTERY GOAL (v2)
//  The target score a keyword must reach to be considered "done for now".
//  Grows logarithmically with total study time, then moderated toward the cohort
//  mean so no single topic races ahead while others lag.
// ════════════════════════════════════════════════════════════════════════════

/** Baseline goal when study time = 0. */
export const GOAL_BASE = 0.50;
/** Rate at which goal rises with log(1 + t_studied_minutes). */
export const GOAL_LOG_RATE = 0.06;
/** Maximum goal (cap — prevents the bar from being unreachably high). */
export const GOAL_MAX = 0.88;
/**
 * How strongly the goal is pulled toward the cohort mean mastery.
 * 0 = purely frontier-leaning (ignore cohort); 1 = lockstep (snap to cohort).
 * Default 0.6 — meaningful cohort pull while still allowing individual progress.
 */
export const BREADTH_STRICTNESS = 0.6;

// ════════════════════════════════════════════════════════════════════════════
//  ITEM MIX (v2)
//  Probabilistic flashcard vs. question ratio driven by current keyword mastery.
//  Low mastery → lots of flashcards (memorize first); high mastery → questions.
// ════════════════════════════════════════════════════════════════════════════

/** P(serve flashcard) when mastery is near 0 (or below MASTERY_START). */
export const MIX_FLASHCARD_AT_LOW = 0.8;
/** P(serve flashcard) when mastery is at or above MASTERY_ADVANCE. */
export const MIX_FLASHCARD_AT_GOAL = 0.1;

// ════════════════════════════════════════════════════════════════════════════
//  WITHIN-DECK CARD SELECTION (v2)
//  When a flashcard is drawn, weight each card in the deck so weak/unseen cards
//  appear more often, but every card eventually cycles and no card repeats immediately.
// ════════════════════════════════════════════════════════════════════════════

/** Multiplier on (1 − known) — how strongly weakness boosts a card's draw weight. */
export const CARD_WEAKNESS_WEIGHT = 2.0;
/** Flat additive bonus for a card not shown recently (coverage guarantee). */
export const CARD_COVERAGE_BOOST = 0.5;
/** Cards shown within this many ms have their weight forced to 0 (no immediate repeat). */
export const CARD_MIN_SPACING_MS = 5 * 60 * 1000; // 5 minutes

// ════════════════════════════════════════════════════════════════════════════
//  CHECKPOINT QUIZ (v2)
//  Yield-based question counts for end-of-unit checkpoint quizzes.
// ════════════════════════════════════════════════════════════════════════════

/** Numeric yield (0–1) above which a keyword is "high yield" in a checkpoint quiz. */
export const YIELD_HIGH_THRESHOLD = 0.6;
/** Questions to include per high-yield keyword in a checkpoint quiz. */
export const Q_PER_HIGH_YIELD = 2;
/** Questions to include per low-yield keyword in a checkpoint quiz. */
export const Q_PER_LOW_YIELD = 1;

// ════════════════════════════════════════════════════════════════════════════
//  LEGACY CONSTANTS (unchanged; kept for backward compat)
// ════════════════════════════════════════════════════════════════════════════

/** Probability an interleaved spaced-review item is a FLASHCARD (vs a question). */
export const REVIEW_FLASHCARD_SHARE = 0.4;

/** Max flashcards served back-to-back while struggling before forcing an (easy) question. */
export const MAX_FLASHCARDS_IN_ROW = 2;

// ════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════════════

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
 * @deprecated Use {@link flashcardProbability} for the v2 probabilistic draw.
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

// ════════════════════════════════════════════════════════════════════════════
//  V2: TIME DECAY
// ════════════════════════════════════════════════════════════════════════════

/**
 * State object describing what is stored (or computed in-memory) per keyword.
 * The `floor` and `last_review_at` columns are new (v2); existing code that
 * passes only `score` can treat floor/last_review_at as optional.
 */
export type KeywordState = {
  score: number;
  /** Lower bound for decayed score. Rises on spaced correct; drops on miss. */
  floor?: number;
  /** ISO timestamp of last review (persisted per account). If absent, no decay applied. */
  last_review_at?: string | null;
};

/**
 * Compute the current effective mastery score after applying logarithmic time decay.
 *
 * Formula: m(t) = score − DECAY_BETA · log(1 + Δt_minutes)
 * Clamped so result never goes below state.floor (or FLOOR_START if floor absent).
 *
 * PURE — does NOT mutate state. Call on read to get the "live" score.
 *
 * @param state  Stored keyword state (score + optional floor + optional last_review_at).
 * @param nowMs  Current wall-clock time in ms (Date.now()). Required for decay calc.
 */
export function decayedScore(state: KeywordState, nowMs: number): number {
  const floor = state.floor ?? FLOOR_START;
  if (!state.last_review_at) {
    // No review recorded → return clamped score (no decay yet).
    return Math.max(floor, Math.min(1, state.score));
  }
  const lastMs = new Date(state.last_review_at).getTime();
  const deltaMinutes = Math.max(0, (nowMs - lastMs) / 60_000);
  const decayed = state.score - DECAY_BETA * Math.log(1 + deltaMinutes);
  return Math.max(floor, Math.min(1, decayed));
}

// ════════════════════════════════════════════════════════════════════════════
//  V2: RISING FLOOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Update the floor for a keyword after one answer event.
 *
 * - CORRECT + spaced (elapsed ≥ minSpacingMs): floor rises toward FLOOR_MAX.
 * - CORRECT + massed (< minSpacingMs): no change (short-term recall doesn't count).
 * - WRONG: floor drops by FLOOR_DROP_ON_MISS, not below FLOOR_START.
 * - DON'T-KNOW: no floor change (small penalty already applied to score).
 *
 * Returns the NEW floor value (caller persists it).
 *
 * @param currentFloor   Stored floor (defaults to FLOOR_START if undefined).
 * @param correct        Whether the answer was correct.
 * @param dontKnow       Whether the student tapped "I don't know".
 * @param elapsedMs      Time since last review in ms (0 if first review).
 * @param minSpacingMs   Override the FLOOR_SPACED_MIN_MS constant (optional).
 */
export function updatedFloor(
  currentFloor: number | undefined,
  correct: boolean,
  dontKnow: boolean,
  elapsedMs: number,
  minSpacingMs: number = FLOOR_SPACED_MIN_MS
): number {
  const floor = currentFloor ?? FLOOR_START;
  if (dontKnow) return floor; // no floor change on skip
  if (!correct) {
    return Math.max(FLOOR_START, floor - FLOOR_DROP_ON_MISS);
  }
  // Correct — only rise if spaced (not massed)
  if (elapsedMs < minSpacingMs) return floor;
  // Rise toward FLOOR_MAX
  return Math.min(FLOOR_MAX, floor + FLOOR_RISE_PER_REP);
}

// ════════════════════════════════════════════════════════════════════════════
//  V2: MASTERY GOAL
// ════════════════════════════════════════════════════════════════════════════

/**
 * Compute the mastery goal for a keyword given how long the student has studied
 * and the cohort's mean mastery across started topics.
 *
 * Formula:
 *   rawGoal = GOAL_BASE + GOAL_LOG_RATE · log(1 + tStudiedMinutes)
 *   goal = rawGoal · (1 − BREADTH_STRICTNESS) + cohortMeanMastery · BREADTH_STRICTNESS
 *   goal = clamp(goal, GOAL_BASE, GOAL_MAX)
 *
 * BREADTH_STRICTNESS = 0 → frontier-leaning (ignore cohort / solo race ahead)
 * BREADTH_STRICTNESS = 1 → lockstep (goal = cohort mean)
 *
 * @param tStudiedMinutes    Total minutes the student has studied this course.
 * @param cohortMeanMastery  Mean mastery across all started keywords (0–1). Pass 0 if unknown.
 */
export function masteryGoal(tStudiedMinutes: number, cohortMeanMastery: number): number {
  const t = Math.max(0, tStudiedMinutes);
  const cohort = Math.min(1, Math.max(0, cohortMeanMastery));
  const rawGoal = GOAL_BASE + GOAL_LOG_RATE * Math.log(1 + t);
  const moderated = rawGoal * (1 - BREADTH_STRICTNESS) + cohort * BREADTH_STRICTNESS;
  return Math.min(GOAL_MAX, Math.max(GOAL_BASE, moderated));
}

// ════════════════════════════════════════════════════════════════════════════
//  V2: IS DUE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Returns true when a keyword is due for review — its decayed score has fallen
 * below the current mastery goal.
 *
 * PURE — takes all inputs, does nothing stateful.
 *
 * @param state              Stored keyword state.
 * @param nowMs              Current wall-clock time in ms.
 * @param cohortMeanMastery  Mean mastery across all started keywords (0 if unknown).
 * @param tStudiedMinutes    Total study time in minutes.
 */
export function isDue(
  state: KeywordState,
  nowMs: number,
  cohortMeanMastery: number,
  tStudiedMinutes: number
): boolean {
  const live = decayedScore(state, nowMs);
  const goal = masteryGoal(tStudiedMinutes, cohortMeanMastery);
  return live < goal;
}

// ════════════════════════════════════════════════════════════════════════════
//  V2: PROBABILISTIC FLASHCARD MIX
// ════════════════════════════════════════════════════════════════════════════

/**
 * Returns the probability (0–1) that the next item served for a keyword should
 * be a FLASHCARD rather than a question.
 *
 * Interpolates linearly from MIX_FLASHCARD_AT_LOW (at mastery ≤ 0) to
 * MIX_FLASHCARD_AT_GOAL (at mastery ≥ MASTERY_ADVANCE).
 *
 * Caller does the weighted coin-flip: `Math.random() < flashcardProbability(m)`.
 *
 * @param mastery  Current keyword mastery score (0–1, typically decayedScore result).
 */
export function flashcardProbability(mastery: number): number {
  const m = Math.min(1, Math.max(0, mastery));
  const t = Math.min(1, m / Math.max(0.001, MASTERY_ADVANCE));
  return MIX_FLASHCARD_AT_LOW + t * (MIX_FLASHCARD_AT_GOAL - MIX_FLASHCARD_AT_LOW);
}

// ════════════════════════════════════════════════════════════════════════════
//  V2: WITHIN-DECK CARD SELECTION WEIGHTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * A flashcard entry as needed by cardSelectionWeights. The per-card `known`
 * value is a 0–1 familiarity score (or can be derived from SRS box: box/5).
 */
export type FlashcardEntry = {
  id: string;
  /** Per-card familiarity 0–1 (higher = more known). Use 0.5 default if unknown. */
  known?: number;
  /** ISO timestamp the card was last shown (undefined = never shown). */
  last_shown_at?: string | null;
};

/**
 * Compute a parallel array of selection weights for a deck of flashcards.
 *
 * Weight formula for each card:
 *   weakness = CARD_WEAKNESS_WEIGHT · (1 − known)
 *   coverage = CARD_COVERAGE_BOOST  (if NOT shown recently, i.e. elapsed ≥ CARD_MIN_SPACING_MS)
 *   weight   = weakness + coverage
 *   BUT weight = 0 if card was shown within CARD_MIN_SPACING_MS (no immediate repeat)
 *
 * Guarantees:
 *   - Weak cards (low known) get higher weights.
 *   - Every card that isn't in the min-spacing window gets nonzero weight (coverage via CARD_COVERAGE_BOOST).
 *   - A just-shown card gets weight = 0 until the spacing window expires.
 *
 * Returns a parallel number[] of raw weights (NOT normalized — caller picks via
 * weighted random using these weights).
 *
 * @param cards   Deck of flashcard entries.
 * @param nowMs   Current wall-clock time in ms.
 */
export function cardSelectionWeights(cards: FlashcardEntry[], nowMs: number): number[] {
  return cards.map((card) => {
    const known = Math.min(1, Math.max(0, card.known ?? 0.5));

    // Compute elapsed since last shown
    let elapsedMs = Infinity;
    if (card.last_shown_at) {
      const lastMs = new Date(card.last_shown_at).getTime();
      elapsedMs = Math.max(0, nowMs - lastMs);
    }

    // Suppress if shown within the minimum spacing window
    if (elapsedMs < CARD_MIN_SPACING_MS) return 0;

    const weakness = CARD_WEAKNESS_WEIGHT * (1 - known);
    // Coverage boost applies when the card hasn't been shown recently (or ever)
    const coverageBoost =
      elapsedMs >= CARD_MIN_SPACING_MS ? CARD_COVERAGE_BOOST : 0;

    return weakness + coverageBoost;
  });
}
