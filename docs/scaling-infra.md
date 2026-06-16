# Scaling infrastructure — setup & runbook

Context: the student app runs against a Supabase **Nano** instance (43 Mbps baseline disk IO, 30-min/day burst). On 2026-06-15 a day of automated traffic exhausted the burst budget → throttling → auth 500s and 521s. This doc covers the scaling work and the steps only the account owner can do.

## Code-level work already shipped (no action needed beyond deploy + migrate)
- **pgvector search** — `supabase/migrations/20260615000001_pgvector_search.sql`; search runs in-DB via HNSW index instead of scanning all embeddings in JS. **(Biggest IO fix.)**
- **Caching** — `lib/serverCache.ts` (`cached()` / `invalidate()`), applied to the math/mcat taxonomy routes (TTL 5 min). In-memory by default; uses Upstash Redis if env set.
- **Read-replica routing** — `lib/supabaseRead.ts` (`getReadClient()`); read-only routes (taxonomy, search) use it. Falls back to primary when no replica env.
- **Rate limiting** — `middleware.ts` + `lib/rateLimit.ts` on `/api/*`. Tiers (10s window): expensive (lesson/refresher/search/quiz/next-question/lookup) = 20, auth = 15, default = 120. Fail-open. In-memory by default; Upstash if env set.

## Migrations to apply manually (Supabase → SQL Editor), in order
1. `supabase/migrations/20260615000000_features_v2.sql`
2. `supabase/migrations/20260615000001_pgvector_search.sql`
(No `exec_sql` RPC + no direct Postgres URL = DDL cannot be applied programmatically.)

## Environment variables to set (Vercel project + local `.env.local`)
| Var | Purpose | Without it |
|-----|---------|-----------|
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Durable, multi-instance cache + rate limiting | In-memory (per-serverless-instance, resets on cold start) |
| `SUPABASE_REPLICA_URL` | Route read-only queries to a read replica | Reads hit the primary |
| `RATE_LIMIT_DISABLED=1` | Emergency off-switch for rate limiting | Limiting on (recommended) |

## Owner-only dashboard / billing actions (I cannot do these — they cost money / need dashboard access)

### 1. Upgrade compute + provisioned disk IOPS  ⚠️ required for real traffic
Supabase Dashboard → **Project Settings → Compute and Disk**.
- Upgrade off **Nano**: Small for low-hundreds of light users; Medium/Large for hundreds active; XL–2XL for thousands.
- On the Pro plan, raise **provisioned disk IOPS and throughput** above the Nano 43 Mbps baseline.
- Requires the **Pro plan** ($25/mo) for most of these knobs.

### 2. Add a read replica
Dashboard → **Database → Read Replicas** (Pro plan add-on). After it provisions, copy its REST URL into `SUPABASE_REPLICA_URL`. The code already routes reads to it.

### 3. Provision Upstash Redis (free tier exists)
Create a Redis DB at upstash.com (or via Vercel Marketplace → Upstash). Copy the REST URL + token into `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Cache + rate limiting become durable across all serverless instances automatically.

## Still-recommended code follow-up (not yet done)
- **Append-only events + batched rollup**: `/api/events` currently does a synchronous read-modify-write of `est_time_ms` on the question row per `timer_stop` → hot-row write contention at scale. Make events append-only and compute `est_time_ms` in a periodic cron/rollup. (Highest remaining scale risk.)
- **Pre-generate lessons/refreshers** for all keywords offline so OpenAI isn't in the request hot path.
