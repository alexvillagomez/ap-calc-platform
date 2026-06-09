/**
 * On-demand content generation for the learn system.
 * Uses Gemini 3.5 Flash (same as admin app) via OpenAI-compat SDK.
 * Called by student API routes when DB content doesn't exist yet.
 * Generates → stores → returns. Delete the DB row to force regeneration.
 */
import OpenAI from "openai";
import { SupabaseClient } from "@supabase/supabase-js";

const GEN_MODEL = "gpt-5.4-mini";

function createGenClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey: key });
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

// Universal format: plain-text prose with every expression inline in $...$.
// You do NOT need \n\n or \text{} — just write it the way you'd write it on paper.
const FORMAT_RULES = `FORMATTING:
• Write prose as PLAIN TEXT — never use \\\\text{}.
• Wrap every variable, symbol, or expression in $...$, e.g. "Use $A^2-B^2=(A-B)(A+B)$ with $A=m^2n$ and $B=4$."
• Plain-text prose must contain no backslash, ^, _, or { } — anything that needs them goes inside $...$.`;

// Worked-example / solution illustration, in the universal format.
const WORKED_EXAMPLE = `"Recognize each term as a square. $m^4n^2=(m^2n)^2$ because squaring $m^2n$ gives $m^4n^2$. Also $16=4^2$. Use $A^2-B^2=(A-B)(A+B)$ with $A=m^2n$ and $B=4$, so $m^4n^2-16=(m^2n-4)(m^2n+4)$."`;

const EXAMPLE_FORMAT = `
example_latex format — a worked example showing every step, plain text with math in $...$:
  ${WORKED_EXAMPLE}

${FORMAT_RULES}
• Show every intermediate step — never jump from the problem straight to the answer.
• Only include a FunctionGraph when a picture genuinely helps (graphing a function, transformations, intervals, end behavior, shape). For purely algebraic skills (expanding, FOIL, factoring, simplifying, solving) do NOT include a graph — it adds nothing.
• FunctionGraph (only when used): * for multiply, ^ for power, no implicit multiplication (2*x not 2x): <FunctionGraph equation=\\"expr\\" rangeX=\\"-3,3\\" rangeY=\\"-4,6\\" />`;

const SOLUTION_FORMAT = `
solution_latex format — the worked solution showing every step, plain text with math in $...$:
  ${WORKED_EXAMPLE}

${FORMAT_RULES}`;

