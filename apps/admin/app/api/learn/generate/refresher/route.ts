import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { assembleChoices } from "@/lib/assembleChoices";

const SYSTEM_PROMPT = `You are a math tutor generating a short skill refresher for a student who once learned this but forgot it.

Return exactly one JSON object:
{
  "rule_latex": string,
  "example_latex": string,
  "check_question": {
    "latex_content": string,
    "solution_latex": string,
    "correct_answer": string,
    "distractors": [string, string, string]
  }
}

DELIMITERS (mandatory): every math expression in EVERY field (rule_latex, example_latex, check_question.latex_content, solution_latex, correct_answer, distractors) MUST be wrapped in $...$ (inline) or $$...$$ (block). Write prose as plain text, NOT inside \\text{}. Bare LaTeX outside delimiters does NOT render — it shows literal backslashes.
  ✅ CORRECT (block): "$$\\begin{aligned} a^2-b^2 &= (a-b)(a+b) \\end{aligned}$$"
  ✅ CORRECT (inline): "Factor the difference of squares: $a^2-b^2=(a-b)(a+b)$."
  ❌ WRONG (bare): "\\begin{aligned} ... \\end{aligned}" or "\\frac{a}{b}" without $...$.

Rules:
- rule_latex: 1-2 sentences stating the rule or property. Plain-text prose; wrap any math in $...$.
- example_latex: a $$\\begin{aligned}...\\end{aligned}$$ block (the WHOLE block wrapped in $$...$$) with &= and \\\\ for each step. Never chain equalities on one line.
- check_question ORDER (mandatory): write latex_content, THEN solution_latex (work it fully to a final answer), THEN copy that final answer verbatim into correct_answer, THEN write distractors. Never decide the answer before finishing solution_latex.
- check_question.latex_content: a short question testing the rule. Plain-text prose; wrap any math in $...$.
- check_question.solution_latex: a $$\\begin{aligned}...\\end{aligned}$$ block (wrapped in $$...$$) with &= and \\\\ between steps.
- check_question.correct_answer: EXACTLY the final answer solution_latex concluded, wrapped in $...$. The app makes this the correct choice — it MUST match the solution.
- check_question.distractors: exactly 3 choices each wrapped in $...$, all different from correct_answer. Include common error distractors.
- Do NOT output a "choices" array or a "correct_index" in check_question; the app assembles and randomizes them.
- All LaTeX: valid KaTeX. \\\\ for line breaks. No markdown. Return raw JSON only.`;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !openaiKey) {
    return NextResponse.json({ error: "Missing configuration" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  const body = (await request.json()) as { keyword_id: string; force?: boolean };
  const { keyword_id, force = false } = body;

  if (!keyword_id) {
    return NextResponse.json({ error: "keyword_id required" }, { status: 400 });
  }

  const { data: kw } = await supabase
    .from("learn_keywords")
    .select("id, label, description, topic_id")
    .eq("id", keyword_id)
    .single();

  if (!kw) {
    return NextResponse.json({ error: `Keyword not found: ${keyword_id}` }, { status: 404 });
  }

  if (!force) {
    const { data: existing } = await supabase
      .from("learn_refreshers")
      .select("id")
      .eq("keyword_id", keyword_id)
      .maybeSingle();
    if (existing) return NextResponse.json({ status: "exists", id: existing.id });
  }

  const userPrompt = `Generate a refresher for keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? "(none)"}`;

  let parsed: { rule_latex: string; example_latex: string; check_question: unknown };
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
    parsed = JSON.parse(content) as typeof parsed;
  } catch (err) {
    console.error("refresher generation error:", err);
    return NextResponse.json({ error: "OpenAI generation failed" }, { status: 500 });
  }

  if (!parsed.rule_latex || !parsed.example_latex || !parsed.check_question) {
    return NextResponse.json({ error: "Invalid response from model" }, { status: 500 });
  }

  // Assemble choices in code so the correct choice is the solution's final answer.
  const rawCq = parsed.check_question as {
    latex_content?: string;
    solution_latex?: string;
    correct_answer?: string;
    distractors?: string[];
  };
  const assembled = assembleChoices(rawCq.correct_answer, rawCq.distractors);
  if (!assembled) {
    return NextResponse.json({ error: "Could not assemble a valid check question from model output" }, { status: 502 });
  }
  const checkQuestion = {
    latex_content: rawCq.latex_content ?? "",
    solution_latex: rawCq.solution_latex ?? "",
    choices: assembled.choices,
    correct_index: assembled.correct_index,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("learn_refreshers")
    .upsert(
      { keyword_id, rule_latex: parsed.rule_latex, example_latex: parsed.example_latex, check_question: checkQuestion, model: "gpt-5.4-mini" },
      { onConflict: "keyword_id" }
    )
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: "generated", id: inserted?.id });
}
