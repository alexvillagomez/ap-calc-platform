/**
 * Shared TypeScript types for the math system (precalc + calc_ab).
 * Mirrors the spec schema in docs/math-research/design-spec.md.
 * Routes and generation libs import from here — no circular deps.
 */

// ─── Course / category model ──────────────────────────────────────────────────

export type MathCourse = "precalc" | "calc_ab";
export type MathSection = "foundations" | "ap_precalc" | "calc_ab";
export type MathCourseRole = "core" | "foundation";
export type MathKeywordTier = "umbrella" | "in_depth";
export type MathKeywordStatus = "draft" | "approved" | "deprecated";
export type MathQuestionStatus = "active" | "flagged" | "out_of_scope";
export type MathQuestionSource = "generated" | "imported_rag" | "imported_practice";
export type MathStudentState = "in_progress" | "mastered";

// ─── Blueprint (same ConceptBlueprint interface as MCAT) ──────────────────────

/** Scope contract for a single keyword — stored in math_keywords.concept_blueprint. */
export interface ConceptBlueprint {
  /** Concepts/skills a question or lesson for THIS keyword may test. 2–6 short phrases. */
  in_scope_concepts: string[];
  /** Formulas the student is expected to USE for this keyword. Empty array for purely conceptual keywords. */
  in_scope_formulas: string[];
  /** Concepts/formulas that belong to OTHER keywords and must NOT be tested here. 2–8 phrases. */
  out_of_scope: string[];
  /** Canonical terms/symbols in play for this keyword. */
  key_terms: string[];
  /** One imperative sentence stating the hard boundary. */
  boundary_statement: string;
}

// ─── math_categories ──────────────────────────────────────────────────────────

export interface MathCategory {
  id: string;
  label: string;
  description: string;
  section: MathSection;
  ced_unit: string | null;
  yield_score: number;
  yield_rationale: string;
  order_index: number;
  embedding: number[] | null;
  status: MathKeywordStatus;
}

// ─── math_keywords ────────────────────────────────────────────────────────────

export interface MathKeyword {
  id: string;
  category_id: string;
  parent_keyword_id: string | null;
  tier: MathKeywordTier;
  label: string;
  description: string;
  ced_topics: string[] | null;
  yield_score: number;
  yield_rationale: string;
  concept_blueprint: ConceptBlueprint | null;
  source_learn_keyword_id: string | null;
  examples: unknown[] | null;
  status: MathKeywordStatus;
  order_index: number;
  embedding: number[] | null;
}

// ─── math_questions ───────────────────────────────────────────────────────────

export interface MathQuestion {
  id: string;
  category_id: string;
  stem_latex: string;
  choices: [string, string, string, string];
  correct_index: number;
  solution_latex: string;  // full worked solution in KaTeX
  hint_latex: string;
  keyword_weights: Record<string, number>;
  difficulty: number;  // 0.2–0.9 continuous
  parent_question_id: string | null;
  source: MathQuestionSource;
  source_id: string | null;
  embedding: number[] | null;
  avg_rating: number | null;
  rating_count: number;
  flag_count: number;
  status: MathQuestionStatus;
}

// ─── math_flashcards ──────────────────────────────────────────────────────────

export interface MathFlashcard {
  id: string;
  keyword_id: string;
  front_latex: string;
  back_latex: string;
  keyword_weights: Record<string, number>;
  status: MathKeywordStatus;
}

// ─── math_lessons ─────────────────────────────────────────────────────────────

export interface MathLessonCheckQuestion {
  latex_content: string;
  choices: [string, string, string, string];
  correct_index: number;
  solution_latex: string;
}

export interface MathMicroStep {
  step_index: number;
  has_check: true;
  explanation_latex: string;
  example_latex: string;
  check_question: MathLessonCheckQuestion;
  hint_latex: string;
}

export interface MathLesson {
  id: string;
  keyword_id: string;
  micro_steps: MathMicroStep[];
  model: string;
  avg_rating: number | null;
  rating_count: number;
  flag_count: number;
}

// ─── Generated types (returned by generator, before DB insert) ────────────────

export interface GeneratedMathQuestion {
  stem_latex: string;
  choices: [string, string, string, string];
  correct_index: number;
  solution_latex: string;
  hint_latex: string;
  keyword_weights: Record<string, number>;
  difficulty: number;
}

export interface GeneratedMathFlashcard {
  front_latex: string;
  back_latex: string;
  keyword_weights: Record<string, number>;
}

export interface GeneratedMathLesson {
  micro_steps: MathMicroStep[];
}

// ─── Verification results ─────────────────────────────────────────────────────

export interface FastVerifyResult {
  /** Verifier's independent answer matches correct_index. */
  agrees: boolean;
  predicted_index: number | null;
  /** false if the verifier call errored/timed out — fail-open: treat as agrees. */
  ok: boolean;
}

export interface FastFlashcardVerifyResult {
  /** true when the verifier confirms BACK correctly answers FRONT. */
  valid: boolean;
  /** false if the verifier call errored/timed out — fail-open: treat as valid. */
  ok: boolean;
}

// ─── math_student_keyword_states ──────────────────────────────────────────────

export interface MathStudentKeywordState {
  session_id: string;
  keyword_id: string;
  score: number;
  total_attempts: number;
  correct_attempts: number;
  consecutive_correct: number;
  dont_know_count: number;
  state: MathStudentState;
  spaced_review_due_at: string | null;
  spaced_review_count: number;
  course: MathCourse;
}

// ─── Keyword metadata for generator calls ─────────────────────────────────────

export type MathKeywordMeta = {
  id: string;
  label: string;
  description: string;
  blueprint?: ConceptBlueprint | null;
};

// ─── Blueprint generation result ──────────────────────────────────────────────

export interface BlueprintResult {
  blueprint: ConceptBlueprint;
  yield_score: number;       // 0.00–1.00 (two decimal places)
  yield_rationale: string;
}
