-- Feedback (helpful / not helpful) for AI-generated learn content

CREATE TABLE IF NOT EXISTS learn_feedback (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID        REFERENCES student_sessions(id) ON DELETE SET NULL,
  content_type TEXT        NOT NULL CHECK (content_type IN ('lesson','refresher','tip')),
  keyword_id   TEXT        NOT NULL,
  helpful      BOOLEAN     NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, content_type, keyword_id)
);

CREATE INDEX IF NOT EXISTS idx_learn_feedback_keyword ON learn_feedback(keyword_id, content_type);

-- Aggregate counters on each content table (updated by trigger)
ALTER TABLE learn_lessons    ADD COLUMN IF NOT EXISTS helpful_count     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learn_lessons    ADD COLUMN IF NOT EXISTS not_helpful_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learn_refreshers ADD COLUMN IF NOT EXISTS helpful_count     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learn_refreshers ADD COLUMN IF NOT EXISTS not_helpful_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learn_tips       ADD COLUMN IF NOT EXISTS helpful_count     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learn_tips       ADD COLUMN IF NOT EXISTS not_helpful_count INTEGER NOT NULL DEFAULT 0;

-- RLS
ALTER TABLE learn_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_learn_feedback" ON learn_feedback
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_learn_feedback" ON learn_feedback FOR SELECT USING (true);
