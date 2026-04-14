-- Student profiles table for tracking mastery progress
create table public.student_profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete cascade not null unique,
  mastery_vector jsonb not null default '{}'::jsonb
);

-- Index for looking up by user_id
create index idx_student_profiles_user_id on public.student_profiles (user_id);

-- Trigger to update updated_at
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_student_profiles_updated_at
  before update on public.student_profiles
  for each row
  execute function public.update_updated_at();

-- Enable RLS
alter table public.student_profiles enable row level security;

-- Policy: Users can only read/update their own profile
create policy "Users can read own profile"
  on public.student_profiles for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.student_profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.student_profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
