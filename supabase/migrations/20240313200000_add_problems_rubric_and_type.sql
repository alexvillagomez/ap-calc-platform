-- Add rubric and type columns (manual schema sync)
alter table public.problems
  add column if not exists rubric text,
  add column if not exists type text;
