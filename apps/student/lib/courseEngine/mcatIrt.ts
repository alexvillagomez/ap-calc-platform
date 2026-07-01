/**
 * mcatIrt.ts — MCAT-only IRT/Elo mastery model
 *
 * This is a pure, dependency-free module (no imports, no React, no DB).
 * It is intentionally isolated from lib/courseEngine/adaptive.ts, which remains
 * the math/legacy engine and must NOT be imported or modified here.
 *
 * Mastery is modeled as latent ability θ on the difficulty scale [0,1].
 * The "reported mastery" b* is the item difficulty at which P(correct) = 0.80 —
 * i.e., the difficulty the student has an 80% chance of answering correctly.
 *
 * All tunable constants are exported and grouped with section comments below.
 * To tune: change the constant and reload (HMR in dev, or re-run tests).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Outcome = "correct" | "wrong" | "dont_know";

/**
 * Per-keyword ability state.
 * - `ability` ∈ [0,1]: latent ability θ for this keyword.
 * - `attempts` ≥ 0 (fractional allowed): effective exposure count; drives
 *   the uncertainty-shrinking step size (more attempts → smaller steps).
 */
export type KeywordAbility = { ability: number; attempts: number };

// ─── Constants: IRT core ──────────────────────────────────────────────────────

/** Fresh-keyword seed ability (before any practice). */
export const DEFAULT_ABILITY = 0.30;

/**
 * k — logistic steepness.
 * Controls how quickly P(correct) rises from 0→1 as θ−b increases.
 * Larger k = narrower band; smaller k = shallower curve.
 */
export const K_LOGISTIC_STEEPNESS = 5;

// ─── Constants: step-size schedule ───────────────────────────────────────────

/**
 * Initial ability step size at 0 attempts.
 * Governs how fast ability moves on the very first exposures (high uncertainty).
 */
export const K_START = 0.15;

/** Floor for the ability step size — learning never completely stalls. */
export const K_MIN = 0.04;

/**
 * Decay rate per effective attempt.
 * A higher value makes the step size shrink faster with exposure.
 */
export const K_DECAY_PER_ATTEMPT = 0.15;

/**
 * Item-difficulty step size.
 * Much smaller than K_START because items are shared across students;
 * difficulty should drift slowly toward the population calibration.
 */
export const K_ITEM = 0.02;

// ─── Constants: wrong-answer amplifier ───────────────────────────────────────

/**
 * Maximum wrong-answer amplifier.
 * When a student gets an EASY item wrong (b ≪ ability), the penalty is
 * scaled up to A_MAX relative to getting a hard item wrong.
 */
export const A_MAX = 2.0;

/**
 * Ability-minus-difficulty gap at which the amplifier reaches A_MAX.
 * A gap ≥ A_RAMP means "the student definitely should have known this."
 */
export const A_RAMP = 0.5;

// ─── Constants: don't-know ────────────────────────────────────────────────────

/**
 * "Don't know" counts as this fraction of a full wrong penalty.
 * IDK is penalised but less harshly than a confident wrong answer.
 */
export const IDK_FACTOR = 0.4;

// ─── Constants: item-difficulty seeds ────────────────────────────────────────

/** Initial difficulty assigned to a newly stored flashcard. */
export const FLASHCARD_BASE_B = 0.15;

/** Initial item difficulty by difficulty band (for generated questions). */
export const Q_BAND_MID: Record<"easy" | "medium" | "hard", number> = {
  easy: 0.30,
  medium: 0.55,
  hard: 0.80,
};

// ─── Constants: reported mastery ─────────────────────────────────────────────

/**
 * P(correct) target that defines "reported mastery."
 * b* is the difficulty at which the student has this probability of being correct.
 */
export const MASTERY_TARGET_P = 0.80;

// ─── Constants: benchmark ─────────────────────────────────────────────────────

/** Benchmark b* at study time 0. */
export const BENCH_BASE = 0.45;

/** How fast the benchmark rises with log(1 + studyMinutes). */
export const BENCH_LOG_RATE = 0.05;

/** Ceiling for the benchmark (prevents unrealistic targets). */
export const BENCH_MAX = 0.85;

