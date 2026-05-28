-- Add distractor_pool to rag_examples to store the full set of generated
-- misconception/wrong-answer pairs (5-6 entries per problem). Three are selected
-- at generation time; the rest are available for per-student variation.
ALTER TABLE rag_examples
  ADD COLUMN IF NOT EXISTS distractor_pool JSONB;
