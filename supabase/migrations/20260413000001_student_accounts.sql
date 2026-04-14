-- student_accounts: username/password auth for the student portal.
-- Each account owns exactly one student_session (strengths + history live there).
CREATE TABLE IF NOT EXISTS student_accounts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  session_id    UUID        NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS (prototype: open anon access — tighten when adding proper auth)
ALTER TABLE student_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sac_anon_all" ON student_accounts FOR ALL TO anon          USING (true) WITH CHECK (true);
CREATE POLICY "sac_auth_all" ON student_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_student_accounts_username ON student_accounts(username);