/**
 * How much keyword yield raises the benchmark.
 * yield=1 → benchmark + BENCH_YIELD_WEIGHT; yield=0 → no effect.
 */
export const BENCH_YIELD_WEIGHT = 0.15;

// ─── Constants: decay ─────────────────────────────────────────────────────────

/**
 * Ability decay per log-minute elapsed since last review.
 * Forgetting curve: ability -= DECAY_BETA * log(1 + minutesElapsed).
 */
export const DECAY_BETA = 0.004;

// ─── Constants: serving difficulty ───────────────────────────────────────────

/** Serve items slightly above reported mastery by this stretch. */
export const SERVE_STRETCH = 0.08;

/** Served-difficulty clamp lower bound. */
export const SERVE_MIN = 0.05;

/** Served-difficulty clamp upper bound. */
export const SERVE_MAX = 0.95;

// ─── Constants: external import seeding ──────────────────────────────────────

/** Ability seed at confidence=0 (Anki import / manual self-rating). */
export const IMPORT_THETA_FLOOR = 0.0;

/**
 * Ability seed cap at confidence=1.
 * Capped below 1.0 because self-reported confidence over-estimates true ability.
 */
export const IMPORT_THETA_CAP = 0.7;

/**
 * Effective-attempts seed for imported items.
 * Small → high uncertainty → fast self-correction on first real attempt.
 */
export const IMPORT_SEED_ATTEMPTS = 0.5;

// ─── Constants: flashcard/quiz mixing ────────────────────────────────────────

/** P(serve flashcard) when reported mastery is well below benchmark. */
export const MIX_FLASHCARD_LOW = 0.8;

/** P(serve flashcard) at/above benchmark (mostly quiz at high mastery). */
export const MIX_FLASHCARD_HIGH = 0.1;

// ─── Constants: tier labels ───────────────────────────────────────────────────

/**
 * bStar/benchmark ratio threshold for the "Solid" tier.
 * ratio ≥ 1 → "Strong"; ratio ≥ TIER_SOLID_RATIO → "Solid"; else "Building".
 */
export const TIER_SOLID_RATIO = 0.5;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// ─── Exported pure functions ──────────────────────────────────────────────────

/**
 * IRT logistic prediction: probability of a correct response.
 * P = 1 / (1 + exp(-k * (θ − b)))
 */
export function predict(
  thetaEff: number,
  b: number,
  k: number = K_LOGISTIC_STEEPNESS
): number {
  return 1 / (1 + Math.exp(-k * (thetaEff - b)));
}

/**
 * Weighted-average effective ability across all keywords contributing to an item.
 * Missing keywords default to DEFAULT_ABILITY; weights ≤ 0 are skipped.
 * If total weight is 0, returns DEFAULT_ABILITY.
 */
export function effectiveAbility(
  keywordWeights: Record<string, number>,
  abilities: Record<string, number>
): number {
  let sumW = 0;
  let sumWTheta = 0;
  for (const [id, w] of Object.entries(keywordWeights)) {
    if (w <= 0) continue;
    const theta = abilities[id] ?? DEFAULT_ABILITY;
    sumW += w;
    sumWTheta += w * theta;
  }
  return sumW === 0 ? DEFAULT_ABILITY : sumWTheta / sumW;
}

/**
 * Per-keyword ability step size, shrinking with exposure.
 * K = max(K_MIN, K_START / (1 + K_DECAY_PER_ATTEMPT * max(0, attempts)))
 */
export function stepSize(attempts: number): number {
  return Math.max(
    K_MIN,
    K_START / (1 + K_DECAY_PER_ATTEMPT * Math.max(0, attempts))
  );
}

/**
 * Amplifier applied to wrong-answer penalties when the item was easy relative
 * to the student's ability.  ≥ 1; equals A_MAX when ability − b ≥ A_RAMP.
 */
export function wrongAmplifier(b: number, ability: number): number {
  return 1 + (A_MAX - 1) * clamp((ability - b) / A_RAMP, 0, 1);
}

/**
 * Reported mastery b*: the item difficulty at which P(correct) = MASTERY_TARGET_P.
 * Derived by inverting the logistic: b* = θ − logit(p) / k.
 * Result is clamped to [0,1].
 */
