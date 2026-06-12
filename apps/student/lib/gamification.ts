/**
 * Lodera gamification helpers — single source of truth for all gamification
 * policies: sounds, animations, streak touching, combo state.
 *
 * Rules:
 *   correct  → playCorrect + CorrectPulse always
 *   combo 3  → slightly bigger moment (use in ComboMeter)
 *   combo 5  → milestone moment
 *   combo 10 → milestone moment
 *   incorrect → playIncorrect (gentle), no punishing visuals
 *   streak extended today → playStreak + StreakBadge celebrate
 */

import { playCorrect, playIncorrect, playStreak } from "@/lib/sound";

// ── Streak API ─────────────────────────────────────────────────────────────────

export interface StreakResult {
  current_streak: number;
  longest_streak: number;
  extended_today: boolean;
}

/**
 * Call /api/streak/touch once per page-load (enforced by the latch in
 * useStreakTouchOnce). Returns null on 401 (logged out) or any error.
 */
export async function touchStreak(): Promise<StreakResult | null> {
  try {
    const res = await fetch("/api/streak/touch", { method: "POST" });
    if (!res.ok) return null; // 401 = not logged in; any other error → silent
    return (await res.json()) as StreakResult;
  } catch {
    return null;
  }
}

// ── Session combo reducer ──────────────────────────────────────────────────────

export interface ComboState {
  count: number; // consecutive correct answers in this sitting
}

export function comboReducer(
  state: ComboState,
  action: "correct" | "incorrect"
): ComboState {
  if (action === "correct") return { count: state.count + 1 };
  return { count: 0 };
}

/** Milestone combo counts — at these values a bigger moment fires. */
export const COMBO_MILESTONES = [3, 5, 10] as const;

export function isMilestone(count: number): boolean {
  return (COMBO_MILESTONES as readonly number[]).includes(count);
}

// ── Milestone labels ──────────────────────────────────────────────────────────

export function comboLabel(count: number): string {
  if (count >= 10) return `${count} in a row!`;
  if (count >= 5) return `${count} streak!`;
  if (count >= 2) return `${count} in a row`;
  return "";
}

// ── Sound + animation policy ──────────────────────────────────────────────────

/**
 * Call after every correct answer.
 * Handles sound automatically (respects mute via sound.ts).
 */
export function onCorrectAnswer(combo: number): void {
  playCorrect();
  // Milestones get an extra sparkle — ComboMeter handles the visual;
  // sound escalation is a future hook if desired.
  void combo; // referenced for clarity, visual handled by ComboMeter
}

/**
 * Call after every incorrect answer.
 * Gentle sound only — no punishing visuals.
 */
export function onIncorrectAnswer(): void {
  playIncorrect();
}

/**
 * Call when a daily streak extension is confirmed.
 * Handled by StreakBadge internally; exported for external callers.
 */
export function onStreakExtended(): void {
  playStreak();
}
