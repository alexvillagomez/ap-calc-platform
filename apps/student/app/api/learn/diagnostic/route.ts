import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { topicToCategory } from "@/lib/topicCategoryMap";

type RagQuestion = {
  id: string;
  latex_content: string;
  choices: string[];
  correct_index: number;
  difficulty: number;
  umbrella_keywords: Record<string, number>;
  in_depth_keywords: Record<string, number>;
  topic_id?: string;
};

function keywordUncertainty(score: number): number {
  return 1 - Math.abs(score - 0.5) * 2;
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = await request.json() as {
    topic_id?: string;
    topic_ids?: string[];
    answeredIds?: string[];
    keywordScores?: Record<string, number>;
  };

  const { answeredIds = [], keywordScores = {} } = body;

  // Resolve topic list — support both single topic_id and multi topic_ids
  const topicIds: string[] = body.topic_ids?.length
    ? body.topic_ids
    : body.topic_id
    ? [body.topic_id]
    : [];

  if (topicIds.length === 0) {
    return NextResponse.json({ error: "topic_id or topic_ids required" }, { status: 400 });
  }

  // Map topic IDs → category IDs (learn_keywords uses category_id, not topic_id)
  const categoryIds = topicIds.map(topicToCategory);

  const supabase = createClient(supabaseUrl, key);

  // Fetch all in-depth keywords across all requested categories
  const { data: keywords } = await supabase
    .from("learn_keywords")
    .select("id, category_id")
    .in("category_id", categoryIds)
    .eq("tier", "in_depth")
    .eq("status", "approved");

  const allKeywordIds = (keywords ?? []).map((k: { id: string }) => k.id);
  if (allKeywordIds.length === 0) {
    return NextResponse.json({ problem: null, done: true, error: "No keywords found for topic(s)" });
  }

  // Build a map from keyword_id → topic_id (for umbrella scoring, keep original topic param)
  const categoryToTopic = new Map<string, string>(
    topicIds.map((t, i) => [categoryIds[i]!, t])
  );
  const keywordToTopic = new Map<string, string>(
    (keywords ?? []).map((k: { id: string; category_id: string }) => [
      k.id,
      categoryToTopic.get(k.category_id) ?? topicIds[0]!,
    ])
  );

  const topicKeywordSet = new Set(allKeywordIds);

  // Fetch candidate problems from problems + rag_examples in parallel
  type CandidateRow = { id: string; latex_content: string; choices: string[]; correct_index: number; difficulty: number; keyword_weights: Record<string, number> };

  const [problemsRes, ragRes] = await Promise.all([
    supabase
      .from("problems")
      .select("id, latex_content, choices, correct_index, difficulty, keyword_weights")
      .eq("status", "approved")
      .not("choices", "is", null)
      .not("keyword_weights", "is", null),
    supabase
      .from("rag_examples")
      .select("id, latex_content, choices, correct_index, difficulty, keyword_weights")
      .not("choices", "is", null)
      .not("keyword_weights", "is", null),
  ]);

  const candidates: CandidateRow[] = [
    ...((problemsRes.data ?? []) as CandidateRow[]),
    ...((ragRes.data ?? []) as CandidateRow[]),
  ];

  // Filter out already-answered, keep only those with keyword overlap
  const filtered = candidates.filter((row) => {
    if (answeredIds.includes(row.id)) return false;
    const kws = row.keyword_weights ?? {};
    return Object.keys(kws).some(k => topicKeywordSet.has(k));
  });

  if (filtered.length === 0) {
    return NextResponse.json({ problem: null, done: true });
  }

  // Score each candidate by sum(uncertainty * weight) — maximizes information gain
  const scored = filtered.map((row) => {
    const kws = row.keyword_weights ?? {};
    let score = 0;
    for (const [kw, weight] of Object.entries(kws)) {
      if (topicKeywordSet.has(kw)) {
        const kwScore = keywordScores[kw] ?? 0.5;
        score += keywordUncertainty(kwScore) * (weight as number);
      }
    }
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!.row;

  // Determine which topic this question primarily belongs to
  const bestKws = Object.keys(best.keyword_weights ?? {});
  const primaryTopic = bestKws
    .map(k => keywordToTopic.get(k))
    .find(t => t !== undefined) ?? topicIds[0]!;

  const umbrellaTopicId = body.topic_ids?.length ? primaryTopic : (body.topic_id ?? primaryTopic);

  const problem: RagQuestion = {
    id: best.id,
    latex_content: best.latex_content,
    choices: best.choices as string[],
    correct_index: best.correct_index,
    difficulty: best.difficulty,
    umbrella_keywords: { [umbrellaTopicId]: 1.0 },
    in_depth_keywords: best.keyword_weights ?? {},
    topic_id: primaryTopic,
  };

  return NextResponse.json({ problem, done: false });
}
