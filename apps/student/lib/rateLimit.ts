/**
 * rateLimit.ts — zero-dependency sliding/fixed-window rate limiter for the
 * Lodera student app. Protects the tiny Nano Supabase DB from runaway clients
 * and abuse by capping requests per identity per time window.
 *
 * BACKENDS (auto-selected):
 *   1. Upstash Redis (DURABLE, recommended for prod / multi-instance):
 *      Used when BOTH `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
 *      are set. Implemented as a fixed-window counter over the Upstash REST API
 *      using plain `fetch` (INCR + EXPIRE-on-first-hit). The Upstash REST API
 *      works on the Edge runtime (no TCP socket needed), so this is safe to call
 *      from Next.js middleware.
 *
 *   2. In-process Map (BEST-EFFORT, per-instance):
 *      Used when Upstash env vars are absent. A fixed-window counter keyed by
 *      `key:windowBucket`, with periodic cleanup of stale buckets. Because the
 *      counter lives in module memory, limits are enforced per server instance
 *      only — serverless scale-out / multiple regions each get their own
 *      counter. Good enough to stop a single runaway client/script; use Upstash
 *      when you need a global, durable limit.
 *
 * FAIL-OPEN: any backend error (network failure, bad response, etc.) returns
 * `{ success: true }` so a broken limiter never blocks real users.
 */

interface RateLimitResult {
  success: boolean;
  remaining: number;
}

// ---------------------------------------------------------------------------
// In-memory fixed-window backend
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  // Absolute ms timestamp at which this window bucket expires and can be GC'd.
  expiresAt: number;
}

// Module-scoped store. Persists for the lifetime of the server instance.
const memoryStore: Map<string, Bucket> = new Map();
let lastCleanup = 0;
// Run stale-bucket cleanup at most this often to keep the map from growing.
const CLEANUP_INTERVAL_MS = 60_000;

function cleanupMemoryStore(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [k, bucket] of memoryStore) {
    if (bucket.expiresAt <= now) memoryStore.delete(k);
  }
}

function rateLimitMemory(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  cleanupMemoryStore(now);

  const bucketIndex = Math.floor(now / windowMs);
  const bucketKey = `${key}:${bucketIndex}`;

  let bucket = memoryStore.get(bucketKey);
  if (!bucket || bucket.expiresAt <= now) {
    bucket = { count: 0, expiresAt: (bucketIndex + 1) * windowMs };
    memoryStore.set(bucketKey, bucket);
  }

  bucket.count += 1;
  const remaining = Math.max(0, max - bucket.count);
  return { success: bucket.count <= max, remaining };
}

// ---------------------------------------------------------------------------
// Upstash Redis (REST) fixed-window backend
// ---------------------------------------------------------------------------

async function rateLimitUpstash(
  url: string,
  token: string,
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  const bucketIndex = Math.floor(Date.now() / windowMs);
  const redisKey = `rl:${key}:${bucketIndex}`;
  const ttlSeconds = Math.ceil(windowMs / 1000);

  // Pipeline: INCR the counter, then EXPIRE (idempotent — re-setting the TTL
  // each hit is harmless and guarantees the key self-destructs).
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, ttlSeconds],
    ]),
    // Never let the limiter hang a request.
    signal: AbortSignal.timeout(2000),
  });

  if (!res.ok) {
    throw new Error(`Upstash responded ${res.status}`);
  }

  const data: Array<{ result?: number; error?: string }> = await res.json();
  const incr = data?.[0];
  if (!incr || typeof incr.result !== "number") {
    throw new Error("Upstash returned unexpected payload");
  }

  const count = incr.result;
  const remaining = Math.max(0, max - count);
  return { success: count <= max, remaining };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Increment the counter for `key` and report whether the caller is within the
 * `max` requests / `windowMs` window. Fails open on any error.
 */
export async function rateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      return await rateLimitUpstash(url, token, key, max, windowMs);
    }

    return rateLimitMemory(key, max, windowMs);
  } catch {
    // FAIL-OPEN: a broken limiter must never block real users.
    return { success: true, remaining: max };
  }
}
