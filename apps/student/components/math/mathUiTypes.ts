/**
 * Shared UI-layer types for math pages.
 * These mirror the shapes returned by /api/math/taxonomy and other routes.
 */

export interface MathInDepthChild {
  id: string;
  label: string;
  description: string | null;
  yield_score: number | null;
  yield_rationale: string | null;
  score: number | null;
  total_attempts: number;
  correct_attempts: number;
  dont_know_count: number;
  state: string | null;
  needs_lesson: boolean;
}

export interface MathUmbrella {
  id: string;
  label: string;
  description: string | null;
  yield_score: number | null;
  yield_rationale: string | null;
  score: number | null;
  total_attempts: number;
  correct_attempts: number;
  dont_know_count: number;
  state: string | null;
  implied_score: number | null;
  children: MathInDepthChild[];
}

export interface MathCategory {
  id: string;
  label: string;
  description: string | null;
  section: string;
  ced_unit: string | null;
  yield_score: number | null;
  yield_rationale: string | null;
  order_index: number;
  role: "core" | "foundation";
  umbrellas: MathUmbrella[];
}

export interface MathTaxonomyResponse {
  categories: MathCategory[];
}

// Practice queue types
export interface MathQueueKeyword {
  id: string;
  label: string;
  description: string;
  umbrella_id: string | null;
  umbrella_label: string | null;
  score: number | null;
  state: string | null;
  total_attempts: number;
  needs_lesson: boolean;
  yield_score: number | null;
}

export interface MathReviewKeyword {
  id: string;
  label: string;
  score: number | null;
  spaced_review_due_at: string | null;
}

export interface MathPracticeQueueResponse {
  queue: MathQueueKeyword[];
  review_pool: MathReviewKeyword[];
}

// Question (returned by next-question, quiz, diagnostic)
export interface MathQuestion {
  id: string;
  stem_latex: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
  hint_latex: string | null;
  keyword_weights: Record<string, number>;
  difficulty: number;
  parent_question_id: string | null;
}

// Helpers
export function umbrellaDisplayScore(u: MathUmbrella): number | null {
  if (u.implied_score !== null) return Math.round(u.implied_score * 100);
  if (u.score !== null) return Math.round(u.score * 100);
  return null;
}

export function umbrellaAttempts(u: MathUmbrella): number {
  if (u.children.length > 0) {
    return u.children.reduce((s, c) => s + c.total_attempts, 0);
  }
  return u.total_attempts;
}

export function categoryMasteryPct(cat: MathCategory): number | null {
  const scores = cat.umbrellas
    .map((u) => umbrellaDisplayScore(u))
    .filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function diffLabel(d: number): { label: string; cls: string } {
  if (d < 0.35) return { label: "Easy", cls: "bg-success-100 text-success-700" };
  if (d < 0.65) return { label: "Medium", cls: "bg-amber-100 text-amber-700" };
  return { label: "Hard", cls: "bg-error-100 text-error-700" };
}

export function scoreColor(pct: number): string {
  return pct >= 80
    ? "text-success-700"
    : pct >= 50
    ? "text-amber-700"
    : "text-error-600";
}

export const COURSE_LABELS: Record<string, string> = {
  precalc: "Precalculus",
  calc_ab: "AP Calculus AB",
};

export const SECTION_LABELS: Record<string, string> = {
  foundations: "Foundations",
  ap_precalc: "AP Precalculus",
  calc_ab: "Calculus AB",
};
