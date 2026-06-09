/**
 * Problem selection and strength-update algorithm for the student practice portal.
 *
 * Strength model
 * ──────────────
 * Each topic has a strength value in [0, 1]. 0.5 is the implicit default (unknown).
 * Strengths are updated after every answer via a weighted exponential rule.
 *
 * Target difficulty
 * ─────────────────
 * For a student with average strength s across the relevant topics, the target
 * difficulty is 0.2 + s * 0.6 (so s=0 → d≈0.2, s=0.5 → d≈0.5, s=1 → d≈0.8).
 * This keeps the expected success rate near ~75 %.
 */

export interface ScoredProblem {
  id: string;
  difficulty: number;
  estimated_difficulty?: number | null;
  topic_weights?: Record<string, number>;
  keyword_weights?: Record<string, number>;
  avg_rating: number | null;
  score: number;
}

/**
 * Compute the weighted-average target difficulty given the student's strengths
 * and the specific topic weights of the pool being considered.
 */
export function computeTargetDifficulty(
  strengths: Record<string, number>,
  selectedTopicIds: string[]
): number {
  if (selectedTopicIds.length === 0) return 0.5;
  const vals = selectedTopicIds.map((id) => strengths[id] ?? 0.5);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return 0.2 + avg * 0.6; // 0.2–0.8 range
}

/**
 * Map a raw 1–5 author-assigned difficulty onto the same [0.2, 0.8]
 * scale used by computeTargetDifficulty / estimated_difficulty, leaving
 * headroom on both ends for calibration to diverge from the initial guess.
 * 1 → 0.2, 3 → 0.5, 5 → 0.8.
 */
export function normalizeDifficulty(rawDifficulty: number): number {
  const clamped = Math.min(5, Math.max(1, rawDifficulty));
  return 0.2 + ((clamped - 1) / 4) * 0.6;
}

/**
 * Score a candidate problem for a given student state.
 * Returns 0 if the problem has no overlap with the selected topics.
 */
export function scoreProblem(
  problem: { difficulty: number; estimated_difficulty?: number | null; topic_weights: Record<string, number>; avg_rating: number | null },
  strengths: Record<string, number>,
  selectedTopicIds: string[],
  targetDifficulty: number
): number {
  const tw = problem.topic_weights ?? {};
  const selectedSet = new Set(selectedTopicIds);

  let topicWeightedWeakness = 0;
  let totalOverlap = 0;
  for (const [id, w] of Object.entries(tw)) {
    if (selectedSet.has(id) && w > 0) {
      const weakness = 1 - (strengths[id] ?? 0.5);
      topicWeightedWeakness += w * weakness;
      totalOverlap += w;
    }
  }
  if (totalOverlap === 0) return 0;

  // Normalise topic score by total overlap weight (not selected length) so
  // a problem that perfectly covers one weak topic still scores well.
  const topicScore = topicWeightedWeakness / totalOverlap;

  // Use calibrated difficulty when available, fall back to normalized static difficulty.
  const effectiveDifficulty = problem.estimated_difficulty ?? normalizeDifficulty(problem.difficulty ?? 3);

  // Difficulty proximity: Gaussian around target (σ = 0.2 difficulty units)
  const diff = effectiveDifficulty - targetDifficulty;
  const diffScore = Math.exp(-0.5 * diff * diff);

  // Quality nudge: high-rated problems are slightly preferred
  const ratingScore = problem.avg_rating != null ? 0.7 + 0.3 * (problem.avg_rating / 5) : 0.8;

  return topicScore * diffScore * ratingScore;
}

/**
 * Weighted random pick — adds exploration so students don't see the same
 * top-scored problem every session.
 */
export function weightedRandomPick<T>(items: T[], weights: number[]): T | null {
  if (items.length === 0) return null;
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Select the best problem from a set of scored candidates using weighted
 * random sampling from the top-K (avoids always picking the exact same problem).
 */
export function selectProblem(
  candidates: ScoredProblem[],
  topK = 8
): ScoredProblem | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const pool = sorted.slice(0, Math.min(topK, sorted.length));
  const weights = pool.map((p) => Math.max(0, p.score));
  return weightedRandomPick(pool, weights);
}

/**
 * Update a student's strength vector after answering a problem.
 *
 * Uses a weighted exponential moving average:
 *   Δs = learning_rate * topic_weight * (target − current_strength)
 * where target = 1 on correct, 0 on incorrect.
 * This keeps strengths in [0, 1] and respects how much each topic was tested.
 */
