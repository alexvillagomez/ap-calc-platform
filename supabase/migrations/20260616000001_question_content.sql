-- Question content fields: natural-language description + its embedding +
-- per-distractor wrong-answer explanations, for BOTH math_questions and
-- mcat_questions.
--
-- MANUAL APPLICATION REQUIRED: apply this migration by hand in the Supabase SQL
-- editor. The live DB is a small Nano instance; do NOT run it automatically.
--
-- WHY:
--   description            — a concise natural-language description of what the
--                            problem asks/tests. Improves retrieval and lets
--                            keyword pinpointing match against intent (not just
--                            the raw LaTeX/biology stem).
--   description_embedding  — 1536-d (text-embedding-3-small) embedding of
--                            `description`, JSONB to match the existing
--                            `embedding` column convention on these tables.
--   wrong_answer_explanations — JSONB array aligned to `choices`: for each
--                            NON-correct choice, a short rationale of why it is
--                            wrong / the underlying misconception. The correct
--                            choice's slot may be null or a brief "correct
--                            because…".
--
-- The content backfill (scripts/backfill-question-content.ts) writes these.
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS — safe to re-run.

-- ─── math_questions ───────────────────────────────────────────────────────────
alter table math_questions
  add column if not exists description text;

alter table math_questions
  add column if not exists description_embedding jsonb;

alter table math_questions
  add column if not exists wrong_answer_explanations jsonb;

-- ─── mcat_questions ───────────────────────────────────────────────────────────
alter table mcat_questions
  add column if not exists description text;

alter table mcat_questions
  add column if not exists description_embedding jsonb;

alter table mcat_questions
  add column if not exists wrong_answer_explanations jsonb;
