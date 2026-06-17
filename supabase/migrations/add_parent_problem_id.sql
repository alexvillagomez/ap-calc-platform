ALTER TABLE problems ADD COLUMN IF NOT EXISTS parent_problem_id uuid REFERENCES problems(id);
CREATE INDEX IF NOT EXISTS problems_parent_problem_id_idx ON problems(parent_problem_id);