/**
 * Compute the student's effective skill level for a specific problem, expressed
 * on the 1–5 difficulty scale.  Uses the student's pre-attempt strengths so the
 * calibration signal is based on what the student knew before seeing the answer.
 *
 * Formula: weighted_avg_strength (already 0–1)
 *   strength 0   → skill 0 (very weak)
 *   strength 0.5 → skill 0.5 (average)
 *   strength 1   → skill 1 (expert)
 */
export function computeStudentSkill(
  strengths: Record<string, number>,
  topicWeights: Record<string, number>
): number {
  let totalWeight = 0;
  let weightedStrength = 0;
  for (const [id, w] of Object.entries(topicWeights)) {
    if (w > 0) {
      weightedStrength += (strengths[id] ?? 0.5) * w;
      totalWeight += w;
    }
  }
  const avg = totalWeight > 0 ? weightedStrength / totalWeight : 0.5;
  return avg;
}

export function mergeWrongAnswerWeights(
  topicWeights: Record<string, number>,
  wrongAnswerWeights: Record<string, number>,
  discount = 0.5,
): Record<string, number> {
  const merged = { ...topicWeights };
  for (const [id, w] of Object.entries(wrongAnswerWeights)) {
    const discounted = w * discount;
    merged[id] = Math.max(merged[id] ?? 0, discounted);
  }
  return merged;
}

export function updateStrengths(
  strengths: Record<string, number>,
  topicWeights: Record<string, number>,
  correct: boolean,
  learningRate = 0.12
): Record<string, number> {
  const updated = { ...strengths };
  for (const [id, w] of Object.entries(topicWeights)) {
    if (w <= 0) continue;
    if (updated[id] === undefined) {
      const firstAnswerTarget = correct ? 0.75 : 0.25;
      updated[id] = Math.min(1, Math.max(0, 0.5 + (firstAnswerTarget - 0.5) * w));
      continue;
    }
    const s = updated[id];
    if (correct) {
      updated[id] = Math.min(1, s + learningRate * w * (1 - s));
    } else {
      updated[id] = Math.max(0, s - learningRate * w * s);
    }
  }
  return updated;
}

// Diagnostic variant — difficulty scales the update size, guess/slip correction keeps
// single answers from being overconfident.
//
// p_guess = 1/numChoices (0.25 for 4-choice MCQ): a lucky guess is not real evidence.
// p_slip  = 0.10: a student who knows the material still slips occasionally.
// correctSignal = 1 - p_guess = 0.75  →  discounts the boost from a correct answer.
// wrongSignal   = 1 - p_slip  = 0.90  →  discounts the penalty from a wrong answer.
//
// First-touch correct: always above 0.5, step scaled by difficulty × correctSignal.
//   easy(0.2)→0.55, medium(0.5)→0.69, hard(0.8)→0.80
// First-touch wrong:   near 0 for easy, ~0.20 for hard (unchanged from before).
// Subsequent correct:  α = difficulty × 0.45 × correctSignal.
// Subsequent wrong:    α = 0.50 × wrongSignal = 0.45.
//
// difficulty should be normalizeDifficulty(raw 1-5), i.e. in [0.2, 0.8]; defaults to 0.5.
export function updateStrengthsDiagnostic(
  strengths: Record<string, number>,
  topicWeights: Record<string, number>,
  correct: boolean,
  difficulty: number = 0.5,
  numChoices: number = 4
): Record<string, number> {
  const p_guess = 1 / numChoices;
  const p_slip  = 0.10;
  const correctSignal = 1 - p_guess; // 0.75
  const wrongSignal   = 1 - p_slip;  // 0.90

  const updated = { ...strengths };
  for (const [id, w] of Object.entries(topicWeights)) {
    if (w <= 0) continue;
    if (updated[id] === undefined) {
      if (correct) {
        updated[id] = Math.min(1, 0.5 + difficulty * 2.0 * w * correctSignal);
      } else {
        updated[id] = Math.max(0, 0.5 - difficulty * 2.0 * w * wrongSignal);
      }
      continue;
    }
    const s = updated[id]!;
    if (correct) {
      const αCorrect = difficulty * 1.5 * correctSignal;
      updated[id] = Math.min(1, s + αCorrect * w * (1 - s));
    } else {
      updated[id] = Math.max(0, s - 1.0 * wrongSignal * w * s);
    }
  }
  return updated;
}

