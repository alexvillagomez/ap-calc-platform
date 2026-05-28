import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const SYSTEM_PROMPT = `You are a math assessment author. Generate a short mastery quiz for a specific keyword skill.

Mastery quiz questions should:
- Be difficulty 3-4 (genuine understanding, not pattern-matching)
- Include at least one question in an unfamiliar presentation of the rule
- Test whether the student can apply the rule, not just recognize it

Return exactly one JSON object: { "problems": [ QuizProb, ... ] }

Each QuizProb:
{
  "latex_content": string,
  "choices": [string, string, string, string],
  "correct_index": number,
  "solution_latex": string,
  "difficulty": number
}

Rules:
- Generate exactly 4 problems.
- choices: 4 strings each wrapped in $...$. Traps and distractors should be plausible.
- solution_latex: use \\begin{aligned}...\\end{aligned} with &= and \\\\ between each step. Never chain equalities on one line.
- difficulty: 3 or 4 for each problem.
- All LaTeX valid KaTeX. \\\\ for line breaks. No markdown. Return raw JSON only.`;

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
    .select("id, label, description")
    .eq("id", keyword_id)
    .single();

  if (!kw) {
    return NextResponse.json({ error: `Keyword not found: ${keyword_id}` }, { status: 404 });
  }

  if (!force) {
    const { data: existing } = await supabase
      .from("learn_mastery_quiz_problems")
      .select("id")
      .eq("keyword_id", keyword_id)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ status: "exists", count: existing.length });
    }
  }

  const userPrompt = `Keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? "(none)"}`;

  let parsed: { problems: unknown[] };
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
    console.error("mastery-quiz generation error:", err);
    return NextResponse.json({ error: "OpenAI generation failed" }, { status: 500 });
  }

  if (!Array.isArray(parsed.problems) || parsed.problems.length === 0) {
    return NextResponse.json({ error: "Invalid problems from model" }, { status: 500 });
  }

  type QuizRow = {
    latex_content: string;
    choices: string[];
    correct_index: number;
    solution_latex: string;
    difficulty?: number;
  };

  const rows = (parsed.problems as QuizRow[]).map((p) => ({
    keyword_id,
    latex_content: p.latex_content,
    choices: p.choices,
    correct_index: p.correct_index,
    solution_latex: p.solution_latex ?? "",
    difficulty: p.difficulty ?? 3,
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from("learn_mastery_quiz_problems")
    .insert(rows)
    .select("id");

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: "generated", count: inserted?.length ?? 0 });
}
