-- Keyword system: adds keyword_weights to problems, keyword_strengths to student_sessions,
-- and a rag_examples table for curated generation seeds.
-- Existing problems are truncated because they have no keyword_weights and were generated
-- under older prompts; start fresh with a tagged pool.

TRUNCATE problems RESTART IDENTITY CASCADE;

ALTER TABLE problems
  ADD COLUMN keyword_weights JSONB NOT NULL DEFAULT '{}';

ALTER TABLE student_sessions
  ADD COLUMN keyword_strengths JSONB NOT NULL DEFAULT '{}';

CREATE TABLE rag_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id TEXT,
  variant_index INTEGER,
  keyword_weights JSONB NOT NULL DEFAULT '{}',
  latex_content TEXT NOT NULL,
  solution_latex TEXT NOT NULL,
  choices JSONB,
  correct_index INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GIN indexes for efficient keyword overlap queries (?| operator)
CREATE INDEX idx_problems_keyword_weights ON problems USING GIN(keyword_weights);
CREATE INDEX idx_rag_examples_keyword_weights ON rag_examples USING GIN(keyword_weights);

-- Allow anonymous reads on rag_examples (same policy as problems)
ALTER TABLE rag_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read rag_examples" ON rag_examples FOR SELECT USING (true);
CREATE POLICY "service write rag_examples" ON rag_examples FOR ALL USING (true);
