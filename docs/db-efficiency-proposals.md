> **PROPOSALS ONLY — NONE OF THIS IS APPLIED.** This is a backlog for the owner to review and approve. No migrations were run, no code was changed, no DB writes were made while producing this document.

# Database efficiency proposals — Lodera student app (Supabase Nano)

## Context & scope

The student app runs on a Supabase **Nano** instance (43 Mbps baseline disk IO, 30-min/day burst budget). On 2026-06-15 a day of automated traffic exhausted the burst budget and caused throttling / auth 500s. Infra work already shipped is documented in `docs/scaling-infra.md` (pgvector search, `lib/serverCache.ts`, read-replica routing via `lib/supabaseRead.ts`, rate limiting) and the owner-only knobs there (compute upgrade, provisioned IOPS, read replica, Upstash). **This document deliberately does not repeat those** — it goes beyond them, focused on cutting disk-IO and write amplification at the schema / query level.

The single biggest lever remains the owner-only **compute + provisioned IOPS upgrade off Nano** already called out in `scaling-infra.md`. Everything below reduces the IO that lands on whatever instance is running, which both relieves Nano today and lowers cost on a larger tier later.

All hot paths use the Supabase JS client over PostgREST, which goes through **Supavisor** (transaction pooler) — see §5. No direct-Postgres connections were found in `apps/student`, which is good.

---

## Ranked summary (impact vs. effort)

| # | Proposal | Impact | Effort | Risk | Migration? |
|---|----------|--------|--------|------|-----------|
| 1 | Stop the per-event `est_time_ms` read-modify-write; make events append-only + cron rollup | **Very high** | Med | Low | Yes (rollup fn/cron) |
| 2 | Add unique constraint + replace whole-session attempt pulls in next-question | **Very high** | Low–Med | Low | Yes |
| 3 | GIN index on `keyword_weights` + narrow next-question column projection | High | Low | Low | Yes |
| 4 | Trim `student_events` indexes (write amplification) + add the one composite that matters | High | Low | Low | Yes |
| 5 | Drop legacy JSONB `embedding` after `embedding_vec` backfill verified | High | Low | Med | Yes |
| 6 | Stop pulling JSONB (`embedding`, `concept_blueprint`) in `loadTargetKeywords` hot path | High | Low | Low | No |
| 7 | Events retention / rollup lifecycle (partition or TTL delete) | Med–High | Med | Low | Yes |
| 8 | Replace whole-course keyword pulls (1000-row pager) with a server-side RPC / matview | Med | Med | Low | Yes |
| 9 | Autovacuum tuning for high-churn tables (states, events, sessions) | Med | Low | Low | Yes (ALTER) |
| 10 | Materialized views for progress / leaderboard | Med | Med | Med | Yes |
| 11 | Missing FK / lookup indexes (priorities, attempts) | Med | Low | Low | Yes |
| 12 | Route remaining read-only handlers through `getReadClient()` | Low–Med | Low | Low | No |

---

## 1. Hot-row write contention — `est_time_ms` synchronous rollup (HIGHEST scale risk)

**What:** `apps/student/app/api/events/route.ts` on every `timer_stop` does a synchronous **read-modify-write on the question row**: `SELECT time_sample_count, time_sum_ms FROM <table> WHERE id = ?` then `UPDATE` the same row with new sum/count/`est_time_ms`. Popular questions become hot rows: concurrent answerers serialize on the same row's lock and each `UPDATE` produces a new tuple (HOT churn + WAL + autovacuum pressure). The append (`INSERT` into `student_events`) already captures the data, so this rollup is redundant in the request path.

**Proposal:** Make `/api/events` purely append-only — keep the `student_events` insert, delete the read-modify-write block (lines ~59-89). Recompute `est_time_ms` out-of-band:
- A scheduled job (Supabase pg_cron, or a Vercel Cron route) every N minutes runs `UPDATE math_questions q SET time_sample_count = s.cnt, time_sum_ms = s.sum, est_time_ms = round(s.sum/s.cnt) FROM (SELECT question_id, count(*) cnt, sum(time_ms) sum FROM student_events WHERE event_type='timer_stop' AND system='math' AND created_at > <watermark> GROUP BY question_id) s WHERE q.id = s.question_id::uuid;` (and the mcat equivalent). Keep a watermark so each run only scans recent events.

