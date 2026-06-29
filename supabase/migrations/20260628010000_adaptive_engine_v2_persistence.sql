-- ============================================================================
-- Migration: 20260628010000_adaptive_engine_v2_persistence
-- Date: 2026-06-28
-- Branch: features-v2
-- Purpose: Additive schema for adaptive engine v2 spaced-repetition persistence.
--
-- Changes (ADDITIVE ONLY — no DROP, no PK changes, no data loss):
--   1. Add last_review_at + floor to *_student_keyword_states (math + mcat)
--   2. Add user_id (account-scoped) + last_shown_at to *_flashcard_srs (math + mcat)
--   3. Add indexes for account-keyed SRS queries
--   4. Backfill all new columns with safe defaults
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1a. math_student_keyword_states: add last_review_at + floor
-- ----------------------------------------------------------------------------
ALTER TABLE math_student_keyword_states
  ADD COLUMN IF NOT EXISTS last_review_at  timestamptz,
  ADD COLUMN IF NOT EXISTS floor           real DEFAULT 0.40;

-- Backfill: last_review_at = COALESCE(updated_at, now()), floor = 0.40
UPDATE math_student_keyword_states
SET
  last_review_at = COALESCE(updated_at, now()),
  floor          = 0.40
WHERE last_review_at IS NULL;

-- ----------------------------------------------------------------------------
-- 1b. mcat_student_keyword_states: add last_review_at + floor
-- ----------------------------------------------------------------------------
ALTER TABLE mcat_student_keyword_states
  ADD COLUMN IF NOT EXISTS last_review_at  timestamptz,
  ADD COLUMN IF NOT EXISTS floor           real DEFAULT 0.40;

-- Backfill
UPDATE mcat_student_keyword_states
SET
  last_review_at = COALESCE(updated_at, now()),
  floor          = 0.40
WHERE last_review_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2a. math_flashcard_srs: add user_id (account key) + last_shown_at
-- ----------------------------------------------------------------------------
ALTER TABLE math_flashcard_srs
  ADD COLUMN IF NOT EXISTS user_id        uuid,
  ADD COLUMN IF NOT EXISTS last_shown_at  timestamptz;

-- Backfill user_id from student_sessions where derivable
UPDATE math_flashcard_srs srs
SET user_id = ss.user_id
FROM student_sessions ss
WHERE ss.id = srs.session_id
  AND ss.user_id IS NOT NULL
  AND srs.user_id IS NULL;

-- Backfill last_shown_at from last_reviewed_at (already exists on the table)
UPDATE math_flashcard_srs
SET last_shown_at = last_reviewed_at
WHERE last_shown_at IS NULL AND last_reviewed_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2b. mcat_flashcard_srs: add user_id (account key) + last_shown_at
-- ----------------------------------------------------------------------------
ALTER TABLE mcat_flashcard_srs
  ADD COLUMN IF NOT EXISTS user_id        uuid,
  ADD COLUMN IF NOT EXISTS last_shown_at  timestamptz;

-- Backfill user_id from student_sessions where derivable
UPDATE mcat_flashcard_srs srs
SET user_id = ss.user_id
FROM student_sessions ss
WHERE ss.id = srs.session_id
  AND ss.user_id IS NOT NULL
  AND srs.user_id IS NULL;

-- Backfill last_shown_at
UPDATE mcat_flashcard_srs
SET last_shown_at = last_reviewed_at
WHERE last_shown_at IS NULL AND last_reviewed_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Indexes for account-keyed SRS queries (used by engine v2 selection)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS math_flashcard_srs_user_cat_due_idx
  ON math_flashcard_srs (user_id, category_id, due_at)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS math_flashcard_srs_user_fc_idx
  ON math_flashcard_srs (user_id, flashcard_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mcat_flashcard_srs_user_cat_due_idx
  ON mcat_flashcard_srs (user_id, category_id, due_at)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mcat_flashcard_srs_user_fc_idx
  ON mcat_flashcard_srs (user_id, flashcard_id)
  WHERE user_id IS NOT NULL;
