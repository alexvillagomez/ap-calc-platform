-- Adds a depth_level column to mcat_keywords (and math_keywords) so each keyword
-- can carry an L1–L4 difficulty/depth classification that guides generation and
-- serves as the anchor for the must_state_facts coverage contract in ConceptBlueprint.
-- Nullable — no backfill. Populate incrementally via the blueprint generation phase.

ALTER TABLE mcat_keywords
  ADD COLUMN IF NOT EXISTS depth_level text
    CHECK (depth_level IN ('L1', 'L2', 'L3', 'L4'));

ALTER TABLE math_keywords
  ADD COLUMN IF NOT EXISTS depth_level text
    CHECK (depth_level IN ('L1', 'L2', 'L3', 'L4'));
