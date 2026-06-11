/**
 * MCAT session helper — REQUIRES a logged-in account, then resolves the shared
 * ap_calc_student_session_id and ensures the student_sessions row exists.
 *
 * MCAT is login-gated: every /mcat page calls this on mount, so if there is no
 * account in localStorage we redirect to /login?next=<current path> and never
 * resolve (the page keeps its loading state until navigation happens).
 */
const ACCOUNT_KEY = "ap_calc_account_id";
const SESSION_KEY = "ap_calc_student_session_id";

export async function getOrCreateMcatSession(): Promise<string> {
  // ── Auth gate ──────────────────────────────────────────────────────────────
  const accountId = localStorage.getItem(ACCOUNT_KEY);
  if (!accountId) {
    const next = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.href = `/login?next=${next}`;
    // Navigation is underway — return a promise that never resolves so callers
    // stay in their loading state instead of proceeding without a session.
    return new Promise<string>(() => {});
  }

  // Logged in: login/register set SESSION_KEY to the account's session id.
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }

  // Bootstrap the row in student_sessions (no-op if it already exists)
  await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: id }),
  }).catch(() => {
    // Non-fatal — session row may already exist or network is temporarily down
  });

  return id;
}
