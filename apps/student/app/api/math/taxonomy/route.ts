/**
 * GET /api/math/taxonomy?session_id=&course=
 *
 * Returns categories for the given course, grouped by section, with:
 *   - umbrellas[].children[] nested tree
 *   - per-keyword session scores from math_student_keyword_states
 *   - implied_score on each umbrella (avg of attempted children)
 *   - yield_score surfaced on every node
 *   - role from math_course_categories (core | foundation)
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { MathCourse } from "@/lib/mathTypes";
import { fetchAllPages } from "@/lib/mathPagedQuery";

export const runtime = "nodejs";

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

  if (course !== "precalc" && course !== "calc_ab") {
    return NextResponse.json(
      { error: "course must be 'precalc' or 'calc_ab'" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // Load course memberships (category_id, role, order_index for this course)
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

  // Load categories + keywords in parallel (keywords paginated — a course's
  // full keyword set exceeds PostgREST's 1000-row cap)
  const [categoriesRes, keywordRows] = await Promise.all([
    supabase
      .from("math_categories")
      .select("id, label, description, section, ced_unit, yield_score, yield_rationale, order_index")
      .in("id", categoryIds),
    fetchAllPages<Record<string, unknown>>((from, to) =>
      supabase
        .from("math_keywords")
        .select(
          "id, category_id, label, description, tier, parent_keyword_id, order_index, yield_score, yield_rationale"
        )
        .in("category_id", categoryIds)
        .eq("status", "approved")
        .order("order_index")
        .range(from, to)
    ),
  ]);
  const keywordsRes = { data: keywordRows, error: null };

  if (categoriesRes.error) {
    return NextResponse.json(
      { error: categoriesRes.error.message },
      { status: 500 }
    );
  }

  // Load session keyword states if provided
  const stateMap = new Map<
    string,
    {
      score: number | null;
      total_attempts: number;
      correct_attempts: number;
      dont_know_count: number;
      state: string | null;
    }
  >();

  if (sessionId) {
    const { data: states } = await supabase
      .from("math_student_keyword_states")
      .select(
        "keyword_id, score, total_attempts, correct_attempts, dont_know_count, state"
      )
      .eq("session_id", sessionId)
      .in("keyword_id",
        (keywordsRes.data ?? []).map((k) => k.id as string)
      );

    for (const s of states ?? []) {
      stateMap.set(s.keyword_id as string, {
        score: (s.score as number | null) ?? null,
        total_attempts: (s.total_attempts as number) ?? 0,
        correct_attempts: (s.correct_attempts as number) ?? 0,
        dont_know_count: (s.dont_know_count as number) ?? 0,
        state: (s.state as string) ?? null,
      });
    }
  }

  const keywords = keywordsRes.data ?? [];

  // Group keywords by category
  const kwByCategory = new Map<string, typeof keywords>();
  for (const kw of keywords) {
    const catId = kw.category_id as string;
    if (!kwByCategory.has(catId)) kwByCategory.set(catId, []);
    kwByCategory.get(catId)!.push(kw);
  }

  // Sort categories by course order_index from math_course_categories
  const cats = (categoriesRes.data ?? []).sort((a, b) => {
    const aOrd = membershipMap.get(a.id as string)?.order_index ?? 0;
    const bOrd = membershipMap.get(b.id as string)?.order_index ?? 0;
    return aOrd - bOrd;
  });

  const categories = cats.map((cat) => {
    const catKws = kwByCategory.get(cat.id as string) ?? [];
    const membership = membershipMap.get(cat.id as string);

    const sorted = [...catKws].sort((a, b) => {
      const tierOrder = (t: string) => (t === "umbrella" ? 0 : 1);
      const tDiff = tierOrder(a.tier as string) - tierOrder(b.tier as string);
      if (tDiff !== 0) return tDiff;
      return ((a.order_index as number) ?? 0) - ((b.order_index as number) ?? 0);
    });

    const umbrellaKws = sorted.filter((kw) => kw.tier === "umbrella");
    const inDepthKws = sorted.filter((kw) => kw.tier === "in_depth");

    // Build umbrella → in_depth map
    const inDepthByUmbrella = new Map<string, typeof inDepthKws>();
    for (const kw of inDepthKws) {
      const parentId = kw.parent_keyword_id as string | null;
      if (parentId) {
        if (!inDepthByUmbrella.has(parentId)) inDepthByUmbrella.set(parentId, []);
        inDepthByUmbrella.get(parentId)!.push(kw);
      }
    }

    const umbrellas = umbrellaKws.map((umb) => {
      const umbSt = stateMap.get(umb.id as string);
      const umbScore = umbSt?.score ?? null;
      const umbState = umbSt?.state ?? null;

      const children = (inDepthByUmbrella.get(umb.id as string) ?? []).map((kw) => {
        const st = stateMap.get(kw.id as string);
        const score = st?.score ?? null;
        const state = st?.state ?? null;
        const needsLesson =
          !st || state === "needs_lesson" || (score !== null && score < 0.35);
        return {
          id: kw.id as string,
          label: kw.label as string,
          description: kw.description as string | null,
          yield_score: (kw.yield_score as number | null) ?? null,
          yield_rationale: (kw.yield_rationale as string | null) ?? null,
          score,
          total_attempts: st?.total_attempts ?? 0,
          correct_attempts: st?.correct_attempts ?? 0,
          dont_know_count: st?.dont_know_count ?? 0,
          state,
          needs_lesson: needsLesson,
        };
      });

      // implied_score = avg of attempted children scores
      const attempted = children.filter(
        (c) => c.total_attempts > 0 && c.score !== null
      );
      const impliedScore =
        attempted.length > 0
          ? attempted.reduce((acc, c) => acc + (c.score as number), 0) /
            attempted.length
          : null;

      // Umbrella-level yield: use own yield_score if present, else max of children
      const umbYieldScore =
        (umb.yield_score as number | null) ??
        (children.length > 0
          ? Math.max(...children.map((c) => c.yield_score ?? 0))
          : null);

      return {
        id: umb.id as string,
        label: umb.label as string,
        description: umb.description as string | null,
        yield_score: umbYieldScore,
        yield_rationale: (umb.yield_rationale as string | null) ?? null,
        score: umbScore,
        total_attempts: umbSt?.total_attempts ?? 0,
        correct_attempts: umbSt?.correct_attempts ?? 0,
        dont_know_count: umbSt?.dont_know_count ?? 0,
        state: umbState,
        implied_score: impliedScore,
        children,
      };
    });

    return {
      id: cat.id as string,
      label: cat.label as string,
      description: cat.description as string | null,
      section: cat.section as string,
      ced_unit: cat.ced_unit as string | null,
      yield_score: (cat.yield_score as number | null) ?? null,
      yield_rationale: (cat.yield_rationale as string | null) ?? null,
      order_index: membership?.order_index ?? (cat.order_index as number),
      role: membership?.role ?? "core",
      umbrellas,
    };
  });

  return NextResponse.json({ categories });
}
