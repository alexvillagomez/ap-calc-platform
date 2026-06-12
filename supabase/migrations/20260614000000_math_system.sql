-- Math system schema (precalc + calc_ab).
-- Mirrors mcat_* conventions: naming, index style, created_at defaults, no RLS (same as mcat_biology).
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- User-approved additive DDL for Supabase project czjyvmpvxejsrctxgqke.
-- Branch: math-system. NEVER runs on main.

-- ─── math_categories ──────────────────────────────────────────────────────────
-- One row per category (19 total: F1–F7 foundations, P1–P4 ap_precalc, C1–C8 calc_ab).
CREATE TABLE IF NOT EXISTS math_categories (
  id              text        PRIMARY KEY,
  label           text        NOT NULL,
  description     text,
  section         text        NOT NULL CHECK (section IN ('foundations', 'ap_precalc', 'calc_ab')),
  ced_unit        text,
  yield_score     real,
  yield_rationale text,
  order_index     int         NOT NULL DEFAULT 0,
  embedding       jsonb,
  status          text        NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── math_course_categories ───────────────────────────────────────────────────
-- Join table: which categories belong to which course, and in what role.
CREATE TABLE IF NOT EXISTS math_course_categories (
  course       text NOT NULL CHECK (course IN ('precalc', 'calc_ab')),
  category_id  text NOT NULL REFERENCES math_categories(id),
  role         text NOT NULL CHECK (role IN ('core', 'foundation')),
  order_index  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (course, category_id)
);

-- ─── math_keywords ────────────────────────────────────────────────────────────
-- 3-tier taxonomy: category → umbrella → in_depth.
CREATE TABLE IF NOT EXISTS math_keywords (
  id                      text        PRIMARY KEY,
  category_id             text        NOT NULL REFERENCES math_categories(id),
  parent_keyword_id       text        REFERENCES math_keywords(id),
  tier                    text        NOT NULL CHECK (tier IN ('umbrella', 'in_depth')),
  label                   text        NOT NULL,
  description             text,
  ced_topics              jsonb,
  yield_score             real,
  yield_rationale         text,
  concept_blueprint       jsonb,
  source_learn_keyword_id text,
  examples                jsonb,
  status                  text        NOT NULL DEFAULT 'approved',
  order_index             int         NOT NULL DEFAULT 0,
  embedding               jsonb,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ─── math_questions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS math_questions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id        text        NOT NULL REFERENCES math_categories(id),
  stem_latex         text        NOT NULL,
  choices            jsonb       NOT NULL,
  correct_index      int         NOT NULL,
  solution_latex     text,
  hint_latex         text,
  keyword_weights    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  difficulty         real        NOT NULL DEFAULT 0.5,
  parent_question_id uuid        REFERENCES math_questions(id),
  source             text        NOT NULL DEFAULT 'generated' CHECK (source IN ('generated', 'imported_rag', 'imported_practice')),
  source_id          text,
  embedding          jsonb,
  avg_rating         real,
  rating_count       int         NOT NULL DEFAULT 0,
  flag_count         int         NOT NULL DEFAULT 0,
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'flagged', 'out_of_scope')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ─── math_flashcards ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS math_flashcards (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     text        NOT NULL REFERENCES math_categories(id),
  front           text        NOT NULL,
  back            text        NOT NULL,
  keyword_weights jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source_card_ids uuid[],
  generated_by    text,
  avg_rating      real,
  rating_count    int         NOT NULL DEFAULT 0,
  flag_count      int         NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── math_lessons ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS math_lessons (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id   text        NOT NULL UNIQUE REFERENCES math_keywords(id) ON DELETE CASCADE,
  micro_steps  jsonb       NOT NULL,
  model        text,
  generated_at timestamptz DEFAULT now(),
  avg_rating   real,
  rating_count int         NOT NULL DEFAULT 0,
  flag_count   int         NOT NULL DEFAULT 0
);

-- ─── math_question_attempts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS math_question_attempts (
  id             bigserial   PRIMARY KEY,
  session_id     uuid        NOT NULL REFERENCES student_sessions(id),
  question_id    uuid        NOT NULL REFERENCES math_questions(id),
  selected_index int,
  correct        boolean,
  response_type  text        NOT NULL DEFAULT 'answered' CHECK (response_type IN ('answered', 'dont_know')),
  context        text        NOT NULL DEFAULT 'practice',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── math_flashcard_attempts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS math_flashcard_attempts (
  id           bigserial   PRIMARY KEY,
  session_id   uuid        NOT NULL REFERENCES student_sessions(id),
  flashcard_id uuid        NOT NULL REFERENCES math_flashcards(id),
  result       text        NOT NULL CHECK (result IN ('got_it', 'missed_it', 'dont_know')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── math_student_keyword_states ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS math_student_keyword_states (
  session_id          uuid        NOT NULL REFERENCES student_sessions(id),
  keyword_id          text        NOT NULL REFERENCES math_keywords(id),
  category_id         text        NOT NULL,
  score               real        NOT NULL DEFAULT 0.5,
  total_attempts      int         NOT NULL DEFAULT 0,
  correct_attempts    int         NOT NULL DEFAULT 0,
  consecutive_correct int         NOT NULL DEFAULT 0,
  dont_know_count     int         NOT NULL DEFAULT 0,
  state               text        NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'mastered')),
  last_practiced_at   timestamptz,
  spaced_review_due_at timestamptz,
  spaced_review_count int         NOT NULL DEFAULT 0,
  course              text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, keyword_id)
);

-- ─── math_content_feedback ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS math_content_feedback (
  id           bigserial   PRIMARY KEY,
  session_id   uuid        NOT NULL REFERENCES student_sessions(id),
  content_type text        NOT NULL CHECK (content_type IN ('question', 'flashcard', 'lesson')),
  content_id   text        NOT NULL,
  rating       int         CHECK (rating BETWEEN 1 AND 5),
  flagged      boolean     NOT NULL DEFAULT false,
  flag_reason  text,
  comment      text,
  created_at   timestamptz DEFAULT now()
);

-- ─── math_prereq_edges ────────────────────────────────────────────────────────
-- Category-level prerequisite edges driving the adaptive diagnostic.
-- Failing `from_category_id` implies a likely deficit in `to_category_id`.
CREATE TABLE IF NOT EXISTS math_prereq_edges (
  from_category_id text    NOT NULL REFERENCES math_categories(id),
  to_category_id   text    NOT NULL REFERENCES math_categories(id),
  strength         real    NOT NULL DEFAULT 0.8,
  note             text,
  PRIMARY KEY (from_category_id, to_category_id)
);

-- ─── math_diagnostic_sessions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS math_diagnostic_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid        NOT NULL REFERENCES student_sessions(id),
  course              text        NOT NULL CHECK (course IN ('precalc', 'calc_ab')),
  status              text        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  asked               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  category_estimates  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

-- ─── Additive columns on learn_keywords ───────────────────────────────────────
-- Back-fills numeric yield for the 777 precalc rows (replaces the old low/medium/high MCAT signal).
ALTER TABLE learn_keywords ADD COLUMN IF NOT EXISTS yield_score    real;
ALTER TABLE learn_keywords ADD COLUMN IF NOT EXISTS yield_rationale text;

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_math_questions_category_status       ON math_questions(category_id, status);
CREATE INDEX IF NOT EXISTS idx_math_question_attempts_session       ON math_question_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_math_question_attempts_question      ON math_question_attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_math_flashcard_attempts_session      ON math_flashcard_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_math_keywords_category               ON math_keywords(category_id);
CREATE INDEX IF NOT EXISTS idx_math_flashcards_category_status      ON math_flashcards(category_id, status);
CREATE INDEX IF NOT EXISTS idx_math_feedback_content                ON math_content_feedback(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_math_diagnostic_sessions_session     ON math_diagnostic_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_math_student_keyword_states_session  ON math_student_keyword_states(session_id);
CREATE INDEX IF NOT EXISTS idx_math_prereq_edges_to                 ON math_prereq_edges(to_category_id);
