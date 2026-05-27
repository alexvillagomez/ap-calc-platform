-- Add embedding column to learn_practice_problems and learn_diagnostic_problems
-- Used by /api/lookup to match queries against problem content directly

ALTER TABLE learn_practice_problems
  ADD COLUMN IF NOT EXISTS embedding JSONB;

ALTER TABLE learn_diagnostic_problems
  ADD COLUMN IF NOT EXISTS embedding JSONB;
