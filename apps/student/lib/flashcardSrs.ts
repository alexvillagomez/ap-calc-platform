/**
 * Leitner-box spaced repetition for MCAT memorization flashcards.
 *
 * Design (per product spec):
 *  - Boxes 1..5. Missing a card drops it to box 1, due immediately, so it
 *    recirculates within the same session until it graduates.
 *  - "Graduated" = box ≥ MEMORIZED_BOX (3): the next review is a day+ out, so
 *    the card leaves the current session.
 *  - A brand-new card answered correctly on first sight jumps straight to box 3
 *    (no pointless repetition of things already known); a missed/new-but-missed
 *    card starts at box 1 and gets heavy in-session repetition.
 *  - No hard daily cap — the due schedule naturally lands ~20–30 items/day.
 *  - Quiz gating: a scope's quiz unlocks only once its core cards are memorized
 *    (≥ MEMORIZED_BOX), i.e. memorize-before-quiz.
 */

export type FlashcardResult = "got_it" | "missed_it" | "dont_know";

export const MIN_BOX = 1;
export const MAX_BOX = 5;

/** Box at/above which a card counts as "memorized" (graduates the session). */
export const MEMORIZED_BOX = 3;

/**
 * Per-scope target number of memorized cards required to unlock the quiz.
 * If a scope has fewer active cards than this, all of them must be memorized.
 */
export const QUIZ_GATE_CORE_TARGET = 6;

/** Minimum memorized cards before a quiz can ever unlock (even tiny scopes). */
export const QUIZ_GATE_MIN = 3;

/**
 * Time until a card in a given box is due again, in milliseconds.
 * Boxes 1–2 are sub-session (minutes) so missed cards re-appear in the same
 * sitting; box 3+ pushes the card to a later day.
 */
const BOX_INTERVAL_MS: Record<number, number> = {
  1: 1 * 60_000, // ~immediately — recirculate this session
  2: 7 * 60_000, // a few cards later, still this session
  3: 24 * 3_600_000, // next day
  4: 3 * 24 * 3_600_000, // 3 days
  5: 7 * 24 * 3_600_000, // 1 week
};

export interface SrsState {
  box: number;
  reps: number;
  lapses: number;
  learned: boolean;
}

export interface SrsTransition {
  box: number;
  reps: number;
  lapses: number;
  learned: boolean;
  /** ISO timestamp when the card is next due. */
  due_at: string;
}

/**
 * Compute the next SRS state from a review result.
 *
 * @param prev  existing state, or null for a brand-new (never-seen) card
 * @param result grading result
 * @param now    current time (ms) — injectable for tests
 */
export function nextSrsState(
  prev: SrsState | null,
  result: FlashcardResult,
  now: number = Date.now()
): SrsTransition {
  const reps = (prev?.reps ?? 0) + 1;
  const correct = result === "got_it";

  let box: number;
  let lapses = prev?.lapses ?? 0;

  if (correct) {
    if (!prev) {
      // New card known on first sight → graduate straight to box 3.
      box = MEMORIZED_BOX;
    } else {
      box = Math.min(MAX_BOX, prev.box + 1);
    }
  } else {
    // missed_it or dont_know → reset to box 1 and recirculate this session.
    box = MIN_BOX;
    if (prev) lapses += 1; // only count a lapse on a card already seen
  }

  const learned = box >= MAX_BOX;
  const interval = BOX_INTERVAL_MS[box] ?? BOX_INTERVAL_MS[1];
  const due_at = new Date(now + interval).toISOString();

  return { box, reps, lapses, learned, due_at };
}

/**
 * Whether a quiz scope is unlocked given how many of its active cards are
 * memorized. Pure so it can be reused on the server and (optionally) client.
 *
 * @param memorizedCount cards in the scope with box ≥ MEMORIZED_BOX
 * @param activeCardCount total active cards available in the scope
 */
export function quizUnlocked(
  memorizedCount: number,
  activeCardCount: number
): boolean {
  if (activeCardCount <= 0) return false; // nothing to memorize yet → locked
  const required = Math.max(
    QUIZ_GATE_MIN,
    Math.min(QUIZ_GATE_CORE_TARGET, activeCardCount)
  );
  return memorizedCount >= required;
}

/** The number of memorized cards still needed to unlock a scope's quiz. */
export function quizGateRemaining(
  memorizedCount: number,
  activeCardCount: number
): number {
  if (activeCardCount <= 0) return QUIZ_GATE_MIN;
  const required = Math.max(
    QUIZ_GATE_MIN,
    Math.min(QUIZ_GATE_CORE_TARGET, activeCardCount)
  );
  return Math.max(0, required - memorizedCount);
}
