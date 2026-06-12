/**
 * GET /api/math/lesson/[keywordId]
 *
 * Cache-or-generate a math micro-lesson for a keyword.
 * - Try math_lessons table first (cache hit → return immediately).
 * - On miss: fetch math_keywords row, generate via generateMathLesson.
 * - Verify check questions via verifyLessonStepFast; retry once if any fail (fail-open).
 * - Upsert into math_lessons; re-fetch to get server-assigned id/generated_at.
 *
 * Returns { id, keyword_id, keyword_label, micro_steps, generated_at }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  generateMathLesson,
  verifyLessonStepFast,
  MathGenError,
} from "@/lib/mathGenerator";
import { outlineContextForCategory } from "@/lib/mathContentOutline";
import type { ConceptBlueprint } from "@/lib/mathTypes";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ keywordId: string }> }
) {
  const { keywordId } = await params;

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

  const supabase = createClient(supabaseUrl, key);

  // 1. Try DB first (cache hit)
  const { data: existing, error: selectError } = await supabase
    .from("math_lessons")
    .select("id, keyword_id, micro_steps, generated_at")
    .eq("keyword_id", keywordId)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (existing) {
    const { data: kw } = await supabase
      .from("math_keywords")
      .select("label")
      .eq("id", keywordId)
      .maybeSingle();

    return NextResponse.json({
      id: existing.id,
      keyword_id: existing.keyword_id,
      keyword_label: (kw?.label as string) ?? null,
      micro_steps: existing.micro_steps,
      generated_at: existing.generated_at,
    });
  }

  // 2. Not in DB — fetch keyword metadata
  const { data: kwRow, error: kwError } = await supabase
    .from("math_keywords")
    .select("id, label, description, category_id, concept_blueprint")
    .eq("id", keywordId)
    .maybeSingle();

  if (kwError) {
    return NextResponse.json({ error: kwError.message }, { status: 500 });
  }
  if (!kwRow) {
    return NextResponse.json(
      { error: `Keyword not found: ${keywordId}` },
      { status: 404 }
    );
  }

  // 3. Generate
  const outlineContext = outlineContextForCategory(kwRow.category_id as string);
  const kwMeta = {
    id: kwRow.id as string,
    label: kwRow.label as string,
    description: (kwRow.description as string) ?? "",
    blueprint: (kwRow.concept_blueprint as ConceptBlueprint | null) ?? null,
  };

  let generated;
  try {
    generated = await generateMathLesson(kwMeta, outlineContext);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error(`Math lesson generation failed for ${keywordId}:`, detail);
    const status = err instanceof MathGenError ? err.status : 502;
    return NextResponse.json(
      { error: "Lesson generation failed", detail },
      { status }
    );
  }

  // 3b. Verify check questions; retry once if any fail (fail-open)
  type GeneratedLesson = typeof generated;

  const verifySteps = async (lesson: GeneratedLesson): Promise<number> => {
    const results = await Promise.all(
      lesson.micro_steps.map((s) =>
        verifyLessonStepFast(s)
      )
    );
    return results.filter((r) => r.ok && !r.step_ok).length;
  };

  const firstFailCount = await verifySteps(generated);

  if (firstFailCount > 0) {
    let retryLesson: GeneratedLesson | null = null;
    try {
      retryLesson = await generateMathLesson(kwMeta, outlineContext);
    } catch {
      // swallow — keep original
    }

    if (retryLesson) {
      const retryFailCount = await verifySteps(retryLesson);
      if (retryFailCount <= firstFailCount) {
        generated = retryLesson;
        if (retryFailCount > 0) {
          console.warn(
            `[math/lesson/${keywordId}] Verification still failing after retry: ${retryFailCount} step(s) — serving retry lesson`
          );
        }
      } else {
        console.warn(
          `[math/lesson/${keywordId}] Retry had more failures (${retryFailCount} vs ${firstFailCount}) — keeping original`
        );
      }
    } else {
      console.warn(
        `[math/lesson/${keywordId}] Verification failed for ${firstFailCount} step(s); retry also failed — serving original`
      );
    }
  }

  // 4. Upsert into math_lessons
  const { error: upsertError } = await supabase
    .from("math_lessons")
    .upsert(
      {
        keyword_id: kwRow.id as string,
        micro_steps: generated.micro_steps,
        model: "gpt-5.4-mini",
      },
      { onConflict: "keyword_id" }
    );

  if (upsertError) {
    console.error(
      `math_lessons upsert failed for ${keywordId}:`,
      upsertError.message
    );
  }

  // 5. Re-fetch to get assigned id + generated_at
  const { data: inserted } = await supabase
    .from("math_lessons")
    .select("id, keyword_id, micro_steps, generated_at")
    .eq("keyword_id", keywordId)
    .maybeSingle();

  return NextResponse.json(
    inserted
      ? {
          id: inserted.id,
          keyword_id: inserted.keyword_id,
          keyword_label: kwRow.label as string,
          micro_steps: inserted.micro_steps,
          generated_at: inserted.generated_at,
        }
      : {
          id: null,
          keyword_id: keywordId,
          keyword_label: kwRow.label as string,
          micro_steps: generated.micro_steps,
          generated_at: null,
        }
  );
}
