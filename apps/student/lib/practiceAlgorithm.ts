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
 * difficulty is 1 + s * 3 (so s=0 → d≈1, s=0.5 → d≈2.5, s=1 → d≈4).
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
  if (selectedTopicIds.length === 0) return 2.5;
  const vals = selectedTopicIds.map((id) => strengths[id] ?? 0.5);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return 1 + avg * 3; // 1–4 range
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

  // Use calibrated difficulty when available, fall back to static difficulty.
  const effectiveDifficulty = problem.estimated_difficulty ?? problem.difficulty ?? 3;

  // Difficulty proximity: Gaussian around target (σ = 1 difficulty unit)
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
 * Formula: 1 + weighted_avg_strength * 4
 *   strength 0   → skill 1 (very weak)
 *   strength 0.5 → skill 3 (average)
 *   strength 1   → skill 5 (expert)
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
  return 1 + avg * 4;
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
    const s = updated[id] ?? 0.5;
    if (correct) {
      updated[id] = Math.min(1, s + learningRate * w * (1 - s));
    } else {
      updated[id] = Math.max(0, s - learningRate * w * s);
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
  const effectiveDifficulty = problem.estimated_difficulty ?? problem.difficulty ?? 3;
  const diff = effectiveDifficulty - targetDifficulty;
  const diffScore = Math.exp(-0.5 * diff * diff);
  const ratingScore = problem.avg_rating != null ? 0.7 + 0.3 * (problem.avg_rating / 5) : 0.8;
  return topicScore * diffScore * ratingScore;
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
