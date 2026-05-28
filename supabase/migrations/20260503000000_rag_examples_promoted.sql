ALTER TABLE rag_examples
  ADD COLUMN IF NOT EXISTS promoted_problem_id UUID REFERENCES problems(id);
