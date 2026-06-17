/**
 * GET /api/mcat/auto-plan?session_id=
 *
 * Server-side computes the student's current position in the MCAT auto-mode path.
 * Mirrors math's auto-plan route but adapted for the flat MCAT category structure:
 *   - mcat_categories ordered by order_index (no course-level grouping)
 *   - mcat_keywords (in_depth preferred, umbrella fallback)
 *   - mcat_student_keyword_states for mastery
 *   - No diagnostic gate (MCAT has no diagnostic; always defaults to start-at-first)
 *
 * Response shape:
 * {
 *   frontier: {                   // first category not-yet-mastered
 *     id: string,
 *     label: string,
 *     order_index: number,
 *     umbrella_label: string | null,   // umbrella of the weakest focus keyword
 *   } | null,
 *   next_focus: string[],         // up to 3 weakest unmastered in_depth keyword ids
 *   progress: Array<{
 *     id: string,
 *     label: string,
 *     order_index: number,
 *     avg_score: number | null,
 *     mastered_count: number,
 *     keyword_count: number,
 *     complete: boolean,
 *   }>,
 *   overall_pct: number,          // 0–100
 * }
 *
 * 404 when taxonomy is empty.
 * Yield-nudge: yield "high" → −0.12, "low" → +0.10 (same as practice-queue).
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/** Yield-level string → numeric nudge. */
const YIELD_ADJ: Record<string, number> = { high: -0.12, medium: 0, low: 0.10 };

