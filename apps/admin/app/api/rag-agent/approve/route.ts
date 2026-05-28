import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { autoTagKeywords } from "@/lib/ai/keywordTagger";
import { GEN_MODEL } from "@/lib/ai/genClient";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const body = await request.json() as {
    latex_content: string;
    solution_latex: string;
    choices: string[];
    correct_index: number;
    assessedDifficulty: number;
    problemTypeName: string;
    targetDifficulty: number;
    course?: "ap_calc" | "precalc";
    problem_description?: string;
    wrong_answer_descriptions?: (string | null)[];
    generation_thinking?: string;
    distractor_thinking?: string;
    distractor_pool?: { id: string; misconception: string; wrong_answer_plain: string }[] | null;
  };
  const course = body.course === "precalc" ? "precalc" : "ap_calc";

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: inserted, error: insertError } = await supabase
    .from("rag_examples")
    .insert({
      topic_id: null,
      keyword_weights: {},
      latex_content: body.latex_content,
      solution_latex: body.solution_latex,
      choices: body.choices,
      correct_index: body.correct_index,
      difficulty: body.assessedDifficulty,
      notes: `RAG Agent — ${body.problemTypeName} (D${body.targetDifficulty})`,
      course,
      ...(body.generation_thinking ? { generation_thinking: body.generation_thinking } : {}),
      ...(body.distractor_thinking ? { distractor_thinking: body.distractor_thinking } : {}),
      ...(body.distractor_pool ? { distractor_pool: body.distractor_pool } : {}),
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? "Insert failed" }, { status: 500 });
  }

  const ragId = (inserted as { id: string }).id;

  // Fire-and-forget: keyword tagging + embedding + descriptions
  if (openaiKey) {
    const openai = new OpenAI({ apiKey: openaiKey });
    void (async () => {
      try {
        const problemText = `${body.latex_content}\n\n${body.solution_latex}`;
        const wadForTagging = Array.isArray(body.wrong_answer_descriptions) ? body.wrong_answer_descriptions : [];
        const [taggingResult, embRes] = await Promise.all([
          autoTagKeywords(openai, body.latex_content, body.solution_latex, supabase, body.problem_description, wadForTagging as (string | null)[], body.correct_index),
          openai.embeddings.create({ model: "text-embedding-3-small", input: problemText }),
        ]);
        const embedding = embRes.data[0]?.embedding ?? null;
        const normalizedKw = taggingResult.keyword_weights;
        const normalizedTags = taggingResult.tag_weights;
        const wrong_answer_data = taggingResult.wrong_answer_data;

        // Generate descriptions (fallback for problems missing problem_description)
        let problem_description: string | null = body.problem_description ?? null;
        let wrong_answer_descriptions: (string | null)[] | null = body.wrong_answer_descriptions ?? null;
        if (!problem_description && Array.isArray(body.choices) && body.choices.length === 4) {
          const choicesText = body.choices
            .map((c, i) => `${String.fromCharCode(65 + i)}. ${c}${i === body.correct_index ? " (correct)" : ""}`)
            .join("\n");
          const completion = await openai.chat.completions.create({
            model: GEN_MODEL,
            messages: [
              { role: "system", content: `Return JSON with problem_description (one plain-English sentence, no LaTeX) and wrong_answer_descriptions (array of 4 strings|null, null for correct answer). No markdown.` },
              { role: "user", content: `Problem:\n${body.latex_content}\n\nChoices:\n${choicesText}\n\nSolution:\n${body.solution_latex}` },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
          });
          const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { problem_description?: string; wrong_answer_descriptions?: (string | null)[] };
          problem_description = parsed.problem_description ?? null;
          wrong_answer_descriptions = Array.isArray(parsed.wrong_answer_descriptions) ? parsed.wrong_answer_descriptions : null;
        }

        await supabase.from("rag_examples").update({
          keyword_weights: normalizedKw,
          tag_weights: normalizedTags,
          ...(wrong_answer_data.length > 0 ? { wrong_answer_data } : {}),
          ...(embedding ? { embedding } : {}),
          ...(problem_description ? { problem_description } : {}),
          ...(wrong_answer_descriptions ? { wrong_answer_descriptions } : {}),
        }).eq("id", ragId);
      } catch (err) {
        console.error("rag-agent approve: enrichment failed for", ragId, err instanceof Error ? err.message : err);
      }
    })();
  }

  return NextResponse.json({ id: ragId });
}
