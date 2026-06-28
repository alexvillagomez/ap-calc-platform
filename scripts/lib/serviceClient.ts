/**
 * Shared service-role Supabase client for CLI scripts (seed/embed/backfill).
 *
 * Why this exists: `@supabase/supabase-js` eagerly constructs a RealtimeClient in
 * its constructor, and `@supabase/realtime-js` throws on Node.js < 22 when there is
 * no native global `WebSocket` ("Node.js 20 detected without native WebSocket
 * support"). Our scripts never use realtime, but the eager init still crashes
 * `createClient(...)` under Node 20 (the version on this machine).
 *
 * Fix: provide the `ws` constructor as the realtime transport (and disable
 * auto-reconnect / event handling we don't need). `ws` is already a transitive
 * dependency. This keeps the normal `npm run mcat:embed` / `math:embed` scripts
 * working on Node 20 without requiring a Node upgrade or a global polyfill.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

export function createServiceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Provide a WebSocket implementation so RealtimeClient init doesn't throw on
    // Node < 22. We don't open any channels, so this is never actually used.
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket,
    },
  });
}