export function reportedMastery(
  ability: number,
  k: number = K_LOGISTIC_STEEPNESS
): number {
  const logitP = Math.log(MASTERY_TARGET_P / (1 - MASTERY_TARGET_P));
  return clamp(ability - logitP / k, 0, 1);
}

/**
 * Update item difficulty after one response.
 * "don't know" leaves b unchanged (ambiguous signal).
 * Otherwise: b' = clamp(b − K_ITEM * (o − p), SERVE_MIN, SERVE_MAX)
 */
export function updateItemDifficulty(
  b: number,
  outcome: Outcome,
  p: number
): number {
  if (outcome === "dont_know") return b;
  const o = outcome === "correct" ? 1 : 0;
  return clamp(b - K_ITEM * (o - p), SERVE_MIN, SERVE_MAX);
}

// ─── applyAttempt ─────────────────────────────────────────────────────────────

export type ApplyInput = {
  abilities: Record<string, number>;
  attemptsByKeyword: Record<string, number>;
  keywordWeights: Record<string, number>;
  b: number;
  outcome: Outcome;
};

export type ApplyResult = {
  /** NEW abilities map (input untouched); only keys in keywordWeights changed. */
  abilities: Record<string, number>;
  /** NEW attempts map; changed keys incremented by their weight. */
  attemptsByKeyword: Record<string, number>;
  /** Updated item difficulty. */
  b: number;
  /** The item-level prediction used (P(correct) before the response). */
  p: number;
};

/**
 * Orchestrator: apply one student response and return updated maps.
 *
 * Per-keyword delta logic:
 *   correct   → delta = K * (1 − p) * w            (gain proportional to surprise)
 *   wrong     → delta = K * amplifier * (0 − p) * w (penalise; amplifier punishes easy misses)
 *   dont_know → delta = K * amplifier * IDK_FACTOR * (0 − p) * w (softer wrong)
 *
 * Item difficulty is updated via updateItemDifficulty; dont_know leaves b unchanged.
 * All OTHER keys in abilities/attemptsByKeyword are copied through unchanged.
 */
export function applyAttempt(input: ApplyInput): ApplyResult {
  const { abilities, attemptsByKeyword, keywordWeights, b, outcome } = input;

  const thetaEff = effectiveAbility(keywordWeights, abilities);
  const p = predict(thetaEff, b);

  const newAbilities: Record<string, number> = { ...abilities };
  const newAttempts: Record<string, number> = { ...attemptsByKeyword };

  for (const [id, w] of Object.entries(keywordWeights)) {
    if (w <= 0) continue;
    const theta = abilities[id] ?? DEFAULT_ABILITY;
    const n = attemptsByKeyword[id] ?? 0;
    const K = stepSize(n);

    let delta: number;
    if (outcome === "correct") {
      delta = K * (1 - p) * w;
    } else if (outcome === "wrong") {
      delta = K * wrongAmplifier(b, theta) * (0 - p) * w;
    } else {
      // dont_know
      delta = K * wrongAmplifier(b, theta) * IDK_FACTOR * (0 - p) * w;
    }

    newAbilities[id] = clamp(theta + delta, 0, 1);
    newAttempts[id] = n + w;
  }

  const newB = updateItemDifficulty(b, outcome, p);

  return { abilities: newAbilities, attemptsByKeyword: newAttempts, b: newB, p };
}

// ─── Benchmark ────────────────────────────────────────────────────────────────

/**
 * Contextual benchmark: the b* a student "should" reach given study time and
 * keyword importance (yield). Rises logarithmically with study time, capped at BENCH_MAX.
 */
export function benchmark(tStudiedMinutes: number, yieldValue: number): number {
  return Math.min(
    BENCH_MAX,
    BENCH_BASE +
      BENCH_LOG_RATE * Math.log(1 + Math.max(0, tStudiedMinutes)) +
      BENCH_YIELD_WEIGHT * clamp(yieldValue, 0, 1)
  );
}

// ─── Forgetting curve ─────────────────────────────────────────────────────────

