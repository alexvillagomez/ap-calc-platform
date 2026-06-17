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
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  generateMathFlashcards,
  verifyMathFlashcardsFast,
  MathGenError,
} from "@/lib/mathGenerator";
import { loadTargetKeywords } from "@/lib/mathTagging";
import { outlineContextForCategory } from "@/lib/mathContentOutline";
import type { ConceptBlueprint, MathCourse } from "@/lib/mathTypes";
import { cached, invalidate } from "@/lib/serverCache";

export const runtime = "nodejs";

const DEFAULT_COUNT = 2;
const MAX_COUNT = 10;

type DbFlashcard = {
  id: string;
  front_latex: string;
  back_latex: string;
  keyword_weights: Record<string, number>;
  avg_rating: number | null;
  score?: number;
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
  };

  const { session_id, category_id, keyword_id } = body;
  const count = Math.min(body.count ?? DEFAULT_COUNT, MAX_COUNT);
  const course: MathCourse = body.course ?? "precalc";

  if (!session_id || !category_id) {
    return NextResponse.json(
      { error: "session_id and category_id are required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  const [keywords, statesRes, fcAttemptsRes] = await Promise.all([
    loadTargetKeywords(supabase, [category_id], course),
    supabase
      .from("math_student_keyword_states")
      .select("keyword_id, score")
      .eq("session_id", session_id),
    supabase
      .from("math_flashcard_attempts")
      .select("flashcard_id")
      .eq("session_id", session_id),
  ]);

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

  const strengths: Record<string, number> = Object.fromEntries(
    (statesRes.data ?? []).map((s) => [
      s.keyword_id as string,
      (s.score as number) ?? 0.5,
    ])
  );

  const seenFcIds = new Set<string>(
    (fcAttemptsRes.data ?? []).map((a) => a.flashcard_id as string)
  );

  // Load stored flashcards for this category — shared across users, safe to cache.
  // The per-session "seen" filter (seenFcIds) is applied below after the cache hit.
  const cacheKey = `math:flashcards:deck:${course}:${category_id}`;
  const allFcs = await cached<DbFlashcard[]>(cacheKey, 60_000, async () => {
    const { data } = await supabase
      .from("math_flashcards")
      .select("id, front_latex, back_latex, keyword_weights, avg_rating")
      .eq("category_id", category_id)
      .eq("status", "active");
    return (data ?? []) as DbFlashcard[];
  });

  const unseenFcs: DbFlashcard[] = allFcs.filter((fc) => {
    if (seenFcIds.has(fc.id)) return false;
    if (keyword_id) {
      return Object.prototype.hasOwnProperty.call(
        fc.keyword_weights ?? {},
        keyword_id
      );
    }
    if (scopedKeywordIds) {
      return (
        fc.keyword_weights &&
        Object.keys(fc.keyword_weights).some((id) => scopedKeywordIds.has(id))
      );
    }
    return true;
  });

  // Rank by weakness + rating nudge
  const scored = unseenFcs.map((fc) => {
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
    return { ...fc, score: weakness * ratingNudge };
  });

  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const selected: DbFlashcard[] = scored.slice(0, count);

  // Generate shortfall
  const shortfall = count - selected.length;
  if (shortfall > 0) {
    const kwStateMap = new Map(
      (statesRes.data ?? []).map((s) => [s.keyword_id as string, s])
    );

    let weakestKws: {
      id: string;
      label: string;
      description: string;
      blueprint?: ConceptBlueprint | null;
    }[];

    if (keyword_id) {
      const { data: kwRow } = await supabase
        .from("math_keywords")
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
      const outlineContext = outlineContextForCategory(category_id);

      try {
        const genResults = await generateMathFlashcards({
          keywords: weakestKws,
          count: shortfall,
          outlineContext,
        });

        // Verify generated flashcards; keep only valid (fail-safe: keep all if none pass)
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

        if (keptResults.length > 0) {
          const rows = keptResults.map((fc) => ({
            category_id,
            front_latex: fc.front_latex,
            back_latex: fc.back_latex,
            keyword_weights: fc.keyword_weights,
            generated_by: "gpt-5.4-mini",
            status: "active",
          }));

          const { data: inserted } = await supabase
            .from("math_flashcards")
            .insert(rows)
            .select("id, front_latex, back_latex, keyword_weights, avg_rating");

          // Invalidate the deck cache so new cards are visible on next request.
          // Fire-and-forget — don't await; a miss on the next request is fine.
          void invalidate(cacheKey);

          for (const fc of inserted ?? []) {
            if (selected.length >= count) break;
            selected.push({ ...(fc as DbFlashcard), score: 0 });
          }
        }
      } catch (err) {
        if (err instanceof MathGenError) {
          console.error("math/flashcards: generation failed:", err.message);
        } else {
          throw err;
        }
      }
    }
  }

  const flashcards = selected.slice(0, count).map((fc) => ({
    id: fc.id,
    front_latex: fc.front_latex,
    back_latex: fc.back_latex,
    keyword_weights: fc.keyword_weights,
  }));

  return NextResponse.json({ flashcards });
}
