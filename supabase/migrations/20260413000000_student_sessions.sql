-- student_sessions: anonymous practice sessions identified by a client-generated UUID.
-- No auth required — the UUID stored in localStorage is the session key.
CREATE TABLE IF NOT EXISTS student_sessions (
  id         UUID        PRIMARY KEY,
  strengths  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track every problem a student has attempted: prevents repeats and drives strength updates.
CREATE TABLE IF NOT EXISTS student_problem_attempts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID        NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
  problem_id     UUID        NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  selected_index INTEGER     NOT NULL,
  correct        BOOLEAN     NOT NULL,
  rating         INTEGER     CHECK (rating BETWEEN 1 AND 5),
  attempted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, problem_id)
);

-- Auto-bump updated_at on student_sessions
CREATE OR REPLACE FUNCTION _set_student_sessions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_sessions_updated_at ON student_sessions;
CREATE TRIGGER trg_student_sessions_updated_at
  BEFORE UPDATE ON student_sessions
  FOR EACH ROW EXECUTE FUNCTION _set_student_sessions_updated_at();

-- RLS (prototype: open anon access — tighten when adding auth)
ALTER TABLE student_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_problem_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ss_anon_all"  ON student_sessions         FOR ALL TO anon          USING (true) WITH CHECK (true);
CREATE POLICY "ss_auth_all"  ON student_sessions         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "spa_anon_all" ON student_problem_attempts FOR ALL TO anon          USING (true) WITH CHECK (true);
CREATE POLICY "spa_auth_all" ON student_problem_attempts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_spa_session ON student_problem_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_spa_problem ON student_problem_attempts(problem_id);
