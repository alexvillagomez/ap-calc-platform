import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { topicToCategory } from "@/lib/topicCategoryMap";

export type LessonQueueItem = {
  keyword_id: string;
  keyword_label: string;
  in_depth_score: number;
  state: string;
  status: "pending" | "in_progress" | "completed";
};

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = await request.json() as { sessionId: string; topic_id: string };
  const { sessionId, topic_id } = body;

  if (!sessionId || !topic_id) {
    return NextResponse.json({ error: "sessionId and topic_id required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  const category_id = topicToCategory(topic_id);

  // Fetch all in_depth keywords for this topic's category
  const { data: keywords } = await supabase
    .from("learn_keywords")
    .select("id, label")
    .eq("category_id", category_id)
    .eq("tier", "in_depth")
    .eq("status", "approved")
    .order("id");

  if (!keywords?.length) {
    return NextResponse.json({ queue: [] });
  }

  const keywordIds = keywords.map((k: { id: string }) => k.id);

  // Fetch keyword states for this session
  const { data: states } = await supabase
    .from("learn_student_keyword_states")
    .select("keyword_id, state, in_depth_score")
    .eq("session_id", sessionId)
    .in("keyword_id", keywordIds);

  const stateMap = new Map<string, { state: string; in_depth_score: number }>(
    (states ?? []).map((s: { keyword_id: string; state: string; in_depth_score: number }) => [
      s.keyword_id,
      { state: s.state, in_depth_score: s.in_depth_score ?? 0.5 }
    ])
  );

  // Fetch any existing lesson queue entries for this session+topic
  const { data: queueRows } = await supabase
    .from("precalc_lesson_queue")
    .select("keyword_id, status")
    .eq("session_id", sessionId)
    .eq("topic_id", topic_id);

  const queueMap = new Map<string, "pending" | "in_progress" | "completed">(
    (queueRows ?? []).map((r: { keyword_id: string; status: "pending" | "in_progress" | "completed" }) => [r.keyword_id, r.status])
  );

  // Build queue: include keywords that are weak or need a lesson
  const queue: LessonQueueItem[] = [];
  for (const kw of keywords) {
    const kwState = stateMap.get(kw.id);
    const inDepthScore = kwState?.in_depth_score ?? 0.5;
    const state = kwState?.state ?? "unknown";

    // Include if: unknown, needs_lesson, needs_refresher, or score < 0.65
    const needsLesson = !kwState ||
      state === "unknown" ||
      state === "needs_lesson" ||
      state === "needs_refresher" ||
      inDepthScore < 0.65;

    if (needsLesson) {
      queue.push({
        keyword_id: kw.id,
        keyword_label: kw.label ?? kw.id.replace(/_/g, " "),
        in_depth_score: inDepthScore,
        state,
        status: queueMap.get(kw.id) ?? "pending",
      });
    }
  }

  // Sort: completed last, then by score ascending (weakest first)
  queue.sort((a, b) => {
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (a.status !== "completed" && b.status === "completed") return -1;
    return a.in_depth_score - b.in_depth_score;
  });

  return NextResponse.json({ queue });
}
