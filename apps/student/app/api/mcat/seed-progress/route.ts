/**
 * POST /api/mcat/seed-progress
 *
 * Manually seed MCAT keyword abilities from a confidence slider pass.
 * Accepts per-keyword confidence values (0–1) and translates them to
 * high-uncertainty IRT ability seeds via seedFromImport().
 *
 * Body (application/json):
 *   {
 *     session_id: string;
 *     section: "biology" | "psych_soc" | "physics" | "chemistry";
 *     seeds: { keyword_id: string; confidence: number }[];
 *   }
 *
 * Response:
 *   { keywords_seeded: number }
 *
 * This is one of two seeding entry points (the other is /api/mcat/import for
 * Anki decks). Both call the same seedKeywordProgress primitive so seeding
 * behaviour is identical regardless of the source.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { MCAT_SECTION_ORDER, type McatSection } from "@/lib/mcatSection";
import { seedKeywordProgress } from "@/lib/mcatSeedProgress";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  let body: {
    session_id?: string;
    section?: string;
    seeds?: { keyword_id: string; confidence: number }[];
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { session_id, section, seeds } = body;

  // ── Validation ────────────────────────────────────────────────────────────────
  if (!session_id || typeof session_id !== "string") {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 }
    );
  }
  if (!section || !MCAT_SECTION_ORDER.includes(section as McatSection)) {
    return NextResponse.json(
      {
        error: `section is required and must be one of: ${MCAT_SECTION_ORDER.join(", ")}`,
      },
      { status: 400 }
    );
  }
  if (!Array.isArray(seeds) || seeds.length === 0) {
    return NextResponse.json(
      { error: "seeds must be a non-empty array of { keyword_id, confidence }" },
      { status: 400 }
    );
  }

  // Build a confidence map — last entry wins on duplicates.
  const confidenceByKeyword: Record<string, number> = {};
  for (const seed of seeds) {
    if (
      typeof seed.keyword_id !== "string" ||
      typeof seed.confidence !== "number"
    ) {
      continue;
    }
    // Clamp confidence to [0,1] defensively.
    confidenceByKeyword[seed.keyword_id] = Math.min(
      1,
      Math.max(0, seed.confidence)
    );
  }

  const supabase = createClient(supabaseUrl, key);

  const keywords_seeded = await seedKeywordProgress(
    supabase,
    session_id,
    section as McatSection,
    confidenceByKeyword
  );

  // Write a tiny audit row — no card content, just counters.
  const { error: auditErr } = await supabase
    .from("mcat_progress_imports")
    .insert({
      session_id,
      section,
      source: "manual",
      cards_parsed: 0,
      cards_matched: 0,
      cards_dropped: 0,
      keywords_seeded,
    });

  if (auditErr) {
    // Non-fatal — the seeding already happened; just log.
    console.error("[seed-progress] audit insert failed:", auditErr.message);
  }

  return NextResponse.json({ keywords_seeded });
}
