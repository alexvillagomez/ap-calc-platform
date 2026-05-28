-- Add course tag to rag_examples so precalc problems can be differentiated from AP Calc
ALTER TABLE rag_examples
  ADD COLUMN IF NOT EXISTS course TEXT NOT NULL DEFAULT 'ap_calc'
    CHECK (course IN ('ap_calc', 'precalc'));

CREATE INDEX IF NOT EXISTS idx_rag_examples_course ON rag_examples(course);
