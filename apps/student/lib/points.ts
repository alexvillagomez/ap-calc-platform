"use client";

/**
 * Points store — a persistent "points scored" tally for general practice.
 *
 * Scoring (the visible reward loop):
 *   - CORRECT flashcard  → +1 point
 *   - CORRECT quiz/question → +2 points
 * Wrong answers add nothing (but never subtract).
 *
 * Unlike the grind meter (effort/heat, resets daily), points ACCUMULATE and are
 * kept as a per-day map so "My Progress" can show today / this week / this month
 * / all-time. Persistence is per user (lodera_uid cookie) in localStorage:
 *
 *   lodera_points_v1:<uid>  →  { "YYYY-MM-DD": <points>, … }
 *
 * Per-device for now (matches grindMeter.ts); a future account-level DB rollup
 * can hydrate this without changing the call sites.
 */

const STORAGE_PREFIX = "lodera_points_v1";

/** Points awarded per correct item. */
export const POINTS_FLASHCARD = 1;
export const POINTS_QUIZ = 2;

/** Drop day entries older than this many days on save (keeps storage bounded). */
const RETAIN_DAYS = 400;

export type PointsSummary = {
  today: number;
  week: number; // calendar week, Monday-based, includes today
  month: number; // calendar month, includes today
  total: number; // all-time (within retained window)
};

type DailyMap = Record<string, number>;

// ── Date helpers (local wall-clock, matching grindMeter) ─────────────────────

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayKey(): string {
  return dayKey(new Date());
}

/** Monday-based start of the week containing `d`, at local midnight. */
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  x.setDate(x.getDate() - dow);
  return x;
}

function uid(): string {
  if (typeof document === "undefined") return "anon";
  const m = document.cookie.match(/(?:^|;\s*)lodera_uid=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : "anon";
}

function storageKey(): string {
  return `${STORAGE_PREFIX}:${uid()}`;
}

// ── Storage ──────────────────────────────────────────────────────────────────

function load(): DailyMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: DailyMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(n) && n > 0) {
        out[k] = n;
      }
    }
    return out;
  } catch {
    return {};
  }
}

const listeners = new Set<(s: PointsSummary) => void>();

function prune(map: DailyMap): DailyMap {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETAIN_DAYS);
  const cutoffKey = dayKey(cutoff);
  const out: DailyMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (k >= cutoffKey) out[k] = v;
  }
  return out;
}

function save(map: DailyMap): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(storageKey(), JSON.stringify(map));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }
  const summary = summarize(map);
  listeners.forEach((fn) => fn(summary));
}

// ── Public API ────────────────────────────────────────────────────────────────

function summarize(map: DailyMap): PointsSummary {
  const now = new Date();
  const tKey = todayKey();
  const weekStart = dayKey(startOfWeek(now));
  const monthPrefix = tKey.slice(0, 7); // "YYYY-MM"

  let today = 0;
  let week = 0;
  let month = 0;
  let total = 0;
  for (const [k, v] of Object.entries(map)) {
    total += v;
    if (k === tKey) today += v;
    if (k >= weekStart) week += v;
    if (k.startsWith(monthPrefix)) month += v;
  }
  return { today, week, month, total };
}

/** Current points summary (today / week / month / all-time). */
export function getPoints(): PointsSummary {
  return summarize(load());
}

/** Award `n` points to today's tally. Returns the new summary. */
export function addPoints(n: number): PointsSummary {
  if (!Number.isFinite(n) || n <= 0) return getPoints();
  const map = prune(load());
  const k = todayKey();
  map[k] = (map[k] ?? 0) + n;
  save(map);
  return summarize(map);
}

/** Convenience: award a correct flashcard (+1). */
export function awardFlashcard(): PointsSummary {
  return addPoints(POINTS_FLASHCARD);
}

/** Convenience: award a correct quiz/question (+2). */
export function awardQuiz(): PointsSummary {
  return addPoints(POINTS_QUIZ);
}

/** Subscribe to points changes (fires on every award, this tab only). */
export function subscribePoints(fn: (s: PointsSummary) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
