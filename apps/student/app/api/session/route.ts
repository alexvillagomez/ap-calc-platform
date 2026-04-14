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
    .select("id, strengths")
    .eq("id", sessionId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ id: existing.id, strengths: existing.strengths ?? {}, isNew: false });
  }

  // Create new session with empty strengths (0.5 is the in-memory default)
  const { data: created, error } = await supabase
    .from("student_sessions")
    .insert({ id: sessionId, strengths: {} })
    .select("id, strengths")
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "Failed to create session" }, { status: 500 });
  }

  return NextResponse.json({ id: created.id, strengths: created.strengths ?? {}, isNew: true });
}
