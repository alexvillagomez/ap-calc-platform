/**
 * AP Calculus Unit identifiers (Unit 1 through Unit 10)
 */
export type APCalcUnit =
  | "Unit 1"
  | "Unit 2"
  | "Unit 3"
  | "Unit 4"
  | "Unit 5"
  | "Unit 6"
  | "Unit 7"
  | "Unit 8"
  | "Unit 9"
  | "Unit 10";

/**
 * Topic vector mapping topic IDs to decimal weights (e.g. {"1_10": 1.0}).
 */
export type TopicWeights = Record<string, number>;

/**
 * Problem type aligned with the problems table schema.
 */
export interface Problem {
  id?: string;
  latex_content: string;
  solution_latex: string;
  choices?: string[] | null;
  correct_index?: number | null;
  difficulty: number;
  topic_weights: TopicWeights;
  /** Sparse model weights from generation; subtopic_relevance is the full-catalog expansion for rec. */
  subtopic_relevance?: TopicWeights;
  /** Community average rating (1–5); updated when users rate. */
  avg_rating?: number | null;
  /** Number of ratings contributing to avg_rating. */
  rating_count?: number;
  /** Total student attempts used to calibrate estimated_difficulty. */
  attempt_count?: number;
  /** Number of correct student attempts. */
  success_count?: number;
  /** Dynamically calibrated difficulty via IRT-inspired EMA; null = not yet calibrated. */
  estimated_difficulty?: number | null;
  status?: "pending_review" | "approved" | "rejected";
  created_at?: string;
  /** Grading criteria (College Board style); separate from solution narrative. */
  rubric?: string | null;
  /** Question type: multiple_choice or free_response */
  type?: string | null;
}

/** Payload for inserting a new problem (omits id, created_at). */
export type ProblemInsert = Omit<Problem, "id" | "created_at"> & {
  status?: "pending_review" | "approved" | "rejected";
};
