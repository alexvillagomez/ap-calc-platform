/**
 * POST /api/math/similar
 *
 * Generate a similar variant of an existing math question.
 * - Loads the source question from math_questions.
 * - Generates with generateSimilarMathQuestion at the same difficulty.
 * - Verify with verifyMathQuestionFast; retry once on failure (fail-open).
 * - Embed + retag; store as new math_questions row with parent_question_id set.
 *
 * Body: { session_id, question_id }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  generateSimilarMathQuestion,
  verifyMathQuestionFast,
  MathGenError,
} from "@/lib/mathGenerator";
import { loadTargetKeywords, embedText, tagByEmbedding } from "@/lib/mathTagging";
import { outlineContextForCategory } from "@/lib/mathContentOutline";
import type { ConceptBlueprint } from "@/lib/mathTypes";

export const runtime = "nodejs";

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
    question_id?: string;
  };

  const { session_id, question_id } = body;
  if (!session_id || !question_id) {
    return NextResponse.json(
      { error: "session_id and question_id are required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // Load source question
  const { data: sourceQ, error: qError } = await supabase
    .from("math_questions")
    .select(
      "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, category_id, difficulty"
    )
    .eq("id", question_id)
    .maybeSingle();

  if (qError || !sourceQ) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const kwWeights = (sourceQ.keyword_weights as Record<string, number>) ?? {};
  const kwIds = Object.keys(kwWeights);

  // Load keyword metadata for weights
  const { data: kwMeta } = kwIds.length > 0
    ? await supabase
        .from("math_keywords")
        .select("id, label, description, concept_blueprint")
        .in("id", kwIds)
    : { data: [] };

  const keywords = (kwMeta ?? []).map((k) => ({
    id: k.id as string,
    label: k.label as string,
    description: (k.description as string) ?? "",
    blueprint: (k.concept_blueprint as ConceptBlueprint | null) ?? null,
  }));

  // Fallback: category keywords
  let finalKeywords = keywords;
  if (finalKeywords.length === 0) {
    const { data: catKws } = await supabase
      .from("math_keywords")
      .select("id, label, description, concept_blueprint")
      .eq("category_id", sourceQ.category_id as string)
      .eq("status", "approved")
      .limit(5);
    finalKeywords = (catKws ?? []).map((k) => ({
      id: k.id as string,
      label: k.label as string,
      description: (k.description as string) ?? "",
      blueprint: (k.concept_blueprint as ConceptBlueprint | null) ?? null,
    }));
  }

  if (finalKeywords.length === 0) {
    return NextResponse.json(
      { error: "No keyword metadata found for this question" },
      { status: 404 }
    );
  }

  const sourceDifficulty = (sourceQ.difficulty as number) ?? undefined;
  const outlineContext = outlineContextForCategory(sourceQ.category_id as string);

  const genArgs = {
    question: {
      stem_latex: sourceQ.stem_latex as string,
      choices: sourceQ.choices as string[],
      correct_index: sourceQ.correct_index as number,
      solution_latex: sourceQ.solution_latex as string,
      keyword_weights: kwWeights,
      difficulty: sourceDifficulty,
    },
    keywords: finalKeywords,
    targetDifficulty: sourceDifficulty,
    outlineContext,
  };

  let generated;
  try {
    generated = await generateSimilarMathQuestion(genArgs);
  } catch (err) {
    if (err instanceof MathGenError) {
      return NextResponse.json(
        { error: "Similar question generation failed", detail: err.message },
        { status: err.status }
      );
    }
    throw err;
  }

  // Verify; retry once on hard failure (fail-open)
  const firstVerify = await verifyMathQuestionFast({
    stem_latex: generated.stem_latex,
    choices: generated.choices,
    correct_index: generated.correct_index,
  });

  if (firstVerify.agrees === false && firstVerify.ok === true) {
    try {
      const retry = await generateSimilarMathQuestion(genArgs);
      const retryVerify = await verifyMathQuestionFast({
        stem_latex: retry.stem_latex,
        choices: retry.choices,
        correct_index: retry.correct_index,
      });
      if (retryVerify.agrees || !(firstVerify.agrees === false && firstVerify.ok)) {
        generated = retry;
      }
    } catch {
      // keep original
    }
  }

  // Embed + retag (non-fatal)
  let embedding: number[] | null = null;
  let finalWeights = generated.keyword_weights;

  try {
    const poolKeywords = await loadTargetKeywords(supabase, [sourceQ.category_id as string]);
    const keywordsWithEmbed = poolKeywords.filter((k) => k.embedding !== null);
    embedding = await embedText(
      `${generated.stem_latex} | ${generated.choices[generated.correct_index]}`
    );
    const retagged = tagByEmbedding(embedding, keywordsWithEmbed);
    if (Object.keys(retagged).length > 0) {
      finalWeights = retagged;
    }
  } catch {
    // non-fatal
  }

  // Insert
  const { data: inserted, error: insertError } = await supabase
    .from("math_questions")
    .insert({
      category_id: sourceQ.category_id as string,
      stem_latex: generated.stem_latex,
      choices: generated.choices,
      correct_index: generated.correct_index,
      solution_latex: generated.solution_latex,
      hint_latex: generated.hint_latex,
      keyword_weights: finalWeights,
      difficulty: generated.difficulty,
      parent_question_id: sourceQ.id as string,
      source: "generated",
      status: "active",
      embedding: embedding as unknown,
    })
    .select(
      "id, stem_latex, choices, correct_index, solution_latex, hint_latex, keyword_weights, difficulty, parent_question_id"
    )
    .single();

  if (insertError || !inserted) {
    return NextResponse.json(
      { error: "Failed to save generated question", detail: insertError?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    question: {
      id: inserted.id,
      stem_latex: inserted.stem_latex,
      choices: inserted.choices,
      correct_index: inserted.correct_index,
      solution_latex: inserted.solution_latex,
      hint_latex: inserted.hint_latex ?? null,
      keyword_weights: inserted.keyword_weights,
      difficulty: inserted.difficulty,
      parent_question_id: inserted.parent_question_id ?? null,
    },
  });
}
