-- Batch-on-miss recycle model (within-subtopic diversity design, Phase 2):
-- a per-cell in-flight claim/lock + soft global concurrency cap so a cold
-- catalog doesn't spawn duplicate or explosive batch generations. A "cell" is
-- a coarse (course/subject : category : difficulty-band) key. The first request
-- to miss claims the cell, generates a deliberate diverse batch, serves one and
-- persists the rest as `active` (recycled for everyone); concurrent requests for
-- the same cell do NOT also spawn a batch.

CREATE TABLE IF NOT EXISTS question_gen_locks (
  cell_key text PRIMARY KEY,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Atomic try-lock: claims the cell if free or the prior lock expired, subject to
-- a soft global cap on concurrent generations. Returns true iff the caller may
-- generate. Expired locks are reaped on every call (TTL-based self-healing).
CREATE OR REPLACE FUNCTION try_claim_gen_lock(p_cell text, p_ttl_seconds int, p_max_concurrent int)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE active_count int; got boolean;
BEGIN
  DELETE FROM question_gen_locks WHERE expires_at < now();
  INSERT INTO question_gen_locks(cell_key, claimed_at, expires_at)
    VALUES (p_cell, now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (cell_key) DO UPDATE SET claimed_at = now(), expires_at = EXCLUDED.expires_at
    WHERE question_gen_locks.expires_at < now()
  RETURNING true INTO got;
  IF got IS NULL THEN
    RETURN false;  -- cell currently locked by a live generation
  END IF;
  SELECT count(*) INTO active_count FROM question_gen_locks;
  IF active_count > p_max_concurrent THEN
    DELETE FROM question_gen_locks WHERE cell_key = p_cell;
    RETURN false;  -- over the global concurrency cap; back off
  END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION release_gen_lock(p_cell text)
RETURNS void LANGUAGE sql AS $$
  DELETE FROM question_gen_locks WHERE cell_key = p_cell;
$$;
