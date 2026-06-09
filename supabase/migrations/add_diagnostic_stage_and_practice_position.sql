-- Continue-progress journey: server-side stage flag + durable practice position.
-- Run this in the Supabase SQL editor (or via your migration tooling).
--
-- 1) Diagnostic completion flag on the account. Set the first time a student
--    finishes the diagnostic; read at login to route returning users straight
--    to /demo-practice instead of restarting the diagnostic.
ALTER TABLE student_accounts
  ADD COLUMN IF NOT EXISTS diagnostic_completed_at timestamptz;

-- 2) Durable "where I left off" position inside demo-practice, stored on the
--    student's session row (1:1 with the account via student_accounts.session_id).
--    Lets a returning user resume the exact keyword / phase / lesson step / problem
--    across browsers and devices.
ALTER TABLE student_sessions
  ADD COLUMN IF NOT EXISTS practice_keyword_id  text,
  ADD COLUMN IF NOT EXISTS practice_phase       text,
  ADD COLUMN IF NOT EXISTS practice_lesson_step integer,
  ADD COLUMN IF NOT EXISTS practice_problem_id  text,
  ADD COLUMN IF NOT EXISTS practice_updated_at  timestamptz;
