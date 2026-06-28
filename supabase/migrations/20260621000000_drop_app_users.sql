-- Drop the retired custom-auth accounts table. Superseded by Supabase Auth
-- (auth.users + public.profiles) in migration 20260620000003_supabase_auth_cutover.
-- Verified safe before dropping: 0 rows, 0 code references in apps/packages/scripts,
-- 0 incoming foreign keys, and 0 referencing DB functions/views/triggers.
--
-- NOTE: student_accounts (the other legacy auth table) is intentionally LEFT in
-- place — the legacy /demo flow still references it (api/demo/reset,
-- api/demo/complete). It can be dropped once the /demo routes are retired.
DROP TABLE IF EXISTS public.app_users;
