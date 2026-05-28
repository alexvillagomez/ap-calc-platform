-- Per-choice wrong-answer data: description, embedding, keyword_weights.
-- wrong_answer_data: JSONB array indexed by choice position (0-3).
-- Each entry: {description: string|null, embedding: number[]|null, keyword_weights: Record<string,number>}
-- null entry at the correct_index position.

ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS wrong_answer_data JSONB NOT NULL DEFAULT '[]';

ALTER TABLE rag_examples
  ADD COLUMN IF NOT EXISTS wrong_answer_data JSONB NOT NULL DEFAULT '[]';

-- calculator_allowed: explicit boolean instead of a keyword tag.
ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS calculator_allowed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE rag_examples
  ADD COLUMN IF NOT EXISTS calculator_allowed BOOLEAN NOT NULL DEFAULT false;

-- Remove non_calculator/calculator keywords from learn_keywords so they don't
-- appear as content skill tags (calculator access is a problem-level property, not a skill).
DELETE FROM learn_keywords WHERE id IN ('non_calculator', 'calculator', 'calculator_allowed', 'no_calculator', 'without_calculator');
DELETE FROM learn_keywords WHERE name ILIKE '%calculator%' AND tier = 'tag';
