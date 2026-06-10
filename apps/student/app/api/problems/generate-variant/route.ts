import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const GEN_MODEL = "gpt-5.4-mini";

const VARIANT_SYSTEM = `You are a precalculus problem author. Given a template problem, generate a NEW problem that tests the SAME skill but uses different values, numbers, or a slightly different scenario. The structure and difficulty should match the template.

Return JSON: {
  "latex_content": string,
  "solution_latex": string,
  "choices": ["$...$", "$...$", "$...$", "$...$"],
  "correct_index": 0-3
}

Rules:
- The new problem must have a DIFFERENT correct answer from the template (different correct_index or different values)
- All 4 choices must be distinct
- Keep the same difficulty level
- Prose in \\\\text{}, math outside. Use $$...$$ for displayed math.
- Return valid JSON only.`;

function createGenClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey: key });
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key);
}

type RagExample = {
  id: string;
  latex_content: string;
  solution_latex: string | null;
  choices: string[] | unknown;
  correct_index: number;
  difficulty: number | null;
  keyword_weights: Record<string, number> | null;
  action_weights: Record<string, number> | null;
  representation_weights: Record<string, number> | null;
  prerequisite_weights: Record<string, number> | null;
};

type GeneratedVariant = {
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      templateProblemId?: string;
      keywordId?: string;
      keywordLabel?: string;
    };

    const { templateProblemId, keywordId, keywordLabel } = body;

    if (!templateProblemId || !keywordId) {
      return NextResponse.json(
        { error: "templateProblemId and keywordId are required" },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Fetch the template from rag_examples
    const { data: template, error: fetchError } = await supabase
      .from("rag_examples")
      .select(
        "id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights, action_weights, representation_weights, prerequisite_weights"
      )
      .eq("id", templateProblemId)
      .single();

    if (fetchError || !template) {
      return NextResponse.json(
        { error: "Template problem not found" },
        { status: 404 }
      );
    }

    const tpl = template as RagExample;

    // Call OpenAI to generate the variant
    const client = createGenClient();

    const userMessage = `Template problem:
latex_content: ${tpl.latex_content}
choices: ${JSON.stringify(tpl.choices)}
correct_index: ${tpl.correct_index}
difficulty: ${tpl.difficulty ?? 2}/5
keyword: ${keywordLabel ?? keywordId}

Generate a variant problem testing the same skill with different numbers/values.`;

    const completion = await client.chat.completions.create({
      model: GEN_MODEL,
      messages: [
        { role: "system", content: VARIANT_SYSTEM },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0.85,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Partial<GeneratedVariant>;
    try {
      parsed = JSON.parse(raw) as Partial<GeneratedVariant>;
    } catch {
      return NextResponse.json(
        { error: "Failed to parse generated variant" },
        { status: 500 }
      );
    }

    // Validate required fields
    if (
      typeof parsed.latex_content !== "string" ||
      typeof parsed.solution_latex !== "string" ||
      !Array.isArray(parsed.choices) ||
      (parsed.choices as unknown[]).length !== 4 ||
      typeof parsed.correct_index !== "number" ||
      parsed.correct_index < 0 ||
      parsed.correct_index > 3
    ) {
      return NextResponse.json(
        { error: "Generated variant is malformed" },
        { status: 500 }
      );
    }

    const difficulty = tpl.difficulty ?? 2;

    // Insert the variant into problems table.
    // Note: parent_problem_id is omitted here because it FK-references problems(id),
    // but the template id comes from rag_examples which has a separate uuid space.
    // is_sibling: true marks this as a generated variant.
    const { data: inserted, error: insertError } = await supabase
      .from("problems")
      .insert({
        latex_content: parsed.latex_content,
        solution_latex: parsed.solution_latex,
        choices: parsed.choices,
        correct_index: parsed.correct_index,
        difficulty,
        estimated_difficulty: null,
        keyword_weights: tpl.keyword_weights ?? {},
        action_weights: tpl.action_weights ?? {},
        representation_weights: tpl.representation_weights ?? {},
        prerequisite_weights: tpl.prerequisite_weights ?? {},
        is_sibling: true,
        status: "approved",
        // topic_weights required by schema — derive from keyword_weights as a placeholder
        topic_weights: tpl.keyword_weights ?? {},
      })
      .select(
        "id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights"
      )
      .single();

    if (insertError || !inserted) {
      console.error("generate-variant insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to store generated variant" },
        { status: 500 }
      );
    }

    return NextResponse.json({ problem: inserted });
  } catch (err) {
    console.error("generate-variant error:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
