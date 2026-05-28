import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const PASS_THRESHOLD = 1.0;
const SPACED_REVIEW_DAYS = 7;

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
    topic_id: string;
    answers: { problem_id: string; correct: boolean }[];
  };

  const { sessionId, keyword_id, topic_id, answers } = body;

  if (!sessionId || !keyword_id || !Array.isArray(answers)) {
    return NextResponse.json({ error: "sessionId, keyword_id, answers required" }, { status: 400 });
  }

  const correct = answers.filter((a) => a.correct).length;
  const score = answers.length > 0 ? correct / answers.length : 0;
  const passed = score >= PASS_THRESHOLD;

  // Record quiz result
  await supabase.from("learn_mastery_quiz_results").insert({
    session_id: sessionId,
    keyword_id,
    score,
    passed,
  });

  // Update keyword state
  const dueAt = passed
    ? new Date(Date.now() + SPACED_REVIEW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : null;

  await supabase
    .from("learn_student_keyword_states")
    .upsert(
      {
        session_id: sessionId,
        keyword_id,
        topic_id,
        state: passed ? "mastered" : "needs_practice",
        ...(passed && dueAt ? { spaced_review_due_at: dueAt } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id,keyword_id" }
    );

  return NextResponse.json({
    passed,
    score,
    correct_count: correct,
    total: answers.length,
    next_review_due: dueAt,
  });
}
