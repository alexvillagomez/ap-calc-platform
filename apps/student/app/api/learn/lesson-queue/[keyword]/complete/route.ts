import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const { keyword } = await params;
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

  // Upsert this keyword as completed in the queue
  await supabase
    .from("precalc_lesson_queue")
    .upsert(
      {
        session_id: sessionId,
        topic_id,
        keyword_id: keyword,
        status: "completed",
        xp_awarded: true,
      },
      { onConflict: "session_id,topic_id,keyword_id" }
    );

  // Count how many are completed for this session+topic
  const { data: completed } = await supabase
    .from("precalc_lesson_queue")
    .select("keyword_id")
    .eq("session_id", sessionId)
    .eq("topic_id", topic_id)
    .eq("status", "completed");

  // Count total in queue (all items, completed or not)
  const { data: total } = await supabase
    .from("precalc_lesson_queue")
    .select("keyword_id")
    .eq("session_id", sessionId)
    .eq("topic_id", topic_id);

  return NextResponse.json({
    xp: 10,
    totalCompleted: (completed ?? []).length,
    totalItems: (total ?? []).length,
  });
}
