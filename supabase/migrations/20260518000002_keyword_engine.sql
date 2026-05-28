-- Keyword generation engine: categories + extended keywords + embeddings

CREATE TABLE IF NOT EXISTS learn_categories (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL,
  order_index INTEGER     DEFAULT 0,
  embedding   JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE learn_keywords
  ADD COLUMN IF NOT EXISTS name        TEXT,
  ADD COLUMN IF NOT EXISTS category_id TEXT REFERENCES learn_categories(id),
  ADD COLUMN IF NOT EXISTS examples    JSONB,
  ADD COLUMN IF NOT EXISTS status      TEXT DEFAULT 'draft'
    CHECK (status IN ('draft','approved','rejected')),
  ADD COLUMN IF NOT EXISTS embedding   JSONB;

CREATE INDEX IF NOT EXISTS idx_learn_keywords_category ON learn_keywords(category_id);
CREATE INDEX IF NOT EXISTS idx_learn_keywords_status   ON learn_keywords(category_id, status);

ALTER TABLE learn_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_categories" ON learn_categories FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_categories"    ON learn_categories FOR SELECT USING (true);
