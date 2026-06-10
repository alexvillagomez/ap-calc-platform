import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { sessionId } = (await request.json()) as { sessionId?: string };
  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Try to fetch existing session first
  const { data: existing } = await supabase
    .from("student_sessions")
    .select("id, topic_strengths, action_strengths, representation_strengths")
    .eq("id", sessionId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      id: existing.id,
      topic_strengths: existing.topic_strengths ?? {},
      action_strengths: existing.action_strengths ?? {},
      representation_strengths: existing.representation_strengths ?? {},
      isNew: false,
    });
  }

  // Create new session — strengths start empty (0.5 is the in-memory default everywhere)
  const { data: created, error } = await supabase
    .from("student_sessions")
    .insert({ id: sessionId, topic_strengths: {}, action_strengths: {}, representation_strengths: {} })
    .select("id, topic_strengths, action_strengths, representation_strengths")
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "Failed to create session" }, { status: 500 });
  }

  return NextResponse.json({
    id: created.id,
    topic_strengths: created.topic_strengths ?? {},
    action_strengths: created.action_strengths ?? {},
    representation_strengths: created.representation_strengths ?? {},
    isNew: true,
  });
}
