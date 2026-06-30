-- openstax_chunks: stores CC-BY-licensed OpenStax textbook chunks for MCAT keyword grounding.
-- Only CC BY 4.0 (NOT CC BY-NC-SA) content is ingested — the ingestion script enforces this.
-- Each row is a ~500-1000-token semantic unit from a specific section of a specific book.
-- embedding_vec mirrors the mcat_keywords / math_keywords HNSW pattern (vector_cosine_ops).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS openstax_chunks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  book          text        NOT NULL,          -- book slug, e.g. "biology-2e"
  chapter       text        NOT NULL,          -- chapter/subcollection title
  section       text        NOT NULL,          -- section title (module md:title)
  url           text        NOT NULL,          -- canonical source URL for citation
  content       text        NOT NULL,          -- clean prose text (~500-1000 tokens)
  token_count   int,                           -- approximate token count (chars/4)
  embedding_vec vector(1536),                  -- text-embedding-3-small
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Idempotent upsert key: same book + section + chunk offset must not double-insert.
  -- We use a hash of (book, url, content) as a stable idempotent key.
  content_hash  text        NOT NULL           -- SHA-256 hex of (book||url||content)
);

-- Unique constraint for idempotent upsert (skip-if-exists on content_hash)
CREATE UNIQUE INDEX IF NOT EXISTS openstax_chunks_content_hash_idx
  ON openstax_chunks (content_hash);

-- ANN index for cosine similarity search — mirrors mcat_keywords_embedding_vec_hnsw
CREATE INDEX IF NOT EXISTS openstax_chunks_embedding_vec_hnsw
  ON openstax_chunks USING hnsw (embedding_vec vector_cosine_ops);

-- Fast lookup by book for scoped queries
CREATE INDEX IF NOT EXISTS openstax_chunks_book_idx
  ON openstax_chunks (book);