**Why (IO/perf):** Eliminates one SELECT + one UPDATE per timer_stop on the hottest content rows — removes lock contention, tuple churn on `math_questions`/`mcat_questions` (wide rows with JSONB → expensive to rewrite), and the associated WAL/autovacuum IO. Converts many tiny random writes into one batched sequential aggregate.
**Effort:** Medium (delete code block; add cron job + watermark). **Risk:** Low — `est_time_ms` becomes eventually-consistent (minutes stale), which is fine for a UI time estimate. **Migration:** Yes (rollup function + pg_cron schedule, or a cron route).

---

## 2. Attempt tables: no uniqueness + whole-session re-reads

**What (two coupled issues):**
- **(a) No unique constraint.** `math_question_attempts` and `mcat_question_attempts` (migrations `20260614000000`, `20260610000000`) are `bigserial`-PK append logs with **no `UNIQUE(session_id, question_id)`** — unlike `student_problem_attempts` which has `UNIQUE(session_id, problem_id)`. Re-answering a question appends duplicate rows, inflating the table and every per-session read.
- **(b) Whole-session pull each request.** `math/next-question` (and the mcat twin) does `SELECT question_id FROM math_question_attempts WHERE session_id = ?` with **no row cap** to build the "seen" set, on every single next-question call. A long session re-reads its entire growing attempt history every request.

**Proposal:**
- Add `CREATE UNIQUE INDEX ... ON math_question_attempts(session_id, question_id)` (and mcat). Decide on the attempt-log semantics first: if you want full attempt history, keep the bigserial log but de-dupe the "seen" read instead; if you only need latest, switch the insert to an upsert on that key. (The route already de-dupes in JS via a `Set`, so a unique index is safe to add as long as inserts move to `ON CONFLICT DO NOTHING`/upsert — **verify no code depends on duplicate rows before applying**.)
- The existing single-column `idx_math_question_attempts_session` already supports the read; the win is bounding row growth so the read stays small.

**Why:** Caps unbounded per-session reads (sequential index scans that grow with session length) and table bloat. With a unique index the "seen" lookup returns one row per distinct question instead of N attempts.
**Effort:** Low–Med (must confirm no analytics relies on duplicate attempt rows). **Risk:** Low. **Migration:** Yes.

---

## 3. `next-question` full-category scan + JS `keyword_weights` filter

**What:** `math/next-question` step 4 runs `SELECT id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty, parent_question_id, avg_rating FROM math_questions WHERE category_id IN (...) AND status='active'` — pulling **every active question in the category with all content columns** (large `stem_latex`/`solution_latex` text + `keyword_weights` JSONB), then filters `keyword_weights` membership and scores entirely in JS. As content grows this is a wide full-category read on every request. `idx_math_questions_category_status` helps the WHERE but not the payload size or the JSON filtering.

**Proposal:**
- Add a **GIN index on `keyword_weights`** (`CREATE INDEX ... USING gin (keyword_weights jsonb_path_ops)`) on `math_questions` and `mcat_questions` so keyword-scoped queries (`keyword_id` / `keyword_ids` paths) can filter in-DB with `keyword_weights ? '<kw>'` / `?| array[...]` instead of fetching the whole category and filtering in Node.
- **Narrow the SELECT**: don't fetch `solution_latex`/`stem_latex`/`choices` during the *scoring* phase — fetch only `id, keyword_weights, difficulty, avg_rating, parent_question_id` to score, then fetch full content for the single selected row. This cuts the bytes read per request dramatically (the heavy LaTeX columns are the bulk of row width and likely TOASTed).

**Why:** Two compounding IO wins — fewer rows scanned (GIN-filtered) and far fewer bytes per row (skip TOASTed LaTeX until the one winner is chosen). This is one of the top per-request read costs.
**Effort:** Low (index + projection split). **Risk:** Low. **Migration:** Yes (indexes).

---

## 4. `student_events` index write-amplification

