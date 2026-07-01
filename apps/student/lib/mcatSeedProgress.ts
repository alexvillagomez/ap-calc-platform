/**
 * mcatSeedProgress.ts — shared helper for pre-seeding MCAT keyword ability from
 * an external confidence signal (Anki import or manual self-rating).
 *
 * Uses the IRT seeding primitive from lib/courseEngine/mcatIrt.ts:
 *   seedFromImport(confidence) → { ability, attempts }
 * where the low `attempts` value keeps uncertainty high so the first few real
 * practice attempts self-correct the import quickly.
 *
 * This helper is intentionally a plain async function (not a Next.js route) so
 * both /api/mcat/seed-progress and /api/mcat/import can share it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { seedFromImport } from "@/lib/courseEngine/mcatIrt";
import { sectionFromId, type McatSection } from "@/lib/mcatSection";

/**
 * Pre-seed `mcat_student_keyword_states` from a per-keyword confidence map.
 *
 * @param supabase       Service-role Supabase client.
 * @param sessionId      Student session id (must correspond to a student_sessions row).
 * @param section        The MCAT section these confidence scores apply to. Only
 *                       keywords whose id maps to this section are seeded.
 * @param confidenceByKeyword  Map of keyword_id → confidence [0–1].
 * @returns The number of keyword rows actually upserted.
 */
export async function seedKeywordProgress(
  supabase: SupabaseClient,
  sessionId: string,
  section: McatSection,
  confidenceByKeyword: Record<string, number>
): Promise<number> {
  // Ensure the session row exists — required by the FK on mcat_student_keyword_states.
  // Use upsert with ignoreDuplicates (ON CONFLICT DO NOTHING) — safe to call even
  // if the session was already created by /api/session.
  const { error: sessionErr } = await supabase
    .from("student_sessions")
    .upsert({ id: sessionId }, { onConflict: "id", ignoreDuplicates: true });

  if (sessionErr) {
    // Non-fatal: log and continue — the row may already exist.
    console.warn("[mcatSeedProgress] session ensure warning:", sessionErr.message);
  }

  const keywordIds = Object.keys(confidenceByKeyword);
  if (keywordIds.length === 0) return 0;

  // Look up which of the requested keyword ids actually exist in mcat_keywords,
  // fetching category_id for the upsert and the id so we can filter by section.
  const { data: kwRows, error: kwErr } = await supabase
    .from("mcat_keywords")
    .select("id, category_id")
    .in("id", keywordIds);

  if (kwErr) {
    console.error("[mcatSeedProgress] keyword lookup failed:", kwErr.message);
    return 0;
  }

  const now = new Date().toISOString();

  // Keep only keywords that exist AND whose id maps to the requested section.
  const upserts: Array<{
    session_id: string;
    keyword_id: string;
    category_id: string | null;
    score: number;
    ability_attempts: number;
    state: string;
    last_practiced_at: string;
    last_review_at: string;
    updated_at: string;
  }> = [];

  for (const row of kwRows ?? []) {
    const kwId = row.id as string;
    const kwSection = sectionFromId(kwId);
    if (kwSection !== section) continue;

    const confidence = confidenceByKeyword[kwId] ?? 0;
    const { ability, attempts } = seedFromImport(confidence);

    upserts.push({
      session_id: sessionId,
      keyword_id: kwId,
      category_id: (row.category_id as string | null) ?? null,
      score: ability,
      ability_attempts: attempts,
      state: "in_progress",
      last_practiced_at: now,
      last_review_at: now,
      updated_at: now,
    });
  }

  if (upserts.length === 0) return 0;

  const { error: upsertErr } = await supabase
    .from("mcat_student_keyword_states")
    .upsert(upserts, { onConflict: "session_id,keyword_id" });

  if (upsertErr) {
    console.error("[mcatSeedProgress] upsert failed:", upsertErr.message);
    // Partial — we tried. Return 0 to signal nothing was written.
    return 0;
  }

  return upserts.length;
}
