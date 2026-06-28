/**
 * GET /api/mcat/auto-plan?session_id=
 *
 * Server-side computes the student's current position in the MCAT auto-mode
 * GUIDED PATH — IDENTICAL in shape/algorithm to /api/math/auto-plan, adapted for
 * the flat MCAT taxonomy (no course-level grouping over mcat_categories).
 *
 * Guided-path model:
 *   - The forward path walks mcat_categories in order_index order.
 *   - Within a category, the path walks UMBRELLAS (tier='umbrella') in order_index
 *     order — ONE topic at a time. A topic is the unit of progression.
 *   - Per topic the student does: LESSON → FLASHCARDS → QUIZ (practice on the
 *     topic's in_depth skills). The page owns per-topic sequencing; this route just
 *     reports the current frontier topic + its ordered skill ids.
 *   - A topic is "complete" when every in_depth skill under it is mastered. The path
 *     only advances to the next topic once the current one is complete, so a later
 *     topic (e.g. "alpha helix") is never surfaced before its predecessors.
 *   - `next_focus` = the frontier topic's UNMASTERED in_depth skills, in order_index
 *     (CED) order — NOT weakness, NOT yield.
 *   - Spiral review: `review_focus` lists already-mastered skills from EARLIER topics
 *     (decay-ranked: skills slipped below the re-review threshold bubble to the front).
 *   - needs_diagnostic: true when the session has NO keyword states AND no completed
 *     mcat_diagnostic_sessions row.
 *
 * Response shape (pinned — the auto page depends on this EXACTLY):
 * {
 *   needs_diagnostic: boolean,
 *   frontier: { id, label, order_index } | null,                  // category
 *   frontier_topic: { id, label, category_id, topic_number, topic_total, in_depth_ids: string[] } | null,
 *   next_focus: string[],     // UNMASTERED in_depth of frontier_topic, in order
 *   review_focus: string[],
 *   progress: [...],          // per-category progress array
 *   overall_pct: number,
 *   intro_seen: string[]
 * }
 *
 * 404 when taxonomy is empty.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sectionFromId } from "@/lib/mcatSection";

export const runtime = "nodejs";

const REVIEW_FOCUS_CAP = 40;

// Mastery-decay re-review threshold (mirrors math). A previously-mastered keyword
// whose current score has slipped BELOW this jumps to the FRONT of spiral review.
const REREVIEW_SLIP_THRESHOLD = 0.75;

type KwRow = {
  id: string;
  category_id: string;
  tier: string;
  parent_keyword_id: string | null;
  label: string;
  yield_level: string | null;
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
  // "Learn this" scope — restricts the forward frontier to one object (category /
  // umbrella / keyword) while spiral review still pulls from earlier mastered topics.
  const scope = searchParams.get("scope");
  const scopeId = searchParams.get("scope_id");
  // Section scope: default biology so existing Biology auto-mode is unchanged.
  // When a "learn this" deep link omits ?section, infer it from the scope
  // target's id prefix (psych_soc = mcat_psychsoc_* categories / ps_* keywords).
  const sectionFilter = searchParams.get("section") || sectionFromId(scopeId);

  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // 1. Load MCAT categories ordered by order_index — the forward path.
  const { data: catRows, error: catErr } = await supabase
    .from("mcat_categories")
    .select("id, label, order_index")
    .eq("section", sectionFilter)
    .order("order_index");

  if (catErr || !catRows || catRows.length === 0) {
    return NextResponse.json(
      { error: "No MCAT categories found — taxonomy may not be seeded yet", detail: catErr?.message },
      { status: 404 }
    );
  }

  const categories = [...catRows].sort(
    (a, b) => ((a.order_index as number) ?? 0) - ((b.order_index as number) ?? 0)
  );
  const categoryIds = categories.map((c) => c.id as string);

  // 2. Load all keywords for these categories.
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

  const keywordRows: KwRow[] = (kwRows ?? []).map((k) => ({
    id: k.id as string,
    category_id: k.category_id as string,
    tier: k.tier as string,
    parent_keyword_id: (k.parent_keyword_id as string | null) ?? null,
    label: k.label as string,
    yield_level: (k.yield_level as string | null) ?? null,
    order_index: (k.order_index as number | null) ?? 0,
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
  const allTargetSkillIds: string[] = [];

  for (const catId of categoryIds) {
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
        const skillIds = children.length > 0 ? children.map((c) => c.id) : [u.id];
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

  // 3. Load session keyword states + completed-diagnostic flag (parallel).
  //
  // IMPORTANT: fetch by session_id ONLY — do NOT add `.in("keyword_id",
  // allTargetSkillIds)`. MCAT Biology has ~700+ skills; a 700-element `.in()` makes
  // a GET URL large enough that PostgREST rejects it, so the query failed silently
  // and the plan saw ZERO states → reopening auto mode reset to the start. States
  // are already per-session; we filter to path skills in JS below.
  const allTargetSkillSet = new Set(allTargetSkillIds);
  const [statesRes, diagRes] = await Promise.all([
    supabase
      .from("mcat_student_keyword_states")
      .select("keyword_id, score, total_attempts, state, intro_seen")
      .eq("session_id", sessionId),
    supabase
      .from("mcat_diagnostic_sessions")
      .select("id, status")
      .eq("session_id", sessionId)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle(),
  ]);

  type StateEntry = { score: number | null; total_attempts: number; state: string | null };
  const stateMap = new Map<string, StateEntry>();
  // Server-authoritative set of skill ids whose LESSON→FLASHCARDS intro the student
  // has already completed (per-user, NOT per-browser).
  const introSeen: string[] = [];
  for (const s of statesRes.data ?? []) {
    const kid = s.keyword_id as string;
    if (!allTargetSkillSet.has(kid)) continue;
    stateMap.set(kid, {
      score: (s.score as number | null) ?? null,
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
  // A scoped "Learn this" run never gates on the diagnostic — drop the student
  // straight into the object's lesson → flashcards → questions.
  const isScoped = !!(scope && scopeId);
  const needsDiagnostic = !isScoped && !hasAnyStates && !hasCompletedDiagnostic;

  // 4. Per-category progress (topic-aware).
  type CategoryProgress = {
    id: string;
    label: string;
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
      order_index: (cat.order_index as number) ?? 0,
      avg_score: avgScore,
      mastered_count: masteredCount,
      keyword_count: keywordCount,
      complete,
      topic_count: topics.length,
      topics_complete: topicsComplete,
    };
  });

  // 5. overall_pct over all path skills.
  const totalKeywords = progress.reduce((s, p) => s + p.keyword_count, 0);
  const totalMastered = progress.reduce((s, p) => s + p.mastered_count, 0);
  const overallPct =
    totalKeywords > 0 ? Math.round((totalMastered / totalKeywords) * 100) : 0;

  if (totalKeywords === 0) {
    return NextResponse.json(
      { error: "No keywords found — MCAT taxonomy may not be seeded yet" },
      { status: 404 }
    );
  }

  // 6. Find the frontier TOPIC: walk categories in order, then umbrellas in order,
  //    stop at the first topic with an unmastered skill. Everything before it is the
  //    completed (review) region; nothing after it is surfaced yet.
  let frontierCategory: (typeof categories)[number] | null = null;
  let frontierTopic: Topic | null = null;
  let frontierTopicNumber = 0;
  const reviewFocus: string[] = []; // mastered skills from earlier topics

  // "Learn this" scope gate — only an in-scope topic can become the forward frontier.
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
        break outer;
      }
      // Fully-mastered topic → its skills become spiral-review candidates.
      for (const sid of t.skillIds) {
        if (isMastered(sid)) reviewFocus.push(sid);
      }
    }
  }

  // Decay-aware re-prioritization of spiral review: previously-mastered skills whose
  // current score has slipped below REREVIEW_SLIP_THRESHOLD jump to the FRONT.
  const scoreOf = (sid: string) => {
    const s = stateMap.get(sid)?.score;
    return s === null || s === undefined ? 1 : s; // mastered w/ no score → full
  };
  const slipping: string[] = [];
  const steady: string[] = [];
  for (const sid of reviewFocus) {
    if (scoreOf(sid) < REREVIEW_SLIP_THRESHOLD) slipping.push(sid);
    else steady.push(sid);
  }
  slipping.sort((a, b) => scoreOf(a) - scoreOf(b)); // most-decayed first
  const rankedReviewFocus = [...slipping, ...steady];

  // next_focus = unmastered skills of the frontier topic, in CED order. For a
  // single-keyword "Learn this" scope, narrow to just that keyword.
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
            order_index: (frontierCategory.order_index as number) ?? 0,
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
    review_focus: rankedReviewFocus.slice(0, REVIEW_FOCUS_CAP),
    progress,
    overall_pct: overallPct,
    intro_seen: introSeen,
    // Framing-only intro keywords (order_index === -1): lesson + general flashcards
    // only, never practiced. The client advances past them after the warm-up.
    intro_ids: keywordRows.filter((r) => r.order_index === -1).map((r) => r.id),
  });
}
