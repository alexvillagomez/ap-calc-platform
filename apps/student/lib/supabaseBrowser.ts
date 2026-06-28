/**
 * Browser Supabase client (Supabase Auth = single source of truth).
 *
 * Uses @supabase/ssr's createBrowserClient so the GoTrue session (access +
 * refresh JWT) is stored in cookies that the server (route handlers, middleware,
 * server components) can read. This replaces the old custom `lodera_uid` cookie
 * and the per-browser `ap_calc_student_session_id` localStorage id.
 *
 * Singleton — one client per tab.
 */
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (client) return client;
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return client;
}
