/**
 * GET /api/math/auto-plan?session_id=&course=
 *
 * Server-side computes the student's current position in the auto-mode path.
 *
 * Response shape:
 * {
 *   needs_diagnostic: boolean,   // true when no keyword states AND no completed diagnostic
 *   frontier: {                  // first category whose avg_score < 0.8 / not all mastered
 *     id: string,
 *     label: string,
 *     section: string,
 *     role: string,
 *     umbrella_label: string | null,   // label of the best-focus umbrella
 *     order_index: number,
 *   } | null,
 *   next_focus: string[],        // up to 3 weakest unmastered in_depth keyword ids
 *   progress: Array<{            // per-category progress for the course
 *     id: string,
 *     label: string,
 *     section: string,
 *     order_index: number,
 *     avg_score: number | null,
 *     mastered_count: number,
 *     keyword_count: number,
 *     complete: boolean,
 *   }>,
 *   overall_pct: number,         // 0–100 overall mastery percentage
 * }
 *
 * 404 when taxonomy is empty.
 * Yield-nudge per spec: yield 1.0 → −0.12, yield 0.0 → +0.10 (same as practice-queue).
 *
 * Mirrors conventions of practice-queue/route.ts.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { MathCourse } from "@/lib/mathTypes";
import { fetchAllPages } from "@/lib/mathPagedQuery";

export const runtime = "nodejs";

/** Map numeric yield_score ∈ [0,1] to the bounded nudge.
 *  yield 1.0 → −0.12, yield 0.0 → +0.10.  Linear interpolation. */
