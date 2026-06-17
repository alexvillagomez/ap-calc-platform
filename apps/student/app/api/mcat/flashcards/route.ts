import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchTemplateCards } from "@/lib/mcatTemplateCards";
import { generateMcatFlashcards, McatGenError, verifyFlashcardsFast } from "@/lib/mcatGenerator";
import { loadTargetKeywords } from "@/lib/mcatTagging";
import { outlineContextForCategory } from "@/lib/mcatContentOutline";
import { ConceptBlueprint } from "@/lib/mcatBlueprint";
import { MEMORIZED_BOX } from "@/lib/flashcardSrs";

export const runtime = "nodejs";

const DEFAULT_COUNT = 12;
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
  };

  const { session_id, category_id, keyword_id } = body;
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
  const [keywords, statesRes, srsRes] = await Promise.all([
    loadTargetKeywords(supabase, [category_id]),
    supabase
      .from("mcat_student_keyword_states")
      .select("keyword_id, score")
      .eq("session_id", session_id),
    supabase
      .from("mcat_flashcard_srs")
      .select("flashcard_id, box, due_at")
      .eq("session_id", session_id)
      .eq("category_id", category_id),
  ]);

  if (keywords.length === 0) {
    return NextResponse.json(
      { error: "Unknown category or no keywords seeded for it" },
      { status: 404 }
    );
  }

  // Resolve keyword scope — only active when keyword_id (single) is absent.
  const categoryKeywordIdSet = new Set(keywords.map((k) => k.id));
  const rawKeywordIds = Array.isArray(body.keyword_ids) ? body.keyword_ids : [];
  const filteredKeywordIds = !keyword_id
    ? rawKeywordIds.filter((id) => categoryKeywordIdSet.has(id))
    : [];
  const scopedKeywordIds: Set<string> | null =
    filteredKeywordIds.length > 0 ? new Set(filteredKeywordIds) : null;

  const strengths: Record<string, number> = Object.fromEntries(
    (statesRes.data ?? []).map((s) => [
      s.keyword_id as string,
      (s.score as number) ?? 0.5,
    ])
  );

  const srsByCard = new Map<string, SrsRow>(
    (srsRes.data ?? []).map((r) => [r.flashcard_id as string, r as SrsRow])
  );

  // All active cards in the category.
  const { data: allFcs } = await supabase
    .from("mcat_flashcards")
    .select("id, front, back, keyword_weights, avg_rating")
    .eq("category_id", category_id)
    .eq("status", "active");

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

  const scopedFcs: DbFlashcard[] = ((allFcs ?? []) as DbFlashcard[]).filter(inScope);

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

  // ── New cards ───────────────────────────────────────────────────────────────
  // Never-seen cards (no SRS row), ranked by keyword weakness + rating nudge so
  // the student first memorizes what they're weakest on.
  const newCards = scopedFcs
    .filter((fc) => !srsByCard.has(fc.id))
    .map((fc) => {
      const kw = (fc.keyword_weights as Record<string, number>) ?? {};
      let weightedWeakness = 0;
      let totalWeight = 0;
      for (const [id, w] of Object.entries(kw)) {
        if (w > 0) {
          weightedWeakness += w * (1 - (strengths[id] ?? 0.5));
          totalWeight += w;
        }
      }
      const weakness = totalWeight > 0 ? weightedWeakness / totalWeight : 0.5;
      const ratingNudge = 0.7 + 0.3 * ((fc.avg_rating ?? 3) / 5);
      return { fc, score: weakness * ratingNudge };
    })
    .sort((a, b) => b.score - a.score);

  // Build the batch: due reviews first, then new cards.
  type OutCard = DbFlashcard & { box: number; is_review: boolean };
  const selected: OutCard[] = [];

  for (const { fc, srs } of dueReviews) {
    if (selected.length >= count) break;
    selected.push({ ...fc, box: srs.box, is_review: true });
  }
  for (const { fc } of newCards) {
    if (selected.length >= count) break;
    selected.push({ ...fc, box: 0, is_review: false });
  }

  // ── Generate shortfall ───────────────────────────────────────────────────────
  // If the scope simply doesn't have enough cards yet, generate fresh ones.
  const shortfall = count - selected.length;
  if (shortfall > 0) {
    const kwStateMap = new Map(
      (statesRes.data ?? []).map((s) => [s.keyword_id as string, s])
    );

    let weakestKws: { id: string; label: string; description: string; blueprint?: ConceptBlueprint | null }[];

    if (keyword_id) {
      const { data: kwRow } = await supabase
        .from("mcat_keywords")
        .select("id, label, description, concept_blueprint")
        .eq("id", keyword_id)
        .maybeSingle();

      weakestKws = kwRow
        ? [
            {
              id: kwRow.id as string,
              label: kwRow.label as string,
              description: (kwRow.description as string) ?? "",
              blueprint: (kwRow.concept_blueprint as ConceptBlueprint | null) ?? null,
            },
          ]
        : [];
    } else if (scopedKeywordIds) {
      weakestKws = keywords
        .filter((k) => scopedKeywordIds.has(k.id))
        .sort((a, b) => {
          const aScore = (kwStateMap.get(a.id)?.score as number) ?? 0.5;
          const bScore = (kwStateMap.get(b.id)?.score as number) ?? 0.5;
          return aScore - bScore;
        })
        .slice(0, 3)
        .map((kw) => ({
          id: kw.id,
          label: kw.label,
          description: kw.description ?? "",
          blueprint: kw.concept_blueprint,
        }));
    } else {
      weakestKws = [...keywords]
        .sort((a, b) => {
          const aScore = (kwStateMap.get(a.id)?.score as number) ?? 0.5;
          const bScore = (kwStateMap.get(b.id)?.score as number) ?? 0.5;
          return aScore - bScore;
        })
        .slice(0, 3)
        .map((kw) => ({
          id: kw.id,
          label: kw.label,
          description: kw.description ?? "",
          blueprint: kw.concept_blueprint,
        }));
    }

    if (weakestKws.length > 0) {
      const templateCards = await fetchTemplateCards(
        supabase,
        category_id,
        weakestKws.map((k) => k.label)
      );

      const outlineContext = outlineContextForCategory(category_id);

      try {
        const genResults = await generateMcatFlashcards({
          keywords: weakestKws,
          templateCards,
          count: shortfall,
          outlineContext,
        });

        // Verify generated flashcards; keep only valid ones (fail-safe).
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

        if (keptResults.length > 0) {
          const sourceCardIds = templateCards.map((c) => c.id);
          const rows = keptResults.map((fc) => ({
            section: "biology",
            category_id,
            front: fc.front,
            back: fc.back,
            keyword_weights: fc.keyword_weights,
            source_card_ids: sourceCardIds,
            generated_by: "gpt-5.4-mini",
            status: "active",
          }));

          const { data: inserted } = await supabase
            .from("mcat_flashcards")
            .insert(rows)
            .select("id, front, back, keyword_weights, avg_rating");

          for (const fc of inserted ?? []) {
            if (selected.length >= count) break;
            selected.push({ ...(fc as DbFlashcard), box: 0, is_review: false });
          }
        }
      } catch (err) {
        if (err instanceof McatGenError) {
          console.error("mcat/flashcards: generation failed:", err.message);
        } else {
          throw err;
        }
      }
    }
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
