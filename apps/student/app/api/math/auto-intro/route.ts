/**
 * POST /api/math/auto-intro
 * Body: { session_id, keyword_id, category_id, course }
 *
 * Marks the LESSON→FLASHCARDS intro for a subtopic as completed, per-USER
 * (session), in Supabase — replacing the old per-browser localStorage flag
 * `lodera_auto_intro_<course>`. Upserts into math_student_keyword_states so it
 * only touches `intro_seen` and never clobbers existing score/attempt progress.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let body: {
    session_id?: string;
    keyword_id?: string;
    category_id?: string;
    course?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { session_id, keyword_id, category_id, course } = body;
  if (!session_id || !keyword_id || !category_id) {
    return NextResponse.json(
      { error: "session_id, keyword_id and category_id are required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  const row: Record<string, unknown> = {
    session_id,
    keyword_id,
    category_id,
    intro_seen: true,
  };
  if (course) row.course = course;

  const { error } = await supabase
    .from("math_student_keyword_states")
    .upsert(row, { onConflict: "session_id,keyword_id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
