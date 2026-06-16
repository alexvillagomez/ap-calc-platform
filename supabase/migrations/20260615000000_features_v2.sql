-- ─────────────────────────────────────────────────────────────────────────────
-- 20260615000000_features_v2.sql
-- Additive-only. Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS everywhere).
-- Foundation layer for feature sprint v2.
-- Adds:
--   student_events           — generic client telemetry
--   student_topic_priorities — per-session "prioritize this topic" rows
--   math_questions / mcat_questions — est-time-per-question rollup columns
--   app_users                — profile columns (name, grade, target exam date)
--   math_refreshers / mcat_refreshers — refresher cache (mirrors learn_refreshers)
-- NOTE: applied MANUALLY in the Supabase SQL editor (no exec_sql RPC).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. student_events ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID,
  session_id   TEXT,
  system       TEXT,                       -- 'math' | 'mcat' | 'precalc'
  course       TEXT,
  event_type   TEXT        NOT NULL,       -- 'answer','timer_stop','refresher_used',...
  keyword_id   TEXT,
  question_id  TEXT,
  content_type TEXT,                       -- 'question' | 'flashcard' | 'lesson' | 'quiz'
  correct      BOOLEAN,
  time_ms      INTEGER,
  metadata     JSONB       DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE student_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'student_events' AND policyname = 'se_anon_all'
  ) THEN
    CREATE POLICY "se_anon_all" ON student_events FOR ALL TO anon          USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'student_events' AND policyname = 'se_auth_all'
  ) THEN
    CREATE POLICY "se_auth_all" ON student_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_student_events_user_id     ON student_events(user_id);
CREATE INDEX IF NOT EXISTS idx_student_events_session_id  ON student_events(session_id);
CREATE INDEX IF NOT EXISTS idx_student_events_event_type  ON student_events(event_type);
CREATE INDEX IF NOT EXISTS idx_student_events_question_id ON student_events(question_id);
CREATE INDEX IF NOT EXISTS idx_student_events_created_at  ON student_events(created_at);

-- ── 2. student_topic_priorities ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_topic_priorities (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     TEXT        NOT NULL,
  user_id        UUID,
  system         TEXT        NOT NULL,     -- 'math' | 'mcat'
  course         TEXT,
  keyword_id     TEXT        NOT NULL,
  baseline_score REAL,
  target_score   REAL,
  active         BOOLEAN     DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

ALTER TABLE student_topic_priorities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'student_topic_priorities' AND policyname = 'stp_anon_all'
  ) THEN
    CREATE POLICY "stp_anon_all" ON student_topic_priorities FOR ALL TO anon          USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'student_topic_priorities' AND policyname = 'stp_auth_all'
  ) THEN
    CREATE POLICY "stp_auth_all" ON student_topic_priorities FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stp_active
  ON student_topic_priorities(session_id, system, keyword_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_stp_session_active
  ON student_topic_priorities(session_id, active);

-- ── 3. est-time rollup columns on question tables ────────────────────────────
ALTER TABLE math_questions
  ADD COLUMN IF NOT EXISTS time_sample_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_sum_ms       BIGINT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS est_time_ms       INTEGER;

ALTER TABLE mcat_questions
  ADD COLUMN IF NOT EXISTS time_sample_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_sum_ms       BIGINT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS est_time_ms       INTEGER;

-- ── 4. app_users profile columns ─────────────────────────────────────────────
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS first_name       TEXT,
  ADD COLUMN IF NOT EXISTS last_name        TEXT,
  ADD COLUMN IF NOT EXISTS display_name     TEXT,
  ADD COLUMN IF NOT EXISTS grade_level      TEXT,
  ADD COLUMN IF NOT EXISTS target_exam_date DATE,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT now();

-- ── 5. refresher cache tables (mirror learn_refreshers) ──────────────────────
CREATE TABLE IF NOT EXISTS math_refreshers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id     TEXT        NOT NULL UNIQUE,
  rule_latex     TEXT,
  example_latex  TEXT,
  check_question JSONB,
  generated_at   TIMESTAMPTZ DEFAULT now(),
  model          TEXT
);

CREATE TABLE IF NOT EXISTS mcat_refreshers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id     TEXT        NOT NULL UNIQUE,
  rule_latex     TEXT,
  example_latex  TEXT,
  check_question JSONB,
  generated_at   TIMESTAMPTZ DEFAULT now(),
  model          TEXT
);

ALTER TABLE math_refreshers ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcat_refreshers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'math_refreshers' AND policyname = 'mr_anon_all'
  ) THEN
    CREATE POLICY "mr_anon_all" ON math_refreshers FOR ALL TO anon          USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'math_refreshers' AND policyname = 'mr_auth_all'
  ) THEN
    CREATE POLICY "mr_auth_all" ON math_refreshers FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'mcat_refreshers' AND policyname = 'cr_anon_all'
  ) THEN
    CREATE POLICY "cr_anon_all" ON mcat_refreshers FOR ALL TO anon          USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'mcat_refreshers' AND policyname = 'cr_auth_all'
  ) THEN
    CREATE POLICY "cr_auth_all" ON mcat_refreshers FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
