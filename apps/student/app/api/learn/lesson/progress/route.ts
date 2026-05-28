import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, key);

  const body = (await request.json()) as {
    sessionId: string;
    keyword_id: string;
    current_step: number;
    completed?: boolean;
  };

  const { sessionId, keyword_id, current_step, completed = false } = body;

  if (!sessionId || !keyword_id || current_step == null) {
    return NextResponse.json({ error: "sessionId, keyword_id, current_step required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("learn_student_lesson_progress")
    .upsert(
      {
        session_id: sessionId,
        keyword_id,
        current_step,
        completed,
        ...(completed ? { completed_at: new Date().toISOString() } : {}),
      },
      { onConflict: "session_id,keyword_id" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If completed, update keyword state to needs_practice
  if (completed) {
    await supabase
      .from("learn_student_keyword_states")
      .update({ state: "needs_practice", updated_at: new Date().toISOString() })
      .eq("session_id", sessionId)
      .eq("keyword_id", keyword_id);
  }

  return NextResponse.json({ ok: true });
}
