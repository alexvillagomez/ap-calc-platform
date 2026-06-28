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
  /** The keyword's own category — review keywords can span earlier units, so a
   *  review question must be scoped to this, not the current frontier category. */
  category_id?: string;
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
  /** Authoritative toolbar keyword (embedding-matched); falls back to max-weight. */
  primary_keyword_id?: string | null;
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

export function scoreBarColor(pct: number): "brand" | "success" | "error" {
  if (pct >= 80) return "success";
  if (pct >= 55) return "brand";
  return "error";
}

// ─── Word-label status system ─────────────────────────────────────────────────
//
// Data-sufficiency thresholds (documented here — the sole source of truth):
//   Keyword:   ≥ 5 attempts
//   Umbrella:  ≥ 5 total attempts (aggregated across children)
//   Category:  ≥ 5 total attempts AND ≥ min(3, totalKeywords) keywords attempted
//
// Status scale (once data-sufficient):
//   "Not started"   — 0 attempts or no score
//   "Just started"  — some attempts but below data-sufficiency threshold
//   "Needs work"    — score < 55%
//   "Getting there" — score 55–79%
//   "Strong"        — score ≥ 80%

export interface ProgressStatus {
  label: string;
  labelClass: string;
  sufficient: boolean; // when false, skip progress bar (data not reliable yet)
}

export function keywordProgressStatus(attempts: number, pct: number | null): ProgressStatus {
  if (attempts === 0 || pct === null) {
    return { label: "Not started", labelClass: "text-neutral-400", sufficient: false };
  }
  if (attempts < 5) {
    return { label: "Just started", labelClass: "text-neutral-500", sufficient: false };
  }
  if (pct >= 80) return { label: "Strong",        labelClass: "text-success-700", sufficient: true };
  if (pct >= 55) return { label: "Getting there", labelClass: "text-amber-700",   sufficient: true };
  return               { label: "Needs work",     labelClass: "text-error-600",   sufficient: true };
}

export function umbrellaProgressStatus(
  totalAttempts: number,
  displayScore: number | null
): ProgressStatus {
  if (totalAttempts === 0 || displayScore === null) {
    return { label: "Not started", labelClass: "text-neutral-400", sufficient: false };
  }
  if (totalAttempts < 5) {
    return { label: "Just started", labelClass: "text-neutral-500", sufficient: false };
  }
  if (displayScore >= 80) return { label: "Strong",        labelClass: "text-success-700", sufficient: true };
  if (displayScore >= 55) return { label: "Getting there", labelClass: "text-amber-700",   sufficient: true };
  return                  { label: "Needs work",           labelClass: "text-error-600",   sufficient: true };
}

export function categoryProgressStatus(
  totalKeywords: number,
  keywordsAttempted: number,
  totalAttempts: number,
  avgScore: number | null
): ProgressStatus {
  if (totalAttempts === 0 || avgScore === null) {
    return { label: "Not started", labelClass: "text-neutral-400", sufficient: false };
  }
  const minKeywordsNeeded = Math.min(3, totalKeywords);
  const sufficient = totalAttempts >= 5 && keywordsAttempted >= minKeywordsNeeded;
  if (!sufficient) {
    return { label: "Just started", labelClass: "text-neutral-500", sufficient: false };
  }
  if (avgScore >= 80) return { label: "Strong",        labelClass: "text-success-700", sufficient: true };
  if (avgScore >= 55) return { label: "Getting there", labelClass: "text-amber-700",   sufficient: true };
  return               { label: "Needs work",          labelClass: "text-error-600",   sufficient: true };
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
