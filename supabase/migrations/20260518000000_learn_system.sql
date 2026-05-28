-- Adaptive learn system tables
-- Covers: keyword taxonomy, AI-generated content, student state tracking

-- ─── Keyword taxonomy ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learn_keywords (
  id           TEXT        PRIMARY KEY,
  topic_id     TEXT        NOT NULL,
  label        TEXT        NOT NULL,
  description  TEXT,
  tier         TEXT        CHECK (tier IN ('umbrella', 'in_depth')),
  order_index  INTEGER     DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── AI-generated content (generated once, stored permanently) ───────────────

CREATE TABLE IF NOT EXISTS learn_lessons (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id   TEXT        NOT NULL REFERENCES learn_keywords(id) ON DELETE CASCADE,
  micro_steps  JSONB       NOT NULL,
  model        TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(keyword_id)
);

CREATE TABLE IF NOT EXISTS learn_refreshers (
  id             UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id     TEXT  NOT NULL REFERENCES learn_keywords(id) ON DELETE CASCADE,
  rule_latex     TEXT  NOT NULL,
  example_latex  TEXT  NOT NULL,
  check_question JSONB NOT NULL,
  model          TEXT,
  generated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(keyword_id)
);

CREATE TABLE IF NOT EXISTS learn_tips (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id   TEXT  NOT NULL REFERENCES learn_keywords(id) ON DELETE CASCADE,
  tip_latex    TEXT  NOT NULL,
  model        TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(keyword_id)
);

CREATE TABLE IF NOT EXISTS learn_diagnostic_problems (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id          TEXT    NOT NULL,
  latex_content     TEXT    NOT NULL,
  choices           JSONB   NOT NULL,
  correct_index     INTEGER NOT NULL,
  difficulty        INTEGER CHECK (difficulty BETWEEN 1 AND 5),
  umbrella_keywords JSONB   NOT NULL DEFAULT '{}',
  in_depth_keywords JSONB   NOT NULL DEFAULT '{}',
  diagnostic_purpose TEXT,
  order_index       INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learn_practice_problems (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id    TEXT    NOT NULL,
  topic_id      TEXT    NOT NULL,
  latex_content TEXT    NOT NULL,
  solution_latex TEXT   NOT NULL,
  choices       JSONB   NOT NULL,
  correct_index INTEGER NOT NULL,
  difficulty    INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  hint_latex    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learn_mastery_quiz_problems (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id     TEXT    NOT NULL,
  latex_content  TEXT    NOT NULL,
  choices        JSONB   NOT NULL,
  correct_index  INTEGER NOT NULL,
  difficulty     INTEGER DEFAULT 3,
  solution_latex TEXT    NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Per-student state ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS learn_student_keyword_states (
  id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID    NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
  keyword_id           TEXT    NOT NULL,
  topic_id             TEXT    NOT NULL,
  state                TEXT    NOT NULL DEFAULT 'unknown'
                               CHECK (state IN ('unknown','needs_lesson','needs_refresher','needs_practice','in_progress','mastered')),
  umbrella_score       NUMERIC(4,3) DEFAULT 0.5,
  in_depth_score       NUMERIC(4,3) DEFAULT 0.5,
  confidence           NUMERIC(4,3) DEFAULT 0.0,
  consecutive_correct  INTEGER DEFAULT 0,
  total_attempts       INTEGER DEFAULT 0,
  correct_attempts     INTEGER DEFAULT 0,
  clicked_never_seen   BOOLEAN DEFAULT FALSE,
  clicked_forgot       BOOLEAN DEFAULT FALSE,
  spaced_review_due_at TIMESTAMPTZ,
  last_practiced_at    TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, keyword_id)
);

CREATE TABLE IF NOT EXISTS learn_student_lesson_progress (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID    NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
  keyword_id   TEXT    NOT NULL,
  current_step INTEGER DEFAULT 0,
  completed    BOOLEAN DEFAULT FALSE,
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(session_id, keyword_id)
);

CREATE TABLE IF NOT EXISTS learn_mastery_quiz_results (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID    NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
  keyword_id   TEXT    NOT NULL,
  score        NUMERIC(4,3),
  passed       BOOLEAN,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learn_tip_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
  keyword_id TEXT NOT NULL,
  action     TEXT CHECK (action IN ('dismissed','opened_lesson','opened_refresher')),
  shown_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_learn_keywords_topic ON learn_keywords(topic_id);
CREATE INDEX IF NOT EXISTS idx_learn_practice_keyword ON learn_practice_problems(keyword_id, difficulty);
CREATE INDEX IF NOT EXISTS idx_learn_mastery_quiz_keyword ON learn_mastery_quiz_problems(keyword_id);
CREATE INDEX IF NOT EXISTS idx_learn_diagnostic_topic ON learn_diagnostic_problems(topic_id, order_index);
CREATE INDEX IF NOT EXISTS idx_learn_student_states_session ON learn_student_keyword_states(session_id);
CREATE INDEX IF NOT EXISTS idx_learn_student_states_kw ON learn_student_keyword_states(keyword_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE learn_keywords               ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_lessons                ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_refreshers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_tips                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_diagnostic_problems    ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_practice_problems      ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_mastery_quiz_problems  ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_student_keyword_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_student_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_mastery_quiz_results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_tip_events             ENABLE ROW LEVEL SECURITY;

-- Service role: full access to all
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'learn_keywords','learn_lessons','learn_refreshers','learn_tips',
    'learn_diagnostic_problems','learn_practice_problems','learn_mastery_quiz_problems',
    'learn_student_keyword_states','learn_student_lesson_progress',
    'learn_mastery_quiz_results','learn_tip_events'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY "service_role_all_%s" ON %s FOR ALL TO service_role USING (true) WITH CHECK (true)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- Anonymous read on content tables
CREATE POLICY "anon_read_learn_keywords"            ON learn_keywords            FOR SELECT USING (true);
CREATE POLICY "anon_read_learn_lessons"             ON learn_lessons             FOR SELECT USING (true);
CREATE POLICY "anon_read_learn_refreshers"          ON learn_refreshers          FOR SELECT USING (true);
CREATE POLICY "anon_read_learn_tips"                ON learn_tips                FOR SELECT USING (true);
CREATE POLICY "anon_read_learn_diagnostic_problems" ON learn_diagnostic_problems FOR SELECT USING (true);
CREATE POLICY "anon_read_learn_practice_problems"   ON learn_practice_problems   FOR SELECT USING (true);
CREATE POLICY "anon_read_learn_mastery_quiz"        ON learn_mastery_quiz_problems FOR SELECT USING (true);
