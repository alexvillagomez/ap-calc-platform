import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const SYSTEM_PROMPT = `You are a precalculus problem author. Generate multiple-choice practice problems targeting one specific skill keyword at a specified difficulty (1-5).

Return exactly one JSON object: { "problems": [ PracticeProb, ... ] }

Each PracticeProb:
{
  "latex_content": string,
  "choices": [string, string, string, string],
  "correct_index": number,
  "solution_latex": string,
  "hint_latex": string
}

Difficulty scale:
1 = Single step, direct application, simple integers
2 = Two steps, one rule, clean arithmetic
3 = Three steps, slight variation or unfamiliar form
4 = Multi-step, trap answer included, non-obvious
5 = Complex, combines two or more rules, unusual presentation

Rules:
- Each problem must DIRECTLY test the keyword — not incidentally.
- choices: exactly 4 strings each wrapped in $...$. Distractors must reflect real student errors for this keyword.
- correct_index: 0-3.
- solution_latex: use \\begin{aligned}...\\end{aligned} with &= and \\\\ between each step. Never chain equalities on one line.
- hint_latex: one sentence. What to think about when stuck. Prose in \\text{}.
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

  const body = (await request.json()) as {
    keyword_id: string;
    difficulty: number;
    count?: number;
  };

  const { keyword_id, difficulty, count = 3 } = body;

  if (!keyword_id || !difficulty) {
    return NextResponse.json({ error: "keyword_id and difficulty required" }, { status: 400 });
  }
  if (difficulty < 1 || difficulty > 5) {
    return NextResponse.json({ error: "difficulty must be 1-5" }, { status: 400 });
  }

  const { data: kw } = await supabase
    .from("learn_keywords")
    .select("id, label, description, topic_id")
    .eq("id", keyword_id)
    .single();

  if (!kw) {
    return NextResponse.json({ error: `Keyword not found: ${keyword_id}` }, { status: 404 });
  }

  const userPrompt = `Keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? "(none)"}\nDifficulty: ${difficulty}/5\nGenerate ${count} problems.`;

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
    console.error("problems generation error:", err);
    return NextResponse.json({ error: "OpenAI generation failed" }, { status: 500 });
  }

  if (!Array.isArray(parsed.problems) || parsed.problems.length === 0) {
    return NextResponse.json({ error: "Invalid problems from model" }, { status: 500 });
  }

  type ProbRow = {
    latex_content: string;
    choices: string[];
    correct_index: number;
    solution_latex: string;
    hint_latex?: string;
  };

  const rows = (parsed.problems as ProbRow[]).map((p) => ({
    keyword_id,
    topic_id: kw.topic_id,
    latex_content: p.latex_content,
    solution_latex: p.solution_latex ?? "",
    choices: p.choices,
    correct_index: p.correct_index,
    difficulty,
    hint_latex: p.hint_latex ?? null,
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from("learn_practice_problems")
    .insert(rows)
    .select("id");

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: "generated", count: inserted?.length ?? 0, ids: inserted?.map((r) => r.id) });
}
