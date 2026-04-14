-- Restructure problems table to work with topic_metadata
-- Drops existing table and recreates with topic_id FK

drop table if exists public.problems;

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  topic_id text not null references public.topic_metadata (id),
  latex_content text not null,
  solution_latex text not null,
  choices jsonb,
  correct_index int,
  difficulty int not null check (difficulty >= 1 and difficulty <= 5),
  topic_weights jsonb not null default '{}'::jsonb,
  status text not null default 'pending_review' check (
    status in ('pending_review', 'approved', 'rejected')
  ),
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_problems_status on public.problems (status);
create index idx_problems_difficulty on public.problems (difficulty);
create index idx_problems_topic_id on public.problems (topic_id);
create index idx_problems_created_at on public.problems (created_at desc);

-- Enable RLS
alter table public.problems enable row level security;

-- Admin: service_role has full CRUD
create policy "Service role full access"
  on public.problems for all
  to service_role
  using (true)
  with check (true);

-- Public/Student: anonymous users can only SELECT approved problems
create policy "Anonymous read approved only"
  on public.problems for select
  to anon
  using (status = 'approved');

-- Authenticated students: same as anon for read
create policy "Authenticated read approved only"
  on public.problems for select
  to authenticated
  using (status = 'approved');
