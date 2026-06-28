/**
 * Course Engine — CourseConfig registry (the generic-engine parameterization).
 *
 * This is the single source of truth for everything that differs between
 * courses BY DESIGN. Per the unification directive (docs/unified-course-engine-design.md
 * + user overrides in docs/unification-progress.md):
 *
 *   - The shared FRAMEWORK (guided/auto flow, mastery, lessons/flashcards/quiz,
 *     diagnostic, tagging/enrichment) is one engine parameterized by this registry.
 *   - API routes stay SEPARATE per course (/api/math/*, /api/mcat/*) — thin wrappers.
 *   - The DB stays SEPARATE per course (math_*, mcat_*). New course = its own tables.
 *   - EMPHASIS lives here in code (no DB table) — constraint #4.
 *
 * Adding a new course = its own tables + ONE registry entry here (taxonomy ref +
 * emphasis) + seed/embed. No new bespoke flow/lib/component code.
 *
 * THE HEADLINE FEATURE — emphasis drives the flashcard-vs-quiz SERVING MIX as a
 * function of the student's PROFICIENCY on the current material:
 *   - low proficiency  → favor FLASHCARDS (memorize first)
 *   - high proficiency → shift toward QUIZ (apply)
 * Each course supplies its own curve endpoints (see `EmphasisConfig` +
 * `flashcardShare`). Mastery SCORING is unchanged; only the serving MIX is driven
 * by emphasis. This replaces the old hardcoded magic numbers (math 3 warm-up
 * cards / streak-3 vs MCAT 3 warm-up cards / streak-4).
 */

export type LearningForm = "lesson" | "flashcard" | "quiz" | "practice";

// ─── Generation models (model-per-TASK, not per-course) ──────────────────────────
//
// The generation TASK drives the model, centralized here in the registry layer so
// model choices live in one place.
//
// COST FIX (2026-06-24): ALL generation runs on gpt-5.4-mini. No task uses gpt-5.5
// for now (questions, MCAT lessons, flashcards, everything). Flip a single entry
// back to "gpt-5.5" here if a specific task needs the larger model again.
//
// These are referenced by the per-course generators (e.g. mcatGenerator.ts) which
// keep their own named constants (GEN_MODEL / QUESTION_MODEL / LESSON_MODEL) pointing
// here, mirroring the existing QUESTION_MODEL pattern.
export const GEN_MODELS: {
  default: string;
  question: string;
  mcatLesson: string;
  mathLesson: string;
  flashcard: string;
} = {
  default: "gpt-5.4-mini",
  // QUESTION MODEL TOGGLE — set QUESTION_MODEL=gemini-2.5-flash in apps/student/.env.local
  // to route question generation to Gemini Flash. See docs/gemini-flash-question-eval.md.
  question: process.env.QUESTION_MODEL ?? "gpt-5.4-mini",
  // Lessons run on gpt-5.4-mini (same model as questions) for now — flip a single
  // entry back to "gpt-5.5" here if lesson quality needs the larger model again.
  mcatLesson: "gpt-5.4-mini",
  mathLesson: "gpt-5.4-mini",
  flashcard: "gpt-5.4-mini",
};

/** Which course family a config belongs to — groups courses for nav/switching only. */
export type CourseFamily = "math" | "mcat";

export interface EmphasisConfig {
  /**
   * Flashcard share of the serving mix at the LOW-proficiency endpoint (proficiency = 0).
   * 0..1. e.g. math ~0.10 (quiz-dominant even early), mcat ~0.92 (almost only flashcards).
   */
  lowProficiencyShare: number;
  /**
   * Flashcard share at/above the PROFICIENT endpoint.
   * e.g. math ~0.10 (flat), mcat ~0.20 (80% quiz / 20% flashcards once proficient).
   */
  highProficiencyShare: number;
  /**
   * Proficiency (0..1 mastery on the current material) at which the curve reaches
   * `highProficiencyShare`. Below it, share interpolates from low→high.
   */
  proficientAt: number;
  /** Max warm-up flashcards a topic intro can show (the budget the share scales). */
  flashcardBudget: number;
  /** Floor on warm-up flashcards (keeps a small presence; math = 1, mcat can be 1). */
  minFlashcards: number;
  /** Consecutive-correct to master a subtopic (math 3, mcat 4). Scoring stays unchanged. */
  masteryStreak: number;
  /** Spiral-review interleave probability (~0.35 both). */
  reviewProbability: number;
  /** Flashcard SRS depth — described for the engine; per-course default. */
  srsModel: "leitner" | "simple";
}

export interface CourseConfig {
  id: string; // registry key: "precalc" | "calc_ab" | "mcat_bio" | <new>
  label: string;
  family: CourseFamily;
  /** The `system` value the already-unified libs (enrichment, refresher, bestKeyword) take. */
  system: "math" | "mcat";
  /** Per-course table prefix — DB stays separate (constraint #3). */
  tablePrefix: "math" | "mcat";
  /** Emphasis curve — THE per-course "what matters more" knob. */
  emphasis: EmphasisConfig;
  /** Presentation flags. */
  ui: {
    showYieldBadges: boolean;
    onboardingModal: boolean;
    sampleQuestion: boolean;
  };
}

