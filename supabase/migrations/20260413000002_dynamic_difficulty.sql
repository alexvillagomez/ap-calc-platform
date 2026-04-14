-- Add dynamic difficulty calibration columns to problems.
-- estimated_difficulty is NULL until the first student attempt (falls back to static difficulty).
ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS attempt_count        INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_count        INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_difficulty NUMERIC(4,2);
