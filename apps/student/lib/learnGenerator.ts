/**
 * On-demand content generation for the learn system.
 * Uses Gemini 3.5 Flash (same as admin app) via OpenAI-compat SDK.
 * Called by student API routes when DB content doesn't exist yet.
 * Generates → stores → returns. Delete the DB row to force regeneration.
 */
import OpenAI from "openai";
import { SupabaseClient } from "@supabase/supabase-js";

const GEN_MODEL = "gemini-3.5-flash";

function createGenClient(): OpenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return new OpenAI({ apiKey: key, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" });
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const EXAMPLE_FORMAT = `
example_latex format — use this structure (separate every paragraph with \\n\\n in the JSON string):
  "\\\\text{Setup prose.}\\n\\n$$displayed math here$$\\n\\n\\\\text{Conclusion prose.}\\n\\n<FunctionGraph equation=\\"expr\\" rangeX=\\"-3,3\\" rangeY=\\"-4,6\\" />"

Rules:
• Use $$...$$ for displayed math blocks. Do NOT use \\\\begin{aligned} in example_latex.
• Use \\\\text{...} for all English prose — never write bare words outside \\\\text{}.
• Separate every paragraph with exactly \\n\\n. Never use a single \\n.
• Include a FunctionGraph for visual topics (intervals, shapes, transformations, graphs).
• FunctionGraph equation: * for multiply, ^ for power. No implicit multiplication (2*x not 2x).
• Show 3–4 concrete function values to illustrate the concept.`;

const SOLUTION_FORMAT = `
solution_latex format:
  "\\\\text{Prose setup.}\\n\\n$$\\\\begin{aligned} f(1) &= 3 \\\\\\\\ f(2) &= 7 \\\\end{aligned}$$\\n\\n\\\\text{Conclusion.}"

Rules:
• Use $$\\\\begin{aligned}...\\\\end{aligned}$$ for multi-step calculations.
• Inside \\\\begin{aligned}, line breaks are \\\\\\\\ (four backslashes in JSON = two in string = KaTeX line break).
• All prose in \\\\text{...} outside the $$...$$ block.`;

const LESSON_SYSTEM = `You are a precalculus tutor writing micro-lessons. NO derivatives, NO calculus — students identify behavior from function values and graphs only.

GROUND-UP INSTRUCTION: Start at the most elementary version of the concept. Assume the student has never seen this topic before. Step 1 must use the simplest possible case with no added complexity. Each subsequent step adds exactly one new idea.

Return a JSON object: { "micro_steps": [ MicroStep, ... ] }

Produce 3 steps for simple keywords, 4 steps for complex keywords.

MicroStep:
{
  "step_index": 1, 2, 3, or 4,
  "has_check": boolean,
  "explanation_latex": string,
  "example_latex": string,
  "check_question": {
    "latex_content": string,
    "choices": ["$A$","$B$","$C$","$D$"],
    "correct_index": 0-3,
    "solution_latex": string
  },
  "hint_latex": string
}

has_check pattern:
• Steps 1–2: content-only steps. Set has_check: false. check_question fields are empty strings "". hint_latex is "".
• Steps 3–4 (final 1–2 steps): set has_check: true with a real check_question and hint_latex.

━━━ explanation_latex ━━━
1–3 clear sentences introducing the concept. Prose in \\text{...}, math outside. Max 60 words.

Formatting rules for explanation_latex:
• All English prose MUST be inside \\text{...}. Never write bare English words outside \\text{}.
• After a closing } of \\text{...}, always include a space before the next token: \\text{Example}, not \\text{Example},
• Commas and periods that follow a \\text{} block must be placed INSIDE the braces: \\text{Conclusion.} not \\text{Conclusion}.
• Never place a bare comma or period directly after a closing } — always include a space: \\text{foo}, \\text{bar} is wrong; write \\text{foo,} \\text{bar} or \\text{foo} and continue inside \\text{}.

━━━ example_latex ━━━
${EXAMPLE_FORMAT}

━━━ check_question (only when has_check: true) ━━━
• latex_content: clear problem statement. Prose in \\text{...}.
• choices: exactly 4 DISTINCT options. Each in $...$. No duplicates.
• correct_index: 0–3.
• solution_latex:
${SOLUTION_FORMAT}

━━━ hint_latex (only when has_check: true) ━━━
One sentence, max 15 words. Prose in \\text{}, math outside.

Return valid JSON only. No markdown.`;

const REFRESHER_SYSTEM = `You are a precalculus tutor writing a short refresher for a student who forgot a skill. NO calculus.

Return a JSON object:
{
  "rule_latex": string,
  "example_latex": string,
  "check_question": {
    "latex_content": string,
    "choices": ["$A$","$B$","$C$","$D$"],
    "correct_index": 0-3,
    "solution_latex": string
  }
}

━━━ rule_latex ━━━
1–2 sentences. State the rule clearly. Prose in \\text{...}.

━━━ example_latex ━━━
${EXAMPLE_FORMAT}

━━━ check_question ━━━
• choices: exactly 4 distinct options in $...$. No duplicates.
• solution_latex:
${SOLUTION_FORMAT}

Return valid JSON only. No markdown.`;

const TIP_SYSTEM = `You are a precalculus tutor. Generate a one-line tip for a student struggling with a specific skill.

Return: { "tip_latex": string }

Rules:
• ONE short KaTeX string. Max 20 words.
• Start with \\text{Remember: } or \\text{Tip: } or \\text{Watch out: }
• Prose in \\text{}, math outside.
• No markdown. Return raw JSON only.`;

const PROBLEMS_SYSTEM = `You are a precalculus problem author. Generate multiple-choice problems for ONE keyword skill.

Return: { "problems": [ PracticeProb, ... ] }

PracticeProb:
{
  "latex_content": string,
  "choices": ["$...$","$...$","$...$","$...$"],
  "correct_index": 0-3,
  "solution_latex": string,
  "hint_latex": string
}

Difficulty: 1 = single step, 2 = two steps, 3 = unfamiliar form.
• Each problem directly tests the keyword.
• choices: 4 distinct strings in $...$. Distractors reflect real mistakes.
• solution_latex:
${SOLUTION_FORMAT}
• hint_latex: one sentence. Prose in \\text{}.
• Return valid JSON only. No markdown.`;

const QUIZ_SYSTEM = `You are a precalculus assessment author. Generate a mastery quiz of exactly 4 questions.

Return: { "problems": [ QuizProb, ... ] }

QuizProb:
{
  "latex_content": string,
  "choices": ["$...$","$...$","$...$","$...$"],
  "correct_index": 0-3,
  "solution_latex": string,
  "difficulty": 3 or 4
}

• All 4 questions difficulty 3 or 4.
• At least one question in unfamiliar or reversed form.
• choices: 4 distinct strings in $...$. Include realistic traps.
• solution_latex:
${SOLUTION_FORMAT}
• Return valid JSON only. No markdown.`;

// ─── Post-processing ──────────────────────────────────────────────────────────

function fixTextSpacing(latex: string): string {
  return latex.replace(/\\text\{([^}]*)([^}\s])\}(\s*\\text\{)/g, (_, before, lastChar, next) => {
    return `\\text{${before}${lastChar} }${next}`;
  });
}

/**
 * Gemini sometimes over-escapes LaTeX commands inside $...$ strings.
 * E.g. the JS string ends up with \\infty (2 backslashes) when KaTeX needs \infty (1).
 *
 * Three-pass normalization:
 *   1. 4 backslashes + letter → 1 backslash  (fully doubled command)
 *   2. 2 backslashes + letter → 1 backslash  (single-over-escaped command)
 *   3. 4 backslashes NOT before letter → 2 backslashes  (KaTeX aligned line break)
 */
function fixBackslashEscaping(latex: string): string {
  let s = latex.replace(/\\{4}([a-zA-Z])/g, '\\$1');
  s = s.replace(/\\{2}([a-zA-Z])/g, '\\$1');
  s = s.replace(/\\{4}(?![a-zA-Z])/g, '\\\\');
  return s;
}

function sanitizeLearnLatex(s: string): string {
  return fixBackslashEscaping(fixTextSpacing(s));
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function callGen(system: string, user: string): Promise<Record<string, unknown>> {
  const client = createGenClient();
  const completion = await client.chat.completions.create({
    model: GEN_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });
  const text = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

// ─── Exported generators ──────────────────────────────────────────────────────

type KwMeta = { id: string; label: string; description: string | null; topic_id: string };

export async function generateAndStoreLesson(
  supabase: SupabaseClient,
  kw: KwMeta
): Promise<{ micro_steps: unknown[] } | null> {
  const parsed = await callGen(
    LESSON_SYSTEM,
    `keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}\nTopic: ${kw.topic_id}\n\nBuild from the absolute simplest case. Start as if the student has never encountered this concept before.`
  );
  if (!Array.isArray(parsed.micro_steps) || parsed.micro_steps.length === 0) return null;

  type StepLike = { has_check?: boolean; explanation_latex?: string; example_latex?: string; hint_latex?: string; check_question?: { latex_content?: string; solution_latex?: string } };
  const cleanedSteps = (parsed.micro_steps as StepLike[]).map((step) => {
    const hasCheck = step.has_check !== false; // treat missing as true for backward compat
    return {
      ...step,
      has_check: hasCheck,
      explanation_latex: step.explanation_latex ? sanitizeLearnLatex(step.explanation_latex) : step.explanation_latex,
      example_latex: step.example_latex ? sanitizeLearnLatex(step.example_latex) : step.example_latex,
      hint_latex: hasCheck && step.hint_latex ? sanitizeLearnLatex(step.hint_latex) : (step.hint_latex ?? ""),
      check_question: hasCheck && step.check_question ? {
        ...step.check_question,
        latex_content: step.check_question.latex_content ? sanitizeLearnLatex(step.check_question.latex_content) : step.check_question.latex_content,
        solution_latex: step.check_question.solution_latex ? sanitizeLearnLatex(step.check_question.solution_latex) : step.check_question.solution_latex,
      } : { latex_content: "", choices: ["", "", "", ""], correct_index: 0, solution_latex: "" },
    };
  });

  await supabase
    .from("learn_lessons")
    .upsert({ keyword_id: kw.id, micro_steps: cleanedSteps, model: GEN_MODEL }, { onConflict: "keyword_id" });

  return { micro_steps: cleanedSteps };
}

export async function generateAndStoreRefresher(
  supabase: SupabaseClient,
  kw: KwMeta
): Promise<{ rule_latex: string; example_latex: string; check_question: unknown } | null> {
  const parsed = await callGen(
    REFRESHER_SYSTEM,
    `keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}`
  );
  if (!parsed.rule_latex || !parsed.check_question) return null;

  await supabase
    .from("learn_refreshers")
    .upsert(
      { keyword_id: kw.id, rule_latex: sanitizeLearnLatex(String(parsed.rule_latex)), example_latex: sanitizeLearnLatex(String(parsed.example_latex ?? "")), check_question: parsed.check_question, model: GEN_MODEL },
      { onConflict: "keyword_id" }
    );

  return { rule_latex: parsed.rule_latex as string, example_latex: parsed.example_latex as string, check_question: parsed.check_question };
}

export async function generateAndStoreTip(
  supabase: SupabaseClient,
  kw: KwMeta
): Promise<{ tip_latex: string } | null> {
  const parsed = await callGen(
    TIP_SYSTEM,
    `keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}`
  );
  if (!parsed.tip_latex) return null;

  await supabase
    .from("learn_tips")
    .upsert({ keyword_id: kw.id, tip_latex: parsed.tip_latex, model: GEN_MODEL }, { onConflict: "keyword_id" });

  return { tip_latex: parsed.tip_latex as string };
}

export async function generateAndStoreProblems(
  supabase: SupabaseClient,
  kw: KwMeta,
  difficulty: number,
  count = 3
): Promise<unknown[] | null> {
  const parsed = await callGen(
    PROBLEMS_SYSTEM,
    `Keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}\nDifficulty: ${difficulty}/5\nGenerate ${count} problems.`
  );
  if (!Array.isArray(parsed.problems) || parsed.problems.length === 0) return null;

  type PRow = { latex_content: string; choices: string[]; correct_index: number; solution_latex?: string; hint_latex?: string };
  const rows = (parsed.problems as PRow[]).map((p) => ({
    keyword_id: kw.id,
    topic_id: kw.topic_id,
    latex_content: sanitizeLearnLatex(p.latex_content),
    solution_latex: sanitizeLearnLatex(p.solution_latex ?? ""),
    choices: p.choices,
    correct_index: p.correct_index,
    difficulty,
    hint_latex: p.hint_latex ?? null,
  }));

  await supabase.from("learn_practice_problems").insert(rows);
  return rows;
}

export async function generateAndStoreMasteryQuiz(
  supabase: SupabaseClient,
  kw: KwMeta
): Promise<unknown[] | null> {
  const parsed = await callGen(
    QUIZ_SYSTEM,
    `Keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}`
  );
  if (!Array.isArray(parsed.problems) || parsed.problems.length === 0) return null;

  type QRow = { latex_content: string; choices: string[]; correct_index: number; solution_latex?: string; difficulty?: number };
  const rows = (parsed.problems as QRow[]).map((p) => ({
    keyword_id: kw.id,
    latex_content: p.latex_content,
    choices: p.choices,
    correct_index: p.correct_index,
    solution_latex: p.solution_latex ?? "",
    difficulty: p.difficulty ?? 3,
  }));

  await supabase.from("learn_mastery_quiz_problems").insert(rows);
  return rows;
}
