-- Track how many times a problem has been flagged/reported by students.
ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS flag_count INTEGER NOT NULL DEFAULT 0;

-- Track whether a student flagged a specific problem during their attempt.
ALTER TABLE student_problem_attempts
  ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false;

-- Atomic flag_count increment to avoid race conditions.
CREATE OR REPLACE FUNCTION increment_flag_count(problem_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE problems SET flag_count = flag_count + 1 WHERE id = problem_id;
$$;
