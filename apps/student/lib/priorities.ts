/**
 * Server-side helpers for the "prioritize this topic" feature and generic
 * server-side telemetry. Everything here is FAIL-SOFT: if the underlying tables
 * (student_topic_priorities / student_events) are missing because migration
 * 20260615000000 has not been applied to the live DB, these helpers degrade to
 * a no-op / empty result instead of throwing.
 */
import { SupabaseClient } from "@supabase/supabase-js";

/** Improvement margin applied to baseline mastery when a topic is prioritized. */
export const PRIORITY_TARGET_MARGIN = 0.2;

/** Selection-score multiplier applied to questions whose top keyword is prioritized. */
export const PRIORITY_BOOST_FACTOR = 2.5;

export type ActivePriority = {
  keyword_id: string;
  target_score: number;
};

/**
 * Load the set of active prioritized keyword ids for a session + system.
 * Returns an empty Set (and empty target map) when the table is missing.
 */
export async function loadActivePriorities(
  supabase: SupabaseClient,
  sessionId: string,
  system: "math" | "mcat"
): Promise<{ ids: Set<string>; targets: Map<string, number> }> {
  try {
    const { data, error } = await supabase
      .from("student_topic_priorities")
      .select("keyword_id, target_score")
      .eq("session_id", sessionId)
      .eq("system", system)
      .eq("active", true);

    if (error || !data) return { ids: new Set(), targets: new Map() };

    const ids = new Set<string>();
    const targets = new Map<string, number>();
    for (const row of data) {
      const kid = row.keyword_id as string;
      ids.add(kid);
      targets.set(kid, (row.target_score as number) ?? 1);
    }
    return { ids, targets };
  } catch {
    return { ids: new Set(), targets: new Map() };
  }
}

/**
 * Best-effort server-side telemetry insert into student_events.
 * Never throws; failures (missing table, db error) are swallowed.
 */
export async function logServerEvent(
  supabase: SupabaseClient,
  row: {
    event_type: string;
    system?: string | null;
    session_id?: string | null;
    user_id?: string | null;
    course?: string | null;
    keyword_id?: string | null;
    question_id?: string | null;
    content_type?: string | null;
    correct?: boolean | null;
    time_ms?: number | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabase.from("student_events").insert({
      event_type: row.event_type,
      system: row.system ?? null,
      session_id: row.session_id ?? null,
      user_id: row.user_id ?? null,
      course: row.course ?? null,
      keyword_id: row.keyword_id ?? null,
      question_id: row.question_id ?? null,
      content_type: row.content_type ?? null,
      correct: typeof row.correct === "boolean" ? row.correct : null,
      time_ms: typeof row.time_ms === "number" ? row.time_ms : null,
      metadata: row.metadata ?? {},
    });
  } catch {
    // swallow — telemetry must never affect the request
  }
}

/**
 * After a keyword score is updated by an attempt, resolve any active priority for
 * that (session, system, keyword) whose target_score has now been met.
 * Returns the keyword ids that were resolved (for downstream event logging).
 * Fail-soft: returns [] when the table is missing.
 */
export async function autoResolvePriorities(
  supabase: SupabaseClient,
  sessionId: string,
  system: "math" | "mcat",
  scoresByKeyword: Map<string, number>
): Promise<string[]> {
  if (scoresByKeyword.size === 0) return [];
  try {
    const { data, error } = await supabase
      .from("student_topic_priorities")
      .select("id, keyword_id, target_score")
      .eq("session_id", sessionId)
      .eq("system", system)
      .eq("active", true)
      .in("keyword_id", Array.from(scoresByKeyword.keys()));

    if (error || !data || data.length === 0) return [];

    const toResolve: string[] = [];
    const resolvedKeywords: string[] = [];
    for (const row of data) {
      const kid = row.keyword_id as string;
      const target = (row.target_score as number) ?? 1;
      const score = scoresByKeyword.get(kid);
      if (score !== undefined && score >= target) {
        toResolve.push(row.id as string);
        resolvedKeywords.push(kid);
      }
    }

    if (toResolve.length === 0) return [];

    await supabase
      .from("student_topic_priorities")
      .update({ active: false, resolved_at: new Date().toISOString() })
      .in("id", toResolve);

    return resolvedKeywords;
  } catch {
    return [];
  }
}
