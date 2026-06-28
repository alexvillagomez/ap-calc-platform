/**
 * MCAT session helper — Supabase Auth is the source of truth.
 *
 * Returns the authenticated user's uid (from the Supabase GoTrue session) and
 * ensures a `student_sessions` row keyed by that uid exists, so every per-user
 * table (which keys on `session_id`) is now keyed by the auth uid. If there is
 * no session, redirects to /login?next=<path> and never resolves (callers stay
 * in their loading state). This replaces the old localStorage account/session id.
 */
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export async function getOrCreateMcatSession(): Promise<string> {
  const supabase = supabaseBrowser();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const next = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.href = `/login?next=${next}`;
    return new Promise<string>(() => {});
  }

  // Ensure the student_sessions anchor row (id = uid) exists for FK integrity.
  await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: user.id }),
  }).catch(() => {});

  return user.id;
}
