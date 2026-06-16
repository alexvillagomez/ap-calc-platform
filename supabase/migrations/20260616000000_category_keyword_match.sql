-- Category-scoped keyword similarity match (KEYWORD-MISMATCH fix).
--
-- MANUAL APPLICATION REQUIRED: apply this migration by hand in the Supabase SQL
-- editor. The live DB is a small Nano instance; do NOT run it automatically.
--
-- WHY: the QuestionToolbar (refresher / lesson) picks the keyword to teach from
-- a question's stored `keyword_weights` (max weight). Those weights are noisy:
-- e.g. "What is the sign of -9/-3?" has max-weight `negative_signs_and_grouping`
-- (a grouping/distribution sub-concept) even though `sign_of_quotients` is the
-- correct concept and isn't even in keyword_weights. This RPC lets the serving
-- route pick the keyword whose embedding is SEMANTICALLY CLOSEST to the question,
-- restricted to the question's own category.
--
-- Depends on 20260615000001_pgvector_search.sql (embedding_vec + HNSW indexes on
-- *_keywords). math_questions / mcat_questions only have a JSONB `embedding`
-- column, so the question vector is passed in as a text literal by the caller.
--
-- Fully idempotent: safe to re-run. Routes fail-soft to max-weight selection
-- until this migration is applied, then use the RPC automatically.

-- ─── RPC: match_math_keywords_in_category ─────────────────────────────────────
create or replace function match_math_keywords_in_category(
  query_embedding text,
  p_category_id text,
  match_count int default 1
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
    and k.category_id = p_category_id
    and k.embedding_vec is not null
  order by k.embedding_vec <=> query_embedding::vector(1536) asc
  limit match_count;
$$;

-- ─── RPC: match_mcat_keywords_in_category ─────────────────────────────────────
create or replace function match_mcat_keywords_in_category(
  query_embedding text,
  p_category_id text,
  match_count int default 1
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
    and k.category_id = p_category_id
    and k.embedding_vec is not null
  order by k.embedding_vec <=> query_embedding::vector(1536) asc
  limit match_count;
$$;
