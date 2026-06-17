import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { assembleChoices } from "@/lib/assembleChoices";

const SYSTEM_PROMPT = `You are a math assessment author. Generate a short mastery quiz for a specific keyword skill.

Mastery quiz questions should:
- Be difficulty 3-4 (genuine understanding, not pattern-matching)
- Include at least one question in an unfamiliar presentation of the rule
- Test whether the student can apply the rule, not just recognize it

Return exactly one JSON object: { "problems": [ QuizProb, ... ] }

Each QuizProb:
{
  "latex_content": string,
  "solution_latex": string,
  "correct_answer": string,
  "distractors": [string, string, string],
  "difficulty": number
}

OUTPUT ORDER — mandatory: write latex_content, THEN solution_latex (work the problem fully to a final answer), THEN copy that final answer verbatim into correct_answer, THEN write distractors. Never decide the answer before finishing solution_latex.

DELIMITERS (mandatory): every math expression in EVERY field (latex_content, solution_latex, correct_answer, distractors) MUST be wrapped in $...$ (inline) or $$...$$ (block). Bare LaTeX outside delimiters does NOT render — it shows literal backslashes.
  ✅ CORRECT (block): "$$\\begin{aligned} 6y &= 30 \\\\ y &= 5 \\end{aligned}$$"
  ❌ WRONG (bare): "\\begin{aligned} ... \\end{aligned}" or "\\frac{a}{b}" without $...$.

Rules:
- Generate exactly 4 problems.
- solution_latex: a $$\\begin{aligned}...\\end{aligned}$$ block with &= and \\\\ between each step (the WHOLE block wrapped in $$...$$). Never chain equalities on one line.
- correct_answer: EXACTLY the final answer solution_latex concluded, wrapped in $...$. The app makes this the correct choice — it MUST match the solution.
- distractors: exactly 3 strings each wrapped in $...$, all different from correct_answer. Traps and distractors should be plausible.
- Do NOT output a "choices" array or a "correct_index"; the app assembles and randomizes them.
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
    console.error("mastery-quiz generation error:", err);
    return NextResponse.json({ error: "OpenAI generation failed" }, { status: 500 });
  }

  if (!Array.isArray(parsed.problems) || parsed.problems.length === 0) {
    return NextResponse.json({ error: "Invalid problems from model" }, { status: 500 });
  }

  type QuizRow = {
    latex_content: string;
    correct_answer?: string;
    distractors?: string[];
    solution_latex: string;
    difficulty?: number;
  };

  // Assemble choices in code: correct choice = solution's answer at a random index.
  const rows = (parsed.problems as QuizRow[])
    .map((p) => {
      const assembled = assembleChoices(p.correct_answer, p.distractors);
      if (!assembled) return null;
      return {
        keyword_id,
        latex_content: p.latex_content,
        choices: assembled.choices,
        correct_index: assembled.correct_index,
        solution_latex: p.solution_latex ?? "",
        difficulty: p.difficulty ?? 3,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid quiz problems assembled from model output" }, { status: 502 });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("learn_mastery_quiz_problems")
    .insert(rows)
    .select("id");

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: "generated", count: inserted?.length ?? 0 });
}
