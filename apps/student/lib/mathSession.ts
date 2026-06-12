/**
 * Math session helper — reuses the same student session as MCAT.
 * Requires a logged-in account. If no account in localStorage,
 * redirects to /login?next=<current path> and never resolves.
 */
const ACCOUNT_KEY = "ap_calc_account_id";
const SESSION_KEY = "ap_calc_student_session_id";
const MATH_COURSE_KEY = "math_last_course";

export type MathCourseId = "precalc" | "calc_ab";

export async function getOrCreateMathSession(): Promise<string> {
  const accountId = localStorage.getItem(ACCOUNT_KEY);
  if (!accountId) {
    const next = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.href = `/login?next=${next}`;
    return new Promise<string>(() => {});
  }

  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }

  await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: id }),
  }).catch(() => {});

  return id;
}

export function getLastMathCourse(): MathCourseId {
  if (typeof window === "undefined") return "precalc";
  const stored = localStorage.getItem(MATH_COURSE_KEY);
  if (stored === "precalc" || stored === "calc_ab") return stored;
  return "precalc";
}

export function setLastMathCourse(course: MathCourseId) {
  if (typeof window !== "undefined") {
    localStorage.setItem(MATH_COURSE_KEY, course);
  }
}
