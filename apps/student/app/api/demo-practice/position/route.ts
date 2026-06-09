import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

interface PositionBody {
  sessionId?: string;
  keywordId?: string | null;
  phase?: string | null;
  lessonStepIdx?: number | null;
  problemId?: string | null;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await req.json()) as PositionBody;
  const { sessionId, keywordId, phase, lessonStepIdx, problemId } = body;

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  try {
    const { error } = await supabase
      .from("student_sessions")
      .update({
        practice_keyword_id: keywordId ?? null,
        practice_phase: phase ?? null,
        practice_lesson_step: lessonStepIdx ?? null,
        practice_problem_id: problemId ?? null,
        practice_updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (error) {
      return NextResponse.json({ ok: false });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  try {
    const { data, error } = await supabase
      .from("student_sessions")
      .select("practice_keyword_id, practice_phase, practice_lesson_step, practice_problem_id, practice_updated_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ keywordId: null });
    }

    return NextResponse.json({
      keywordId: data.practice_keyword_id ?? null,
      phase: data.practice_phase ?? null,
      lessonStepIdx: data.practice_lesson_step ?? null,
      problemId: data.practice_problem_id ?? null,
      updatedAt: data.practice_updated_at ?? null,
    });
  } catch {
    return NextResponse.json({ keywordId: null });
  }
}
