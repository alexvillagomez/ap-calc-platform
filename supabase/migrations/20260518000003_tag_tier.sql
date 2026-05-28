-- Add 'tag' as an allowed tier value in learn_keywords
ALTER TABLE learn_keywords DROP CONSTRAINT IF EXISTS learn_keywords_tier_check;
ALTER TABLE learn_keywords ADD CONSTRAINT learn_keywords_tier_check
  CHECK (tier IN ('umbrella', 'in_depth', 'tag'));