export function scoreProblemByKeyword(
  problem: { difficulty: number; estimated_difficulty?: number | null; keyword_weights?: Record<string, number>; avg_rating: number | null },
  keywordStrengths: Record<string, number>,
  targetDifficulty: number
): number {
  const kw = problem.keyword_weights ?? {};
  const ids = Object.keys(kw);
  let weightedWeakness = 0;
  let totalWeight = 0;
  for (const [id, w] of Object.entries(kw)) {
    if (w > 0) {
      weightedWeakness += w * (1 - (keywordStrengths[id] ?? 0.5));
      totalWeight += w;
    }
  }
  const topicScore = ids.length === 0 ? 0.5 : totalWeight > 0 ? weightedWeakness / totalWeight : 0.5;
  const effectiveDifficulty = problem.estimated_difficulty ?? normalizeDifficulty(problem.difficulty ?? 3);
  const diff = effectiveDifficulty - targetDifficulty;
  const diffScore = Math.exp(-0.5 * diff * diff);
  const ratingScore = problem.avg_rating != null ? 0.7 + 0.3 * (problem.avg_rating / 5) : 0.8;

  // Uncertainty bonus: prefer problems that probe skills we know the least about.
  // A score near 0.5 is maximally uncertain; near 0 or 1 is confident.
  // Weight 0.25 keeps this secondary to weakness+difficulty targeting.
  let uncertaintySum = 0;
  for (const [id, w] of Object.entries(kw)) {
    if (w > 0) {
      const s = keywordStrengths[id] ?? 0.5;
      uncertaintySum += w * (1 - Math.abs(s - 0.5) * 2);
    }
  }
  const uncertaintyBonus = totalWeight > 0 ? 0.25 * uncertaintySum / totalWeight : 0;

  return topicScore * diffScore * ratingScore + uncertaintyBonus;
}

// Spaced repetition intervals in days: review 1, 3, 7, 14, 30, 60 days after mastery
const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60];

export function computeNextReviewDate(inDepthScore: number, reviewCount: number): Date {
  const idx = Math.min(reviewCount, REVIEW_INTERVALS.length - 1);
  const baseDays = REVIEW_INTERVALS[idx];
  // Stronger students get slightly longer intervals
  const multiplier = 0.8 + inDepthScore * 0.4;
  const days = Math.round(baseDays * multiplier);
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next;
}

export function isReviewDue(spacedReviewDueAt: string | null): boolean {
  if (!spacedReviewDueAt) return false;
  return new Date(spacedReviewDueAt) <= new Date();
}

export function getLearningPhase(
  inDepthScore: number,
  consecutiveCorrect: number,
  spacedReviewDueAt: string | null,
  state: string
): string {
  if (state === "mastered") return isReviewDue(spacedReviewDueAt) ? "spaced_review" : "mastered";
  if (inDepthScore >= 0.7 && consecutiveCorrect >= 2) return "interleaved";
  return "blocked";
}

// ─── Evidence Propagation Layer ──────────────────────────────────────────────
// Layered on top of the existing direct-evidence update (updateStrengthsDiagnostic).
// Infers untested skills from tested ones using a prerequisite graph and sibling
// correlation within umbrella parents. See docs/weights-research.md for full design.

export const PROP_UPSTREAM_RATE   = 0.20;
export const PROP_DOWNSTREAM_RATE = 0.12;
export const PROP_SIBLING_RATE    = 0.08;
export const PROP_HIGH_CONF       = 0.75;
export const PROP_LOW_CONF        = 0.35;
export const DEFAULT_SIBLING_CORR = 0.30;

/**
 * Build a prerequisite graph from problem co-occurrence data.
 *
 * Heuristic: for each problem, every id in `prerequisite_weights` is a prerequisite
 * OF every id in `keyword_weights` (same problem). We build both directions:
 *   - dependentsOf[k]: keywords that have k as a prerequisite (k → harder skills)
 *   - prereqsOf[k]:    keywords that are prerequisites of k (k → easier skills)
 */
export function buildGraphFromProblems(
  problems: { keyword_weights: Record<string, number> | null; prerequisite_weights: Record<string, number> | null }[]
): { dependentsOf: Record<string, Set<string>>; prereqsOf: Record<string, Set<string>> } {
  const dependentsOf: Record<string, Set<string>> = {};
  const prereqsOf: Record<string, Set<string>> = {};

  for (const prob of problems) {
    const kwKeys = Object.keys(prob.keyword_weights ?? {});
    const pwKeys = Object.keys(prob.prerequisite_weights ?? {});
    for (const kId of kwKeys) {
      for (const pId of pwKeys) {
        // pId is a prerequisite of kId
        if (!dependentsOf[pId]) dependentsOf[pId] = new Set();
        dependentsOf[pId].add(kId);

        if (!prereqsOf[kId]) prereqsOf[kId] = new Set();
        prereqsOf[kId].add(pId);
      }
    }
  }

  return { dependentsOf, prereqsOf };
}

