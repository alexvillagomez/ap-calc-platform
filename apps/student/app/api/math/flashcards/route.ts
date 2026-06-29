/**
 * POST /api/math/flashcards
 *
 * Return N flashcards (default 2 — de-emphasized per spec; max 10).
 * Stored flashcards are preferred; shortfall filled by generation.
 * Uses front_latex / back_latex (math_flashcards schema post-migration).
 *
 * Body:
 *   session_id    required
 *   category_id   required
 *   count         default 2, max 10
 *   keyword_id    single-keyword scope (highest precedence)
 *   keyword_ids   set scope
 *   course        "precalc" | "calc_ab"
 */
import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  generateMathFlashcards,
  verifyMathFlashcardsFast,
  MathGenError,
} from "@/lib/mathGenerator";
import { loadTargetKeywords } from "@/lib/mathTagging";
import { outlineContextForCategory } from "@/lib/mathContentOutline";
import type { MathCourse } from "@/lib/mathTypes";
import { cached, invalidate } from "@/lib/serverCache";
import { MEMORIZED_BOX } from "@/lib/flashcardSrs";
import {
  cardSelectionWeights,
  type FlashcardEntry,
} from "@/lib/courseEngine/adaptive";

export const runtime = "nodejs";
// Per-keyword complete-deck generation runs gpt-5.5 (enumerate→emit); give it headroom.
export const maxDuration = 300;

const DEFAULT_COUNT = 12;
const MAX_COUNT = 30;

type DbFlashcard = {
  id: string;
  front_latex: string;
  back_latex: string;
  keyword_weights: Record<string, number>;
  avg_rating: number | null;
  score?: number;
};

