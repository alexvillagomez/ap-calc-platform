-- Cutover to Supabase Auth (GoTrue) as the single source of truth for accounts.
-- The custom app_users + scrypt + custom-cookie system is retired; auth identity
-- is now the Supabase auth.users uid. Per-user data continues to key on the same
-- `session_id` column, but that id now equals the auth uid (set by the client
-- session helpers from the GoTrue session). Clean cutover — all accounts were
-- wiped first, so no migration of existing rows is needed.

-- Drop the per-user FKs that pointed at the deprecated app_users table.
ALTER TABLE student_sessions DROP CONSTRAINT IF EXISTS student_sessions_user_id_fkey;
ALTER TABLE user_streaks DROP CONSTRAINT IF EXISTS user_streaks_user_id_fkey;

-- profiles: 1 row per auth user (id = auth.users.id). Holds username/name/profile
-- fields that used to live on app_users. Cascades when the user is deleted from
-- the Supabase Auth dashboard.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  username text,
  first_name text,
  last_name text,
  display_name text,
  grade_level text,
  target_exam_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Streaks key on the auth uid and cascade on dashboard delete.
ALTER TABLE user_streaks
  ADD CONSTRAINT user_streaks_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Auto-provision profile + streak row whenever an auth user is created
-- (signUp OR a user added from the dashboard).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username)
  VALUES (new.id, new.email,
          COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_streaks (user_id) VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- NOTE: app_users + student_accounts (legacy custom-auth tables) are now unused.
-- They are left in place (empty) and DROPPED in a follow-up once the deployed
-- code is confirmed to reference neither. Per-user progress tables continue to
-- key on session_id (= auth uid); RLS on those tables is a fast-follow (all
-- access is currently via the service-role key in API routes).
