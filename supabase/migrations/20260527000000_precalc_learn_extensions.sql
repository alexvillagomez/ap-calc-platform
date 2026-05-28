-- GIN index on rag_examples for fast keyword overlap queries
CREATE INDEX IF NOT EXISTS idx_rag_examples_keyword_weights ON rag_examples USING GIN (keyword_weights);
CREATE INDEX IF NOT EXISTS idx_rag_examples_course_difficulty ON rag_examples(course, difficulty);

-- Lesson queue progress table
CREATE TABLE IF NOT EXISTS precalc_lesson_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
  topic_id     TEXT NOT NULL,
  keyword_id   TEXT NOT NULL REFERENCES learn_keywords(id),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  xp_awarded   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, topic_id, keyword_id)
);
ALTER TABLE precalc_lesson_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_precalc_queue" ON precalc_lesson_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_precalc_queue_session ON precalc_lesson_queue(session_id, topic_id);
