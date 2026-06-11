-- MCAT Biology practice feature database schema.
-- Creates tables for categories, keywords (umbrella + in-depth), questions,
-- flashcards, attempt logs, and per-session keyword mastery state.
-- All CREATE TABLE and CREATE INDEX statements are idempotent (IF NOT EXISTS).

-- ─── Categories ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcat_categories (
  id          text        PRIMARY KEY,
  section     text        NOT NULL DEFAULT 'biology',
  label       text        NOT NULL,
  description text,
  order_index int         NOT NULL DEFAULT 0
);

-- ─── Keywords ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcat_keywords (
  id                text        PRIMARY KEY,
  category_id       text        NOT NULL REFERENCES mcat_categories(id),
  label             text        NOT NULL,
  description       text,
  tier              text        NOT NULL CHECK (tier IN ('umbrella', 'in_depth')),
  parent_keyword_id text        REFERENCES mcat_keywords(id),
  examples          jsonb,
  status            text        NOT NULL DEFAULT 'approved',
  order_index       int         NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── Questions ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcat_questions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  section            text        NOT NULL DEFAULT 'biology',
  category_id        text        NOT NULL REFERENCES mcat_categories(id),
  stem               text        NOT NULL,
  choices            jsonb       NOT NULL,
  correct_index      int         NOT NULL,
  explanation        text,
  keyword_weights    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  difficulty         real        NOT NULL DEFAULT 0.5,
  source_card_ids    uuid[],
  parent_question_id uuid        REFERENCES mcat_questions(id),
  generated_by       text,
  status             text        NOT NULL DEFAULT 'active',
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ─── Flashcards ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcat_flashcards (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  section         text        NOT NULL DEFAULT 'biology',
  category_id     text        NOT NULL REFERENCES mcat_categories(id),
  front           text        NOT NULL,
  back            text        NOT NULL,
  keyword_weights jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source_card_ids uuid[],
  generated_by    text,
  status          text        NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Question Attempts ─────────────────────────────────────────────────────────
-- session_id is UUID to match student_sessions.id (confirmed UUID PK in
-- supabase/migrations/20260413000000_student_sessions.sql)
CREATE TABLE IF NOT EXISTS mcat_question_attempts (
  id             bigserial   PRIMARY KEY,
  session_id     uuid        NOT NULL REFERENCES student_sessions(id),
  question_id    uuid        NOT NULL REFERENCES mcat_questions(id),
  selected_index int,
  correct        boolean,
  response_type  text        NOT NULL DEFAULT 'answered' CHECK (response_type IN ('answered', 'dont_know')),
  context        text        NOT NULL DEFAULT 'practice',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── Flashcard Attempts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcat_flashcard_attempts (
  id           bigserial   PRIMARY KEY,
  session_id   uuid        NOT NULL REFERENCES student_sessions(id),
  flashcard_id uuid        NOT NULL REFERENCES mcat_flashcards(id),
  result       text        NOT NULL CHECK (result IN ('got_it', 'missed_it', 'dont_know')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── Per-Session Keyword Mastery State ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcat_student_keyword_states (
  session_id          uuid        NOT NULL REFERENCES student_sessions(id),
  keyword_id          text        NOT NULL REFERENCES mcat_keywords(id),
  category_id         text        NOT NULL,
  score               real        NOT NULL DEFAULT 0.5,
  total_attempts      int         NOT NULL DEFAULT 0,
  correct_attempts    int         NOT NULL DEFAULT 0,
  consecutive_correct int         NOT NULL DEFAULT 0,
  dont_know_count     int         NOT NULL DEFAULT 0,
  state               text        NOT NULL DEFAULT 'in_progress',
  last_practiced_at   timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, keyword_id)
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mcat_questions_category_status     ON mcat_questions(category_id, status);
CREATE INDEX IF NOT EXISTS idx_mcat_question_attempts_session     ON mcat_question_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_mcat_question_attempts_question    ON mcat_question_attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_mcat_flashcard_attempts_session    ON mcat_flashcard_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_mcat_keywords_category             ON mcat_keywords(category_id);
CREATE INDEX IF NOT EXISTS idx_mcat_flashcards_category_status    ON mcat_flashcards(category_id, status);
