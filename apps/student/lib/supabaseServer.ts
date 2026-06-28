/**
 * Server Supabase client bound to the request cookies (Supabase Auth source of
 * truth). Use in Route Handlers / Server Components to read the AUTHENTICATED
 * user from the GoTrue session cookie:
 *
 *   const supabase = await supabaseServer();
 *   const { data: { user } } = await supabase.auth.getUser();
 *
 * This is the secure way to identify the caller — server routes derive the uid
 * from the verified session, not from a client-supplied id.
 *
 * Note: data-access routes still use the service-role client for DB reads/writes
 * (RLS is a fast-follow); this client is for AUTH identity + auth.* calls.
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component where mutation isn't allowed —
            // safe to ignore; middleware refreshes the session cookie instead.
          }
        },
      },
    }
  );
}

/** Convenience: the authenticated user's id (uid), or null if not signed in. */
export async function getAuthUid(): Promise<string | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
