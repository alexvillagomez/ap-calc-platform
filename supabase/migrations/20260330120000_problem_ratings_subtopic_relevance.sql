-- Full subtopic relevance vector (all topic_metadata ids, zeros elsewhere) for recommendations
alter table public.problems
  add column if not exists subtopic_relevance jsonb not null default '{}'::jsonb;

-- Denormalized aggregates from problem_ratings (updated by API)
alter table public.problems
  add column if not exists avg_rating numeric(4, 3),
  add column if not exists rating_count integer not null default 0 check (rating_count >= 0);

create index if not exists idx_problems_avg_rating on public.problems (avg_rating desc nulls last)
  where avg_rating is not null;

-- Per-user (or per-session) ratings; dynamic community score via avg on problems
create table if not exists public.problem_ratings (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems (id) on delete cascade,
  rater_id text not null,
  rating integer not null check (rating >= 1 and rating <= 5),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (problem_id, rater_id)
);

create index if not exists idx_problem_ratings_problem_id on public.problem_ratings (problem_id);

alter table public.problem_ratings enable row level security;

create policy "Service role problem_ratings full access"
  on public.problem_ratings for all
  to service_role
  using (true)
  with check (true);