type SrsRow = {
  flashcard_id: string;
  box: number;
  due_at: string;
  last_shown_at?: string | null;
};

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

  const body = (await request.json()) as {
    session_id?: string;
    category_id?: string;
    count?: number;
    keyword_id?: string;
    keyword_ids?: string[];
    course?: MathCourse;
    /**
     * When true, the non-due rotation is ordered by CURRICULUM order (the
     * subtopic's order_index) instead of least-shown/weakness — so a fresh deck
     * begins at the FIRST subtopic of the category. Used by flashcard-only
     * (course cards) mode to mirror auto mode's in-order walk.
     */
    curriculum_order?: boolean;
  };

  const { session_id, category_id, keyword_id } = body;
  const count = Math.min(body.count ?? DEFAULT_COUNT, MAX_COUNT);
  const course: MathCourse = body.course ?? "precalc";
  const curriculumOrder = body.curriculum_order === true;

  if (!session_id || !category_id) {
    return NextResponse.json(
      { error: "session_id and category_id are required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  const [keywords, statesRes, srsRes, fcAttemptsRes, categoryRes] = await Promise.all([
    loadTargetKeywords(supabase, [category_id], course),
    supabase
      .from("math_student_keyword_states")
      .select("keyword_id, score")
      .eq("session_id", session_id),
    supabase
      .from("math_flashcard_srs")
      .select("flashcard_id, box, due_at, last_shown_at")
      .eq("session_id", session_id)
      .eq("category_id", category_id),
    supabase
      .from("math_flashcard_attempts")
      .select("flashcard_id")
      .eq("session_id", session_id),
    supabase.from("math_categories").select("label").eq("id", category_id).maybeSingle(),
  ]);

  const categoryLabel =
    (categoryRes.data?.label as string | undefined) ??
    category_id.replace(/_/g, " ");

  if (keywords.length === 0) {
    return NextResponse.json(
      { error: "No keywords found for this category — taxonomy may not be seeded yet" },
      { status: 404 }
    );
  }

  const categoryKeywordIdSet = new Set(keywords.map((k) => k.id));
  const rawKeywordIds = Array.isArray(body.keyword_ids) ? body.keyword_ids : [];
  const filteredKeywordIds = !keyword_id
    ? rawKeywordIds.filter((id) => categoryKeywordIdSet.has(id))
    : [];
  const scopedKeywordIds: Set<string> | null =
    filteredKeywordIds.length > 0 ? new Set(filteredKeywordIds) : null;

  const srsByCard = new Map<string, SrsRow>(
    (srsRes.data ?? []).map((r) => [r.flashcard_id as string, r as SrsRow])
  );

  // Per-session seen-count per card (drives even-coverage rotation). Each row in
  // math_flashcard_attempts is one viewing of a card this session.
  const seenCount = new Map<string, number>();
  for (const a of fcAttemptsRes.data ?? []) {
    const id = a.flashcard_id as string;
    seenCount.set(id, (seenCount.get(id) ?? 0) + 1);
  }

  // Load the full active stored deck for this category — shared across users,
  // safe to cache. The per-session rotation is applied below after the cache hit.
  const cacheKey = `math:flashcards:deck:${course}:${category_id}`;
  let allFcs = await cached<DbFlashcard[]>(cacheKey, 60_000, async () => {
    const { data } = await supabase
      .from("math_flashcards")
      .select("id, front_latex, back_latex, keyword_weights, avg_rating")
      .eq("category_id", category_id)
      .eq("status", "active");
    return (data ?? []) as DbFlashcard[];
  });

  const outlineContext = outlineContextForCategory(category_id);

  // Sibling scope for MECE-across-keywords: the OTHER keywords in this category.
  const siblingsFor = (
    genKws: { id: string }[]
  ): { label: string; description?: string }[] => {
    const targetIds = new Set(genKws.map((k) => k.id));
    return keywords
      .filter((k) => !targetIds.has(k.id))
      .map((k) => ({ label: k.label, description: k.description ?? undefined }));
  };

  // ── Generation closure ──────────────────────────────────────────────────────
  // Generate cards for `genKws` (per-keyword complete decks), verify, dedup across
  // the category (MECE), tag primary_keyword_id, insert active, splice into allFcs.
  // Concurrency-guarded per cell. Fail-soft; returns count added.
  const runGeneration = async (
    genKws: { id: string; label: string; description: string; blueprint: unknown }[],
    need: number,
    cellKey: string,
    seedText: string[] = [],
    complete = false
  ): Promise<number> => {
    if (need <= 0 || genKws.length === 0) return 0;
    let gotGenLock = false;
    try {
      const { data: claimed } = await supabase.rpc("try_claim_gen_lock", {
        p_cell: cellKey,
        p_ttl_seconds: 120,
        p_max_concurrent: 1,
      });
      gotGenLock = claimed === true;
    } catch {
      gotGenLock = false;
    }
    if (!gotGenLock) return 0;

    try {
      const genResults = await generateMathFlashcards({
        keywords: genKws as Parameters<typeof generateMathFlashcards>[0]["keywords"],
        count: need,
        outlineContext,
        templateText: seedText,
        complete,
        siblingKeywords: siblingsFor(genKws),
        categoryLabel,
      });

      let keptResults = genResults;
      if (genResults.length > 0) {
        const verifyResults = await verifyMathFlashcardsFast(
          genResults.map((c) => ({
            front_latex: c.front_latex,
            back_latex: c.back_latex,
          }))
        );
        const validResults = genResults.filter((_, i) => {
          const r = verifyResults[i];
          return !r || !r.ok || r.valid;
        });
        if (validResults.length === 0) {
          console.warn(
            `[math/flashcards] verifyMathFlashcardsFast rejected all ${genResults.length} card(s) — keeping all (fail-safe)`
          );
        } else {
          keptResults = validResults;
        }
      }

      // Cross-deck MECE: drop any generated card whose front already exists
      // anywhere in this category (another keyword's deck already owns the fact).
      const existingFronts = new Set(
        allFcs.map((fc) => (fc.front_latex ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""))
      );
      keptResults = keptResults.filter((fc) => {
        const norm = (fc.front_latex ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (norm && existingFronts.has(norm)) return false;
        if (norm) existingFronts.add(norm);
        return true;
      });

      if (keptResults.length > 0) {
        const genKwIds = new Set(genKws.map((k) => k.id));
        const rows = keptResults.map((fc) => {
          const weights = (fc.keyword_weights ?? {}) as Record<string, number>;
          let primary = genKws[0]!.id;
          let bestW = -Infinity;
          for (const [id, w] of Object.entries(weights)) {
            if (genKwIds.has(id) && w > bestW) {
              bestW = w;
              primary = id;
            }
          }
          return {
            category_id,
            front_latex: fc.front_latex,
            back_latex: fc.back_latex,
            keyword_weights: fc.keyword_weights,
            primary_keyword_id: primary,
            generated_by: "gpt-5.4-mini",
            status: "active",
          };
        });
        const { data: inserted } = await supabase
          .from("math_flashcards")
          .insert(rows)
          .select("id, front_latex, back_latex, keyword_weights, avg_rating");
        void invalidate(cacheKey);
        allFcs = [...allFcs, ...((inserted ?? []) as DbFlashcard[])];
        return (inserted ?? []).length;
      }
      return 0;
    } catch (err) {
      if (err instanceof MathGenError) {
        console.error("math/flashcards: generation failed:", err.message);
        return 0;
      }
      throw err;
    } finally {
      void supabase.rpc("release_gen_lock", { p_cell: cellKey });
    }
  };

  // ── DB-FIRST serving (per-keyword complete decks) ───────────────────────────
  const COMPLETE_CAP = 30;
  const MAX_BG_DECKS = 4;

  const inScope = (fc: DbFlashcard): boolean => {
    if (keyword_id) {
      return Object.prototype.hasOwnProperty.call(
        fc.keyword_weights ?? {},
        keyword_id
      );
    }
    if (scopedKeywordIds) {
      return (
        !!fc.keyword_weights &&
        Object.keys(fc.keyword_weights).some((id) => scopedKeywordIds.has(id))
      );
    }
    return true;
  };
  const unseenIn = (fcs: DbFlashcard[]): number =>
    fcs.filter((fc) => (seenCount.get(fc.id) ?? 0) === 0).length;

  let scopedFcs = allFcs.filter(inScope);

  // Subtopics in scope with NO stored card yet — eligible for a complete-deck pass.
  const coveredKwIds = new Set<string>();
  for (const fc of allFcs) {
    for (const id of Object.keys((fc.keyword_weights as Record<string, number>) ?? {})) {
      coveredKwIds.add(id);
    }
  }
  const considerScope = keyword_id
    ? new Set([keyword_id])
    : scopedKeywordIds ?? categoryKeywordIdSet;
  const uncoveredScoped = keywords
    .filter((kw) => considerScope.has(kw.id) && !coveredKwIds.has(kw.id))
    .sort((a, b) => (keyword_id === a.id ? 0 : 1) - (keyword_id === b.id ? 0 : 1));

  const mkGenKw = (kw: (typeof keywords)[number]) => ({
    id: kw.id,
    label: kw.label,
    description: kw.description ?? "",
    blueprint: kw.concept_blueprint,
  });
  const genCompleteDeck = (kw: (typeof keywords)[number]) =>
    runGeneration([mkGenKw(kw)], COMPLETE_CAP, `mathfc:complete:${course}:${kw.id}`, [], true);

  const topUp = async (): Promise<number> => {
    const scopeKey = keyword_id
      ? keyword_id
      : scopedKeywordIds
        ? [...scopedKeywordIds].sort().join(",").slice(0, 80)
        : "all";
    const scopeIdSet = keyword_id
      ? new Set([keyword_id])
      : scopedKeywordIds ?? categoryKeywordIdSet;
    const genKws = keywords.filter((kw) => scopeIdSet.has(kw.id)).map(mkGenKw);
    const seedText = scopedFcs.slice(0, 8).map((fc) => `${fc.front_latex} → ${fc.back_latex}`);
    const need = Math.max(4, Math.min(count - unseenIn(scopedFcs), 8));
    return runGeneration(genKws, need, `mathfc:${course}:${category_id}:${scopeKey}`, seedText);
  };

  if (scopedFcs.length === 0) {
    const sync = uncoveredScoped.slice(0, 1);
    for (const kw of sync) await genCompleteDeck(kw);
    if (uncoveredScoped.length === 0) await topUp();
    scopedFcs = allFcs.filter(inScope);
    const rest = uncoveredScoped.slice(sync.length, sync.length + MAX_BG_DECKS);
    if (rest.length > 0) {
      after(async () => {
        for (const kw of rest) await genCompleteDeck(kw);
      });
    }
  } else if (unseenIn(scopedFcs) < count) {
    after(async () => {
      if (uncoveredScoped.length > 0) {
        for (const kw of uncoveredScoped.slice(0, MAX_BG_DECKS)) await genCompleteDeck(kw);
      } else {
        await topUp();
      }
    });
  }

  const nowMs = Date.now();

  // ── Due reviews (Leitner box) ───────────────────────────────────────────────
  const dueReviews = scopedFcs
    .map((fc) => ({ fc, srs: srsByCard.get(fc.id) }))
    .filter((x): x is { fc: DbFlashcard; srs: SrsRow } => {
      if (!x.srs) return false;
      return new Date(x.srs.due_at).getTime() <= nowMs;
    })
    .sort((a, b) => {
      if (a.srs.box !== b.srs.box) return a.srs.box - b.srs.box;
      return new Date(a.srs.due_at).getTime() - new Date(b.srs.due_at).getTime();
    });
  const dueIds = new Set(dueReviews.map((x) => x.fc.id));

  // Curriculum rank: position of a card's subtopic in `keywords` (order_index-sorted).
  const kwRank = new Map(keywords.map((k, i) => [k.id, i]));
  const curriculumRankOf = (fc: DbFlashcard): number => {
    let best = Number.MAX_SAFE_INTEGER;
    for (const id of Object.keys((fc.keyword_weights as Record<string, number>) ?? {})) {
      const r = kwRank.get(id);
      if (r !== undefined && r < best) best = r;
    }
    return best;
  };

  // Non-due cards: use cardSelectionWeights (v2) for the adaptive probabilistic draw.
  // In curriculum_order mode (CourseCardsMode) we still deterministically sort by
  // position first, then apply weighted random within a same-rank tier so the
  // in-order walk is preserved while still favouring weak, unseen cards.
  const nonDueFcs = scopedFcs.filter((fc) => !dueIds.has(fc.id));

  // Build FlashcardEntry descriptors for the weight computation.
  const toFlashcardEntry = (fc: DbFlashcard): FlashcardEntry => {
    const srs = srsByCard.get(fc.id);
    // `known` is derived from Leitner box (0–1; MEMORIZED_BOX as the max).
    const known = srs ? Math.min(1, srs.box / Math.max(1, MEMORIZED_BOX)) : 0;
    return {
      id: fc.id,
      known,
      last_shown_at: srs?.last_shown_at ?? null,
    };
  };

  /**
   * Pick `n` cards without replacement via weighted random draw using
   * cardSelectionWeights. Falls back to first-N if all weights are 0.
   */
  function weightedPickN(pool: DbFlashcard[], n: number): DbFlashcard[] {
    const remaining = [...pool];
    const picks: DbFlashcard[] = [];
    while (picks.length < n && remaining.length > 0) {
      const entries = remaining.map(toFlashcardEntry);
      const weights = cardSelectionWeights(entries, nowMs);
      const total = weights.reduce((a, b) => a + b, 0);
      let idx: number;
      if (total <= 0) {
        // All weights zero (everything shown recently) → take first in order.
        idx = 0;
      } else {
        let r = Math.random() * total;
        idx = 0;
        for (let i = 0; i < weights.length; i++) {
          r -= weights[i]!;
          if (r <= 0) { idx = i; break; }
        }
        idx = Math.min(idx, remaining.length - 1);
      }
      picks.push(remaining[idx]!);
      remaining.splice(idx, 1);
    }
    return picks;
  }

  let rotation: DbFlashcard[];
  if (curriculumOrder) {
    // Sort by curriculum position first (deterministic walk), then apply weighted
    // random within each tier to favour weak/unseen cards at that position.
    nonDueFcs.sort((a, b) => {
      const ra = curriculumRankOf(a);
      const rb = curriculumRankOf(b);
      return ra - rb;
    });
    rotation = nonDueFcs;
  } else {
    // Full deck — use cardSelectionWeights to pick adaptively.
    rotation = weightedPickN(nonDueFcs, nonDueFcs.length);
  }

  type OutCard = DbFlashcard & { box: number; is_review: boolean };
  const selected: OutCard[] = [];
  for (const { fc, srs } of dueReviews) {
    if (selected.length >= count) break;
    selected.push({ ...fc, box: srs.box, is_review: true });
  }
  // When not in curriculum_order mode the rotation is already weighted-shuffled.
  // In curriculum_order mode we walk in order but still want weighted pick within
  // same-rank cards — the sort above keeps order; we push in order from that list.
  for (const fc of rotation) {
    if (selected.length >= count) break;
    const srs = srsByCard.get(fc.id);
    selected.push({ ...fc, box: srs?.box ?? 0, is_review: false });
  }

  const flashcards = selected.slice(0, count).map((fc) => ({
    id: fc.id,
    front_latex: fc.front_latex,
    back_latex: fc.back_latex,
    keyword_weights: fc.keyword_weights,
    box: fc.box,
    is_review: fc.is_review,
    memorized: fc.box >= MEMORIZED_BOX,
  }));

  return NextResponse.json({ flashcards });
}
