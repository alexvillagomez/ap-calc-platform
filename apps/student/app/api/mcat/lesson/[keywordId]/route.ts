/**
 * GET /api/mcat/lesson/[keywordId]
 * Cache-or-generate MCAT Biology micro-lesson for a keyword.
 * Returns { id, keyword_id, keyword_label, micro_steps, generated_at }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateMcatLesson, McatGenError, verifyQuestionsFast } from "@/lib/mcatGenerator";
import { outlineContextForCategory } from "@/lib/mcatContentOutline";
import { resolveScopeContract } from "@/lib/scopeContract";
import { loadLessonNeighbors } from "@/lib/lessonNeighbors";
import { ConceptBlueprint } from "@/lib/mcatBlueprint";

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

  // 1. Try DB first
  const { data: existing, error: selectError } = await supabase
    .from("mcat_lessons")
    .select("id, keyword_id, micro_steps, generated_at")
    .eq("keyword_id", keywordId)
    .maybeSingle();

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  if (existing) {
    // Fetch keyword label for the response
    const { data: kw } = await supabase
      .from("mcat_keywords")
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
    .from("mcat_keywords")
    .select("id, label, description, examples, category_id, concept_blueprint, tier, parent_keyword_id, order_index")
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

  const examplesText = Array.isArray(kwRow.examples)
    ? (kwRow.examples as string[]).filter(Boolean).join("; ")
    : ((kwRow.examples as string | null) ?? undefined);

  // 3. Generate
  const outlineContext = outlineContextForCategory(kwRow.category_id as string);
  // Scope contract: stored blueprint, or — for umbrellas / intro keywords with
  // none — derive one from the taxonomy so the lesson (esp. EXAMPLE + FIGURE)
  // stays inside this topic and never drifts into another keyword's content.
  const storedBlueprint = (kwRow.concept_blueprint as ConceptBlueprint | null) ?? null;
  const contract = await resolveScopeContract(supabase, "mcat_keywords", {
    id: kwRow.id as string,
    label: kwRow.label as string,
    description: (kwRow.description as string) ?? "",
    tier: (kwRow.tier as string | null) ?? null,
    parent_keyword_id: (kwRow.parent_keyword_id as string | null) ?? null,
    category_id: kwRow.category_id as string,
    concept_blueprint: storedBlueprint,
  });
  // Light-B scope context: adjacent siblings so the lesson can reference (not teach)
  // neighbors and avoid drifting forward into later topics.
  const neighbors = await loadLessonNeighbors(supabase, "mcat_keywords", {
    id: kwRow.id as string,
    category_id: kwRow.category_id as string,
    parent_keyword_id: (kwRow.parent_keyword_id as string | null) ?? null,
  });

  let generated;
  try {
    generated = await generateMcatLesson(
      {
        id: kwRow.id as string,
        label: kwRow.label as string,
        description: (kwRow.description as string) ?? "",
        examples: examplesText,
        blueprint: (contract as ConceptBlueprint | null) ?? storedBlueprint,
      },
      outlineContext,
      { neighbors, isIntro: (kwRow.order_index as number | null) === -1 }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error(`MCAT lesson generation failed for ${keywordId}:`, detail);
    const status = err instanceof McatGenError ? err.status : 502;
    return NextResponse.json(
      { error: "Lesson generation failed", detail },
      { status }
    );
  }

  // 3b. Verify check questions; retry once if any fail (fail-open)
  const kwMeta = {
    id: kwRow.id as string,
    label: kwRow.label as string,
    description: (kwRow.description as string) ?? "",
    examples: examplesText,
    blueprint: (kwRow.concept_blueprint as ConceptBlueprint | null) ?? null,
  };

  const verifySteps = async (lesson: { micro_steps: { check_question: { latex_content: string; choices: string[]; correct_index: number } }[] }) =>
    verifyQuestionsFast(
      lesson.micro_steps.map((s) => ({
        stem: s.check_question.latex_content,
        choices: s.check_question.choices,
        correct_index: s.check_question.correct_index,
      }))
    );

  const firstResults = await verifySteps(generated);
  const firstFailCount = firstResults.filter((r) => r.ok && !r.agrees).length;

  if (firstFailCount > 0) {
    // Regenerate once and compare failure counts
    let retryLesson: typeof generated | null = null;
    try {
      retryLesson = await generateMcatLesson(kwMeta, outlineContext, { neighbors, isIntro: (kwRow.order_index as number | null) === -1 });
    } catch {
      // swallow — keep original
    }

    if (retryLesson) {
      const retryResults = await verifySteps(retryLesson);
      const retryFailCount = retryResults.filter((r) => r.ok && !r.agrees).length;

      if (retryFailCount <= firstFailCount) {
        generated = retryLesson;
        if (retryFailCount > 0) {
          console.warn(
            `[lesson/${keywordId}] Verification still failing after retry: ${retryFailCount} step(s) — serving retry lesson`
          );
        }
      } else {
        console.warn(
          `[lesson/${keywordId}] Retry had more failures (${retryFailCount} vs ${firstFailCount}) — keeping original`
        );
      }
    } else {
      console.warn(
        `[lesson/${keywordId}] Verification failed for ${firstFailCount} step(s); retry generation also failed — serving original`
      );
    }
  }

  // 4. Upsert into mcat_lessons
  const { error: upsertError } = await supabase
    .from("mcat_lessons")
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
      `mcat_lessons upsert failed for ${keywordId}:`,
      upsertError.message
    );
  }

  // 5. Re-fetch to get the assigned id + generated_at
  const { data: inserted } = await supabase
    .from("mcat_lessons")
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
