import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import type { ProblemInsert } from "@ap-calc/types";
import { expandSubtopicRelevance } from "@/lib/subtopicRelevance";
import { autoTagKeywords } from "@/lib/ai/keywordTagger";

export const runtime = "nodejs";

const DESCRIPTIONS_SYSTEM = `You are a math problem analyst. Given a problem and its solution, return JSON with four descriptions:
- topic_description: one sentence describing what math skill or concept this problem tests (no LaTeX)
- action_description: one short phrase naming the cognitive operation the student performs (e.g., "differentiate and apply chain rule")
- representation_description: one short phrase describing the format the problem is presented in (e.g., "algebraic equation", "graph", "table of values")
- prerequisite_description: one sentence describing prerequisite knowledge required to solve it (no LaTeX)

Return exactly this JSON (no markdown, no extra keys):
{"topic_description":string,"action_description":string,"representation_description":string,"prerequisite_description":string}`;

async function generateFourDescriptions(
  openai: OpenAI,
  latex_content: string,
  solution_latex: string,
  type: string,
  choices?: string[] | null,
  correct_index?: number | null,
): Promise<{
  topic_description: string;
  action_description: string;
  representation_description: string;
  prerequisite_description: string;
} | null> {
  const choicesText =
    type === "multiple_choice" && Array.isArray(choices) && choices.length === 4
      ? "\n\nChoices:\n" +
        choices
          .map((c, i) => `${String.fromCharCode(65 + i)}. ${c}${i === correct_index ? " (correct)" : ""}`)
          .join("\n")
      : "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: DESCRIPTIONS_SYSTEM },
        { role: "user", content: `Problem:\n${latex_content}${choicesText}\n\nSolution:\n${solution_latex}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      topic_description?: string;
      action_description?: string;
      representation_description?: string;
      prerequisite_description?: string;
    };
    if (!parsed.topic_description) return null;
    return {
      topic_description: parsed.topic_description,
      action_description: parsed.action_description ?? "",
      representation_description: parsed.representation_description ?? "",
      prerequisite_description: parsed.prerequisite_description ?? "",
    };
  } catch {
    return null;
  }
}

async function fetchAllTopicIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("topic_metadata").select("id");
  if (error || !data?.length) return [];
  return data.map((r: { id: unknown }) => String(r.id));
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

  try {
    const body = await request.json();
    const {
      latex_content,
      solution_latex,
      choices,
      correct_index,
      difficulty,
      topic_weights,
      rubric,
      type,
      keyword_weights: bodyKwWeights,
      action_weights: bodyActionWeights,
      representation_weights: bodyReprWeights,
      prerequisite_weights: bodyPrereqWeights,
      topic_description: bodyTopicDesc,
      action_description: bodyActionDesc,
      representation_description: bodyReprDesc,
      prerequisite_description: bodyPrereqDesc,
    } = body;

    if (!latex_content || !solution_latex || difficulty == null) {
      return NextResponse.json(
        { error: "Missing required fields: latex_content, solution_latex, difficulty" },
        { status: 400 }
      );
    }

    const sparseWeights: Record<string, number> =
      topic_weights && typeof topic_weights === "object" && !Array.isArray(topic_weights)
        ? (topic_weights as Record<string, number>)
        : {};

    const hasPositiveWeight = Object.values(sparseWeights).some(
      (v) => typeof v === "number" && Number.isFinite(v) && v > 0
    );
    if (!hasPositiveWeight) {
      return NextResponse.json(
        { error: "Missing or invalid topic_weights (need at least one positive weight)" },
        { status: 400 }
      );
    }

    const catalogIds = await fetchAllTopicIds(supabase);
    const idUniverse = catalogIds.length > 0 ? catalogIds : Object.keys(sparseWeights);
    const subtopic_relevance = expandSubtopicRelevance(idUniverse, sparseWeights);

    const problemType = type === "free_response" ? "free_response" : "multiple_choice";

    const insertPayload: ProblemInsert & Record<string, unknown> = {
      latex_content: String(latex_content),
      solution_latex: String(solution_latex),
      difficulty: Number(difficulty),
      topic_weights: sparseWeights,
      subtopic_relevance,
      avg_rating: null,
      rating_count: 0,
      status: "pending_review",
      type: problemType,
      ...(bodyTopicDesc ? { topic_description: bodyTopicDesc } : {}),
      ...(bodyActionDesc ? { action_description: bodyActionDesc } : {}),
      ...(bodyReprDesc ? { representation_description: bodyReprDesc } : {}),
      ...(bodyPrereqDesc ? { prerequisite_description: bodyPrereqDesc } : {}),
      ...(bodyKwWeights && Object.keys(bodyKwWeights).length > 0 ? { keyword_weights: bodyKwWeights } : {}),
      ...(bodyActionWeights && Object.keys(bodyActionWeights).length > 0 ? { action_weights: bodyActionWeights } : {}),
      ...(bodyReprWeights && Object.keys(bodyReprWeights).length > 0 ? { representation_weights: bodyReprWeights } : {}),
      ...(bodyPrereqWeights && Object.keys(bodyPrereqWeights).length > 0 ? { prerequisite_weights: bodyPrereqWeights } : {}),
    };

    if (problemType === "multiple_choice") {
      insertPayload.choices = Array.isArray(choices) ? choices : null;
      insertPayload.correct_index =
        correct_index != null ? Number(correct_index) : null;
    } else {
      insertPayload.choices = null;
      insertPayload.correct_index = null;
      insertPayload.rubric =
        rubric != null && typeof rubric === "string" ? rubric : null;
    }

    const { data, error } = await supabase
      .from("problems")
      .insert(insertPayload)
      .select("id, avg_rating, rating_count")
      .single();

    if (error) {
      console.error("problems insert error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const row = data as { id: string; avg_rating: number | null; rating_count: number | null };

    // Fire-and-forget: generate descriptions + embedding + keyword tags
    if (openai) {
      void (async () => {
        try {
          const descResult = await generateFourDescriptions(
            openai,
            String(latex_content),
            String(solution_latex),
            problemType,
            Array.isArray(choices) ? choices : null,
            correct_index != null ? Number(correct_index) : null,
          );

          const td = bodyTopicDesc ?? descResult?.topic_description;
          const ad = bodyActionDesc ?? descResult?.action_description;
          const rd = bodyReprDesc ?? descResult?.representation_description;
          const pd = bodyPrereqDesc ?? descResult?.prerequisite_description;

          const [taggingResult, embRes] = await Promise.all([
            autoTagKeywords(
              openai, String(latex_content), String(solution_latex), supabase,
              undefined, undefined, undefined,
              td, ad, rd, pd,
            ),
            openai.embeddings.create({
              model: "text-embedding-3-small",
              input: `${String(latex_content)}\n\n${String(solution_latex)}`,
            }),
          ]);

          const embedding = embRes.data[0]?.embedding ?? null;
          const { keyword_weights: kwWeights, action_weights: aWeights, representation_weights: rWeights, prerequisite_weights: pWeights } = taggingResult;

          await supabase.from("problems").update({
            ...(embedding ? { embedding } : {}),
            ...(Object.keys(kwWeights).length > 0 && !bodyKwWeights ? { keyword_weights: kwWeights } : {}),
            ...(Object.keys(aWeights).length > 0 && !bodyActionWeights ? { action_weights: aWeights } : {}),
            ...(Object.keys(rWeights).length > 0 && !bodyReprWeights ? { representation_weights: rWeights } : {}),
            ...(Object.keys(pWeights).length > 0 && !bodyPrereqWeights ? { prerequisite_weights: pWeights } : {}),
            ...(td && !bodyTopicDesc ? { topic_description: td } : {}),
            ...(ad && !bodyActionDesc ? { action_description: ad } : {}),
            ...(rd && !bodyReprDesc ? { representation_description: rd } : {}),
            ...(pd && !bodyPrereqDesc ? { prerequisite_description: pd } : {}),
          }).eq("id", row.id);
        } catch (err) {
          console.error("problems: post-insert enrichment failed for", row.id, err instanceof Error ? err.message : err);
        }
      })();
    }

    return NextResponse.json({
      id: row.id,
      avg_rating: row.avg_rating ?? null,
      rating_count: row.rating_count ?? 0,
    });
  } catch (err) {
    console.error("problems API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
