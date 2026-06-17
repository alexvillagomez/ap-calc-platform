import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { assembleChoices } from "@/lib/assembleChoices";

const SYSTEM_PROMPT = `You are a precalculus tutor generating micro-lessons. A micro-lesson teaches ONE specific keyword skill through a sequence of small steps. Each step is: short explanation → worked example → one check question.

Return exactly one JSON object:
{ "micro_steps": [ MicroStep, ... ] }

Where each MicroStep is:
{
  "step_index": number,
  "explanation_latex": string,
  "example_latex": string,
  "check_question": {
    "latex_content": string,
    "solution_latex": string,
    "correct_answer": string,
    "distractors": [string, string, string]
  },
  "hint_latex": string
}

DELIMITERS (mandatory): every math expression in EVERY field (explanation_latex, example_latex, check_question.latex_content, solution_latex, correct_answer, distractors) MUST be wrapped in $...$ (inline) or $$...$$ (block). Bare LaTeX outside delimiters does NOT render — it shows literal backslashes.
  ✅ CORRECT (block): "$$\\begin{aligned} x^3 \\cdot x^5 &= x^{3+5} \\\\ &= x^8 \\end{aligned}$$"
  ✅ CORRECT (inline): "Add the exponents: $3+5=8$."
  ❌ WRONG (bare): "\\begin{aligned} ... \\end{aligned}" or "\\frac{a}{b}" without $...$.

Rules:
- Generate exactly 2 micro_steps per keyword. Step 1 is a direct application; step 2 is a slightly harder variation.
- explanation_latex: 1-3 sentences of plain text. Wrap any math in $...$. No \\text{}.
- example_latex: a $$\\begin{aligned}...\\end{aligned}$$ block (the WHOLE block wrapped in $$...$$) with each step on its own line via \\\\ and &= alignment. Example: "$$\\begin{aligned} x^3 \\cdot x^5 &= x^{3+5} \\\\ &= x^8 \\end{aligned}$$"
- check_question ORDER (mandatory): write latex_content, THEN solution_latex (work it fully to a final answer), THEN copy that final answer verbatim into correct_answer, THEN write distractors. Never decide the answer before finishing solution_latex.
- check_question.latex_content: one short plain-text question stem. Wrap any math in $...$. No \\text{}.
- check_question.solution_latex: a $$\\begin{aligned}...\\end{aligned}$$ block (wrapped in $$...$$) with &= and \\\\ between steps.
- check_question.correct_answer: EXACTLY the final answer solution_latex concluded, wrapped in $...$. The app makes this the correct choice — it MUST match the solution.
- check_question.distractors: exactly 3 strings, each wrapped in $...$, all different from correct_answer. Each must reflect a real student mistake for this keyword.
- Do NOT output a "choices" array or a "correct_index" in check_question; the app assembles and randomizes them.
- hint_latex: one plain-text sentence. Use $...$ for any math inline. No \\text{}.
- CRITICAL: NEVER chain equalities on a single line (e.g. a = b = c). Always break multi-step work across lines using \\begin{aligned}.
- All LaTeX: valid KaTeX syntax. No markdown. Return raw JSON only.`;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !openaiKey) {
    return NextResponse.json({ error: "Missing configuration" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  const body = (await request.json()) as {
    keyword_id: string;
    force?: boolean;
  };
  const { keyword_id, force = false } = body;

  if (!keyword_id) {
    return NextResponse.json({ error: "keyword_id required" }, { status: 400 });
  }

  // Fetch keyword metadata
  const { data: kw, error: kwErr } = await supabase
    .from("learn_keywords")
    .select("id, label, description, topic_id")
    .eq("id", keyword_id)
    .single();

  if (kwErr || !kw) {
    return NextResponse.json({ error: `Keyword not found: ${keyword_id}` }, { status: 404 });
  }

  // Check if lesson already exists
  if (!force) {
    const { data: existing } = await supabase
      .from("learn_lessons")
      .select("id")
      .eq("keyword_id", keyword_id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ status: "exists", id: existing.id });
    }
  }

  const userPrompt = `Generate a micro-lesson for keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? "(none)"}\nTopic: ${kw.topic_id}`;

  let parsed: { micro_steps: unknown[] };
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });
    const content = completion.choices[0]?.message?.content ?? "{}";
    parsed = JSON.parse(content) as { micro_steps: unknown[] };
  } catch (err) {
    console.error("lesson generation error:", err);
    return NextResponse.json({ error: "OpenAI generation failed" }, { status: 500 });
  }

  if (!Array.isArray(parsed.micro_steps) || parsed.micro_steps.length === 0) {
    return NextResponse.json({ error: "Invalid micro_steps from model" }, { status: 500 });
  }

  // Assemble each check question's choices in code so the correct choice is the
  // solution's final answer at a random index — never a model-keyed contradiction.
  type RawStep = {
    step_index?: number;
    explanation_latex?: string;
    example_latex?: string;
    hint_latex?: string;
    check_question?: { latex_content?: string; solution_latex?: string; correct_answer?: string; distractors?: string[] };
  };
  const microSteps = (parsed.micro_steps as RawStep[])
    .map((s) => {
      const cq = s.check_question;
      const assembled = cq ? assembleChoices(cq.correct_answer, cq.distractors) : null;
      if (!cq || !assembled) return null;
      return {
        step_index: s.step_index,
        explanation_latex: s.explanation_latex,
        example_latex: s.example_latex,
        hint_latex: s.hint_latex,
        check_question: {
          latex_content: cq.latex_content ?? "",
          solution_latex: cq.solution_latex ?? "",
          choices: assembled.choices,
          correct_index: assembled.correct_index,
        },
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (microSteps.length === 0) {
    return NextResponse.json({ error: "No valid micro-steps assembled from model output" }, { status: 502 });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("learn_lessons")
    .upsert(
      { keyword_id, micro_steps: microSteps, model: "gpt-5.4-mini" },
      { onConflict: "keyword_id" }
    )
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: "generated", id: inserted?.id, micro_steps: microSteps });
}
