/**
 * Client-side telemetry helper.
 *
 * `trackEvent` is fire-and-forget: it POSTs one event to /api/events with
 * `keepalive` (so it survives page navigation) and swallows every error.
 * It NEVER throws — telemetry must never break a user flow.
 */

export type StudentEvent = {
  event_type: string; // required, e.g. 'answer' | 'timer_stop' | 'refresher_used' | ...
  session_id?: string;
  system?: "math" | "mcat" | "precalc";
  course?: string;
  keyword_id?: string;
  question_id?: string;
  content_type?: "question" | "flashcard" | "lesson" | "quiz";
  correct?: boolean;
  time_ms?: number;
  metadata?: Record<string, unknown>;
};

/** Fire-and-forget event tracking. Never throws, never blocks. */
export function trackEvent(event: StudentEvent): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // swallow — telemetry must never surface errors
  }
}
