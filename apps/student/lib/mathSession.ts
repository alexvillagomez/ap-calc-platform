/**
 * Math session helper — Supabase Auth is the source of truth (shares the same
 * student session anchor as MCAT). Returns the authenticated user's uid and
 * ensures a `student_sessions` row keyed by that uid exists. Redirects to
 * /login?next=<path> if there is no session.
 */
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const MATH_COURSE_KEY = "math_last_course";

export type MathCourseId = "precalc" | "calc_ab";

export async function getOrCreateMathSession(): Promise<string> {
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

  await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: user.id }),
  }).catch(() => {});

  return user.id;
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
