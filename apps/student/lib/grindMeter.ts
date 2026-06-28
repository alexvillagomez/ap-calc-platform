"use client";

/**
 * Grind-meter store — a persistent, MONOTONIC "effort/focus" meter.
 *
 * Philosophy: the grind meter rewards SHOWING UP and grinding. It is NOT a
 * correctness meter. Its level ONLY EVER INCREASES within a day:
 *  - FLASHCARDS: every card SEEN (Got it / Missed it / Don't know) adds a small
 *    boost, and increments the "seen today" counter.
 *  - QUIZZES / QUESTIONS: a CORRECT answer adds, multiplied by the current
 *    correct-streak multiplier (consecutive correct answers compound). A WRONG
 *    answer never subtracts — it just resets the multiplier back to ×1; the
 *    meter level itself holds steady.
 *
 * Persistence is per user (lodera_uid cookie) per DAY, in localStorage:
 *  - `level` accumulates through the day and never decreases within a session.
 *  - `seenToday` resets at the day boundary.
 * A new calendar day starts a fresh grind (warming up again) — this is the
 * intended "daily streak of effort" model.
 */

const STORAGE_PREFIX = "lodera_grind_v1";

// Tuning. Points are abstract; heat saturates via HEAT_K below.
export const FLASHCARD_BOOST = 4; // points per flashcard seen
export const QUIZ_BASE = 6; // points per correct quiz answer (× multiplier)
export const MAX_MULTIPLIER = 6; // multiplier cap so it stays motivating, not silly
const HEAT_K = 160; // points → ~63% heat; full session climbs through tiers

export type GrindState = {
  date: string; // YYYY-MM-DD this state belongs to
  level: number; // monotonic effort points for the day
  seenToday: number; // flashcards seen today
  multiplier: number; // current quiz correct-streak multiplier (≥1)
};

function todayKey(): string {
  // Local calendar day so "today" matches the student's wall clock.
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function uid(): string {
  if (typeof document === "undefined") return "anon";
  const m = document.cookie.match(/(?:^|;\s*)lodera_uid=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : "anon";
}

function storageKey(): string {
  return `${STORAGE_PREFIX}:${uid()}`;
}

function fresh(): GrindState {
  return { date: todayKey(), level: 0, seenToday: 0, multiplier: 1 };
}

/** Load today's state, rolling over (resetting) if the stored day is stale. */
export function loadGrind(): GrindState {
  if (typeof window === "undefined") return fresh();
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return fresh();
    const parsed = JSON.parse(raw) as Partial<GrindState>;
    if (!parsed || parsed.date !== todayKey()) return fresh();
    return {
      date: parsed.date,
      level: Math.max(0, Number(parsed.level) || 0),
      seenToday: Math.max(0, Math.floor(Number(parsed.seenToday) || 0)),
      multiplier: Math.max(1, Number(parsed.multiplier) || 1),
    };
  } catch {
    return fresh();
  }
}

const listeners = new Set<(s: GrindState) => void>();

function save(state: GrindState): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(storageKey(), JSON.stringify(state));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }
  listeners.forEach((fn) => fn(state));
}

export function subscribeGrind(fn: (s: GrindState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Record one flashcard seen (any outcome). Adds a boost + a "seen" tick. */
export function recordFlashcardSeen(count = 1): GrindState {
  const s = loadGrind();
  const next: GrindState = {
    ...s,
    level: s.level + FLASHCARD_BOOST * count,
    seenToday: s.seenToday + count,
  };
  save(next);
  return next;
}

/**
 * Record one quiz/question answer.
 *  - correct: multiplier compounds (capped), level += QUIZ_BASE × multiplier.
 *  - wrong: multiplier resets to ×1, level UNCHANGED (never decreases).
 */
export function recordQuizAnswer(correct: boolean): GrindState {
  const s = loadGrind();
  if (correct) {
    const multiplier = Math.min(MAX_MULTIPLIER, s.multiplier + 1);
    // First correct after a reset is ×1; each subsequent correct adds one more.
    const applied = Math.max(1, s.multiplier);
    const next: GrindState = {
      ...s,
      level: s.level + QUIZ_BASE * applied,
      multiplier,
    };
    save(next);
    return next;
  }
  // Wrong: hold the level, drop the multiplier back to base.
  const next: GrindState = { ...s, multiplier: 1 };
  save(next);
  return next;
}

/** Saturating 0..1 heat from accumulated points (monotonic in `level`). */
export function heatFromLevel(level: number): number {
  return 1 - Math.exp(-Math.max(0, level) / HEAT_K);
}

/**
 * Overdrive signal: 0 until `level` passes the saturation knee (~3× HEAT_K),
 * then grows linearly so overdrive=1 at ~960 pts and keeps climbing beyond.
 * Used by GrindMeter to unlock the post-Inferno "Supernova" → "Prismatic"
 * tiers; at overdrive≥2 the UI enters rainbow-shimmer mode.
 *
 * Threshold = 3 × HEAT_K ≈ 480 pts (heat ≈ 0.95, effectively "full bar").
 * Scale    = 1 × HEAT_K = 160 pts per overdrive unit.
 */
export const OVERDRIVE_THRESHOLD = 3 * HEAT_K; // 480
export const OVERDRIVE_SCALE = HEAT_K; // 160 pts per unit

export function overdriveFromLevel(level: number): number {
  const excess = Math.max(0, level) - OVERDRIVE_THRESHOLD;
  return excess > 0 ? excess / OVERDRIVE_SCALE : 0;
}

/**
 * Cyclic grind bar (the compact header meter).
 *
 * Instead of one saturating fill, the compact meter fills left → right and
 * then "laps": every full fill bumps it to a HOTTER colour tier, and after
 * enough laps it goes full rainbow. Because the underlying `level` climbs
 * FASTER when a correct-streak multiplier is active (recordQuizAnswer adds
 * QUIZ_BASE × multiplier), the bar visibly accelerates on a hot streak — which
 * is exactly the "goes faster with streak multipliers" feel.
 *
 * `cycle` = how many times it has lapped (0,1,2,…) → drives the colour tier.
 * `fill`  = 0..1 progress through the CURRENT lap → drives the bar width.
 */
export const CYCLE_SIZE = 60; // points to fill the bar once (~10 base answers)

export function cycleProgress(level: number): { cycle: number; fill: number } {
  const p = Math.max(0, level);
  const cycle = Math.floor(p / CYCLE_SIZE);
  const fill = (p % CYCLE_SIZE) / CYCLE_SIZE;
  return { cycle, fill };
}
