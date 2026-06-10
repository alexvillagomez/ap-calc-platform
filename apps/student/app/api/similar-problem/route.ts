import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const GEN_MODEL = "gpt-5.4-mini";

function createGenClient(): OpenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return new OpenAI({
    apiKey: key,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  try {
    const { problemId } = (await req.json()) as {
      problemId?: string;
      sessionId?: string;
    };

    if (!problemId) {
      return NextResponse.json({ error: "problemId is required" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // 1. Fetch the source problem
    const { data: source, error: fetchError } = await supabase
      .from("problems")
      .select("id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights, type")
      .eq("id", problemId)
      .single();

    if (fetchError || !source) {
      return NextResponse.json({ error: "Problem not found" }, { status: 404 });
    }

    // 2. Build prompt and call Gemini
    const client = createGenClient();

    const systemPrompt =
      "You are a math problem generator. You will receive a multiple-choice math problem and must generate a NEW problem with IDENTICAL mathematical structure but different numbers and variable values. The new problem must: (1) test exactly the same concept and skill, (2) have the same difficulty level, (3) use different specific numbers/values so it is not trivially the same, (4) follow the exact same JSON format as the input. Return ONLY valid JSON, no markdown.";

    const userPrompt =
      `Generate a sibling problem for this problem:\n${JSON.stringify({
        latex_content: source.latex_content,
        solution_latex: source.solution_latex,
        choices: source.choices,
        correct_index: source.correct_index,
      })}\n\nReturn the same JSON structure with new numbers.`;

    const completion = await client.chat.completions.create({
      model: GEN_MODEL,
      temperature: 0.8,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    // 3. Parse response — strip markdown fences if present
    let parsed: {
      latex_content?: unknown;
      choices?: unknown;
      correct_index?: unknown;
      solution_latex?: unknown;
    };
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "Could not generate similar problem" }, { status: 500 });
    }

    // 4. Validate required fields
    if (
      typeof parsed.latex_content !== "string" ||
      !Array.isArray(parsed.choices) ||
      (parsed.choices as unknown[]).length !== 4 ||
      typeof parsed.correct_index !== "number" ||
      parsed.correct_index < 0 ||
      parsed.correct_index > 3 ||
      typeof parsed.solution_latex !== "string"
    ) {
      return NextResponse.json({ error: "Could not generate similar problem" }, { status: 500 });
    }

    // 5. Insert sibling into problems table
    const { data: inserted, error: insertError } = await supabase
      .from("problems")
      .insert({
        latex_content: parsed.latex_content,
        solution_latex: parsed.solution_latex,
        choices: parsed.choices,
        correct_index: parsed.correct_index,
        difficulty: source.difficulty,
        estimated_difficulty: source.difficulty,
        keyword_weights: source.keyword_weights,
        type: source.type,
        parent_problem_id: source.id,
        is_sibling: true,
        status: "approved",
      })
      .select("id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json({ error: "Could not generate similar problem" }, { status: 500 });
    }

    return NextResponse.json({ problem: inserted });
  } catch {
    return NextResponse.json({ error: "Could not generate similar problem" }, { status: 500 });
  }
}
