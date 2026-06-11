-- yield_level ∈ {high,medium,low} is an AAMC-content-outline-grounded estimate of how heavily
-- the real MCAT tests this keyword; yield_rationale is a one-sentence justification.
-- TEXT (no CHECK constraint) for forward-compat; validation happens in application code.

ALTER TABLE mcat_keywords ADD COLUMN IF NOT EXISTS yield_level TEXT;
ALTER TABLE mcat_keywords ADD COLUMN IF NOT EXISTS yield_rationale TEXT;
