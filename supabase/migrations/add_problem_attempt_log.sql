-- problem_attempt_log
-- Raw per-attempt event log for future model training.
-- Every attempt route writes here fire-and-forget — this table is append-only
-- and never read by the application. Its purpose is to accumulate the ground-truth
-- data needed to learn a personalized time constant (τ) per student and problem type,
-- correlate platform/timing with accuracy, and train difficulty calibration models.
--
-- Columns chosen for training value:
--   time_spent_ms      — raw response time (not EMA-smoothed)
--   difficulty         — author raw 1-5 at time of attempt
--   estimated_difficulty — IRT-calibrated [0,1] value at time of attempt
--   strength_before    — student's in_depth_score just BEFORE this attempt (pre-update)
--   platform           — 'mobile' | 'desktop' | 'unknown'  (from User-Agent)
--   source             — 'diagnostic' | 'practice' | 'precalc'
--   hint_used          — whether the student used a hint (partial knowledge signal)

CREATE TABLE IF NOT EXISTS problem_attempt_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid        NOT NULL,
  problem_id            uuid,                    -- null for rag_example-only paths
  keyword_id            text,                    -- primary keyword being practiced
  source                text        NOT NULL CHECK (source IN ('diagnostic', 'practice', 'precalc')),
  correct               boolean     NOT NULL,
  time_spent_ms         integer,                 -- null if not measured
  difficulty            integer,                 -- raw 1-5 author rating
  estimated_difficulty  real,                    -- IRT-calibrated [0,1] at time of attempt
  strength_before       real,                    -- in_depth_score before update (null = first attempt)
  platform              text        CHECK (platform IN ('mobile', 'desktop', 'unknown')),
  hint_used             boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pal_session_idx  ON problem_attempt_log(session_id);
CREATE INDEX IF NOT EXISTS pal_keyword_idx  ON problem_attempt_log(keyword_id);
CREATE INDEX IF NOT EXISTS pal_created_idx  ON problem_attempt_log(created_at);
CREATE INDEX IF NOT EXISTS pal_source_idx   ON problem_attempt_log(source);
