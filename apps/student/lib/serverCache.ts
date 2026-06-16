/**
 * serverCache — a tiny, zero-dependency server-side cache for shared,
 * slow-changing reads (taxonomy/category lists). The whole point is to take
 * read load off the Nano Supabase Postgres instance.
 *
 * TWO BACKENDS, auto-selected by env:
 *   - UPSTASH (durable, multi-instance): if both UPSTASH_REDIS_REST_URL and
 *     UPSTASH_REDIS_REST_TOKEN are set, values are stored in Upstash Redis over
 *     its REST API using plain fetch (SET ... EX for writes, GET for reads,
 *     DEL for invalidation). This survives across serverless instances and
 *     deploys, so a cold instance still benefits from a warm cache.
 *   - IN-MEMORY (best-effort, per-instance): otherwise an in-process Map with
 *     per-key expiry timestamps and a max-size LRU-ish eviction. NOTE: this is
 *     per-serverless-instance only — each lambda/instance has its own Map, so a
 *     fresh instance starts cold. Good enough to absorb repeat reads within a
 *     warm instance; set the Upstash env vars for a durable shared cache.
 *
 * FAIL-OPEN: caching must never break a request. If the backend errors, we
 * silently fall through to running producer() and return its result.
 */

const DEFAULT_MAX_ENTRIES = 500;

// ── In-memory backend ───────────────────────────────────────────────────────
type MemEntry = { value: string; expiresAt: number };
const memStore = new Map<string, MemEntry>();

function memGet(key: string): string | null {
  const entry = memStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memStore.delete(key);
    return null;
  }
  // Touch for recency: re-insert so iteration order = least-recently-used first.
  memStore.delete(key);
  memStore.set(key, entry);
  return entry.value;
}

function memSet(key: string, value: string, ttlMs: number): void {
  // Evict oldest entries once we exceed the cap (Map preserves insertion order).
  while (memStore.size >= DEFAULT_MAX_ENTRIES) {
    const oldest = memStore.keys().next().value;
    if (oldest === undefined) break;
    memStore.delete(oldest);
  }
  memStore.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function memDel(key: string): void {
  memStore.delete(key);
}

// ── Upstash REST backend ────────────────────────────────────────────────────
function upstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

async function upstashCommand(
  cfg: { url: string; token: string },
  parts: string[]
): Promise<unknown> {
  const path = parts.map((p) => encodeURIComponent(p)).join("/");
  const res = await fetch(`${cfg.url}/${path}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const json = (await res.json()) as { result?: unknown };
  return json.result ?? null;
}

async function upstashGet(
  cfg: { url: string; token: string },
  key: string
): Promise<string | null> {
  const result = await upstashCommand(cfg, ["GET", key]);
  return typeof result === "string" ? result : null;
}

async function upstashSet(
  cfg: { url: string; token: string },
  key: string,
  value: string,
  ttlMs: number
): Promise<void> {
  const ttlSec = Math.max(1, Math.round(ttlMs / 1000));
  await upstashCommand(cfg, ["SET", key, value, "EX", String(ttlSec)]);
}

async function upstashDel(
  cfg: { url: string; token: string },
  key: string
): Promise<void> {
  await upstashCommand(cfg, ["DEL", key]);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the cached JSON value for `key` if still fresh; otherwise runs
 * `producer()`, stores its result for `ttlMs`, and returns it. Never throws on
 * cache-backend failure — falls open to producer().
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>
): Promise<T> {
  const cfg = upstashConfig();

  // Read from cache (fail-open on any error).
  try {
    const raw = cfg ? await upstashGet(cfg, key) : memGet(key);
    if (raw != null) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // ignore — fall through to producer
  }

  const value = await producer();

  // Write to cache (fail-open: a failed write must not break the response).
  try {
    const raw = JSON.stringify(value);
    if (cfg) {
      await upstashSet(cfg, key, raw, ttlMs);
    } else {
      memSet(key, raw, ttlMs);
    }
  } catch {
    // ignore — value is already computed and returned below
  }

  return value;
}

/** Remove a key from whichever backend is active. Fail-open. */
export async function invalidate(key: string): Promise<void> {
  const cfg = upstashConfig();
  try {
    if (cfg) {
      await upstashDel(cfg, key);
    } else {
      memDel(key);
    }
  } catch {
    // ignore — invalidation is best-effort
  }
}
