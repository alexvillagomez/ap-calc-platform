import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { topicToCategory } from "@/lib/topicCategoryMap";

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const topicId = searchParams.get("topic");
  const sessionId = searchParams.get("sessionId");

  if (!topicId || !sessionId) {
    return NextResponse.json({ error: "topic and sessionId required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);
  const categoryId = topicToCategory(topicId);

  // Get all in-depth keywords for this category
  const { data: keywords } = await supabase
    .from("learn_keywords")
    .select("id, label")
    .eq("category_id", categoryId)
    .eq("tier", "in_depth")
    .eq("status", "approved");

  if (!keywords?.length) {
    return NextResponse.json({ states: [], hasData: false });
  }

  const keywordIds = keywords.map((k: { id: string }) => k.id);

  // Get existing keyword states for this session
  const { data: states } = await supabase
    .from("learn_student_keyword_states")
    .select("keyword_id, state, in_depth_score, umbrella_score, confidence, clicked_never_seen, clicked_forgot")
    .eq("session_id", sessionId)
    .in("keyword_id", keywordIds);

  const hasData = (states ?? []).some(
    (s: { confidence: number }) => (s.confidence ?? 0) > 0
  );

  // Build a label map for enriched response
  const labelMap = new Map(keywords.map((k: { id: string; label: string }) => [k.id, k.label]));

  const enriched = (states ?? []).map((s: { keyword_id: string; state: string; in_depth_score: number; umbrella_score: number; confidence: number; clicked_never_seen: boolean; clicked_forgot: boolean }) => ({
    ...s,
    keyword_label: labelMap.get(s.keyword_id) ?? s.keyword_id.replace(/_/g, " "),
  }));

  return NextResponse.json({ states: enriched, hasData, totalKeywords: keywordIds.length });
}