const LESSON_SYSTEM = `You are a precalculus tutor writing micro-lessons. NO derivatives, NO calculus — students identify behavior from function values and graphs only.

GROUND-UP INSTRUCTION: Start at the most elementary version of the concept. Assume the student has NEVER seen this topic before. Think carefully about what such a student would find confusing. Step 1 must use the SIMPLEST possible case — single-term, no edge cases, minimal complexity. Each subsequent step adds exactly one new idea and explicitly references what was learned in the previous step.

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
• ALL steps have has_check: true. Every step includes a real check_question and hint_latex.
• Step 1 check: easy — confirm the student understood the most basic idea just introduced.
• Step 2 check: medium — apply the idea from step 1 in a slightly different form.
• Steps 3–4 check: harder — require genuine understanding, not just recognition.

━━━ explanation_latex ━━━
2–4 clear sentences introducing the concept. Max 90 words.
• If the skill has a standard named method or mnemonic, NAME it explicitly and unpack what each part means. For multiplying two binomials, name and teach FOIL — First, Outer, Inner, Last — and explain that it is just the distributive property applied so that every term in the first binomial multiplies every term in the second. Do not merely state the rule; explain WHY it works.
• Steps 2–4 MUST begin with a sentence that explicitly connects to the previous step (e.g. "Now that we know X, we can ...").
• Explain the WHY behind the concept, not just the procedure.

Formatting rules for explanation_latex:
${FORMAT_RULES}

━━━ example_latex ━━━
${EXAMPLE_FORMAT}
• After showing the computation, add a sentence of reasoning that explains WHY the result is what it is — connect the answer back to the concept.

━━━ check_question (every step has one) ━━━
• latex_content: clear problem statement as plain text with math in $...$, e.g. "A student claims $x=-2$ solves $x^3+2x^2-5x-6=0$. Is the student correct?" Never use \\text{}.
• choices: exactly 4 DISTINCT options. Each in $...$. No duplicates.
• correct_index: 0–3.
• DISTRACTORS MUST reflect realistic student mistakes — each wrong choice should correspond to a specific common error (e.g. off-by-one, sign error, wrong operation, forgetting a rule). Do NOT use random or implausible values.
• solution_latex:
${SOLUTION_FORMAT}

━━━ hint_latex (every step) ━━━
One sentence, max 15 words. Plain text, math in $...$ (never \\text{}). Guide the student toward the correct approach without giving it away.

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
1–2 sentences. State the rule clearly as plain text, math in $...$ (never \\text{}).

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
• ONE short line. Max 20 words.
• Start with "Remember: ", "Tip: ", or "Watch out: " as plain text.
• Write prose as PLAIN TEXT — never use \\text{}. Put any math inside $...$.
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
• latex_content: full problem statement as PLAIN TEXT with all math in $...$, e.g. "Expand and simplify: $(x-4)(x+2)$." or "A student claims $x=-2$ solves $x^3+2x^2-5x-6=0$. Is the student correct?" Never use \\\\text{} — write words as plain text and wrap only math in $...$.
• choices: 4 distinct strings in $...$. Distractors reflect real mistakes.
• solution_latex:
${SOLUTION_FORMAT}
• hint_latex: one sentence as plain text with math in $...$. Never use \\\\text{}.
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
• latex_content: plain text with all math in $...$, e.g. "A student claims $x=-2$ solves $x^3+2x^2-5x-6=0$. Is the student correct?" Never use \\\\text{}.
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

/**
 * Fix \text{ that was corrupted by JSON tab-escape expansion.
 * When an LLM outputs \text{ with a single backslash in JSON, the JSON parser
 * interprets \t as a literal tab character (U+0009), yielding "<TAB>ext{...}".
 * KaTeX then renders "extExpand..." instead of the intended instruction text.
 * This sanitizer replaces every occurrence of <TAB>ext{ with \text{.
 */
function fixTabCorruptedText(s: string): string {
  // \t in a JS regex character class is a literal tab (U+0009)
  return s.replace(/\text\{/g, "\\text{");
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

type KwMeta = { id: string; label: string; description: string | null; category_id: string };

export async function generateAndStoreLesson(
  supabase: SupabaseClient,
  kw: KwMeta
): Promise<{ micro_steps: unknown[] } | null> {
  const parsed = await callGen(
    LESSON_SYSTEM,
    `Keyword ID: ${kw.id}
Label: ${kw.label}
Topic/Category: ${kw.category_id}

Concept description (read carefully — this defines the exact skill to teach):
${kw.description ?? "(none provided)"}

Think carefully about what a student who has NEVER seen this concept before would find confusing. Build from the absolute simplest case. Step 1 must be a single, minimal example with no edge cases. Every step must have a check question.`
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
    topic_id: kw.category_id,
    // fixTabCorruptedText runs first: repairs <TAB>ext{ → \text{ before the
    // backslash-normalisation pass in sanitizeLearnLatex.
    latex_content: sanitizeLearnLatex(fixTabCorruptedText(p.latex_content)),
    solution_latex: sanitizeLearnLatex(fixTabCorruptedText(p.solution_latex ?? "")),
    choices: p.choices.map((c) => fixTabCorruptedText(c)),
    correct_index: p.correct_index,
    difficulty,
    hint_latex: p.hint_latex ? fixTabCorruptedText(p.hint_latex) : null,
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