**What:** `features_v2` creates `student_events` with **five separate single-column indexes** (`user_id`, `session_id`, `event_type`, `question_id`, `created_at`). This is the highest-volume insert table in the system (every answer, timer_stop, refresher_used, priority change — see `logServerEvent` calls in `math/attempt` alone fire 1-2 inserts per answer). Every insert maintains all five B-trees → large write amplification and WAL on a write-heavy append table, which is exactly what burns IOPS.

**Proposal:** Drop the indexes that don't serve a real query and add the one composite the rollup/analytics actually needs:
- Keep/replace with `idx_student_events_rollup ON student_events(event_type, question_id, created_at)` (serves the §1 rollup and time-per-question analytics).
- Keep `idx_student_events_session_id` if any per-session telemetry read exists; otherwise drop.
- Drop `idx_student_events_user_id`, `idx_student_events_event_type` (low-selectivity alone), and standalone `idx_student_events_question_id`/`idx_student_events_created_at` once the composite covers them. **Audit query usage first** (grep shows events is currently write-only from the app — no SELECT paths found in `apps/student`), so most of these indexes are pure insert tax today.

**Why:** Cuts index-maintenance IO on the busiest insert path. On Nano, halving the per-insert B-tree updates on the highest-volume table is a direct burst-budget saving.
**Effort:** Low. **Risk:** Low (verify no read path needs a dropped index; events is append-only in current code). **Migration:** Yes.

---

## 5. Storage/IO bloat — drop legacy JSONB `embedding` columns

**What:** `pgvector_search` (`20260615000001`) added `embedding_vec vector(1536)` to `math_keywords` and `mcat_keywords` and backfilled it from the old JSONB `embedding`. The JSONB `embedding` column is now **duplicated dead weight** for the search path (the RPCs use only `embedding_vec`). A 1536-float JSONB array is ~30-40 KB of text → forced into TOAST, and any `SELECT ... embedding ...` detoasts it. Same pattern exists on `learn_keywords`, `learn_practice_problems`, `learn_diagnostic_problems`, `problems`, `rag_examples`, `mcat_questions`, `math_questions` (all carry JSONB `embedding`).

**Proposal:** After confirming `embedding_vec` is fully backfilled and no code path reads JSONB `embedding`:
- For `math_keywords`/`mcat_keywords`: `ALTER TABLE ... DROP COLUMN embedding` (the JSONB one). **Blocker today:** `loadTargetKeywords` and the next-question exemplar lookup still read JSONB `embedding` (see §6) — migrate those to `embedding_vec` first, then drop.
- For other tables, give each its own `embedding_vec` + HNSW only where a similarity scan exists; elsewhere the JSONB embedding may be unused at runtime and is a candidate for archival/drop.

**Why:** Removes the largest per-row payload from keyword tables, shrinks table + TOAST size, and means full-keyword pulls (taxonomy, tagging) stop detoasting tens of KB per row. Directly cuts the disk reads behind the whole-course keyword scans.
**Effort:** Low (single DROP per table). **Risk:** Med — irreversible; must verify every reader migrated to `embedding_vec` first and that the backfill covered all rows. **Migration:** Yes.

---

## 6. JSONB pulled into hot paths in `loadTargetKeywords`

**What:** `lib/mathTagging.ts::loadTargetKeywords` (called by every `math/next-question`) selects `embedding, concept_blueprint` for **the whole course's keyword set** (1700+ rows, paginated past the 1000-cap). `embedding` is ~30 KB JSONB and `concept_blueprint` is also JSONB — both TOASTed, both detoasted on every next-question request, for keywords that mostly aren't used in scoring. The route only needs the embedding of `weakestKws[0]` and only uses `concept_blueprint` for the 1-2 generation keywords.

**Proposal:** Split the load:
- Hot path: `loadTargetKeywords` selects only `id, label, description, tier, parent_keyword_id, category_id, yield_score` (no JSONB).
- Lazily fetch `concept_blueprint` only for the 1-2 `weakestKws` actually sent to generation, and the exemplar embedding only for `weakestKws[0]` (the route already does a separate `.select("embedding").eq("id", weakestKws[0].id)` — keep that, and once §5 lands switch it to `embedding_vec` + an HNSW exemplar RPC).

