-- Adds IRT-calibrated difficulty to rag_examples.
--
-- WHY: the /demo diagnostic serves problems exclusively from rag_examples and
-- calibrates each problem's difficulty after every attempt
-- (apps/student/app/api/demo/attempt/route.ts) by writing rag_examples.estimated_difficulty.
-- That column was referenced throughout the code (demo/attempt, record-attempt mirror,
-- demo/problems read path) but was NEVER created — so every calibration UPDATE failed
-- silently and the value never changed in the DB. This adds the missing column.
--
-- The problems table already has estimated_difficulty (migration
-- 20260413000002_dynamic_difficulty.sql); this brings rag_examples to parity.

ALTER TABLE rag_examples
  ADD COLUMN IF NOT EXISTS estimated_difficulty real;

-- Seed from the static `difficulty` using the same mapping the app uses
-- (normalizeDifficulty: raw 1..5 -> 0.2..0.8) so convergence starts from a sensible
-- point and the read path has a value immediately. Calibration nudges it from here.
UPDATE rag_examples
SET estimated_difficulty = 0.2 + ((LEAST(5, GREATEST(1, difficulty)) - 1) / 4.0) * 0.6
WHERE estimated_difficulty IS NULL
  AND difficulty IS NOT NULL;
