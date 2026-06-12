-- ─────────────────────────────────────────────────────────────────────────────
-- 20260614000002_users_and_streaks.sql
-- Additive-only. Idempotent (IF NOT EXISTS everywhere).
-- Adds:
--   app_users              — email+username+password auth (no Supabase Auth dep)
--   student_sessions.user_id — links a session to an app_users row (nullable FK)
--   user_streaks           — daily streak tracking per user
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. app_users ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  username      TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'app_users' AND policyname = 'au_anon_all'
  ) THEN
    CREATE POLICY "au_anon_all" ON app_users FOR ALL TO anon          USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'app_users' AND policyname = 'au_auth_all'
  ) THEN
    CREATE POLICY "au_auth_all" ON app_users FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_users_email    ON app_users(email);
CREATE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username);

-- ── 2. student_sessions.user_id FK ───────────────────────────────────────────
ALTER TABLE student_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_student_sessions_user_id ON student_sessions(user_id);

-- ── 3. user_streaks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_streaks (
  user_id          UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  current_streak   INT         NOT NULL DEFAULT 0,
  longest_streak   INT         NOT NULL DEFAULT 0,
  last_active_date DATE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_streaks' AND policyname = 'us_anon_all'
  ) THEN
    CREATE POLICY "us_anon_all" ON user_streaks FOR ALL TO anon          USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_streaks' AND policyname = 'us_auth_all'
  ) THEN
    CREATE POLICY "us_auth_all" ON user_streaks FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
