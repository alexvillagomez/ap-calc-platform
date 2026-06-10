import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { applyAnswerToScores, computeRoute } from "@/lib/diagnosticScoring";
import type { Answer, KeywordScores } from "@/lib/diagnosticScoring";
import { topicToCategory } from "@/lib/topicCategoryMap";

type DiagnosticProblemRow = {
  id: string;
  umbrella_keywords: Record<string, number>;
  in_depth_keywords: Record<string, number>;
};

type SubmittedAnswer = Answer & { problem_id: string };

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, key);

  const body = (await request.json()) as {
    sessionId: string;
    topic_id?: string;
    topic_ids?: string[];
    answers: SubmittedAnswer[];
  };

  const { sessionId, answers } = body;

  // Resolve topic list
  const topicIds: string[] = body.topic_ids?.length
    ? body.topic_ids
    : body.topic_id
    ? [body.topic_id]
    : [];

  if (!sessionId || topicIds.length === 0 || !Array.isArray(answers)) {
    return NextResponse.json({ error: "sessionId, topic_id/topic_ids, and answers required" }, { status: 400 });
  }

  // Fetch keyword weights for each answered problem from rag_examples
  const problemIds = answers.map((a) => a.problem_id);
  const { data: ragProblems } = await supabase
    .from("rag_examples")
    .select("id, keyword_weights")
    .eq("course", "precalc")
    .in("id", problemIds);

  // Map topic IDs → category IDs (learn_keywords uses category_id not topic_id)
  const categoryIds = topicIds.map(topicToCategory);
  const categoryToTopic = new Map<string, string>(topicIds.map((t, i) => [categoryIds[i]!, t]));

  // Build keyword → topic map across all topics
  const { data: allKeywords } = await supabase
    .from("learn_keywords")
    .select("id, category_id")
    .in("category_id", categoryIds)
    .eq("tier", "in_depth")
    .eq("status", "approved");

  const keywordToTopic = new Map<string, string>(
    (allKeywords ?? []).map((k: { id: string; category_id: string }) => [
      k.id,
      categoryToTopic.get(k.category_id) ?? topicIds[0]!,
    ])
  );
  const validLearnKeywordIds = new Set(keywordToTopic.keys());

  // Group in-depth keywords by topic
  const keywordsByTopic = new Map<string, string[]>();
  for (const kw of (allKeywords ?? []) as Array<{ id: string; category_id: string }>) {
    const topicId = categoryToTopic.get(kw.category_id) ?? topicIds[0]!;
    const list = keywordsByTopic.get(topicId) ?? [];
    list.push(kw.id);
    keywordsByTopic.set(topicId, list);
  }

  // Build problem map with umbrella = primary topic from keywords
  const problemMap = new Map<string, DiagnosticProblemRow>(
    (ragProblems ?? []).map((p: { id: string; keyword_weights: Record<string, number> }) => {
      // Determine primary topic from this problem's keyword_weights
      const kwKeys = Object.keys(p.keyword_weights ?? {});
      const primaryTopic = kwKeys.map(k => keywordToTopic.get(k)).find(t => t !== undefined) ?? topicIds[0]!;
      return [p.id, {
        id: p.id,
        umbrella_keywords: { [primaryTopic]: 1.0 },
        in_depth_keywords: p.keyword_weights ?? {},
      }];
    })
  );

  // Run EMA scoring across all answers (shared state across topics)
  let umbrellaScores: KeywordScores = {};
  let inDepthScores: KeywordScores = {};

  for (const answer of answers) {
    const prob = problemMap.get(answer.problem_id);
    if (!prob) continue;
    const result = applyAnswerToScores(
      umbrellaScores,
      inDepthScores,
      prob.umbrella_keywords,
      prob.in_depth_keywords,
      answer
    );
    umbrellaScores = result.umbrellaScores;
    inDepthScores = result.inDepthScores;
  }

  function scoreToState(score: number, umbrellaRoute: string): string {
    if (umbrellaRoute === "skip") return "mastered";
    if (score >= 0.75) return "needs_practice";
    if (score >= 0.5) return "needs_refresher";
    return "needs_lesson";
  }

  const allStateRows: Record<string, unknown>[] = [];
  const perTopicResults: Record<string, { route: string; umbrellaScore: number; weakestSkills: string[]; verdict: string }> = {};

  for (const topicId of topicIds) {
    // Compute per-topic route using answers related to this topic's keywords
    const topicKwIds = new Set(keywordsByTopic.get(topicId) ?? []);
    const topicAnswers = answers.filter(a => {
      const prob = problemMap.get(a.problem_id);
      if (!prob) return false;
      return Object.keys(prob.in_depth_keywords).some(k => topicKwIds.has(k));
    });

    const topicResult = computeRoute(
      topicAnswers.length > 0 ? topicAnswers : answers,
      umbrellaScores,
      inDepthScores,
      topicId
    );

    perTopicResults[topicId] = {
      route: topicResult.route,
      umbrellaScore: topicResult.umbrellaScore,
      weakestSkills: topicResult.weakestSkills,
      verdict: topicResult.verdict,
    };

    const topicKwArray = keywordsByTopic.get(topicId) ?? [];
    const neverSeen = topicAnswers.some((a) => a.flaggedNeverSeen);
    const forgot = topicAnswers.some((a) => a.flaggedForgotten);

    for (const kwId of topicKwArray) {
      const inDepthScore = inDepthScores[kwId] ?? 0.5;
      const umbrellaScore = umbrellaScores[topicId] ?? 0.5;
      const state = scoreToState(inDepthScore, topicResult.route);

      allStateRows.push({
        session_id: sessionId,
        keyword_id: kwId,
        topic_id: topicId,
        state,
        umbrella_score: Math.min(1, Math.max(0, umbrellaScore)),
        in_depth_score: Math.min(1, Math.max(0, inDepthScore)),
        confidence: Math.min(1, answers.filter((a) => !a.flaggedNeverSeen).length / Math.max(5, answers.length)),
        clicked_never_seen: neverSeen,
        clicked_forgot: forgot,
      });
    }
  }

  if (allStateRows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("learn_student_keyword_states")
      .upsert(allStateRows, { onConflict: "session_id,keyword_id" });

    if (upsertErr) {
      console.error("classify upsert error:", upsertErr.message);
    }

  }

  // Single-topic backwards-compatible response
  if (topicIds.length === 1) {
    const r = perTopicResults[topicIds[0]!]!;
    return NextResponse.json({
      route: r.route,
      verdict: r.verdict,
      umbrellaScore: r.umbrellaScore,
      inDepthScores,
      weakestSkills: r.weakestSkills,
    });
  }

  // Multi-topic response
  return NextResponse.json({ results: perTopicResults });
}
