-- ════════════════════════════════════════════════════════════════════════════
-- MCAT IRT / Elo mastery model — schema additions
-- Spec: docs/mcat-irt-mastery-and-import.md  ·  Model: lib/courseEngine/mcatIrt.ts
-- MCAT ONLY. Does not touch math/learn tables. Apply by hand in the SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Flashcards get a difficulty `b` ──────────────────────────────────────
-- Recognition/recall is genuinely easy, so flashcards seed LOW on the shared
-- difficulty scale (FLASHCARD_BASE_B = 0.15 in mcatIrt.ts). Questions already
-- carry `mcat_questions.difficulty` (reused as `b`) — no change needed there.
ALTER TABLE public.mcat_flashcards
  ADD COLUMN IF NOT EXISTS difficulty real NOT NULL DEFAULT 0.15;

COMMENT ON COLUMN public.mcat_flashcards.difficulty IS
  'IRT item difficulty b on the 0-1 ability scale. Seeded low (~0.15); Elo-calibrated by attempts. See mcatIrt.ts.';

-- ── 2. Per-keyword ability evidence (the uncertainty / step-size driver) ─────
-- The IRT step size shrinks as evidence accumulates: stepSize(attempts) =
-- max(K_MIN, K_START / (1 + K_DECAY_PER_ATTEMPT * attempts)). Evidence accrues
-- by keyword_weight per attempt, so it is FRACTIONAL (real, not the integer
-- `total_attempts` which stays for honest telemetry).
--
-- DEFAULT 0 is deliberate: every existing row instantly reads as a HIGH-
-- uncertainty prior (max step size) and re-converges within a few attempts —
-- this is the spec's "soft reinterpret existing score as ability, no backfill".
--
-- `score` (ability θ), `floor`, and `last_review_at` already exist and are
-- reused as-is (ability, decay floor, decay clock).
ALTER TABLE public.mcat_student_keyword_states
  ADD COLUMN IF NOT EXISTS ability_attempts real NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.mcat_student_keyword_states.ability_attempts IS
  'Weighted evidence count driving the IRT step size (uncertainty). 0 = max uncertainty/step. Fractional; accrues by keyword_weight. See mcatIrt.ts stepSize().';

COMMENT ON COLUMN public.mcat_student_keyword_states.score IS
  'IRT latent ability θ (0-1). Reported mastery b* = difficulty at 80% success = reportedMastery(score). No terminal "mastered" — compared against a moving benchmark.';

-- ── 3. Progress-import audit (NO card content is ever stored) ────────────────
-- One row per Anki/manual import. Records only counts + section, never any
-- flashcard text or images. Used for "you imported N cards" UX + debugging.
CREATE TABLE IF NOT EXISTS public.mcat_progress_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL,                       -- the student (= uid)
  section         text NOT NULL DEFAULT 'biology',     -- biology | psych_soc | chemistry | physics
  source          text NOT NULL,                       -- 'anki' | 'manual'
  cards_parsed    integer NOT NULL DEFAULT 0,
  cards_matched   integer NOT NULL DEFAULT 0,
  cards_dropped   integer NOT NULL DEFAULT 0,          -- low-text/image cards we couldn't match
  keywords_seeded integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcat_progress_imports_session_idx
  ON public.mcat_progress_imports (session_id, created_at DESC);

-- API routes use the service-role key (bypasses RLS), matching the other mcat_*
-- tables. Enable RLS with no public policy so nothing is reachable with the anon
-- key directly.
ALTER TABLE public.mcat_progress_imports ENABLE ROW LEVEL SECURITY;