**Why:** Removes a multi-megabyte detoast (1700 rows × ~30 KB embedding + blueprint) from the **stored-question serve path**, which is the common case (most next-question calls serve from stored and never generate). This is pure waste on the hottest read.
**Effort:** Low (code-only, no migration). **Risk:** Low. **Migration:** No.

---

## 7. Data lifecycle — events retention / rollup

**What:** `student_events` grows unbounded with no retention. On Nano, a large append-only table inflates autovacuum scans, index size, and backup IO over time.

**Proposal:**
- After §1's rollup consumes raw events, either (a) **range-partition `student_events` by `created_at` (monthly)** and `DETACH`/drop old partitions — cheap, no row-by-row delete IO; or (b) a nightly `DELETE FROM student_events WHERE created_at < now() - interval '90 days'` if a partition migration is too heavy. Partitioning is preferred because bulk DELETE itself burns IO and bloats.
- Consider moving `student_events` to an **`UNLOGGED` table or a separate analytics schema** if the data is non-critical telemetry — UNLOGGED skips WAL entirely (huge IOPS win on insert) at the cost of not surviving a crash, which is acceptable for best-effort telemetry that's already fail-soft.

**Why:** Bounds the busiest table's size; UNLOGGED removes WAL from the highest-volume insert path. Both directly reduce sustained IO.
**Effort:** Med (partitioning) / Low (UNLOGGED or TTL delete). **Risk:** Low (telemetry is already best-effort/fail-soft). **Migration:** Yes.

---

## 8. Whole-course keyword pulls — 1000-row pager → RPC / matview

**What:** `lib/mathPagedQuery.ts::fetchAllPages` exists solely to work around PostgREST's 1000-row cap, and is used by `math/taxonomy` and `loadTargetKeywords` to pull a full course's 1700+ keywords in 2 round-trips. Even cached (taxonomy is, 5-min TTL), the *first* request after each cache expiry / cold start does the full multi-page pull; `loadTargetKeywords` is **not** cached and pays it every next-question.

**Proposal:**
- Replace the multi-page keyword pull with a single **server-side RPC** (`get_math_taxonomy(p_course)`) that returns the assembled, projected keyword set in one call (no 1000-row cap inside SQL, no JSONB). Same for the next-question keyword scope.
- Or a **materialized view** `math_taxonomy_mv(course, category_id, keyword fields...)` refreshed on content change / nightly, served in one indexed read.

**Why:** Collapses 2+ paged round-trips into one DB call and lets the projection exclude JSONB at the source. Pairs with §6 to make the next-question keyword load trivial.
**Effort:** Med. **Risk:** Low. **Migration:** Yes (RPC or matview).

---

## 9. Autovacuum / dead-tuple tuning for high-churn tables

**What:** `math_student_keyword_states` / `mcat_student_keyword_states` are upserted on **every answer** (1-2 row UPDATEs per attempt via the `math/attempt` upsert) — high churn, many dead tuples. `student_sessions` has a `BEFORE UPDATE` trigger bumping `updated_at` (churn on session activity). `student_events` is insert-heavy. Default autovacuum thresholds (20% of table) are too lax for these — bloat accumulates, scans slow, IO rises.

**Proposal:** Per-table autovacuum tuning:
- `*_student_keyword_states`: `ALTER TABLE ... SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_cost_delay = 2)` so it vacuums more often in smaller bites.
- `student_events`: more aggressive `autovacuum_vacuum_insert_scale_factor` (or rely on partitioning from §7).
- Consider `fillfactor = 80-90` on the states tables so UPDATEs stay HOT (in-page) and avoid index writes.

**Why:** Smaller, more frequent vacuums prevent the large stop-the-world IO spikes that compound burst exhaustion; HOT updates avoid index churn on the per-answer upsert.
**Effort:** Low (ALTER TABLE). **Risk:** Low. **Migration:** Yes (ALTER statements).

---

## 10. Read scaling — materialized views for progress / leaderboard

**What:** `learn/progress` and `math/taxonomy` reassemble a 3-level tree (category → umbrella → in_depth) with per-session aggregates in JS on every request, reading the full keyword set + all session states. Gamification/streaks (`user_streaks`) are a natural leaderboard source. None are pre-aggregated.

