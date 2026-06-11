-- MCAT v2 schema extensions.
-- All statements are idempotent (IF NOT EXISTS / separate ADD COLUMN statements).

-- ─── mcat_keywords: embedding column ──────────────────────────────────────────
ALTER TABLE mcat_keywords ADD COLUMN IF NOT EXISTS embedding JSONB;

-- ─── mcat_questions: embedding + feedback columns ──────────────────────────────
ALTER TABLE mcat_questions ADD COLUMN IF NOT EXISTS embedding JSONB;
ALTER TABLE mcat_questions ADD COLUMN IF NOT EXISTS avg_rating REAL;
ALTER TABLE mcat_questions ADD COLUMN IF NOT EXISTS rating_count INT NOT NULL DEFAULT 0;
ALTER TABLE mcat_questions ADD COLUMN IF NOT EXISTS flag_count INT NOT NULL DEFAULT 0;

-- ─── mcat_flashcards: feedback columns ────────────────────────────────────────
ALTER TABLE mcat_flashcards ADD COLUMN IF NOT EXISTS avg_rating REAL;
ALTER TABLE mcat_flashcards ADD COLUMN IF NOT EXISTS rating_count INT NOT NULL DEFAULT 0;
ALTER TABLE mcat_flashcards ADD COLUMN IF NOT EXISTS flag_count INT NOT NULL DEFAULT 0;

-- ─── mcat_student_keyword_states: spaced repetition columns ───────────────────
ALTER TABLE mcat_student_keyword_states ADD COLUMN IF NOT EXISTS spaced_review_due_at TIMESTAMPTZ;
ALTER TABLE mcat_student_keyword_states ADD COLUMN IF NOT EXISTS spaced_review_count INT NOT NULL DEFAULT 0;

-- ─── mcat_lessons ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcat_lessons (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id     TEXT        NOT NULL UNIQUE REFERENCES mcat_keywords(id) ON DELETE CASCADE,
  micro_steps    JSONB       NOT NULL,
  model          TEXT,
  generated_at   TIMESTAMPTZ DEFAULT NOW(),
  avg_rating     REAL,
  rating_count   INT         NOT NULL DEFAULT 0,
  flag_count     INT         NOT NULL DEFAULT 0
);

-- ─── mcat_content_feedback ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcat_content_feedback (
  id           BIGSERIAL   PRIMARY KEY,
  session_id   UUID        NOT NULL REFERENCES student_sessions(id),
  content_type TEXT        NOT NULL CHECK (content_type IN ('question', 'flashcard', 'lesson')),
  content_id   TEXT        NOT NULL,
  rating       INT         CHECK (rating BETWEEN 1 AND 5),
  flagged      BOOLEAN     NOT NULL DEFAULT FALSE,
  flag_reason  TEXT,
  comment      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcat_feedback_content ON mcat_content_feedback(content_type, content_id);
