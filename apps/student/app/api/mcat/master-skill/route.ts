/**
 * POST /api/mcat/master-skill
 * Body: { session_id, keyword_id, category_id }
 *
 * AUTHORITATIVE mastery write (MCAT mirror of /api/math/master-skill). The auto
 * client advances a subtopic at the consecutive-correct MASTERY_STREAK (mcat=4),
 * but the EMA state machine only flips `state='mastered'` at score≥0.8 AND
 * consecutive≥4 — unreachable from a 0.5 start in 4 correct — so the server
 * frontier never advances and reopening auto mode resets to the start. This makes
 * the server agree with the client: persist state='mastered' + intro_seen +
 * spaced-review, merged onto the existing row.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeNextReviewDate } from "@/lib/practiceAlgorithm";

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
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { session_id, keyword_id, category_id } = body;
  if (!session_id || !keyword_id || !category_id) {
    return NextResponse.json(
      { error: "session_id, keyword_id and category_id are required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  const { data: existing } = await supabase
    .from("mcat_student_keyword_states")
    .select("score, spaced_review_count")
    .eq("session_id", session_id)
    .eq("keyword_id", keyword_id)
    .maybeSingle();

  const prevScore = (existing?.score as number | null) ?? 0.8;
  const score = Math.max(prevScore, 0.8);
  const spacedReviewCount = ((existing?.spaced_review_count as number | null) ?? 0) + 1;
  const spacedReviewDueAt = computeNextReviewDate(score, spacedReviewCount).toISOString();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("mcat_student_keyword_states")
    .upsert(
      {
        session_id,
        keyword_id,
        category_id,
        state: "mastered",
        intro_seen: true,
        score,
        spaced_review_due_at: spacedReviewDueAt,
        spaced_review_count: spacedReviewCount,
        last_practiced_at: now,
        updated_at: now,
      },
      { onConflict: "session_id,keyword_id" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
