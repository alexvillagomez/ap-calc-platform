"use client";

/**
 * General-practice serving logic — the "controlled randomness" engine for the
 * topic-select practice surface (NOT auto mode, which is a strict in-order path).
 *
 * Per the product spec for General Practice:
 *  - KEYWORD pick: ~60% uniformly random across the selected pool, ~40% focused
 *    on weaker keywords (sampled with weight ∝ 1−score). Net effect: every
 *    selected keyword keeps coming up, but low-mastery ones come up a bit more.
 *  - CONTENT pick: within the chosen keyword, choose flashcard vs quiz-question
 *    adaptively by mastery — weak → mostly flashcards, strong → mostly questions
 *    (reuses `flashcardShareForMastery`) — constrained to the enabled types.
 *  - LESSON: never forced. Only surfaced after a MISS that leaves the keyword's
 *    mastery below a low threshold, and at most once per keyword per session.
 *
 * All functions are pure (rng injectable) so they can be unit-tested and reused
 * by a math equivalent later.
 */

import { flashcardShareForMastery } from "./adaptive";

export type ContentKind = "flashcard" | "question";

export type EnabledTypes = {
  lessons: boolean;
  flashcards: boolean;
  quizzes: boolean;
};

export interface KeywordPick {
  id: string;
  /** Current mastery 0–1 (default 0.5 when unknown). */
  score: number;
}

/** Share of keyword picks that are weakness-focused (vs uniformly random). */
export const FOCUS_SHARE = 0.4;

/**
 * After a miss, a keyword mastery strictly below this surfaces a lesson.
 * Matches the server's `needs_lesson` score gate (0.35) so the two agree.
 */
export const LESSON_SCORE_THRESHOLD = 0.35;

/**
 * Pick the next keyword to practice from the selected pool.
 *  - With probability (1 − FOCUS_SHARE): uniform random.
 *  - With probability FOCUS_SHARE: weighted by (1 − score), so weaker keywords
 *    are favoured (every keyword keeps a floor chance via the epsilon).
 */
export function pickKeyword(
  pool: KeywordPick[],
  rng: () => number = Math.random
): KeywordPick | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0]!;

  const focused = rng() < FOCUS_SHARE;
  if (!focused) {
    return pool[Math.floor(rng() * pool.length)] ?? pool[0]!;
  }

  // Weakness-weighted: lower score → higher weight. Epsilon keeps a floor so
  // even a fully-mastered keyword can still be picked.
  const weights = pool.map((k) => Math.max(0.08, 1 - clamp01(k.score)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

/**
 * Choose flashcard vs question for a keyword at the given mastery, restricted to
 * the enabled content types. Returns null if neither flashcards nor quizzes are
 * enabled (lessons are not part of the normal rotation — see `shouldShowLesson`).
 */
export function pickContentKind(
  score: number,
  enabled: EnabledTypes,
  rng: () => number = Math.random
): ContentKind | null {
  const canFlash = enabled.flashcards;
  const canQuiz = enabled.quizzes;
  if (canFlash && !canQuiz) return "flashcard";
  if (canQuiz && !canFlash) return "question";
  if (!canFlash && !canQuiz) return null;
  // Both enabled → adaptive by skill.
  const share = flashcardShareForMastery(clamp01(score));
  return rng() < share ? "flashcard" : "question";
}

/**
 * Should we surface a lesson right now? Only after a miss, only if lessons are
 * enabled, only once per keyword, and only when the (post-miss) mastery is low
 * enough — OR the server explicitly flagged the keyword as needing a lesson.
 */
export function shouldShowLesson(args: {
  enabled: EnabledTypes;
  wasMiss: boolean;
  alreadyShown: boolean;
  scoreAfter: number | null;
  serverNeedsLesson: boolean;
}): boolean {
  const { enabled, wasMiss, alreadyShown, scoreAfter, serverNeedsLesson } = args;
  if (!enabled.lessons || !wasMiss || alreadyShown) return false;
  const lowEnough = scoreAfter !== null && scoreAfter < LESSON_SCORE_THRESHOLD;
  return lowEnough || serverNeedsLesson;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}
