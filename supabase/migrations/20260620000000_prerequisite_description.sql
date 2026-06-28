-- Prerequisite description — the 7th grounding dimension for math_questions +
-- mcat_questions. Completes the four-dimension model (problem / wrong-answer /
-- action / representation) with the PREREQUISITE knowledge a question assumes,
-- in simple general terms (e.g. "factoring a difference of squares, basic
-- limits, hole discontinuities"). Generated, embedded, and tagged to the
-- course's general (content) topic keywords — same pool as problem/wrong-answer.
--
-- Mirrors the column style of 20260618000001_four_dimension_descriptions.sql:
-- text description + jsonb embedding (1536-d text-embedding-3-small vectors are
-- stored as jsonb arrays, matching problem_description_embedding et al.).
-- Additive + idempotent (IF NOT EXISTS).

ALTER TABLE math_questions
  ADD COLUMN IF NOT EXISTS prerequisite_description text,
  ADD COLUMN IF NOT EXISTS prerequisite_description_embedding jsonb;

ALTER TABLE mcat_questions
  ADD COLUMN IF NOT EXISTS prerequisite_description text,
  ADD COLUMN IF NOT EXISTS prerequisite_description_embedding jsonb;
