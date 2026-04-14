-- Allow anonymous users to read topic_metadata (students can see topic names without logging in)
create policy "Allow read for anonymous"
  on public.topic_metadata for select
  to anon
  using (true);
