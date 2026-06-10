import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ContentType =
  | "problem"
  | "rag_example"
  | "learn_practice_problem"
  | "learn_diagnostic_problem"
  | "learn_mastery_quiz_problem"
  | "lesson"
  | "refresher";

const TABLE_BY_TYPE: Record<ContentType, string> = {
  problem: "problems",
  rag_example: "rag_examples",
  learn_practice_problem: "learn_practice_problems",
  learn_diagnostic_problem: "learn_diagnostic_problems",
  learn_mastery_quiz_problem: "learn_mastery_quiz_problems",
  lesson: "learn_lessons",
  refresher: "learn_refreshers",
};

function normalizeContent(contentType: ContentType, contentId: string): { contentType: ContentType; contentId: string } {
  if (contentId.startsWith("rag_")) {
    return { contentType: "rag_example", contentId: contentId.slice(4) };
  }
  return { contentType, contentId };
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await request.json()) as {
    sessionId?: string;
    contentType?: ContentType;
    contentId?: string;
    rating?: number;
    report?: boolean;
    reason?: string;
  };

  if (!body.sessionId || !body.contentType || !body.contentId) {
    return NextResponse.json({ error: "sessionId, contentType, and contentId required" }, { status: 400 });
  }

  const normalized = normalizeContent(body.contentType, body.contentId);
  const table = TABLE_BY_TYPE[normalized.contentType];
  if (!table) {
    return NextResponse.json({ error: "Unsupported contentType" }, { status: 400 });
  }

  const rating = body.rating;
  if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return NextResponse.json({ error: "rating must be an integer from 1 to 5" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  if (rating !== undefined) {
    const { error } = await supabase
      .from("content_ratings")
      .upsert(
        {
          session_id: body.sessionId,
          content_type: normalized.contentType,
          content_id: normalized.contentId,
          rating,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "session_id,content_type,content_id" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: ratings, error: ratingsError } = await supabase
      .from("content_ratings")
      .select("rating")
      .eq("content_type", normalized.contentType)
      .eq("content_id", normalized.contentId);

    if (ratingsError) return NextResponse.json({ error: ratingsError.message }, { status: 500 });

    const values = (ratings ?? []).map((row: { rating: number }) => row.rating);
    const ratingCount = values.length;
    const avgRating = ratingCount > 0
      ? Number((values.reduce((sum, value) => sum + value, 0) / ratingCount).toFixed(3))
      : null;

    const { error: aggregateError } = await supabase
      .from(table)
      .update({ avg_rating: avgRating, rating_count: ratingCount })
      .eq("id", normalized.contentId);

    if (aggregateError) return NextResponse.json({ error: aggregateError.message }, { status: 500 });
  }

  let reportCount: number | undefined;

  if (body.report) {
    const { error } = await supabase
      .from("content_reports")
      .upsert(
        {
          session_id: body.sessionId,
          content_type: normalized.contentType,
          content_id: normalized.contentId,
          reason: body.reason ?? null,
        },
        { onConflict: "session_id,content_type,content_id" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { count, error: countError } = await supabase
      .from("content_reports")
      .select("id", { count: "exact", head: true })
      .eq("content_type", normalized.contentType)
      .eq("content_id", normalized.contentId);

    if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

    reportCount = count ?? 0;
    const { error: aggregateError } = await supabase
      .from(table)
      .update({ report_count: reportCount })
      .eq("id", normalized.contentId);

    if (aggregateError) return NextResponse.json({ error: aggregateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    contentType: normalized.contentType,
    contentId: normalized.contentId,
    reportCount,
  });
}
