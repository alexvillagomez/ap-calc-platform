import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * GET /api/demo/seen-problems?sessionId=XXX
 *
 * Returns the list of problem IDs (rag_examples ids) that this session has
 * already answered, so the client can exclude them from the candidate pool
 * when the problem bank is loaded (or reloaded after a page refresh).
 */
export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ seenIds: [] });
  }

  const supabase = createClient(supabaseUrl, key);

  const { data, error } = await supabase
    .from("student_problem_attempts")
    .select("problem_id")
    .eq("session_id", sessionId);

  if (error) {
    console.error("demo/seen-problems: query failed", error.message);
    // Non-fatal — return empty so the client degrades gracefully (may show repeats)
    return NextResponse.json({ seenIds: [] });
  }

  const seenIds = (data ?? []).map((r) => r.problem_id as string).filter(Boolean);
  return NextResponse.json({ seenIds });
}
