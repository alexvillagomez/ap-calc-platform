export type KeywordScores = Record<string, number>;

export type Answer = {
  questionId: string;
  selectedIndex: number | null;
  flaggedForgotten: boolean;
  flaggedNeverSeen: boolean;
  flaggedDontKnow: boolean;
  correct: boolean | null;
};

export type DiagnosticRoute =
  | "skip"
  | "targeted"
  | "refresher"
  | "full_lesson";

export type DiagnosticResult = {
  route: DiagnosticRoute;
  umbrellaScore: number;
  inDepthScores: KeywordScores;
  weakestSkills: string[];
  verdict: "absolutely_knows_this" | "needs_more_practice" | "needs_a_refresher" | "needs_to_learn_this";
};

const ALPHA_CORRECT = 0.25;
const ALPHA_WRONG = 0.35;
const ALPHA_DONT_KNOW = 0.45;
const DEFAULT_SCORE = 0.5;

export function updateScores(
  scores: KeywordScores,
  keywords: Record<string, number>,
  correct: boolean,
  wrongAlpha: number = ALPHA_WRONG
): KeywordScores {
  const next = { ...scores };
  for (const [kw, weight] of Object.entries(keywords)) {
    if (next[kw] === undefined) {
      const firstAnswerTarget = correct ? 0.75 : 0.25;
      next[kw] = Math.min(1, Math.max(0, DEFAULT_SCORE + (firstAnswerTarget - DEFAULT_SCORE) * weight));
      continue;
    }
    const s = next[kw];
    if (correct) {
      next[kw] = s + ALPHA_CORRECT * weight * (1 - s);
    } else {
      next[kw] = Math.max(0, s - wrongAlpha * weight * s);
    }
  }
  return next;
}

export function applyAnswerToScores(
  umbrellaScores: KeywordScores,
  inDepthScores: KeywordScores,
  umbrellaKeywords: Record<string, number>,
  inDepthKeywords: Record<string, number>,
  answer: Answer
): { umbrellaScores: KeywordScores; inDepthScores: KeywordScores } {
  // Never seen → excluded from EMA entirely
  if (answer.flaggedNeverSeen) {
    return { umbrellaScores, inDepthScores };
  }
  // Don't know → treated as wrong, but with a heavier penalty than a normal miss
  if (answer.flaggedDontKnow) {
    return {
      umbrellaScores: updateScores(umbrellaScores, umbrellaKeywords, false, ALPHA_DONT_KNOW),
      inDepthScores: updateScores(inDepthScores, inDepthKeywords, false, ALPHA_DONT_KNOW),
    };
  }
  // Forgotten → same decay as wrong answer
  const correct = answer.flaggedForgotten ? false : (answer.correct ?? false);
  return {
    umbrellaScores: updateScores(umbrellaScores, umbrellaKeywords, correct),
    inDepthScores: updateScores(inDepthScores, inDepthKeywords, correct),
  };
}

export function computeRoute(
  answers: Answer[],
  umbrellaScores: KeywordScores,
  inDepthScores: KeywordScores,
  umbrellaKey = "exponent_rules"
): DiagnosticResult {
  const neverSeenCount = answers.filter((a) => a.flaggedNeverSeen).length;
  const forgottenCount = answers.filter((a) => a.flaggedForgotten).length;
  const umbrellaScore = umbrellaScores[umbrellaKey] ?? DEFAULT_SCORE;

  // Find in-depth skills with evidence (score differs from default)
  const inDepthEntries = Object.entries(inDepthScores);
  const weakestSkills = inDepthEntries
    .filter(([, score]) => score < 0.45)
    .sort(([, a], [, b]) => a - b)
    .map(([kw]) => kw);

  let route: DiagnosticRoute;
  let verdict: DiagnosticResult["verdict"];

  if (neverSeenCount >= 3 || umbrellaScore < 0.35) {
    route = "full_lesson";
    verdict = "needs_to_learn_this";
  } else if (forgottenCount >= 2 || umbrellaScore < 0.5) {
    route = "refresher";
    verdict = "needs_a_refresher";
  } else if (umbrellaScore < 0.75 || weakestSkills.length > 0) {
    route = "targeted";
    verdict = "needs_more_practice";
  } else {
    route = "skip";
    verdict = "absolutely_knows_this";
  }

  return { route, umbrellaScore, inDepthScores, weakestSkills, verdict };
}

// After completing a lesson, nudge scores upward with a weaker alpha
// (reading ≠ mastery, but it does update priors).
const ALPHA_LESSON = 0.15;

export function applyLessonToScores(
  umbrellaScores: KeywordScores,
  inDepthScores: KeywordScores,
  umbrellaKeywords: Record<string, number>,
  inDepthKeywords: Record<string, number>
): { umbrellaScores: KeywordScores; inDepthScores: KeywordScores } {
  return {
    umbrellaScores: updateScoresWithAlpha(umbrellaScores, umbrellaKeywords, ALPHA_LESSON),
    inDepthScores: updateScoresWithAlpha(inDepthScores, inDepthKeywords, ALPHA_LESSON),
  };
}

function updateScoresWithAlpha(
  scores: KeywordScores,
  keywords: Record<string, number>,
  alpha: number
): KeywordScores {
  const next = { ...scores };
  for (const [kw, weight] of Object.entries(keywords)) {
    const s = next[kw] ?? DEFAULT_SCORE;
    next[kw] = s + alpha * weight * (1 - s);
  }
  return next;
}

export function formatKeywordLabel(kw: string): string {
  return kw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const DIAGNOSTIC_MIN_QUESTIONS = 5;
export const DIAGNOSTIC_MAX_QUESTIONS = 15;
export const DIAGNOSTIC_CONFIDENCE_THRESHOLD = 0.7;

export function keywordUncertainty(score: number): number {
  return 1 - Math.abs(score - 0.5) * 2;
}

export function allKeywordsConfident(
  scores: KeywordScores,
  knownKeywords: string[],
  threshold = DIAGNOSTIC_CONFIDENCE_THRESHOLD
): boolean {
  if (knownKeywords.length === 0) return false;
  return knownKeywords.every(kw => {
    const s = scores[kw] ?? 0.5;
    return Math.abs(s - 0.5) * 2 >= threshold;
  });
}
