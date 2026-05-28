import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const SYSTEM_PROMPT = `You are a math tutor generating a short skill refresher for a student who once learned this but forgot it.

Return exactly one JSON object:
{
  "rule_latex": string,
  "example_latex": string,
  "check_question": {
    "latex_content": string,
    "choices": [string, string, string, string],
    "correct_index": number,
    "solution_latex": string
  }
}

Rules:
- rule_latex: 1-2 sentences stating the rule or property. Concise. Prose inside \\text{}, math outside.
- example_latex: use \\begin{aligned}...\\end{aligned} with &= and \\\\ for each step. Never chain equalities on one line.
- check_question.latex_content: a short question testing the rule (KaTeX). Prose in \\text{}.
- check_question.choices: exactly 4 choices each wrapped in $...$. Include common error distractors.
- check_question.correct_index: 0-3.
- check_question.solution_latex: use \\begin{aligned}...\\end{aligned} with &= and \\\\ between steps.
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
      model: "gemini-3.5-flash",
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

  const { data: inserted, error: insertErr } = await supabase
    .from("learn_refreshers")
    .upsert(
      { keyword_id, rule_latex: parsed.rule_latex, example_latex: parsed.example_latex, check_question: parsed.check_question, model: "gemini-3.5-flash" },
      { onConflict: "keyword_id" }
    )
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: "generated", id: inserted?.id });
}
