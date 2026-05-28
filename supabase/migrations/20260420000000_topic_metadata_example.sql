ALTER TABLE topic_metadata ADD COLUMN IF NOT EXISTS example text[] DEFAULT '{}';
