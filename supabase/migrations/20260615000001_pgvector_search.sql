-- pgvector course-search acceleration.
--
-- MANUAL APPLICATION REQUIRED: apply this migration by hand in the Supabase SQL
-- editor. The live DB is currently IO-throttled; do NOT run it automatically.
--
-- What this does:
--   1. Enables the `vector` extension.
--   2. Adds an `embedding_vec vector(1536)` column to math_keywords and
--      mcat_keywords alongside the existing JSONB `embedding` column.
--   3. BACKFILLS embedding_vec from the JSONB embedding (the JSONB array's text
--      form '[...]' is a valid pgvector literal).
--   4. Builds HNSW (cosine) indexes for fast approximate nearest-neighbour search.
--   5. Creates two SQL RPC functions (match_math_keywords, match_mcat_keywords)
--      that do the similarity scan IN-DATABASE instead of loading every 1536-float
--      embedding into the Node process and cosine-scanning in JS.
--
-- Fully idempotent: safe to re-run. The routes fail-soft to the old JS scan until
-- this migration is applied, then use the RPCs automatically.

-- ─── Extension ────────────────────────────────────────────────────────────────
create extension if not exists vector;

-- ─── Columns ──────────────────────────────────────────────────────────────────
alter table math_keywords add column if not exists embedding_vec vector(1536);
alter table mcat_keywords add column if not exists embedding_vec vector(1536);

-- ─── Backfill from JSONB embedding ────────────────────────────────────────────
update math_keywords
  set embedding_vec = (embedding::text)::vector
  where embedding is not null and embedding_vec is null;

update mcat_keywords
  set embedding_vec = (embedding::text)::vector
  where embedding is not null and embedding_vec is null;

-- ─── HNSW cosine indexes ──────────────────────────────────────────────────────
create index if not exists math_keywords_embedding_vec_hnsw
  on math_keywords using hnsw (embedding_vec vector_cosine_ops);

create index if not exists mcat_keywords_embedding_vec_hnsw
  on mcat_keywords using hnsw (embedding_vec vector_cosine_ops);

-- ─── RPC: match_math_keywords ─────────────────────────────────────────────────
-- Replicates /api/math/search filters: status='approved', has embedding_vec, and
-- (when p_course is provided) scoped to that course's categories via
-- math_course_categories. When p_course is null, no course filter is applied.
create or replace function match_math_keywords(
  query_embedding text,
  p_course text,
  match_count int default 8
)
returns table (
  keyword_id  text,
  label       text,
  category_id text,
  similarity  real
)
language sql
stable
set search_path = public
as $$
  select
    k.id          as keyword_id,
    k.label       as label,
    k.category_id as category_id,
    (1 - (k.embedding_vec <=> query_embedding::vector(1536)))::real as similarity
  from math_keywords k
  where k.status = 'approved'
    and k.embedding_vec is not null
    and (
      p_course is null
      or k.category_id in (
        select mcc.category_id
        from math_course_categories mcc
        where mcc.course = p_course
      )
    )
  order by k.embedding_vec <=> query_embedding::vector(1536) asc
  limit match_count;
$$;

-- ─── RPC: match_mcat_keywords ─────────────────────────────────────────────────
-- Replicates /api/mcat/search filters: status='approved', tier='in_depth' (the
-- correct leaf category fix), has embedding_vec. The leaf's own category_id is the
-- id practice/quiz/flashcards routes validate against.
create or replace function match_mcat_keywords(
  query_embedding text,
  match_count int default 8
)
returns table (
  keyword_id  text,
  label       text,
  category_id text,
  similarity  real
)
language sql
stable
set search_path = public
as $$
  select
    k.id          as keyword_id,
    k.label       as label,
    k.category_id as category_id,
    (1 - (k.embedding_vec <=> query_embedding::vector(1536)))::real as similarity
  from mcat_keywords k
  where k.status = 'approved'
    and k.tier = 'in_depth'
    and k.embedding_vec is not null
  order by k.embedding_vec <=> query_embedding::vector(1536) asc
  limit match_count;
$$;
