import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

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
    "choices": [string, string, string, string],
    "correct_index": number,
    "solution_latex": string
  },
  "hint_latex": string
}

Rules:
- Generate exactly 2 micro_steps per keyword. Step 1 is a direct application; step 2 is a slightly harder variation.
- explanation_latex: 1-3 sentences max. ALL English prose must be inside \\text{}. Only pure math symbols outside \\text{}.
- example_latex: use \\begin{aligned}...\\end{aligned}. Each step on its own line with \\\\ and &= alignment. Example: \\begin{aligned} x^3 \\cdot x^5 &= x^{3+5} \\\\ &= x^8 \\end{aligned}
- check_question.latex_content: one short question stem (KaTeX). Prose in \\text{}.
- check_question.choices: exactly 4 strings, each wrapped in $...$. Distractors must reflect real student mistakes for this keyword.
- check_question.correct_index: 0-3.
- check_question.solution_latex: use \\begin{aligned}...\\end{aligned} with &= and \\\\ between steps.
- hint_latex: one sentence. The most important thing to remember for this keyword. Prose in \\text{}.
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
      model: "gemini-3.5-flash",
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

  const { data: inserted, error: insertErr } = await supabase
    .from("learn_lessons")
    .upsert(
      { keyword_id, micro_steps: parsed.micro_steps, model: "gemini-3.5-flash" },
      { onConflict: "keyword_id" }
    )
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: "generated", id: inserted?.id, micro_steps: parsed.micro_steps });
}
