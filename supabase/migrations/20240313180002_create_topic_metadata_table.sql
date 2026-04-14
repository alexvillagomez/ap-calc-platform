-- Topic metadata table for AP Calculus topics (joins with problems.topic_weights)
create table public.topic_metadata (
  id text primary key,
  unit_name text not null,
  description text not null
);

-- Enable RLS
alter table public.topic_metadata enable row level security;

-- Policy: Anyone can read topic metadata (reference data)
create policy "Allow read for all"
  on public.topic_metadata for select
  to authenticated
  using (true);

create policy "Allow all for service role"
  on public.topic_metadata for all
  to service_role
  using (true)
  with check (true);
