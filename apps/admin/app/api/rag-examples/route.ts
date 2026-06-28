import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { autoTagKeywords } from "@/lib/ai/keywordTagger";

export const runtime = "nodejs";

const DESCRIPTION_SYSTEM = `You are a math problem analyst. Given a multiple-choice problem and its solution, return:
1. A plain-English problem_description (one sentence describing what skill the problem tests — no LaTeX).
2. wrong_answer_descriptions: for each of the 4 choices in order, a short plain-English explanation of the specific error or misconception a student makes when choosing that answer. For the correct answer, return null.

Return exactly one JSON object:
{
  "problem_description": string,
  "wrong_answer_descriptions": [string | null, string | null, string | null, string | null]
}

No LaTeX. No markdown. Raw JSON only.`;

async function generateDescriptions(
  openai: OpenAI,
  latex_content: string,
  solution_latex: string,
  choices: string[] | null,
  correct_index: number | null
): Promise<{ problem_description: string; wrong_answer_descriptions: (string | null)[] } | null> {
  const choicesText = Array.isArray(choices) && choices.length === 4
    ? choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}${i === correct_index ? " (correct)" : ""}`).join("\n")
    : "(no choices)";

  const userMsg = `Problem:\n${latex_content}\n\nChoices:\n${choicesText}\n\nSolution:\n${solution_latex}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: DESCRIPTION_SYSTEM },
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      problem_description?: string;
      wrong_answer_descriptions?: (string | null)[];
    };
    if (!parsed.problem_description) return null;
    return {
      problem_description: parsed.problem_description,
      wrong_answer_descriptions: Array.isArray(parsed.wrong_answer_descriptions)
        ? parsed.wrong_answer_descriptions
        : [null, null, null, null],
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

  const body = (await request.json()) as {
    problem_id?: string;
    latex_content?: string;
    solution_latex?: string;
    choices?: string[];
    correct_index?: number;
    difficulty?: number;
    notes?: string;
    course?: "ap_calc" | "precalc";
    problem_description?: string;
    wrong_answer_descriptions?: (string | null)[];
    wrong_answer_data?: { index: number; description: string }[];
    topic_description?: string;
    keyword_weights?: Record<string, number>;
    action_description?: string;
    action_weights?: Record<string, number>;
    representation_description?: string;
    representation_weights?: Record<string, number>;
    prerequisite_description?: string;
    prerequisite_weights?: Record<string, number>;
  };
  const course = body.course === "precalc" ? "precalc" : "ap_calc";

  // ── Mode 1: promote from existing problems table ──────────────────────────
  if (body.problem_id) {
    const { problem_id, difficulty, notes } = body;

    const { data: problem, error: fetchError } = await supabase
      .from("problems")
      .select("latex_content, solution_latex, choices, correct_index, topic_weights, keyword_weights, type")
      .eq("id", problem_id)
      .maybeSingle();

    if (fetchError || !problem) {
      return NextResponse.json({ error: fetchError?.message ?? "Problem not found" }, { status: 404 });
    }

    const difficultyValue = typeof difficulty === "number" && difficulty >= 1 && difficulty <= 5 ? difficulty : null;

    const { data: inserted, error: insertError } = await supabase
      .from("rag_examples")
      .insert({
        keyword_weights: problem.keyword_weights ?? {},
        latex_content: problem.latex_content,
        solution_latex: problem.solution_latex,
        choices: problem.type === "multiple_choice" ? (problem.choices ?? null) : null,
        correct_index: problem.type === "multiple_choice" ? (problem.correct_index ?? null) : null,
        difficulty: difficultyValue,
        notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
        course,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json({ error: insertError?.message ?? "Insert failed" }, { status: 500 });
    }

    const newId = (inserted as { id: string }).id;

    // Fire-and-forget: embed + generate descriptions for promoted problems
    if (openai) {
      void (async () => {
        try {
          const [embedding, descriptions] = await Promise.all([
            openai.embeddings.create({
              model: "text-embedding-3-small",
              input: `${problem.latex_content}\n\n${problem.solution_latex}`,
            }).then((r) => r.data[0]?.embedding ?? null),
            problem.type === "multiple_choice"
              ? generateDescriptions(openai, problem.latex_content, problem.solution_latex, problem.choices, problem.correct_index)
              : null,
          ]);
          await supabase.from("rag_examples").update({
            ...(embedding ? { embedding } : {}),
            ...(descriptions ? {
              problem_description: descriptions.problem_description,
              wrong_answer_descriptions: descriptions.wrong_answer_descriptions,
            } : {}),
          }).eq("id", newId);
        } catch (err) {
          console.error("rag-examples promote: embed/describe failed", err);
        }
      })();
    }

    return NextResponse.json({ id: newId });
  }

  // ── Mode 2: direct content insert ────────────────────────────────────────
  const {
    latex_content, solution_latex, choices, correct_index, difficulty, notes,
    topic_description, keyword_weights, action_description, action_weights,
    representation_description, representation_weights, prerequisite_description, prerequisite_weights,
    wrong_answer_data: inputWrongAnswerData,
  } = body;

  if (!latex_content || typeof latex_content !== "string" || !latex_content.trim()) {
    return NextResponse.json({ error: "latex_content is required" }, { status: 400 });
  }
  if (!solution_latex || typeof solution_latex !== "string" || !solution_latex.trim()) {
    return NextResponse.json({ error: "solution_latex is required" }, { status: 400 });
  }

  const isMcq = Array.isArray(choices) && choices.length > 0;
  const difficultyValue = typeof difficulty === "number" && difficulty >= 1 && difficulty <= 5 ? difficulty : null;
  const choicesForInsert = isMcq ? choices : null;
  const correctIndexForInsert = isMcq && typeof correct_index === "number" ? correct_index : null;

  const { data: inserted, error: insertError } = await supabase
    .from("rag_examples")
    .insert({
      keyword_weights: keyword_weights ?? {},
      latex_content: latex_content.trim(),
      solution_latex: solution_latex.trim(),
      choices: choicesForInsert,
      correct_index: correctIndexForInsert,
      difficulty: difficultyValue,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
      course,
      ...(topic_description ? { topic_description } : {}),
      ...(action_weights && Object.keys(action_weights).length > 0 ? { action_weights } : {}),
      ...(action_description ? { action_description } : {}),
      ...(representation_weights && Object.keys(representation_weights).length > 0 ? { representation_weights } : {}),
      ...(representation_description ? { representation_description } : {}),
      ...(prerequisite_weights && Object.keys(prerequisite_weights).length > 0 ? { prerequisite_weights } : {}),
      ...(prerequisite_description ? { prerequisite_description } : {}),
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? "Insert failed" }, { status: 500 });
  }

  const newId = (inserted as { id: string }).id;

  // Fire-and-forget: keyword tagging + embedding + descriptions
  if (openai) {
    void (async () => {
      try {
        // Convert {index, description}[] → position-indexed (string|null)[]
        const wrongAnswerDescriptions: (string | null)[] = Array.from({ length: 4 }, (_, i) => {
          if (i === correctIndexForInsert) return null;
          return inputWrongAnswerData?.find((w) => w.index === i)?.description ?? null;
        });

        const [taggingResult, embedding, descriptions] = await Promise.all([
          autoTagKeywords(
            openai, latex_content, solution_latex, supabase,
            undefined, wrongAnswerDescriptions, correctIndexForInsert ?? undefined,
            topic_description, action_description, representation_description, prerequisite_description,
          ),
          openai.embeddings.create({
            model: "text-embedding-3-small",
            input: `${latex_content.trim()}\n\n${solution_latex.trim()}`,
          }).then((r) => r.data[0]?.embedding ?? null),
          isMcq && !body.problem_description
            ? generateDescriptions(openai, latex_content, solution_latex, choicesForInsert, correctIndexForInsert)
            : null,
        ]);

        const { keyword_weights: autoKwWeights, action_weights: autoActionWeights, representation_weights: autoReprWeights, prerequisite_weights: autoPrereqWeights } = taggingResult;

        const taggedWad = taggingResult.wrong_answer_data;

        const { error: updateErr } = await supabase.from("rag_examples").update({
          ...(Object.keys(autoKwWeights).length > 0 && Object.keys(keyword_weights ?? {}).length === 0 ? { keyword_weights: autoKwWeights } : {}),
          ...(Object.keys(autoActionWeights).length > 0 ? { action_weights: autoActionWeights } : {}),
          ...(Object.keys(autoReprWeights).length > 0 ? { representation_weights: autoReprWeights } : {}),
          ...(Object.keys(autoPrereqWeights).length > 0 ? { prerequisite_weights: autoPrereqWeights } : {}),
          ...(taggedWad.some((e) => e.description !== null) ? { wrong_answer_data: taggedWad } : {}),
          ...(embedding ? { embedding } : {}),
          ...(descriptions?.problem_description ? { problem_description: descriptions.problem_description } : {}),
        }).eq("id", newId);
        if (updateErr) console.error("rag-examples: enrichment update failed for", newId, updateErr.message);
      } catch (err) {
        console.error("rag-examples: post-insert enrichment failed", err);
      }
    })();
  }

  return NextResponse.json({ id: newId });
}