function yieldNudge(yieldScore: number | null): number {
  const y = yieldScore ?? 0.5;
  return 0.10 - 0.22 * y;
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
  const course = (searchParams.get("course") ?? "precalc") as MathCourse;

  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 }
    );
  }

  if (course !== "precalc" && course !== "calc_ab") {
    return NextResponse.json(
      { error: "course must be 'precalc' or 'calc_ab'" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // 1. Load course categories ordered by course order_index (foundations first)
  const { data: memberships, error: membErr } = await supabase
    .from("math_course_categories")
    .select("category_id, role, order_index")
    .eq("course", course)
    .order("order_index");

  if (membErr || !memberships || memberships.length === 0) {
    return NextResponse.json(
      { error: "No categories found for this course", detail: membErr?.message },
      { status: 404 }
    );
  }

  const categoryIds = memberships.map((m) => m.category_id as string);
  const membershipMap = new Map(
    memberships.map((m) => [
      m.category_id as string,
      { role: m.role as string, order_index: m.order_index as number },
    ])
  );

  // 2. Load category metadata
  const { data: catRows, error: catErr } = await supabase
    .from("math_categories")
    .select("id, label, section, order_index")
    .in("id", categoryIds);

  if (catErr || !catRows || catRows.length === 0) {
    return NextResponse.json(
      { error: "No categories found for this course", detail: catErr?.message },
      { status: 404 }
    );
  }

  // Sort categories by course order_index
  const categories = [...catRows].sort((a, b) => {
    const aOrd = membershipMap.get(a.id as string)?.order_index ?? 0;
    const bOrd = membershipMap.get(b.id as string)?.order_index ?? 0;
    return aOrd - bOrd;
  });

  // 3. Load all keywords for these categories (in_depth preferred, umbrella fallback).
  // Paginated — a whole-course scope (1700+ keywords) exceeds PostgREST's 1000-row cap.
  const allKeywords = await fetchAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("math_keywords")
      .select(
        "id, category_id, tier, parent_keyword_id, label, yield_score, order_index"
      )
      .in("category_id", categoryIds)
      .eq("status", "approved")
      .order("order_index")
      .range(from, to)
  ).catch(() => null);

  const keywordRows = allKeywords ?? [];

  // Group keywords by category; prefer in_depth per category
  const kwByCategory = new Map<
    string,
    Array<{
      id: string;
      category_id: string;
      tier: string;
      parent_keyword_id: string | null;
      label: string;
      yield_score: number | null;
      order_index: number | null;
    }>
  >();
  for (const kw of keywordRows) {
    const catId = kw.category_id as string;
    if (!kwByCategory.has(catId)) kwByCategory.set(catId, []);
    kwByCategory.get(catId)!.push({
      id: kw.id as string,
      category_id: catId,
      tier: kw.tier as string,
      parent_keyword_id: (kw.parent_keyword_id as string | null) ?? null,
      label: kw.label as string,
      yield_score: (kw.yield_score as number | null) ?? null,
      order_index: (kw.order_index as number | null) ?? null,
    });
  }

  // Resolve target keyword ids per category (in_depth preferred, umbrella fallback)
  const targetKwByCategory = new Map<string, typeof kwByCategory extends Map<string, infer V> ? V : never>();
  for (const catId of categoryIds) {
    const rows = kwByCategory.get(catId) ?? [];
    const inDepth = rows.filter((r) => r.tier === "in_depth");
    targetKwByCategory.set(catId, inDepth.length > 0 ? inDepth : rows.filter((r) => r.tier === "umbrella"));
  }

  // Build umbrella lookup for labels
  const umbrellaLabelMap = new Map<string, string>();
  for (const kw of keywordRows) {
    if (kw.tier === "umbrella") {
      umbrellaLabelMap.set(kw.id as string, kw.label as string);
    }
  }

  // 4. Load session keyword states for all keywords in this course
  const allKwIds = keywordRows.map((k) => k.id as string);

  // Also check for completed diagnostics in parallel
  const [statesRes, diagRes] = await Promise.all([
    allKwIds.length > 0
      ? supabase
          .from("math_student_keyword_states")
          .select("keyword_id, score, total_attempts, state")
          .eq("session_id", sessionId)
          .eq("course", course)
          .in("keyword_id", allKwIds)
      : Promise.resolve({ data: [] as Array<{ keyword_id: string; score: number | null; total_attempts: number; state: string | null }>, error: null }),
    supabase
      .from("math_diagnostic_sessions")
      .select("id, status")
      .eq("session_id", sessionId)
      .eq("course", course)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle(),
  ]);

  const stateMap = new Map<
    string,
    { score: number | null; total_attempts: number; state: string | null }
  >();
  for (const s of statesRes.data ?? []) {
    stateMap.set(s.keyword_id as string, {
      score: s.score as number | null,
      total_attempts: (s.total_attempts as number) ?? 0,
      state: (s.state as string) ?? null,
    });
  }

  const hasAnyStates = stateMap.size > 0;
  const hasCompletedDiagnostic = !!(diagRes.data);

  // needs_diagnostic: no keyword states for this course AND no completed diagnostic
  const needsDiagnostic = !hasAnyStates && !hasCompletedDiagnostic;

  // 5. Compute per-category progress
  type CategoryProgress = {
    id: string;
    label: string;
    section: string;
    order_index: number;
    avg_score: number | null;
    mastered_count: number;
    keyword_count: number;
    complete: boolean;
  };

  const progress: CategoryProgress[] = categories.map((cat) => {
    const catId = cat.id as string;
    const kwds = targetKwByCategory.get(catId) ?? [];
    const membership = membershipMap.get(catId);

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
      section: cat.section as string,
      order_index: membership?.order_index ?? (cat.order_index as number) ?? 0,
      avg_score: avgScore,
      mastered_count: masteredCount,
      keyword_count: keywordCount,
      complete,
    };
  });

  // 6. Compute overall_pct
  const totalKeywords = progress.reduce((s, p) => s + p.keyword_count, 0);
  const totalMastered = progress.reduce((s, p) => s + p.mastered_count, 0);
  const overallPct =
    totalKeywords > 0 ? Math.round((totalMastered / totalKeywords) * 100) : 0;

  // 7. Find frontier: first category in course order with avg_score < 0.8 OR not all mastered
  //    Categories with 0 keywords are skipped (they'll never be "complete").
  const frontierEntry = progress.find(
    (p) => p.keyword_count > 0 && !p.complete && (p.avg_score === null || p.avg_score < 0.8)
  );

  if (!frontierEntry && progress.every((p) => p.keyword_count === 0)) {
    // Taxonomy is empty — graceful 404
    return NextResponse.json(
      { error: "No keywords found for this course — taxonomy may not be seeded yet" },
      { status: 404 }
    );
  }

  // 8. Compute next_focus: up to 3 weakest unmastered in_depth keywords in frontier category
  //    Yield-nudged like practice-queue.
  let nextFocus: string[] = [];
  let frontierUmbrellaLabel: string | null = null;

  if (frontierEntry) {
    const kwds = targetKwByCategory.get(frontierEntry.id) ?? [];
    const unmastered = kwds.filter((kw) => {
      const st = stateMap.get(kw.id);
      return st?.state !== "mastered";
    });

    // Sort by effective weakness score (yield-nudged, same as practice-queue)
    const sorted = [...unmastered].sort((a, b) => {
      const stA = stateMap.get(a.id);
      const stB = stateMap.get(b.id);
      const rawA = stA?.score ?? 0.5;
      const rawB = stB?.score ?? 0.5;
      const effA = rawA + yieldNudge(a.yield_score);
      const effB = rawB + yieldNudge(b.yield_score);
      if (Math.abs(effA - effB) > 0.001) return effA - effB;
      return (stA?.total_attempts ?? 0) - (stB?.total_attempts ?? 0);
    });

    nextFocus = sorted.slice(0, 3).map((kw) => kw.id);

    // Find the umbrella of the weakest focus keyword for the breadcrumb
    if (nextFocus.length > 0) {
      const firstKw = sorted[0];
      if (firstKw?.parent_keyword_id) {
        frontierUmbrellaLabel = umbrellaLabelMap.get(firstKw.parent_keyword_id) ?? null;
      }
    }
  }

  return NextResponse.json({
    needs_diagnostic: needsDiagnostic,
    frontier: frontierEntry
      ? {
          id: frontierEntry.id,
          label: frontierEntry.label,
          section: frontierEntry.section,
          role: membershipMap.get(frontierEntry.id)?.role ?? "core",
          umbrella_label: frontierUmbrellaLabel,
          order_index: frontierEntry.order_index,
        }
      : null,
    next_focus: nextFocus,
    progress,
    overall_pct: overallPct,
  });
}
