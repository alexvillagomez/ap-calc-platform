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
import type { MathCourse } from "@/lib/mathTypes";
import { fetchAllPages } from "@/lib/mathPagedQuery";
import { getReadClient } from "@/lib/supabaseRead";
import { cached } from "@/lib/serverCache";

export const runtime = "nodejs";

// Shared, slow-changing taxonomy (course memberships + categories + keywords) is
// cached for 5 minutes. Per-session keyword states are NEVER cached (per-user).
const TAXONOMY_TTL_MS = 5 * 60 * 1000;

type MembershipRow = {
  category_id: string;
  role: string;
  order_index: number;
};
type TaxonomyBase = {
  memberships: MembershipRow[];
  categories: Record<string, unknown>[];
  keywords: Record<string, unknown>[];
};

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

  // Read-only queries go to the read replica when SUPABASE_REPLICA_URL is set.
  const supabase = getReadClient();

  // Shared taxonomy is identical for every user of a course → cache it.
  let base: TaxonomyBase;
  try {
    base = await cached<TaxonomyBase>(
      `math:taxonomy:${course}`,
      TAXONOMY_TTL_MS,
      async () => {
        const { data: memberships, error: membErr } = await supabase
          .from("math_course_categories")
          .select("category_id, role, order_index")
          .eq("course", course)
          .order("order_index");

        if (membErr || !memberships || memberships.length === 0) {
          throw new Error(
            membErr?.message ?? "No categories found for this course"
          );
        }

        const categoryIds = memberships.map((m) => m.category_id as string);

        // Load categories + keywords in parallel (keywords paginated — a
        // course's full keyword set exceeds PostgREST's 1000-row cap)
        const [categoriesRes, keywordRows] = await Promise.all([
          supabase
            .from("math_categories")
            .select(
              "id, label, description, section, ced_unit, yield_score, yield_rationale, order_index"
            )
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

        if (categoriesRes.error) {
          throw new Error(categoriesRes.error.message);
        }

        let categories = categoriesRes.data ?? [];
        let keptMemberships = memberships as MembershipRow[];
        let keywords = keywordRows;

        // The "AP Precalculus" section is hidden from the standalone precalc
        // course (config-level removal — the taxonomy rows are untouched and the
        // same categories still appear in calc_ab as foundations). Reversible by
        // deleting this block.
        if (course === "precalc") {
          const hiddenIds = new Set(
            categories
              .filter((c) => (c.section as string) === "ap_precalc")
              .map((c) => c.id as string)
          );
          if (hiddenIds.size > 0) {
            categories = categories.filter((c) => !hiddenIds.has(c.id as string));
            keptMemberships = keptMemberships.filter(
              (m) => !hiddenIds.has(m.category_id as string)
            );
            keywords = keywords.filter(
              (k) => !hiddenIds.has(k.category_id as string)
            );
          }
        }

        return {
          memberships: keptMemberships,
          categories,
          keywords,
        };
      }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "No categories found for this course", detail },
      { status: 404 }
    );
  }

  const membershipMap = new Map(
    base.memberships.map((m) => [
      m.category_id,
      { role: m.role, order_index: m.order_index },
    ])
  );

  const keywordsRes = { data: base.keywords, error: null };
  const categoriesRes = { data: base.categories, error: null };

  // Load session keyword states if provided (per-user — NOT cached)
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
    // Scope by the indexed session_id ONLY, then filter to this course's keywords
    // in JS via a Set — do NOT `.in("keyword_id", …)`. calc_ab has ~1,756 keywords,
    // and a `.in()` of that many ids builds an ~80 KB GET URL that PostgREST hangs
    // on / rejects — the cause of the minute-long "Loading…" spinner. Paginate:
    // a session can hold one state row per keyword, exceeding PostgREST's 1000 cap.
    const relevantIds = new Set(
      (keywordsRes.data ?? []).map((k) => k.id as string)
    );
    const states = await fetchAllPages<{
      keyword_id: string;
      score: number | null;
      total_attempts: number | null;
      correct_attempts: number | null;
      dont_know_count: number | null;
      state: string | null;
    }>((from, to) =>
      supabase
        .from("math_student_keyword_states")
        .select(
          "keyword_id, score, total_attempts, correct_attempts, dont_know_count, state"
        )
        .eq("session_id", sessionId)
        .range(from, to)
    );

    for (const s of states) {
      if (!relevantIds.has(s.keyword_id)) continue;
      stateMap.set(s.keyword_id, {
        score: s.score ?? null,
        total_attempts: s.total_attempts ?? 0,
        correct_attempts: s.correct_attempts ?? 0,
        dont_know_count: s.dont_know_count ?? 0,
        state: s.state ?? null,
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

  // Honest per-question counts (NOT summed per-keyword, which over-counts a
  // question by its number of tagged keywords). Count rows in the attempt log
  // for questions belonging to THIS course's categories.
  let questionsAnswered = 0;
  let correctAnswers = 0;
  if (sessionId) {
    const courseCatIds = [...membershipMap.keys()] as string[];
    const { count: total } = await supabase
      .from("math_question_attempts")
      .select("id, q:math_questions!inner(category_id)", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .in("q.category_id", courseCatIds);
    const { count: corr } = await supabase
      .from("math_question_attempts")
      .select("id, q:math_questions!inner(category_id)", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("correct", true)
      .in("q.category_id", courseCatIds);
    questionsAnswered = total ?? 0;
    correctAnswers = corr ?? 0;
  }

  return NextResponse.json({
    categories,
    questions_answered: questionsAnswered,
    correct_answers: correctAnswers,
  });
}