/**
 * Propagate evidence from directly-tested keywords to untested ones.
 *
 * Three passes (all additive — never mutates the input strengths object):
 *   UPSTREAM:   correct answer on k → boost prerequisites of k
 *   DOWNSTREAM: high-confidence correct on k → nudge dependents of k upward;
 *               low-confidence wrong on k → nudge dependents of k downward
 *   SIBLING:    any answer on k → nudge same-umbrella siblings toward k's strength
 *
 * @param strengths         Current keyword strengths (not mutated)
 * @param testedWeights     The current problem's merged keyword weights (kw + aw + rw)
 * @param graph             Built by buildGraphFromProblems
 * @param correct           Whether the student answered correctly
 * @param normalizedDifficulty  nd in [0.2, 0.8] from normalizeDifficulty()
 * @param inDepthToUmbrella Maps each in_depth keyword id → umbrella id
 */
export function propagateEvidence(
  strengths: Record<string, number>,
  testedWeights: Record<string, number>,
  graph: ReturnType<typeof buildGraphFromProblems>,
  correct: boolean,
  normalizedDifficulty: number,
  inDepthToUmbrella: Record<string, number | string>,
): Record<string, number> {
  const nd = normalizedDifficulty;
  // Clone to avoid mutating the input
  const s: Record<string, number> = { ...strengths };

  // Pre-compute sibling groups: umbrella → set of in_depth keyword ids
  const umbrellaToSiblings: Record<string, string[]> = {};
  for (const [id, umbrellaId] of Object.entries(inDepthToUmbrella)) {
    const uid = String(umbrellaId);
    if (!umbrellaToSiblings[uid]) umbrellaToSiblings[uid] = [];
    umbrellaToSiblings[uid].push(id);
  }

  for (const [k, wk] of Object.entries(testedWeights)) {
    if (wk <= 0) continue;

    // ── UPSTREAM PASS ─────────────────────────────────────────────────────
    // Correct on k → credit prerequisites of k (wrong leaves them unchanged)
    if (correct) {
      const prereqs = graph.prereqsOf[k];
      if (prereqs) {
        for (const p of prereqs) {
          const sp = s[p] ?? 0.5;
          s[p] = Math.min(1, sp + PROP_UPSTREAM_RATE * wk * nd * (1 - sp));
        }
      }
    }

    // ── DOWNSTREAM PASS ───────────────────────────────────────────────────
    // High-confidence correct on k → nudge dependents upward
    // Low-confidence wrong on k    → nudge dependents downward
    const dependents = graph.dependentsOf[k];
    if (dependents) {
      const sk = s[k] ?? 0.5;
      if (correct && sk > PROP_HIGH_CONF) {
        for (const d of dependents) {
          const sd = s[d] ?? 0.5;
          s[d] = Math.min(1, sd + PROP_DOWNSTREAM_RATE * wk * nd * (1 - sd));
        }
      } else if (!correct && sk < PROP_LOW_CONF) {
        for (const d of dependents) {
          const sd = s[d] ?? 0.5;
          s[d] = Math.max(0, sd - PROP_DOWNSTREAM_RATE * wk * (1 - nd) * sd);
        }
      }
    }

    // ── SIBLING PASS ──────────────────────────────────────────────────────
    // Nudge same-umbrella siblings toward k's current strength
    const umbrellaId = inDepthToUmbrella[k];
    if (umbrellaId !== undefined) {
      const uid = String(umbrellaId);
      const siblings = umbrellaToSiblings[uid];
      if (siblings) {
        const sk = s[k] ?? 0.5;
        const delta = (sk - 0.5) * PROP_SIBLING_RATE * wk * DEFAULT_SIBLING_CORR;
        for (const sibId of siblings) {
          if (sibId === k) continue;
          // Skip siblings that are directly tested in this problem
          if (testedWeights[sibId] !== undefined) continue;
          const sib = s[sibId] ?? 0.5;
          s[sibId] = Math.min(1, Math.max(0, sib + delta));
        }
      }
    }
  }

  return s;
}
