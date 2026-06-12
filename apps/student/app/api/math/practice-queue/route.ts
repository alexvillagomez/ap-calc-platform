/**
 * GET /api/math/practice-queue?session_id=&course=&category_id=[&umbrella_id=][&keyword_id=]
 *
 * Returns the weakness-first practice queue (cap 40) and spaced-review pool.
 *
 * Scope precedence:
 *   keyword_id  → single-keyword queue
 *   umbrella_id → in_depth children of that umbrella (fallback: umbrella itself)
 *   category_id → whole category (must belong to the course)
 *   (none)      → all categories in the course
 *
 * Yield-aware nudge per spec:
 *   effective_score = raw_score + YIELD_ADJ[yield]
 *   yield 1.0 → −0.12  (high-yield sorts earlier)
 *   yield 0.0 → +0.10  (low-yield sorts later)
 *   Mapped linearly from the 0–1 numeric yield_score stored on math_keywords.
 *
 * review_pool is always whole-scope regardless of single-keyword/umbrella scope.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadTargetKeywords } from "@/lib/mathTagging";
import type { MathCourse } from "@/lib/mathTypes";

export const runtime = "nodejs";

/** Map numeric yield_score ∈ [0,1] to the bounded nudge defined in the spec.
 *  yield 1.0 → −0.12, yield 0.0 → +0.10.  Linear interpolation. */
