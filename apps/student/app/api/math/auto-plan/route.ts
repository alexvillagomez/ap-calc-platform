/**
 * GET /api/math/auto-plan?session_id=&course=
 *
 * Server-side computes the student's current position in the auto-mode GUIDED PATH.
 *
 * Guided-path model (rebuilt 2026-06-17):
 *   - The forward path walks the course's CORE categories in order_index order.
 *       • precalc  → all 11 categories (foundations + AP Precalc) are role 'core'.
 *       • calc_ab  → only the 8 calc units (calc_unit_1…8) are role 'core'; the
 *         precalc foundations are role 'foundation' and are NOT part of the
 *         forward path, so the calc path starts at Unit 1, Topic 1 (Limits).
 *   - Within a category, the path walks UMBRELLAS (= CED topics) in order_index
 *     order — ONE topic at a time. A topic is the unit of progression.
 *   - For each topic the student does: LESSON → FLASHCARDS → QUIZ (practice on the
 *     topic's in_depth skills). The page owns that per-topic sequencing; this route
 *     just reports the current frontier topic + its ordered skill ids.
 *   - A topic is "complete" when every in_depth skill under it is mastered. The
 *     path only advances to the next topic once the current one is complete, so a
 *     later topic is never surfaced before its predecessors.
 *   - Spiral review: `review_focus` lists already-learned skills from EARLIER topics
 *     so the page can interleave spaced review while advancing one new topic at a time.
 *
 * Response shape:
 * {
 *   needs_diagnostic: boolean,
 *   frontier: {                     // the current category (unit)
 *     id, label, section, role,
 *     umbrella_label: string|null,  // = current topic label
 *     order_index: number,
 *   } | null,
 *   frontier_topic: {               // the current topic (umbrella) — the heart of the path
 *     id: string,                   // umbrella keyword id (used for lesson + flashcards)
 *     label: string,
 *     category_id: string,
 *     topic_number: number,         // 1-based position within the unit
 *     topic_total: number,          // number of topics in the unit
 *     in_depth_ids: string[],       // ALL skill ids under the topic, in CED order
 *   } | null,
 *   next_focus: string[],           // UNMASTERED skill ids of the frontier topic, in CED order
 *   review_focus: string[],         // already-learned skill ids from earlier topics (spiral review)
 *   progress: Array<{ id,label,section,order_index,avg_score,mastered_count,
 *                     keyword_count,complete, topic_count, topics_complete }>,
 *   overall_pct: number,
 * }
 *
 * 404 when taxonomy is empty.
 *
 * Mirrors conventions of practice-queue/route.ts.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { MathCourse } from "@/lib/mathTypes";
import { fetchAllPages } from "@/lib/mathPagedQuery";

export const runtime = "nodejs";

const REVIEW_FOCUS_CAP = 40;

// Mastery-decay re-review threshold. Spec: "If a student is losing mastery on a
// past topic, it's PRIORITIZED in these in-between practice sections ... shown
// until back above threshold." Full mastery sits at ~0.8; a previously-mastered
// keyword whose current score has slipped BELOW this value is treated as
// "slipping" and bubbled to the FRONT of the spiral-review focus (most-decayed
// first) so it is re-reviewed until it recovers.
const REREVIEW_SLIP_THRESHOLD = 0.75;

type KwRow = {
  id: string;
  category_id: string;
  tier: string;
  parent_keyword_id: string | null;
  label: string;
  yield_score: number | null;
  order_index: number | null;
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
  // "Learn this" scope — restricts the FORWARD frontier to one object while spiral
  // review still pulls from already-mastered EARLIER topics. scope ∈
  // {category, umbrella, keyword}; scope_id is the corresponding id.
  const scope = searchParams.get("scope");
  const scopeId = searchParams.get("scope_id");

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

  // 1. Load course categories. The forward path follows the CORE categories
  //    (precalc: all; calc_ab: the 8 calc units) in order_index order — this is
  //    what makes the calc path start at Unit 1 (Limits) rather than foundations.
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

  const coreMemberships = memberships
    .filter((m) => (m.role as string) === "core")
    .sort((a, b) => (a.order_index as number) - (b.order_index as number));

  // Fallback: if a course somehow has no 'core' categories, walk everything.
  const pathMemberships = coreMemberships.length > 0 ? coreMemberships : memberships;

  const categoryIds = pathMemberships.map((m) => m.category_id as string);
  const membershipMap = new Map(
    pathMemberships.map((m) => [
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

  // Sort categories by the forward-path order_index
  const sortedCats = [...catRows].sort((a, b) => {
    const aOrd = membershipMap.get(a.id as string)?.order_index ?? 0;
    const bOrd = membershipMap.get(b.id as string)?.order_index ?? 0;
    return aOrd - bOrd;
  });

  // The "AP Precalculus" section is hidden from the standalone precalc course,
  // so auto mode never walks those topics. (calc_ab keeps them as foundations.)
  const categories =
    course === "precalc"
      ? sortedCats.filter((c) => (c.section as string) !== "ap_precalc")
      : sortedCats;

  // Path category ids AFTER the AP-Precalc filter — drives keyword loading and
  // the per-category progress loop below.
  const pathCategoryIds = categories.map((c) => c.id as string);

  // 3. Load all keywords for path categories (paginated — whole-course exceeds 1000-row cap).
  const allKeywords = await fetchAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("math_keywords")
      .select(
        "id, category_id, tier, parent_keyword_id, label, yield_score, order_index"
      )
      .in("category_id", pathCategoryIds)
      .eq("status", "approved")
      .order("order_index")
      .range(from, to)
  ).catch(() => null);

  const keywordRows: KwRow[] = (allKeywords ?? []).map((kw) => ({
    id: kw.id as string,
    category_id: kw.category_id as string,
    tier: kw.tier as string,
    parent_keyword_id: (kw.parent_keyword_id as string | null) ?? null,
    label: kw.label as string,
    yield_score: (kw.yield_score as number | null) ?? null,
    order_index: (kw.order_index as number | null) ?? 0,
  }));

  // Build per-category ordered TOPIC structure:
  //   topics[] = umbrellas in order; each topic has its in_depth skills in order.
  //   When an umbrella has no in_depth children, the umbrella itself is the skill.
  type Topic = {
    umbrellaId: string;
    label: string;
    order_index: number;
    skillIds: string[]; // in CED order
  };

  const topicsByCategory = new Map<string, Topic[]>();
  const allTargetSkillIds: string[] = []; // every "skill" across the path (for states fetch + overall)

  for (const catId of pathCategoryIds) {
    const rows = keywordRows.filter((r) => r.category_id === catId);
    const umbrellas = rows
      .filter((r) => r.tier === "umbrella")
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const inDepth = rows.filter((r) => r.tier === "in_depth");

    const topics: Topic[] = [];

    if (umbrellas.length > 0) {
      for (const u of umbrellas) {
        const children = inDepth
          .filter((c) => c.parent_keyword_id === u.id)
          .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        const skillIds =
          children.length > 0 ? children.map((c) => c.id) : [u.id];
        topics.push({
          umbrellaId: u.id,
          label: u.label,
          order_index: u.order_index ?? 0,
          skillIds,
        });
        allTargetSkillIds.push(...skillIds);
      }
    } else {
      // No umbrellas — treat each in_depth/keyword as its own one-skill topic.
      const ordered = [...rows].sort(
        (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)
      );
      for (const r of ordered) {
        topics.push({
          umbrellaId: r.id,
          label: r.label,
          order_index: r.order_index ?? 0,
          skillIds: [r.id],
        });
        allTargetSkillIds.push(r.id);
      }
    }

    topicsByCategory.set(catId, topics);
  }

  // 4. Load session keyword states + completed-diagnostic flag (parallel)
  //
  // IMPORTANT: fetch by session_id + course ONLY — do NOT add `.in("keyword_id",
  // allTargetSkillIds)`. A full course has ~400+ skills; a 400-element `.in()` makes
  // a ~17 KB GET URL that PostgREST rejects, so the query failed silently and the
  // plan saw ZERO states → it always returned needs_diagnostic + topic 1, which is
  // why reopening calc_ab auto mode reset to the start. States are already scoped
  // per session+course, so the unfiltered fetch is correct and small. We filter to
  // the target skills in JS below via stateMap lookups.
  const allTargetSkillSet = new Set(allTargetSkillIds);
  const [statesRes, diagRes] = await Promise.all([
    supabase
      .from("math_student_keyword_states")
      .select("keyword_id, score, total_attempts, state, intro_seen")
      .eq("session_id", sessionId)
      .eq("course", course),
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
  // Server-authoritative set of skill ids whose LESSON→FLASHCARDS intro the
  // student has already completed (per-user, NOT per-browser). Replaces the old
  // localStorage `lodera_auto_intro_<course>` flag.
  const introSeen: string[] = [];
  for (const s of statesRes.data ?? []) {
    const kid = s.keyword_id as string;
    // Only consider states for skills on the forward path (ignore stragglers).
    if (!allTargetSkillSet.has(kid)) continue;
    stateMap.set(kid, {
      score: s.score as number | null,
      total_attempts: (s.total_attempts as number) ?? 0,
      state: (s.state as string) ?? null,
    });
    if ((s as { intro_seen?: boolean | null }).intro_seen) {
      introSeen.push(kid);
    }
  }

  const isMastered = (id: string) => stateMap.get(id)?.state === "mastered";

  const hasAnyStates = stateMap.size > 0;
  const hasCompletedDiagnostic = !!diagRes.data;
  // A scoped "Learn this" run never gates on the diagnostic — the student explicitly
  // asked to learn this object, so drop them straight into its lesson → flashcards →
  // questions regardless of whether they've taken a diagnostic.
  const isScoped = !!(scope && scopeId);
  const needsDiagnostic = !isScoped && !hasAnyStates && !hasCompletedDiagnostic;

  // 5. Per-category progress (topic-aware)
  type CategoryProgress = {
    id: string;
    label: string;
    section: string;
    order_index: number;
    avg_score: number | null;
    mastered_count: number;
    keyword_count: number;
    complete: boolean;
    topic_count: number;
    topics_complete: number;
  };

  const progress: CategoryProgress[] = categories.map((cat) => {
    const catId = cat.id as string;
    const topics = topicsByCategory.get(catId) ?? [];
    const membership = membershipMap.get(catId);

    let totalScore = 0;
    let scoredCount = 0;
    let masteredCount = 0;
    let keywordCount = 0;
    let topicsComplete = 0;

    for (const t of topics) {
      let topicAllMastered = t.skillIds.length > 0;
      for (const sid of t.skillIds) {
        keywordCount += 1;
        const st = stateMap.get(sid);
        if (st?.state === "mastered") {
          masteredCount += 1;
          totalScore += 1;
          scoredCount += 1;
        } else {
          topicAllMastered = false;
          if (
            st?.score !== null &&
            st?.score !== undefined &&
            (st?.total_attempts ?? 0) > 0
          ) {
            totalScore += st.score;
            scoredCount += 1;
          }
        }
      }
      if (topicAllMastered) topicsComplete += 1;
    }

    const avgScore = scoredCount > 0 ? totalScore / scoredCount : null;
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
      topic_count: topics.length,
      topics_complete: topicsComplete,
    };
  });

  // 6. overall_pct over all path skills
  const totalKeywords = progress.reduce((s, p) => s + p.keyword_count, 0);
  const totalMastered = progress.reduce((s, p) => s + p.mastered_count, 0);
  const overallPct =
    totalKeywords > 0 ? Math.round((totalMastered / totalKeywords) * 100) : 0;

  if (totalKeywords === 0) {
    return NextResponse.json(
      { error: "No keywords found for this course — taxonomy may not be seeded yet" },
      { status: 404 }
    );
  }

  // 7. Find the frontier TOPIC: walk categories in order, then umbrellas in order,
  //    stop at the first topic with an unmastered skill. Everything before it is the
  //    completed (review) region; nothing after it is surfaced yet.
  let frontierCategory: (typeof categories)[number] | null = null;
  let frontierTopic: Topic | null = null;
  let frontierTopicNumber = 0;
  const reviewFocus: string[] = []; // mastered skills from earlier topics

  // "Learn this" scope gate: a topic can only become the FORWARD frontier when it
  // is within the requested scope. Out-of-scope topics are skipped for the frontier
  // (their MASTERED skills still feed spiral review below), so Learn-this on a later
  // object never drags in unfinished earlier topics, and spaced review still spans
  // everything the student has already covered.
  const topicInScope = (catId: string, t: Topic): boolean => {
    if (!scope || !scopeId) return true;
    if (scope === "category") return catId === scopeId;
    if (scope === "umbrella") return t.umbrellaId === scopeId;
    if (scope === "keyword") return t.skillIds.includes(scopeId);
    return true;
  };

  outer: for (const cat of categories) {
    const topics = topicsByCategory.get(cat.id as string) ?? [];
    for (let i = 0; i < topics.length; i++) {
      const t = topics[i]!;
      const hasUnmastered = t.skillIds.some((sid) => !isMastered(sid));
      if (hasUnmastered && !frontierTopic && topicInScope(cat.id as string, t)) {
        frontierCategory = cat;
        frontierTopic = t;
        frontierTopicNumber = i + 1;
        break outer; // earlier topics already pushed to reviewFocus below
      }
      // This topic is fully mastered → its skills become spiral-review candidates.
      for (const sid of t.skillIds) {
        if (isMastered(sid)) reviewFocus.push(sid);
      }
    }
  }

  // Decay-aware re-prioritization of spiral review: previously-mastered skills
  // whose current score has slipped below REREVIEW_SLIP_THRESHOLD jump to the
  // FRONT (most-decayed first), so a topic losing mastery is re-reviewed until
  // it climbs back above threshold. The rest keep their topic order.
  const scoreOf = (sid: string) => {
    const s = stateMap.get(sid)?.score;
    return s === null || s === undefined ? 1 : s; // mastered w/ no score → treat as full
  };
  const slipping: string[] = [];
  const steady: string[] = [];
  for (const sid of reviewFocus) {
    if (scoreOf(sid) < REREVIEW_SLIP_THRESHOLD) slipping.push(sid);
    else steady.push(sid);
  }
  slipping.sort((a, b) => scoreOf(a) - scoreOf(b)); // most-decayed first
  const rankedReviewFocus = [...slipping, ...steady];

  // next_focus = unmastered skills of the frontier topic, in CED order.
  // For a single-keyword "Learn this" scope, narrow to just that keyword so the
  // mini-auto practices only the clicked subtopic (its umbrella siblings are not
  // pulled in).
  let nextFocus = frontierTopic
    ? frontierTopic.skillIds.filter((sid) => !isMastered(sid))
    : [];
  if (scope === "keyword" && scopeId) {
    nextFocus = nextFocus.filter((sid) => sid === scopeId);
  }

  return NextResponse.json({
    needs_diagnostic: needsDiagnostic,
    frontier:
      frontierCategory && frontierTopic
        ? {
            id: frontierCategory.id as string,
            label: frontierCategory.label as string,
            section: frontierCategory.section as string,
            role: membershipMap.get(frontierCategory.id as string)?.role ?? "core",
            umbrella_label: frontierTopic.label,
            order_index:
              membershipMap.get(frontierCategory.id as string)?.order_index ?? 0,
          }
        : null,
    frontier_topic:
      frontierCategory && frontierTopic
        ? {
            id: frontierTopic.umbrellaId,
            label: frontierTopic.label,
            category_id: frontierCategory.id as string,
            topic_number: frontierTopicNumber,
            topic_total: (topicsByCategory.get(frontierCategory.id as string) ?? [])
              .length,
            in_depth_ids: frontierTopic.skillIds,
          }
        : null,
    next_focus: nextFocus,
    // Take from the FRONT now that the list is decay-ranked (slipping first),
    // so the cap never drops a topic that is losing mastery.
    review_focus: rankedReviewFocus.slice(0, REVIEW_FOCUS_CAP),
    progress,
    overall_pct: overallPct,
    intro_seen: introSeen,
  });
}
