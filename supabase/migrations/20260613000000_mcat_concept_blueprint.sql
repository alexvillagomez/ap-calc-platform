-- MCAT concept blueprint column.
-- Stores the canonical in-scope/out-of-scope contract for each keyword.
-- This blueprint is generated once per keyword and injected into both lesson
-- and question generation prompts to keep both generators tightly scoped and
-- prevent drift into adjacent keywords' territory.

-- ─── mcat_keywords: concept blueprint ─────────────────────────────────────────
ALTER TABLE mcat_keywords ADD COLUMN IF NOT EXISTS concept_blueprint JSONB;
