-- Problems table for AP Calculus content
create table public.problems (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  latex_content text not null,
  solution_latex text not null,
  choices jsonb,
  correct_index int,
  difficulty int not null check (difficulty >= 1 and difficulty <= 5),
  topic_weights jsonb not null default '{}'::jsonb,
  status text not null default 'pending_review' check (
    status in ('pending_review', 'approved', 'rejected')
  ),
  feedback text
);

-- Index for filtering by status (common in admin workflows)
create index idx_problems_status on public.problems (status);

-- Index for filtering by difficulty
create index idx_problems_difficulty on public.problems (difficulty);

-- Index for created_at (sorting, recent problems)
create index idx_problems_created_at on public.problems (created_at desc);

-- Enable RLS
alter table public.problems enable row level security;

-- Policy: Admins can do everything (adjust based on your auth setup)
-- For now, allow authenticated users for read; restrict writes in production
create policy "Allow read for authenticated users"
  on public.problems for select
  to authenticated
  using (status = 'approved');

create policy "Allow all for service role"
  on public.problems for all
  to service_role
  using (true)
  with check (true);
