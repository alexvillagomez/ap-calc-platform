/**
 * supabaseRead — read-replica routing for read-only queries.
 *
 * getReadClient() returns a supabase-js client pointed at a Supabase read
 * replica when one is configured, so SELECT/RPC load can be taken off the
 * primary Nano Postgres instance.
 *
 * To enable replica routing: set SUPABASE_REPLICA_URL to a Supabase read
 * replica's REST URL (e.g. https://<replica-ref>.supabase.co). Read-only route
 * handlers that call getReadClient() will then hit the replica. When the env is
 * unset we fall back to the primary NEXT_PUBLIC_SUPABASE_URL — i.e. current
 * behavior, fully backward compatible.
 *
 * IMPORTANT: use this ONLY for read-only handlers. Writes (attempts, events,
 * sessions, priority, auth) must keep using the primary client so they are not
 * routed to a read-only replica.
 *
 * Clients are memoized per URL so we don't create a new connection per request.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const clients = new Map<string, SupabaseClient>();

export function getReadClient(): SupabaseClient {
  const url =
    process.env.SUPABASE_REPLICA_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase not configured (missing URL or key)");
  }

  const existing = clients.get(url);
  if (existing) return existing;

  const client = createClient(url, key);
  clients.set(url, client);
  return client;
}
