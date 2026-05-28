ALTER TABLE problems ADD COLUMN IF NOT EXISTS parent_problem_id UUID REFERENCES problems(id) ON DELETE SET NULL;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS is_sibling BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN problems.parent_problem_id IS 'If set, this problem was generated as a sibling of the referenced problem';
COMMENT ON COLUMN problems.is_sibling IS 'True if this problem was auto-generated as a sibling of another problem';
