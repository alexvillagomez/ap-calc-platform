-- ────────────────────────────────────────────────────────────────────────────
-- MCAT flashcard spaced-repetition (Leitner) state
--
-- Per (session, flashcard) SRS state driving the memorization flow:
--   • box     — Leitner box 1..5. Missing a card drops it to box 1 (due now);
--               getting it right promotes it one box. Box ≥ 3 = "graduated"
--               from in-session recirculation (next review is a day+ out).
--   • due_at   — when the card is next eligible. Low boxes are due within the
--               same session so missed cards re-appear until they graduate.
--   • lapses   — count of times the card was missed after being seen.
--   • reps     — total reviews.
--   • learned  — box reached 5 (fully memorized).
--
-- There is intentionally NO hard daily cap; spaced repetition regulates volume
-- so a well-tuned session lands ~20–30 items/day organically.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcat_flashcard_srs (
  session_id       uuid        NOT NULL REFERENCES student_sessions(id),
  flashcard_id     uuid        NOT NULL REFERENCES mcat_flashcards(id),
  category_id      text        NOT NULL,
  box              int         NOT NULL DEFAULT 1 CHECK (box BETWEEN 1 AND 5),
  due_at           timestamptz NOT NULL DEFAULT now(),
  reps             int         NOT NULL DEFAULT 0,
  lapses           int         NOT NULL DEFAULT 0,
  learned          boolean     NOT NULL DEFAULT false,
  last_result      text,
  last_reviewed_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, flashcard_id)
);

-- Due-queue lookups: cards for a session/category ordered by due_at.
CREATE INDEX IF NOT EXISTS idx_mcat_flashcard_srs_due
  ON mcat_flashcard_srs(session_id, category_id, due_at);

-- Box / memorization stats for quiz gating.
CREATE INDEX IF NOT EXISTS idx_mcat_flashcard_srs_box
  ON mcat_flashcard_srs(session_id, category_id, box);
