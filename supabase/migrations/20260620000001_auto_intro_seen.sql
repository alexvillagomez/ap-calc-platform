-- Server-authoritative "intro seen" flag for auto-mode guided path.
--
-- Bug: auto-mode intro/lesson-seen state lived ONLY in the browser
-- (localStorage keys `lodera_auto_intro_mcat` / `lodera_auto_intro_<course>`),
-- so a brand-new account opened in a browser that had prior progress inherited
-- that stale state and looked like a returning student (skipped lessons,
-- "Continue" instead of "Start"). Auto-mode position/progress must be keyed
-- per USER (session) in Supabase, never per browser.
--
-- This flag records, per (session_id, keyword_id), that the student has already
-- completed the LESSON → FLASHCARDS intro for that subtopic, so it is not
-- re-shown. A new account has no rows ⇒ intro_seen defaults false ⇒ lessons show
-- and the path starts fresh. Additive + idempotent.

ALTER TABLE mcat_student_keyword_states
  ADD COLUMN IF NOT EXISTS intro_seen boolean NOT NULL DEFAULT false;

ALTER TABLE math_student_keyword_states
  ADD COLUMN IF NOT EXISTS intro_seen boolean NOT NULL DEFAULT false;
