-- Add chain-of-thought thinking fields to rag_examples.
-- generation_thinking: model's planning notes on what makes a good problem here.
-- distractor_thinking: model's analysis of common student mistakes, used to design wrong answers.

ALTER TABLE rag_examples
  ADD COLUMN IF NOT EXISTS generation_thinking TEXT,
  ADD COLUMN IF NOT EXISTS distractor_thinking TEXT;
