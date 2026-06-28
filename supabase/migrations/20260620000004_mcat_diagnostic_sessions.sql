-- MCAT diagnostic sessions — mirrors math_diagnostic_sessions so MCAT guided
-- learning gets the same "take a diagnostic OR skip and start from the beginning"
-- entry screen and in-order hand-off as math.
CREATE TABLE IF NOT EXISTS public.mcat_diagnostic_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  asked jsonb NOT NULL DEFAULT '[]'::jsonb,
  category_estimates jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcat_diagnostic_sessions_session_idx
  ON public.mcat_diagnostic_sessions(session_id);
