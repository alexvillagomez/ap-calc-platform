import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateSimilarQuestion, McatGenError } from "@/lib/mcatGenerator";
import { loadTargetKeywords, embedText, tagByEmbedding } from "@/lib/mcatTagging";
import { outlineContextForCategory } from "@/lib/mcatContentOutline";
import { ConceptBlueprint } from "@/lib/mcatBlueprint";

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

  // Load the source question (including difficulty)
  const { data: sourceQ, error: qError } = await supabase
    .from("mcat_questions")
    .select(
      "id, stem, choices, correct_index, explanation, keyword_weights, category_id, difficulty"
    )
    .eq("id", question_id)
    .maybeSingle();

  if (qError || !sourceQ) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const kwWeights =
    (sourceQ.keyword_weights as Record<string, number>) ?? {};
  const kwIds = Object.keys(kwWeights);

  // Load keyword metadata for the weights
  const { data: kwMeta } = kwIds.length > 0
    ? await supabase
        .from("mcat_keywords")
        .select("id, label, description, concept_blueprint")
        .in("id", kwIds)
    : { data: [] };

  const keywords = (kwMeta ?? []).map((k) => ({
    id: k.id as string,
    label: k.label as string,
    description: (k.description as string) ?? "",
    blueprint: (k.concept_blueprint as ConceptBlueprint | null) ?? null,
  }));

  // Fall back to all category keywords if no valid ones found
  let finalKeywords = keywords;
  if (finalKeywords.length === 0) {
    const { data: catKws } = await supabase
      .from("mcat_keywords")
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

  // Use the source question's difficulty so a hard question yields another hard one
  const sourceDifficulty = (sourceQ.difficulty as number) ?? undefined;
  const outlineContext = outlineContextForCategory(sourceQ.category_id as string);

  let generated;
  try {
    generated = await generateSimilarQuestion({
      question: {
        stem: sourceQ.stem as string,
        choices: sourceQ.choices as string[],
        correct_index: sourceQ.correct_index as number,
        explanation: sourceQ.explanation as string,
        keyword_weights: kwWeights,
        difficulty: sourceDifficulty,
      },
      keywords: finalKeywords,
      targetDifficulty: sourceDifficulty,
      outlineContext,
    });
  } catch (err) {
    if (err instanceof McatGenError) {
      return NextResponse.json(
        { error: "Similar question generation failed", detail: err.message },
        { status: err.status }
      );
    }
    throw err;
  }

  // Embed + retag before insert (try/catch — non-fatal)
  let embedding: number[] | null = null;
  let finalWeights = generated.keyword_weights;

  try {
    // Load pool keywords with embeddings for retagging
    const poolKeywords = await loadTargetKeywords(
      supabase,
      [sourceQ.category_id as string]
    );
    const keywordsWithEmbed = poolKeywords.filter((k) => k.embedding !== null);

    embedding = await embedText(
      `${generated.stem} | ${generated.choices[generated.correct_index]}`
    );
    const retagged = tagByEmbedding(embedding, keywordsWithEmbed);
    if (Object.keys(retagged).length > 0) {
      finalWeights = retagged;
    }
  } catch {
    // Embedding failure is non-fatal — keep LLM weights
  }

  // Insert the new question
  const { data: inserted, error: insertError } = await supabase
    .from("mcat_questions")
    .insert({
      section: "biology",
      category_id: sourceQ.category_id as string,
      stem: generated.stem,
      choices: generated.choices,
      correct_index: generated.correct_index,
      explanation: generated.explanation,
      keyword_weights: finalWeights,
      difficulty: generated.difficulty,
      parent_question_id: sourceQ.id as string,
      generated_by: "gpt-5.4-mini",
      status: "active",
      embedding: embedding as unknown,
    })
    .select(
      "id, stem, choices, correct_index, explanation, keyword_weights, difficulty, parent_question_id"
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
      stem: inserted.stem,
      choices: inserted.choices,
      correct_index: inserted.correct_index,
      explanation: inserted.explanation,
      keyword_weights: inserted.keyword_weights,
      difficulty: inserted.difficulty,
      parent_question_id: inserted.parent_question_id ?? null,
    },
  });
}
