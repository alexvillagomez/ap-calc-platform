import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const CONTENT_TABLE: Record<string, string> = {
  lesson: "learn_lessons",
  refresher: "learn_refreshers",
  tip: "learn_tips",
};

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);

  const body = (await request.json()) as {
    sessionId: string;
    content_type: "lesson" | "refresher" | "tip";
    keyword_id: string;
    helpful: boolean;
  };

  const { sessionId, content_type, keyword_id, helpful } = body;

  if (!sessionId || !content_type || !keyword_id || typeof helpful !== "boolean") {
    return NextResponse.json({ error: "sessionId, content_type, keyword_id, helpful required" }, { status: 400 });
  }

  if (!CONTENT_TABLE[content_type]) {
    return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
  }

  // Record feedback (upsert — one vote per session per keyword per type)
  const { data: prev } = await supabase
    .from("learn_feedback")
    .select("helpful")
    .eq("session_id", sessionId)
    .eq("content_type", content_type)
    .eq("keyword_id", keyword_id)
    .maybeSingle();

  const { error: fbErr } = await supabase
    .from("learn_feedback")
    .upsert(
      { session_id: sessionId, content_type, keyword_id, helpful },
      { onConflict: "session_id,content_type,keyword_id" }
    );

  if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 });

  // Update aggregate counts on the content table
  const table = CONTENT_TABLE[content_type];

  // If they changed their vote, reverse the old one
  if (prev !== null && prev.helpful !== helpful) {
    const reverseField = prev.helpful ? "helpful_count" : "not_helpful_count";
    await supabase.rpc("decrement_learn_feedback", { table_name: table, keyword: keyword_id, field: reverseField });
  }

  // Only increment if this is a new vote (not just same vote re-submitted)
  if (prev === null || prev.helpful !== helpful) {
    const field = helpful ? "helpful_count" : "not_helpful_count";
    // Increment via direct update using select + update
    const { data: row } = await supabase
      .from(table as "learn_lessons")
      .select("helpful_count, not_helpful_count")
      .eq("keyword_id", keyword_id)
      .maybeSingle();

    if (row) {
      await supabase
        .from(table as "learn_lessons")
        .update({
          helpful_count:     field === "helpful_count"     ? row.helpful_count + 1     : row.helpful_count,
          not_helpful_count: field === "not_helpful_count" ? row.not_helpful_count + 1 : row.not_helpful_count,
        })
        .eq("keyword_id", keyword_id);
    }
  }

  // Return current totals
  const { data: totals } = await supabase
    .from(CONTENT_TABLE[content_type] as "learn_lessons")
    .select("helpful_count, not_helpful_count")
    .eq("keyword_id", keyword_id)
    .maybeSingle();

  return NextResponse.json({
    recorded: true,
    helpful_count: totals?.helpful_count ?? 0,
    not_helpful_count: totals?.not_helpful_count ?? 0,
  });
}
