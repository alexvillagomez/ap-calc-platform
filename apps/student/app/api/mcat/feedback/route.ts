/**
 * POST /api/mcat/feedback
 * Submit feedback (rating and/or flag) for a question, flashcard, or lesson.
 *
 * Body: { session_id, content_type, content_id, rating?, flagged?, flag_reason?, comment? }
 * Response: { ok: true }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const VALID_CONTENT_TYPES = ["question", "flashcard", "lesson"] as const;
type ContentType = (typeof VALID_CONTENT_TYPES)[number];

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as {
    session_id?: string;
    content_type?: string;
    content_id?: string;
    rating?: number;
    flagged?: boolean;
    flag_reason?: string;
    comment?: string;
  };

  const {
    session_id,
    content_type,
    content_id,
    rating,
    flagged,
    flag_reason,
    comment,
  } = body;

  if (!session_id || !content_type || !content_id) {
    return NextResponse.json(
      { error: "session_id, content_type, and content_id are required" },
      { status: 400 }
    );
  }

  if (!VALID_CONTENT_TYPES.includes(content_type as ContentType)) {
    return NextResponse.json(
      {
        error: `content_type must be one of: ${VALID_CONTENT_TYPES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (rating === undefined && !flagged) {
    return NextResponse.json(
      { error: "At least one of rating or flagged is required" },
      { status: 400 }
    );
  }

  if (rating !== undefined && (rating < 1 || rating > 5 || !Number.isInteger(rating))) {
    return NextResponse.json(
      { error: "rating must be an integer 1–5" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // Insert feedback record
  const { error: insertError } = await supabase
    .from("mcat_content_feedback")
    .insert({
      session_id,
      content_type,
      content_id,
      rating: rating ?? null,
      flagged: flagged ?? false,
      flag_reason: flag_reason ?? null,
      comment: comment ?? null,
    });

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to save feedback", detail: insertError.message },
      { status: 500 }
    );
  }

  // ── Rating aggregate update ────────────────────────────────────────────────
  if (rating !== undefined) {
    const table = tableForType(content_type as ContentType);
    if (table) {
      const { data: current, error: fetchErr } = await supabase
        .from(table)
        .select("avg_rating, rating_count")
        .eq("id", content_id)
        .maybeSingle();

      if (!fetchErr && current) {
        const prevAvg = (current.avg_rating as number) ?? 0;
        const prevCount = (current.rating_count as number) ?? 0;
        const newCount = prevCount + 1;
        const newAvg = (prevAvg * prevCount + rating) / newCount;

        await supabase
          .from(table)
          .update({ avg_rating: newAvg, rating_count: newCount })
          .eq("id", content_id);
      }
    }
  }

  // ── Flag aggregate update ──────────────────────────────────────────────────
  if (flagged) {
    const table = tableForType(content_type as ContentType);
    if (table) {
      const { data: current, error: fetchErr } = await supabase
        .from(table)
        .select("flag_count")
        .eq("id", content_id)
        .maybeSingle();

      if (!fetchErr && current) {
        const prevFlagCount = (current.flag_count as number) ?? 0;
        const newFlagCount = prevFlagCount + 1;

        if (content_type === "lesson") {
          // For lessons: increment then delete when flag_count >= 2 (forces regen)
          await supabase
            .from("mcat_lessons")
            .update({ flag_count: newFlagCount })
            .eq("id", content_id);

          if (newFlagCount >= 2) {
            await supabase
              .from("mcat_lessons")
              .delete()
              .eq("id", content_id);
          }
        } else {
          // For questions/flashcards: increment flag_count; set status='flagged' when >= 2
          const updatePayload: Record<string, unknown> = {
            flag_count: newFlagCount,
          };
          if (newFlagCount >= 2) {
            updatePayload.status = "flagged";
          }
          await supabase
            .from(table)
            .update(updatePayload)
            .eq("id", content_id);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

function tableForType(contentType: ContentType): string | null {
  switch (contentType) {
    case "question":
      return "mcat_questions";
    case "flashcard":
      return "mcat_flashcards";
    case "lesson":
      return "mcat_lessons";
    default:
      return null;
  }
}
