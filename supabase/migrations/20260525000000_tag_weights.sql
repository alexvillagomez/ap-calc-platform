-- Separate tag_weights from keyword_weights.
-- keyword_weights: content skill keywords only (in_depth tier from learn_keywords), sum to 1.
-- tag_weights: format/action/style tags (tag tier from learn_keywords), sum to 1.

ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS tag_weights JSONB NOT NULL DEFAULT '{}';

ALTER TABLE rag_examples
  ADD COLUMN IF NOT EXISTS tag_weights JSONB NOT NULL DEFAULT '{}';
