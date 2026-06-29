import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchTemplateCards } from "@/lib/mcatTemplateCards";
import { generateMcatFlashcards, McatGenError, verifyFlashcardsFast } from "@/lib/mcatGenerator";
import { loadTargetKeywords } from "@/lib/mcatTagging";
import { sectionFromId } from "@/lib/mcatSection";
import { outlineContextForCategory } from "@/lib/mcatContentOutline";
import { MEMORIZED_BOX } from "@/lib/flashcardSrs";
import { cached, invalidate } from "@/lib/serverCache";
import {
  cardSelectionWeights,
  type FlashcardEntry,
} from "@/lib/courseEngine/adaptive";

export const runtime = "nodejs";
// Complete-deck generation runs gpt-5.5 (enumerate→emit) and may chain a few
// subtopics in one cold request — give it headroom so it never gets killed mid-insert.
export const maxDuration = 300;

const DEFAULT_COUNT = 8;
const MAX_COUNT = 30;

type DbFlashcard = {
  id: string;
  front: string;
  back: string;
  keyword_weights: Record<string, number>;
  avg_rating: number | null;
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
    /**
     * When true, the non-due rotation is ordered by CURRICULUM order (the
     * subtopic's order_index) instead of least-shown/weakness — so a fresh deck
     * begins at the FIRST subtopic of the category. Used by flashcard-only
     * (course cards) mode to mirror auto mode's in-order walk.
     */
    curriculum_order?: boolean;
  };

  const { session_id, category_id, keyword_id } = body;
  const curriculumOrder = body.curriculum_order === true;
  const count = Math.min(body.count ?? DEFAULT_COUNT, MAX_COUNT);

  if (!session_id || !category_id) {
    return NextResponse.json(
      { error: "session_id and category_id are required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // Load keywords, per-keyword states (for weakness ranking of NEW cards), and
  // all SRS rows for this session+category (drives the due-review queue).
  const [keywords, statesRes, srsRes, fcAttemptsRes, categoryRes, umbrellaRes] = await Promise.all([
    loadTargetKeywords(supabase, [category_id]),
    supabase
      .from("mcat_student_keyword_states")
      .select("keyword_id, score")
      .eq("session_id", session_id),
    supabase
      .from("mcat_flashcard_srs")
      .select("flashcard_id, box, due_at, last_shown_at")
      .eq("session_id", session_id)
      .eq("category_id", category_id),
    supabase
      .from("mcat_flashcard_attempts")
      .select("flashcard_id")
      .eq("session_id", session_id),
    supabase.from("mcat_categories").select("label").eq("id", category_id).maybeSingle(),
    // Umbrella-tier topic labels for the category. loadTargetKeywords returns only
    // in_depth rows, so umbrella labels are fetched here for the scope-exclusion feed.
    supabase
      .from("mcat_keywords")
      .select("label")
      .eq("category_id", category_id)
      .eq("tier", "umbrella"),
  ]);

  // Human-readable unit name passed to generation so cards stay inside this one
  // category (no cross-category leak, e.g. no glycolysis in an amino-acids deck).
  const categoryLabel =
    (categoryRes.data?.label as string | undefined) ??
    category_id.replace(/^mcat_biology_/, "").replace(/_/g, " ");

  // Umbrella (topic) labels for this category — part (b) of the scope-exclusion feed.
  const umbrellaLabels = ((umbrellaRes.data ?? []) as { label: string }[]).map(
    (u) => u.label
  );

  if (keywords.length === 0) {
    return NextResponse.json(
      { error: "Unknown category or no keywords seeded for it" },
      { status: 404 }
    );
  }

  // INTRO keywords (order_index === -1) are framing-only — they get NO flashcards.
  const introIds = new Set(
    keywords.filter((k) => k.order_index === -1).map((k) => k.id)
  );
  // If the request is scoped to a single intro keyword, return empty immediately.
  if (keyword_id && introIds.has(keyword_id)) {
    return NextResponse.json({ flashcards: [] });
  }

  // Resolve keyword scope — only active when keyword_id (single) is absent.
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

  // Per-session seen-count per card (drives even-coverage rotation for non-due
  // cards). Each attempt row is one viewing; SRS box adds a secondary nudge below.
  const seenCount = new Map<string, number>();
  for (const a of fcAttemptsRes.data ?? []) {
    const id = a.flashcard_id as string;
    seenCount.set(id, (seenCount.get(id) ?? 0) + 1);
  }

  // Full active stored deck for the category — shared across users, safe to cache.
  // SRS overlay (box/due_at) is applied below from per-session srsByCard.
  const cacheKey = `mcat:flashcards:deck:${category_id}`;
  let allFcs = await cached<DbFlashcard[]>(cacheKey, 60_000, async () => {
    const { data } = await supabase
      .from("mcat_flashcards")
      .select("id, front, back, keyword_weights, avg_rating")
      .eq("category_id", category_id)
      .eq("status", "active");
    return (data ?? []) as DbFlashcard[];
  });

  const outlineContext = outlineContextForCategory(category_id);

  // ── Generation closure ──────────────────────────────────────────────────────
  // Generate `need` cards for `genKws`, verify, insert as active, and splice into
  // `allFcs`. Concurrency-guarded per cell so a cold/exhausted catalog never spawns
  // duplicate decks. `seedText` lets us pass EXISTING cards as style templates so
  // top-up cards match the deck's voice without duplicating it. Fail-soft: never
  // throws to the caller; returns how many cards were added.
  // Sibling scope for MECE-across-keywords: the OTHER keywords in this category
  // (each owns its own content). Passed to the generator so a per-keyword deck
  // never bleeds a neighbor's topic. Target keyword(s) are filtered out per call.
  const siblingsFor = (
    genKws: { id: string }[]
  ): { label: string; description?: string }[] => {
    const targetIds = new Set(genKws.map((k) => k.id));
    // Collect the parent umbrella id(s) for the target keywords.
    const targetUmbrellaIds = new Set(
      genKws
        .map((g) => keywords.find((k) => k.id === g.id)?.parent_keyword_id)
        .filter((id): id is string => !!id)
    );
    // (a) in_depth siblings that share a parent umbrella with any target keyword.
    const sibs: { label: string; description?: string }[] = keywords
      .filter(
        (k) =>
          !targetIds.has(k.id) &&
          k.tier === "in_depth" &&
          !!k.parent_keyword_id &&
          targetUmbrellaIds.has(k.parent_keyword_id)
      )
      .map((k) => ({ label: k.label, description: k.description ?? undefined }));
    // (b) every umbrella-level topic label in the category (not present in
    // `keywords`, which is in_depth-only — fetched via umbrellaLabels above).
    const seen = new Set(sibs.map((s) => s.label));
    for (const lbl of umbrellaLabels) {
      if (!seen.has(lbl)) {
        sibs.push({ label: lbl });
        seen.add(lbl);
      }
    }
    return sibs;
  };

  const runGeneration = async (
    genKws: { id: string; label: string; description: string; blueprint: unknown }[],
    need: number,
    cellKey: string,
    seedText: string[] = [],
    complete = false,
    batchPartition = false,
    intro = false
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
      const fetched = await fetchTemplateCards(
        supabase,
        category_id,
        genKws.map((k) => k.label)
      );
      // Seed from existing in-scope cards (templates) + the category template pool.
      const templateCards = [
        ...seedText.map((t) => ({ id: "", plain_text: t })),
        ...fetched,
      ];
      const genResults = await generateMcatFlashcards({
        keywords: genKws as Parameters<typeof generateMcatFlashcards>[0]["keywords"],
        templateCards,
        count: need,
        outlineContext,
        complete: complete || batchPartition,
        batchPartition,
        intro,
        siblingKeywords: siblingsFor(genKws),
        categoryLabel,
      });

      let keptResults = genResults;
      if (genResults.length > 0) {
        const verifyResults = await verifyFlashcardsFast(
          genResults.map((c) => ({ front: c.front, back: c.back }))
        );
        const validResults = genResults.filter((_, i) => {
          const r = verifyResults[i];
          return !r || !r.ok || r.valid;
        });
        if (validResults.length === 0) {
          console.warn(
            `[mcat/flashcards] verifyFlashcardsFast rejected all ${genResults.length} card(s) — keeping all (fail-safe)`
          );
        } else {
          keptResults = validResults;
        }
      }

      // Cross-deck MECE: drop any generated card whose front already exists
      // anywhere in this category (another keyword's deck already owns the fact).
      const existingFronts = new Set(
        allFcs.map((fc) => fc.front.toLowerCase().replace(/[^a-z0-9]/g, ""))
      );
      keptResults = keptResults.filter((fc) => {
        const norm = (fc.front ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (norm && existingFronts.has(norm)) return false;
        if (norm) existingFronts.add(norm);
        return true;
      });

      if (keptResults.length > 0) {
        const sourceCardIds = fetched.map((c) => c.id).filter(Boolean);
        // primary_keyword_id = the keyword this card's deck belongs to. For a
        // single-keyword (complete) gen that's the target; for multi-keyword
        // top-ups it's the highest-weight keyword among the generated ids.
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
            section: sectionFromId(category_id),
            category_id,
            front: fc.front,
            back: fc.back,
            keyword_weights: fc.keyword_weights,
            primary_keyword_id: primary,
            source_card_ids: sourceCardIds,
            generated_by: "gpt-5.4-mini",
            status: "active",
          };
        });
        const { data: inserted } = await supabase
          .from("mcat_flashcards")
          .insert(rows)
          .select("id, front, back, keyword_weights, avg_rating");
        void invalidate(cacheKey);
        allFcs = [...allFcs, ...((inserted ?? []) as DbFlashcard[])];
        return (inserted ?? []).length;
      }
      return 0;
    } catch (err) {
      if (err instanceof McatGenError) {
        console.error("mcat/flashcards: generation failed:", err.message);
        return 0;
      }
      throw err;
    } finally {
      void supabase.rpc("release_gen_lock", { p_cell: cellKey });
    }
  };

  // ── DB-FIRST serving (stored cards short-circuit generation) ────────────────
  // The common case is a deck that ALREADY EXISTS: serve the stored cards
  // IMMEDIATELY and never block the response on generation. We generate
  // synchronously ONLY when there is genuinely nothing in scope to serve (a
  // brand-new / empty subtopic). Any other fill-in (completing uncovered sibling
  // subtopics, or recycling more for a heavy reviewer) happens in the BACKGROUND
  // via after(), so a visit to an existing deck is never stuck on a spinner.
  const COMPLETE_CAP = 40; // anti-runaway safety only — completeness decides actual count
  const MAX_BG_DECKS = 4;

  // Scope predicate (single keyword > keyword set > whole category).
  const inScope = (fc: DbFlashcard): boolean => {
    const kw = (fc.keyword_weights as Record<string, number>) ?? {};
    if (keyword_id) {
      return Object.prototype.hasOwnProperty.call(kw, keyword_id);
    }
    if (scopedKeywordIds) {
      return Object.keys(kw).some((id) => scopedKeywordIds.has(id));
    }
    return true;
  };
  const unseenIn = (fcs: DbFlashcard[]): number =>
    fcs.filter((fc) => (seenCount.get(fc.id) ?? 0) === 0).length;

  let scopedFcs: DbFlashcard[] = allFcs.filter(inScope);

  // Subtopics in scope that have NO stored card yet — the ONLY ones eligible for a
  // complete-deck enumeration. A subtopic with ≥1 card is "covered" and is never
  // re-enumerated, so the expensive complete-deck pass can't re-run every visit.
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
    .filter((kw) => considerScope.has(kw.id) && !coveredKwIds.has(kw.id) && !introIds.has(kw.id))
    .sort((a, b) => (keyword_id === a.id ? 0 : 1) - (keyword_id === b.id ? 0 : 1));

  const mkGenKw = (kw: (typeof keywords)[number]) => ({
    id: kw.id,
    label: kw.label,
    description: kw.description ?? "",
    blueprint: kw.concept_blueprint,
  });
  // INTRO keywords get zero flashcards — skip generation entirely.
  const genCompleteDeck = (kw: (typeof keywords)[number]) =>
    introIds.has(kw.id)
      ? Promise.resolve(0)
      : runGeneration([mkGenKw(kw)], COMPLETE_CAP, `mcatfc:complete:${kw.id}`, [], true);

  // Batch-across-keywords first-gen: build the decks for SEVERAL keywords (an
  // umbrella's uncovered in-depth siblings) in ONE partitioned call so coverage
  // is MECE — no holes, no overlap. Cap scales with the keyword count.
  const genBatchDecks = (kws: (typeof keywords)[number][], cellKey: string) =>
    runGeneration(
      kws.map(mkGenKw),
      Math.min(12 * kws.length, 120), // anti-runaway safety only — completeness decides actual count
      cellKey,
      [],
      true,
      true
    );

  // The umbrella (topic) of the focused keyword — the natural MECE unit to batch.
  const focusKwId =
    keyword_id ??
    (scopedKeywordIds && scopedKeywordIds.size === 1
      ? [...scopedKeywordIds][0]
      : null);
  const focusUmbrellaId = focusKwId
    ? keywords.find((k) => k.id === focusKwId)?.parent_keyword_id ?? null
    : null;
  const MAX_BATCH_KWS = 8;

  // Recycle MORE cards for a scope whose subtopics ALL already have decks but the
  // user has seen (nearly) everything. Seeded from existing in-scope cards.
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
    const seedText = scopedFcs.slice(0, 8).map((fc) => `${fc.front} → ${fc.back}`);
    const need = Math.max(6, Math.min(count - unseenIn(scopedFcs), 12));
    return runGeneration(genKws, need, `mcatfc:${category_id}:${scopeKey}`, seedText);
  };

  if (scopedFcs.length === 0) {
    // Nothing in scope to serve → generate ONE subtopic synchronously (the minimum
    // to never return an empty deck), then serve and fill the rest in the BACKGROUND.
    // Only a brand-new/empty subtopic reaches this path, and it's bounded to a single
    // complete-deck gen so the one-time wait stays short.
    const sync = uncoveredScoped.slice(0, 1);
    for (const kw of sync) await genCompleteDeck(kw);
    if (uncoveredScoped.length === 0) await topUp();
    scopedFcs = allFcs.filter(inScope);

    // BACKGROUND first-gen of the rest. When the focused keyword belongs to an
    // umbrella, build that umbrella's remaining UNCOVERED in-depth siblings as ONE
    // MECE partition (no holes/overlap) — the headline batch-across-keywords pass.
    // The synchronously-generated focus deck is excluded (its content is fenced off
    // via siblingKeywords + cross-deck dedup). Falls back to per-keyword complete
    // generation when there's no umbrella grouping to batch.
    const syncIds = new Set(sync.map((k) => k.id));
    const umbrellaBatch = focusUmbrellaId
      ? keywords.filter(
          (kw) =>
            kw.parent_keyword_id === focusUmbrellaId &&
            !coveredKwIds.has(kw.id) &&
            !syncIds.has(kw.id) &&
            !introIds.has(kw.id) // intros are framing-only — never batch-enumerated
        )
      : [];
    if (umbrellaBatch.length >= 2) {
      const batch = umbrellaBatch.slice(0, MAX_BATCH_KWS);
      after(async () => {
        await genBatchDecks(batch, `mcatfc:batch:${focusUmbrellaId}`);
      });
    } else {
      const rest = uncoveredScoped.slice(sync.length, sync.length + MAX_BG_DECKS);
      if (rest.length > 0) {
        after(async () => {
          for (const kw of rest) await genCompleteDeck(kw);
        });
      }
    }
  } else if (unseenIn(scopedFcs) < count) {
    // We HAVE stored cards to serve right now — serve them and fill the rest in the
    // BACKGROUND (never block). Complete uncovered sibling subtopics first; if the
    // scope is fully covered, recycle a top-up for the heavy reviewer.
    after(async () => {
      if (uncoveredScoped.length > 0) {
        for (const kw of uncoveredScoped.slice(0, MAX_BG_DECKS)) await genCompleteDeck(kw);
      } else {
        await topUp();
      }
    });
  }

  const nowMs = Date.now();

  // ── Due reviews ─────────────────────────────────────────────────────────────
  // Cards with an SRS row whose due_at has passed. Box-1 lapses come first
  // (top priority), then ascending box, then earliest due.
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

  // ── Non-due card selection via cardSelectionWeights (v2) ────────────────────
  // Due reviews are served first (Leitner SRS). The remainder is picked via
  // adaptive weighted random: weak/unseen cards appear more often, recently-shown
  // cards are suppressed (CARD_MIN_SPACING_MS), and coverage is guaranteed via
  // CARD_COVERAGE_BOOST. In curriculum_order mode we keep the positional sort
  // but still apply within-position weighted draw.
  const dueIds = new Set(dueReviews.map((x) => x.fc.id));

  // Curriculum rank: position of a card's subtopic in `keywords` (already
  // order_index-sorted by loadTargetKeywords). Lower = earlier in the course.
  const kwRank = new Map(keywords.map((k, i) => [k.id, i]));
  const curriculumRankOf = (fc: DbFlashcard): number => {
    let best = Number.MAX_SAFE_INTEGER;
    for (const id of Object.keys((fc.keyword_weights as Record<string, number>) ?? {})) {
      const r = kwRank.get(id);
      if (r !== undefined && r < best) best = r;
    }
    return best;
  };

  const nonDueFcs = scopedFcs.filter((fc) => !dueIds.has(fc.id));

  const toFlashcardEntry = (fc: DbFlashcard): FlashcardEntry => {
    const srs = srsByCard.get(fc.id);
    const known = srs ? Math.min(1, srs.box / Math.max(1, MEMORIZED_BOX)) : 0;
    return {
      id: fc.id,
      known,
      last_shown_at: srs?.last_shown_at ?? null,
    };
  };

  function weightedPickN(pool: DbFlashcard[], n: number): DbFlashcard[] {
    const remaining = [...pool];
    const picks: DbFlashcard[] = [];
    while (picks.length < n && remaining.length > 0) {
      const entries = remaining.map(toFlashcardEntry);
      const weights = cardSelectionWeights(entries, nowMs);
      const total = weights.reduce((a, b) => a + b, 0);
      let idx = 0;
      if (total > 0) {
        let r = Math.random() * total;
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
    // Preserve positional order; weighted pick within the already-sorted list.
    nonDueFcs.sort((a, b) => curriculumRankOf(a) - curriculumRankOf(b));
    rotation = nonDueFcs;
  } else {
    rotation = weightedPickN(nonDueFcs, nonDueFcs.length);
  }

  // Build the batch: due reviews first (SRS priority), then weighted rotation.
  type OutCard = DbFlashcard & { box: number; is_review: boolean };
  const selected: OutCard[] = [];
  for (const { fc, srs } of dueReviews) {
    if (selected.length >= count) break;
    selected.push({ ...fc, box: srs.box, is_review: true });
  }
  for (const fc of rotation) {
    if (selected.length >= count) break;
    const srs = srsByCard.get(fc.id);
    selected.push({ ...fc, box: srs?.box ?? 0, is_review: false });
  }

  const flashcards = selected.slice(0, count).map((fc) => ({
    id: fc.id,
    front: fc.front,
    back: fc.back,
    keyword_weights: fc.keyword_weights,
    box: fc.box,
    is_review: fc.is_review,
    memorized: fc.box >= MEMORIZED_BOX,
  }));

  return NextResponse.json({ flashcards });
}