// ─── The registry ──────────────────────────────────────────────────────────────
//
// math family: quiz-dominant throughout (~90% quiz / 10% flashcards across the
//   board — a small flashcard presence; quiz is the focus even early).
// mcat family: flashcard-dominant until proficient (essentially only flashcards at
//   low proficiency), then ~80% quiz / 20% flashcards once proficient.

const MATH_EMPHASIS: EmphasisConfig = {
  lowProficiencyShare: 0.1,
  highProficiencyShare: 0.1, // flat — quiz-dominant at every proficiency
  proficientAt: 0.6,
  flashcardBudget: 3,
  minFlashcards: 1,
  masteryStreak: 3,
  reviewProbability: 0.35,
  srsModel: "simple",
};

const MCAT_EMPHASIS: EmphasisConfig = {
  lowProficiencyShare: 0.92, // almost only flashcards while unproficient
  highProficiencyShare: 0.2, // ~80% quiz / 20% flashcards once proficient
  proficientAt: 0.6,
  flashcardBudget: 12,
  minFlashcards: 1,
  masteryStreak: 4,
  reviewProbability: 0.35,
  srsModel: "leitner",
};

export const COURSE_REGISTRY: Record<string, CourseConfig> = {
  precalc: {
    id: "precalc",
    label: "AP Precalculus",
    family: "math",
    system: "math",
    tablePrefix: "math",
    emphasis: MATH_EMPHASIS,
    ui: { showYieldBadges: true, onboardingModal: false, sampleQuestion: true },
  },
  calc_ab: {
    id: "calc_ab",
    label: "AP Calculus AB",
    family: "math",
    system: "math",
    tablePrefix: "math",
    emphasis: MATH_EMPHASIS,
    ui: { showYieldBadges: false, onboardingModal: false, sampleQuestion: true },
  },
  mcat_bio: {
    id: "mcat_bio",
    label: "MCAT Biology",
    family: "mcat",
    system: "mcat",
    tablePrefix: "mcat",
    emphasis: MCAT_EMPHASIS,
    ui: { showYieldBadges: true, onboardingModal: true, sampleQuestion: false },
  },
};

/** Resolve a CourseConfig from a course id; falls back to math-like for unknowns. */
export function courseConfig(courseId: string): CourseConfig {
  return COURSE_REGISTRY[courseId] ?? COURSE_REGISTRY.precalc;
}

/** Resolve a course id from a family + (math) route param. mcat is single-course. */
export function courseIdForFamily(family: CourseFamily, mathCourse?: string): string {
  if (family === "mcat") return "mcat_bio";
  return mathCourse && COURSE_REGISTRY[mathCourse] ? mathCourse : "precalc";
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ─── Emphasis curve (the headline) ──────────────────────────────────────────────

/**
 * Flashcard SHARE of the serving mix at a given proficiency (0..1 mastery on the
 * current material). Linearly interpolates lowProficiencyShare → highProficiencyShare
 * up to `proficientAt`, then stays flat at highProficiencyShare.
 *
 *   math:  flat ~0.10 (quiz-dominant at every proficiency)
 *   mcat:  ~0.92 at p=0 → ~0.20 at p>=0.6 (flashcards first, then apply)
 */
export function flashcardShare(courseId: string, proficiency: number): number {
  const e = courseConfig(courseId).emphasis;
  const p = clamp01(proficiency);
  const t = e.proficientAt <= 0 ? 1 : Math.min(1, p / e.proficientAt);
  return e.lowProficiencyShare + (e.highProficiencyShare - e.lowProficiencyShare) * t;
}

/**
 * How many warm-up FLASHCARDS to show before a topic's practice, given the
 * student's current proficiency. Derived from `flashcardShare` × the course's
 * flashcard budget, clamped to [minFlashcards, flashcardBudget].
 *
 * This is what replaces the old hardcoded TOPIC_FLASHCARD_COUNT (math = 3) and
 * MAX_WARMUP_FLASHCARDS (mcat = 3): the count is now proficiency-gated per course.
 *   math:  always ~1 (small, flat presence)
 *   mcat:  ~11 when unproficient → ~2 once proficient
 */
export function warmupFlashcardCount(courseId: string, proficiency: number): number {
  const e = courseConfig(courseId).emphasis;
  const share = flashcardShare(courseId, proficiency);
  const raw = Math.round(share * e.flashcardBudget);
  return Math.max(e.minFlashcards, Math.min(e.flashcardBudget, raw));
}

/**
 * FLASHCARDS-FIRST intro deck size. A brand-new subtopic must show its COMPLETE
 * flashcard deck before ANY practice question, so the auto/learn intro requests
 * the full deck instead of the small emphasis-budgeted warm-up. The
 * /api/{math,mcat}/flashcards routes cap a complete per-keyword deck at 30, so
 * requesting 30 returns every card the subtopic has.
 */
export const FULL_INTRO_DECK_COUNT = 30;

/** Consecutive-correct streak to master a subtopic for this course. */
export function masteryStreakFor(courseId: string): number {
  return courseConfig(courseId).emphasis.masteryStreak;
}

/** Spiral-review interleave probability for this course. */
export function reviewProbabilityFor(courseId: string): number {
  return courseConfig(courseId).emphasis.reviewProbability;
}
