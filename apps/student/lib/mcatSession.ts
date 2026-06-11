/**
 * MCAT session helper — reads/creates the shared ap_calc_student_session_id
 * and ensures the student_sessions row exists via POST /api/session.
 */
export async function getOrCreateMcatSession(): Promise<string> {
  const KEY = "ap_calc_student_session_id";

  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
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