/**
 * Apply forgetting decay to ability based on elapsed time since last review.
 * decayed = ability − DECAY_BETA * log(1 + minutesElapsed)
 * Returns ability clamped to [floor, 1].
 */
export function decayAbility(
  ability: number,
  lastReviewAtMs: number | null,
  nowMs: number,
  floor = 0
): number {
  if (lastReviewAtMs == null) return clamp(ability, floor, 1);
  const dMin = Math.max(0, (nowMs - lastReviewAtMs) / 60000);
  const decayed = ability - DECAY_BETA * Math.log(1 + dMin);
  return Math.max(floor, Math.min(1, decayed));
}

// ─── Serving difficulty ───────────────────────────────────────────────────────

/**
 * Choose the difficulty of the next item to serve.
 * - Struggling: serve slightly BELOW reported mastery (consolidate).
 * - Not struggling: serve slightly ABOVE, but never above benchmark if benchmark > bStar.
 * Result clamped to [SERVE_MIN, SERVE_MAX].
 */
export function serveDifficulty(
  reportedBStar: number,
  benchmarkBStar: number,
  recentlyStruggling: boolean
): number {
  let raw: number;
  if (recentlyStruggling) {
    raw = reportedBStar - SERVE_STRETCH;
  } else {
    raw = reportedBStar + SERVE_STRETCH;
    if (benchmarkBStar > reportedBStar) {
      raw = Math.min(raw, benchmarkBStar);
    }
  }
  return clamp(raw, SERVE_MIN, SERVE_MAX);
}

// ─── Utility predicates ───────────────────────────────────────────────────────

/** True when the student still has room to grow toward the benchmark. */
export function isDue(reportedBStar: number, benchmarkBStar: number): boolean {
  return reportedBStar < benchmarkBStar;
}

/**
 * Probability of serving a flashcard (vs. a quiz question).
 * Linearly interpolates from MIX_FLASHCARD_LOW (bStar ≪ benchmark) to
 * MIX_FLASHCARD_HIGH (bStar ≥ benchmark).
 */
export function flashcardProbability(
  reportedBStar: number,
  benchmarkBStar: number
): number {
  const t = clamp(benchmarkBStar > 0 ? reportedBStar / benchmarkBStar : 0, 0, 1);
  return MIX_FLASHCARD_LOW + t * (MIX_FLASHCARD_HIGH - MIX_FLASHCARD_LOW);
}

// ─── External import seeding ──────────────────────────────────────────────────

/**
 * Seed a KeywordAbility from an external confidence score (e.g., Anki import,
 * manual self-rating).  confidence ∈ [0,1] (clamped).
 * The low seed attempts keep uncertainty high so the first real responses
 * self-correct quickly.
 */
export function seedFromImport(confidence: number): KeywordAbility {
  const ability =
    IMPORT_THETA_FLOOR +
    clamp(confidence, 0, 1) * (IMPORT_THETA_CAP - IMPORT_THETA_FLOOR);
  return { ability, attempts: IMPORT_SEED_ATTEMPTS };
}

// ─── Tier label ───────────────────────────────────────────────────────────────

/**
 * Map reported mastery to a student-facing tier label.
 * ratio = bStar / benchmark.
 *   ≥ 1               → "Strong"
 *   ≥ TIER_SOLID_RATIO → "Solid"
 *   < TIER_SOLID_RATIO → "Building"
 */
export function tierLabel(
  reportedBStar: number,
  benchmarkBStar: number
): "Building" | "Solid" | "Strong" {
  const ratio = benchmarkBStar > 0 ? reportedBStar / benchmarkBStar : 0;
  if (ratio >= 1) return "Strong";
  if (ratio >= TIER_SOLID_RATIO) return "Solid";
  return "Building";
}

// ─── Benchmark progress percentage ───────────────────────────────────────────

/**
 * Percentage progress toward the benchmark [0,100], rounded.
 * Capped at 100 even if the student exceeds the benchmark.
 */
export function benchmarkProgressPct(
  reportedBStar: number,
  benchmarkBStar: number
): number {
  return Math.min(
    100,
    Math.round(100 * (benchmarkBStar > 0 ? reportedBStar / benchmarkBStar : 0))
  );
}