**Proposal:**
- **Progress:** keep the shared taxonomy in a matview (§8); per-session aggregation can stay live (it's per-user and small per session) but route it via `getReadClient()` (§12).
- **Leaderboard:** a matview over `user_streaks` (and/or per-user attempt counts) refreshed every few minutes, served from the replica — never compute a top-N leaderboard live against the primary.

**Why:** Moves repeated aggregation off the primary and onto cached/replica reads.
**Effort:** Med. **Risk:** Med (matview staleness; concurrent refresh needs a unique index). **Migration:** Yes.

---

## 11. Missing FK / lookup indexes

**What:** A few hot filter/lookup columns lack indexes:
- `student_topic_priorities`: queries filter by `(session_id, system, active)` and `(session_id, system, keyword_id)`. There's a partial unique `uq_stp_active(session_id, system, keyword_id) WHERE active` and `idx_stp_session_active(session_id, active)`, but the very common `loadActivePriorities` filter is `session_id + system + active` — the existing partial unique covers it for active rows, so this is likely **OK**; confirm the planner uses it. `user_id` (FK-like, used for per-user priority listing) is unindexed.
- `math_question_attempts` / `mcat_question_attempts`: `question_id` is indexed; the §1 rollup will instead hit `student_events`, so no new attempt index needed beyond §2.
- `student_problem_attempts`: already has both FK indexes (good).

**Proposal:** Add `idx_stp_user_id ON student_topic_priorities(user_id) WHERE active` only if a per-user (cross-session) priority view exists; otherwise skip. Generally: index FK columns that appear in WHERE/JOIN and aren't already covered. Avoid adding speculative indexes on write-heavy tables (they cost insert IO — see §4).

**Why:** Targeted index coverage for real filters; equally important is **not** over-indexing write-hot tables.
**Effort:** Low. **Risk:** Low. **Migration:** Yes.

---

## 12. Route remaining read-only handlers through the replica

**What:** `lib/supabaseRead.ts::getReadClient()` exists and is used by `math/taxonomy` and `math/search`. Other read-only handlers still use `createClient` against the primary: `learn/progress`, `learn/topics`, `mcat/taxonomy` (verify), `priority` GET, and the read portions of next-question.

**Proposal:** Switch all genuinely read-only handlers to `getReadClient()`. Leave all writes (attempts, events, session, priority POST/DELETE, auth, streak) on the primary — the helper's own docstring warns about this. When `SUPABASE_REPLICA_URL` is unset it's a no-op (falls back to primary), so this is safe to land before a replica exists.

**Why:** Once a replica is provisioned (owner action in `scaling-infra.md`), these reads immediately offload from the primary with zero further code change. Cheap to do now.
**Effort:** Low (swap client constructor). **Risk:** Low. **Migration:** No.

---

## §5 Connection & pooling note

- All `apps/student` DB access is via `@supabase/supabase-js` over PostgREST → **Supavisor** pooling; no direct `postgres://` / `pg`/`Pool` connections were found. Good — no per-request direct-connection exhaustion risk.
- Each route calls `createClient(...)` per request. The supabase-js client is stateless over HTTP (no held DB connection), so this is fine for memory but creates a new fetch client per request; `getReadClient()` already memoizes by URL — consider a similarly memoized primary client to avoid per-request client construction (micro-optimization, not IO).
- Confirm serverless functions use the **transaction-mode pooler** connection (port 6543 / Supavisor) for any future direct-SQL needs, never the direct 5432 endpoint, to avoid connection storms from Vercel's many concurrent lambdas.

---

## What to do first (if approving incrementally)

1. **§1** (append-only events + cron rollup) and **§6** (drop JSONB from `loadTargetKeywords`) — biggest IO relief, §6 is code-only/zero-risk.
2. **§3** (GIN + narrow projection on next-question) and **§4** (trim events indexes) — low effort, high write/read IO savings.
3. **§2** (attempt uniqueness) — needs a quick audit of duplicate-row reliance, then low-risk.
4. **§5** (drop legacy JSONB embeddings) once §6 + §8 migrate readers to `embedding_vec`.
5. **§7 / §9** (lifecycle + autovacuum) — sustained-IO hygiene once the above land.
