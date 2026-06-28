-- Flashcard restructure: per-keyword decks + universal math SRS.
--
-- 1. primary_keyword_id: each flashcard belongs to exactly ONE in_depth keyword
--    deck (the keyword its generation targeted). Decks are walked in curriculum
--    order; this column makes deck ownership explicit instead of inferred from the
--    keyword_weights map. Indexed for fast per-keyword/per-category deck fetch.
-- 2. math_flashcard_srs: mirrors mcat_flashcard_srs so math flashcards get the same
--    cross-session Leitner spaced-repetition state — universal per-card SRS across
--    every study surface (auto / category-flashcards / stream / practice / quiz).

ALTER TABLE mcat_flashcards ADD COLUMN IF NOT EXISTS primary_keyword_id text;
ALTER TABLE math_flashcards ADD COLUMN IF NOT EXISTS primary_keyword_id text;

CREATE INDEX IF NOT EXISTS idx_mcat_flashcards_primary_kw
  ON mcat_flashcards (category_id, primary_keyword_id, status);
CREATE INDEX IF NOT EXISTS idx_math_flashcards_primary_kw
  ON math_flashcards (category_id, primary_keyword_id, status);

CREATE TABLE IF NOT EXISTS math_flashcard_srs (
  session_id uuid NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
  flashcard_id uuid NOT NULL REFERENCES math_flashcards(id) ON DELETE CASCADE,
  category_id text,
  box int NOT NULL DEFAULT 1,
  due_at timestamptz NOT NULL DEFAULT now(),
  reps int NOT NULL DEFAULT 0,
  lapses int NOT NULL DEFAULT 0,
  learned boolean NOT NULL DEFAULT false,
  last_result text,
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, flashcard_id)
);

CREATE INDEX IF NOT EXISTS idx_math_flashcard_srs_due
  ON math_flashcard_srs (session_id, category_id, due_at);
CREATE INDEX IF NOT EXISTS idx_math_flashcard_srs_box
  ON math_flashcard_srs (session_id, category_id, box);