function yieldNudge(yieldScore: number | null): number {
  const y = yieldScore ?? 0.5; // treat unknown as mid
  // Linear: +0.10 at y=0, 0 at y=0.5, -0.12 at y=1.0
  // slope = (−0.12 − 0.10) / (1.0 − 0.0) = −0.22
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
  const categoryId = searchParams.get("category_id");
  const umbrellaId = searchParams.get("umbrella_id");
  const keywordId = searchParams.get("keyword_id");
  const keywordIds = searchParams.getAll("keyword_ids").filter(Boolean);

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

  // Resolve which categories to load
  let categoryIds: string[];
  if (categoryId) {
    // Validate category belongs to this course
    const { data: membership } = await supabase
      .from("math_course_categories")
      .select("category_id")
      .eq("course", course)
      .eq("category_id", categoryId)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json(
        { error: "category_id not found in this course" },
        { status: 404 }
      );
    }
    categoryIds = [categoryId];
  } else {
    // All categories in the course
    const { data: memberships } = await supabase
      .from("math_course_categories")
      .select("category_id")
      .eq("course", course);
    categoryIds = (memberships ?? []).map((m) => m.category_id as string);
    if (categoryIds.length === 0) {
      return NextResponse.json(
        { error: "No categories found for this course" },
        { status: 404 }
      );
    }
  }

  // Load all target keywords for these categories
  const allKeywords = await loadTargetKeywords(supabase, categoryIds, course);
  if (allKeywords.length === 0) {
    return NextResponse.json(
      { error: "No keywords found for this scope" },
      { status: 404 }
    );
  }

  const categoryKeywordIds = new Set(allKeywords.map((k) => k.id));

  // Build umbrella lookup (needed for labels)
  const umbrellaMap = new Map<string, { id: string; label: string }>();
  if (categoryIds.length > 0) {
    const { data: umbrellaRows } = await supabase
      .from("math_keywords")
      .select("id, label")
      .in("category_id", categoryIds)
      .eq("tier", "umbrella")
      .eq("status", "approved");
    for (const u of umbrellaRows ?? []) {
      umbrellaMap.set(u.id as string, {
        id: u.id as string,
        label: u.label as string,
      });
    }
  }

  // Resolve scoped keyword set for the QUEUE
  let queueKeywords = allKeywords;

  if (keywordId) {
    const match = allKeywords.find((k) => k.id === keywordId);
    if (!match) {
      return NextResponse.json(
        { error: "keyword_id not found in this scope" },
        { status: 404 }
      );
    }
    queueKeywords = [match];
  } else if (keywordIds.length > 0) {
    // Scoped set (auto mode sends its next_focus keywords as repeated keyword_ids params).
    // Unknown ids are ignored rather than 404ing; empty match falls back to the full scope.
    const idSet = new Set(keywordIds);
    const matches = allKeywords.filter((k) => idSet.has(k.id));
    if (matches.length > 0) {
      queueKeywords = matches;
    }
  } else if (umbrellaId) {
    if (!umbrellaMap.has(umbrellaId)) {
      return NextResponse.json(
        { error: "umbrella_id not found in this scope" },
        { status: 404 }
      );
    }
    const children = allKeywords.filter(
      (k) => k.parent_keyword_id === umbrellaId
    );
    if (children.length > 0) {
      queueKeywords = children;
    } else {
      const umbKw = allKeywords.find((k) => k.id === umbrellaId);
      if (umbKw) {
        queueKeywords = [umbKw];
      } else {
        const { data: umbRow } = await supabase
          .from("math_keywords")
          .select(
            "id, label, description, tier, parent_keyword_id, category_id, embedding, concept_blueprint, yield_score"
          )
          .eq("id", umbrellaId)
          .eq("status", "approved")
          .maybeSingle();
        queueKeywords = umbRow
          ? [
              {
                id: umbRow.id as string,
                label: umbRow.label as string,
                description: (umbRow.description as string) ?? "",
                tier: umbRow.tier as string,
                parent_keyword_id:
                  (umbRow.parent_keyword_id as string | null) ?? null,
                category_id: umbRow.category_id as string,
                embedding: umbRow.embedding,
                concept_blueprint: umbRow.concept_blueprint ?? null,
                yield_score: (umbRow.yield_score as number | null) ?? null,
              },
            ]
          : allKeywords;
      }
    }
  }

  // Load session keyword states
  const { data: states } = await supabase
    .from("math_student_keyword_states")
    .select(
      "keyword_id, score, total_attempts, correct_attempts, dont_know_count, state, spaced_review_due_at"
    )
    .eq("session_id", sessionId)
    .in("keyword_id", [...categoryKeywordIds]);

  const stateMap = new Map<
    string,
    {
      score: number | null;
      total_attempts: number;
      correct_attempts: number;
      dont_know_count: number;
      state: string | null;
      spaced_review_due_at: string | null;
    }
  >();
  for (const s of states ?? []) {
    stateMap.set(s.keyword_id as string, {
      score: s.score as number | null,
      total_attempts: (s.total_attempts as number) ?? 0,
      correct_attempts: (s.correct_attempts as number) ?? 0,
      dont_know_count: (s.dont_know_count as number) ?? 0,
      state: (s.state as string) ?? null,
      spaced_review_due_at: (s.spaced_review_due_at as string) ?? null,
    });
  }

  // Build review_pool (whole scope — all allKeywords that have been learned)
  const reviewItems: {
    id: string;
    label: string;
    score: number | null;
    spaced_review_due_at: string | null;
  }[] = [];

  for (const kw of allKeywords) {
    const st = stateMap.get(kw.id);
    const score = st?.score ?? null;
    const state = st?.state ?? null;
    const totalAttempts = st?.total_attempts ?? 0;
    const spacedReviewDueAt = st?.spaced_review_due_at ?? null;

    if (
      totalAttempts > 0 &&
      (state === "mastered" || (score !== null && score >= 0.5))
    ) {
      reviewItems.push({
        id: kw.id,
        label: kw.label,
        score,
        spaced_review_due_at: spacedReviewDueAt,
      });
    }
  }

  // Build queue (scoped, exclude mastered, yield-nudged weakness-first)
  const queueItems: {
    id: string;
    label: string;
    description: string;
    umbrella_id: string | null;
    umbrella_label: string | null;
    score: number | null;
    state: string | null;
    total_attempts: number;
    needs_lesson: boolean;
    yield_score: number | null;
  }[] = [];

  for (const kw of queueKeywords) {
    const st = stateMap.get(kw.id);
    const score = st?.score ?? null;
    const state = st?.state ?? null;
    const totalAttempts = st?.total_attempts ?? 0;

    if (state === "mastered") continue;

    const needsLesson =
      !st || state === "needs_lesson" || (score !== null && score < 0.35);

    const umbrellaEntry = kw.parent_keyword_id
      ? (umbrellaMap.get(kw.parent_keyword_id) ?? null)
      : null;

    queueItems.push({
      id: kw.id,
      label: kw.label,
      description: kw.description,
      umbrella_id: umbrellaEntry?.id ?? null,
      umbrella_label: umbrellaEntry?.label ?? null,
      score,
      state,
      total_attempts: totalAttempts,
      needs_lesson: needsLesson,
      yield_score: kw.yield_score,
    });
  }

  // Sort: weakness-first with yield nudge per spec
  const effectiveScore = (item: (typeof queueItems)[0]): number =>
    (item.score ?? 0.5) + yieldNudge(item.yield_score);

  queueItems.sort((a, b) => {
    const aEff = effectiveScore(a);
    const bEff = effectiveScore(b);
    if (Math.abs(aEff - bEff) > 0.001) return aEff - bEff;
    return a.total_attempts - b.total_attempts;
  });

  return NextResponse.json({
    queue: queueItems.slice(0, 40),
    review_pool: reviewItems,
  });
}
