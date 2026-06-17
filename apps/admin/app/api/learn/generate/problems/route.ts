import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { assembleChoices } from "@/lib/assembleChoices";

const SYSTEM_PROMPT = `You are a precalculus problem author. Generate multiple-choice practice problems targeting one specific skill keyword at a specified difficulty (1-5).

Return exactly one JSON object: { "problems": [ PracticeProb, ... ] }

Each PracticeProb:
{
  "latex_content": string,
  "solution_latex": string,
  "correct_answer": string,
  "distractors": [string, string, string],
  "hint_latex": string
}

Difficulty scale:
1 = Single step, direct application, simple integers
2 = Two steps, one rule, clean arithmetic
3 = Three steps, slight variation or unfamiliar form
4 = Multi-step, trap answer included, non-obvious
5 = Complex, combines two or more rules, unusual presentation

OUTPUT ORDER — mandatory: write latex_content, THEN solution_latex (work the problem fully to a final answer), THEN copy that final answer verbatim into correct_answer, THEN write distractors. Never decide the answer before finishing solution_latex.

DELIMITERS (mandatory): every math expression in EVERY field (latex_content, solution_latex, correct_answer, distractors, hint_latex) MUST be wrapped in $...$ (inline) or $$...$$ (block). Bare LaTeX outside delimiters does NOT render — it shows literal backslashes.
  ✅ CORRECT (block): "$$\\begin{aligned} x^3\\cdot x^5 &= x^{3+5} \\\\ &= x^8 \\end{aligned}$$"
  ✅ CORRECT (inline): "Combine like terms: $4y+2y=6y$."
  ❌ WRONG (bare): "\\begin{aligned} ... \\end{aligned}" or "\\frac{a}{b}" without $...$.

Rules:
- Each problem must DIRECTLY test the keyword — not incidentally.
- solution_latex: a $$\\begin{aligned}...\\end{aligned}$$ block with &= and \\\\ between each step (the WHOLE block wrapped in $$...$$). Never chain equalities on one line.
- correct_answer: EXACTLY the final answer solution_latex concluded, wrapped in $...$. The app makes this the correct choice — it MUST match the solution.
- distractors: exactly 3 strings each wrapped in $...$, all different from correct_answer. Each must reflect a real student error for this keyword.
- Do NOT output a "choices" array or a "correct_index"; the app assembles and randomizes them.
- hint_latex: one sentence of plain text. Use $...$ for any math inline. No \\text{}.
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
    console.error("problems generation error:", err);
    return NextResponse.json({ error: "OpenAI generation failed" }, { status: 500 });
  }

  if (!Array.isArray(parsed.problems) || parsed.problems.length === 0) {
    return NextResponse.json({ error: "Invalid problems from model" }, { status: 500 });
  }

  type ProbRow = {
    latex_content: string;
    correct_answer?: string;
    distractors?: string[];
    solution_latex: string;
    hint_latex?: string;
  };

  // Assemble choices in code: the correct choice is the solution's final answer,
  // placed at a random index. Drop any problem whose choices can't be formed so
  // we never store an item whose key contradicts its solution.
  const rows = (parsed.problems as ProbRow[])
    .map((p) => {
      const assembled = assembleChoices(p.correct_answer, p.distractors);
      if (!assembled) return null;
      return {
        keyword_id,
        topic_id: kw.topic_id,
        latex_content: p.latex_content,
        solution_latex: p.solution_latex ?? "",
        choices: assembled.choices,
        correct_index: assembled.correct_index,
        difficulty,
        hint_latex: p.hint_latex ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid problems assembled from model output" }, { status: 502 });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("learn_practice_problems")
    .insert(rows)
    .select("id");

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: "generated", count: inserted?.length ?? 0, ids: inserted?.map((r) => r.id) });
}
