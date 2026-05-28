-- Add embedding and problem/wrong-answer descriptions to rag_examples
ALTER TABLE rag_examples
  ADD COLUMN IF NOT EXISTS embedding                  JSONB,
  ADD COLUMN IF NOT EXISTS problem_description        TEXT,
  ADD COLUMN IF NOT EXISTS wrong_answer_descriptions  JSONB;  -- string[4], one per choice

CREATE INDEX IF NOT EXISTS idx_rag_examples_embedding ON rag_examples USING GIN(embedding);