function yieldNudge(level: string | null): number {
  return YIELD_ADJ[level ?? "medium"] ?? 0;
}

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // 1. Load MCAT categories ordered by order_index
  const { data: catRows, error: catErr } = await supabase
    .from("mcat_categories")
    .select("id, label, order_index")
    .order("order_index");

  if (catErr || !catRows || catRows.length === 0) {
    return NextResponse.json(
      { error: "No MCAT categories found — taxonomy may not be seeded yet", detail: catErr?.message },
      { status: 404 }
    );
  }

  const categoryIds = catRows.map((c) => c.id as string);

  // 2. Load all in_depth keywords (fallback to umbrella if none) for all categories
  const { data: kwRows, error: kwErr } = await supabase
    .from("mcat_keywords")
    .select("id, category_id, tier, parent_keyword_id, label, yield_level, order_index")
    .in("category_id", categoryIds)
    .eq("status", "approved")
    .order("order_index");

  if (kwErr) {
    return NextResponse.json(
      { error: "Failed to load keywords", detail: kwErr.message },
      { status: 500 }
    );
  }

  type KwRow = {
    id: string;
    category_id: string;
    tier: string;
    parent_keyword_id: string | null;
    label: string;
    yield_level: string | null;
    order_index: number | null;
  };

  const keywords: KwRow[] = (kwRows ?? []).map((k) => ({
    id: k.id as string,
    category_id: k.category_id as string,
    tier: k.tier as string,
    parent_keyword_id: (k.parent_keyword_id as string | null) ?? null,
    label: k.label as string,
    yield_level: (k.yield_level as string | null) ?? null,
    order_index: (k.order_index as number | null) ?? null,
  }));

  // Group by category; prefer in_depth per category (mirrors math auto-plan)
  const kwByCategory = new Map<string, KwRow[]>();
  for (const kw of keywords) {
    if (!kwByCategory.has(kw.category_id)) kwByCategory.set(kw.category_id, []);
    kwByCategory.get(kw.category_id)!.push(kw);
  }

  const targetKwByCategory = new Map<string, KwRow[]>();
  for (const catId of categoryIds) {
    const rows = kwByCategory.get(catId) ?? [];
    const inDepth = rows.filter((r) => r.tier === "in_depth");
    targetKwByCategory.set(catId, inDepth.length > 0 ? inDepth : rows.filter((r) => r.tier === "umbrella"));
  }

  // Umbrella label lookup (for breadcrumb)
  const umbrellaLabelMap = new Map<string, string>();
  for (const kw of keywords) {
    if (kw.tier === "umbrella") {
      umbrellaLabelMap.set(kw.id, kw.label);
    }
  }

  // 3. Load keyword states for all keywords for this session
  const allKwIds = keywords.map((k) => k.id);

  const { data: stateRows } = allKwIds.length > 0
    ? await supabase
        .from("mcat_student_keyword_states")
        .select("keyword_id, score, total_attempts, state")
        .eq("session_id", sessionId)
        .in("keyword_id", allKwIds)
    : { data: [] as Array<{ keyword_id: string; score: number | null; total_attempts: number; state: string | null }> };

  type StateEntry = { score: number | null; total_attempts: number; state: string | null };
  const stateMap = new Map<string, StateEntry>();
  for (const s of stateRows ?? []) {
    stateMap.set(s.keyword_id as string, {
      score: (s.score as number | null) ?? null,
      total_attempts: (s.total_attempts as number) ?? 0,
      state: (s.state as string) ?? null,
    });
  }

  // 4. Compute per-category progress
  type CategoryProgress = {
    id: string;
    label: string;
    order_index: number;
    avg_score: number | null;
    mastered_count: number;
    keyword_count: number;
    complete: boolean;
  };

  const progress: CategoryProgress[] = catRows.map((cat) => {
    const catId = cat.id as string;
    const kwds = targetKwByCategory.get(catId) ?? [];

    let totalScore = 0;
    let scoredCount = 0;
    let masteredCount = 0;

    for (const kw of kwds) {
      const st = stateMap.get(kw.id);
      if (st?.state === "mastered") {
        masteredCount += 1;
        totalScore += 1;
        scoredCount += 1;
      } else if (st?.score !== null && st?.score !== undefined && (st?.total_attempts ?? 0) > 0) {
        totalScore += st.score;
        scoredCount += 1;
      }
    }

    const avgScore = scoredCount > 0 ? totalScore / scoredCount : null;
    const keywordCount = kwds.length;
    const complete = keywordCount > 0 && masteredCount >= keywordCount;

    return {
      id: catId,
      label: cat.label as string,
      order_index: (cat.order_index as number) ?? 0,
      avg_score: avgScore,
      mastered_count: masteredCount,
      keyword_count: keywordCount,
      complete,
    };
  });

  // 5. Compute overall_pct
  const totalKeywords = progress.reduce((s, p) => s + p.keyword_count, 0);
  const totalMastered = progress.reduce((s, p) => s + p.mastered_count, 0);
  const overallPct =
    totalKeywords > 0 ? Math.round((totalMastered / totalKeywords) * 100) : 0;

  // 6. Find frontier: first category with keywords that isn't complete
  const frontierEntry = progress.find(
    (p) => p.keyword_count > 0 && !p.complete && (p.avg_score === null || p.avg_score < 0.8)
  );

  if (!frontierEntry && progress.every((p) => p.keyword_count === 0)) {
    return NextResponse.json(
      { error: "No keywords found — MCAT taxonomy may not be seeded yet" },
      { status: 404 }
    );
  }

  // 7. Compute next_focus: up to 3 weakest unmastered keywords in frontier category
  //    Yield-nudged (same convention as practice-queue).
  let nextFocus: string[] = [];
  let frontierUmbrellaLabel: string | null = null;

  if (frontierEntry) {
    const kwds = targetKwByCategory.get(frontierEntry.id) ?? [];
    const unmastered = kwds.filter((kw) => stateMap.get(kw.id)?.state !== "mastered");

    const sorted = [...unmastered].sort((a, b) => {
      const stA = stateMap.get(a.id);
      const stB = stateMap.get(b.id);
      const rawA = (stA?.score ?? 0.5) + yieldNudge(a.yield_level);
      const rawB = (stB?.score ?? 0.5) + yieldNudge(b.yield_level);
      if (Math.abs(rawA - rawB) > 0.001) return rawA - rawB;
      return (stA?.total_attempts ?? 0) - (stB?.total_attempts ?? 0);
    });

    nextFocus = sorted.slice(0, 3).map((kw) => kw.id);

    // Umbrella label for the weakest focus keyword
    if (sorted[0]?.parent_keyword_id) {
      frontierUmbrellaLabel = umbrellaLabelMap.get(sorted[0].parent_keyword_id) ?? null;
    }
  }

  return NextResponse.json({
    frontier: frontierEntry
      ? {
          id: frontierEntry.id,
          label: frontierEntry.label,
          order_index: frontierEntry.order_index,
          umbrella_label: frontierUmbrellaLabel,
        }
      : null,
    next_focus: nextFocus,
    progress,
    overall_pct: overallPct,
  });
}
