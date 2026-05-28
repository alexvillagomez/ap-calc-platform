import OpenAI from "openai";

export interface GeneratedMCQ {
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
  difficulty: number;
  keyword_weights?: Record<string, number>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ProblemPlan = {
  problem_description: string;
  expression_plain: string;
  correct_working: string[];
  correct_answer_plain: string;
  difficulty: number;
};

type MisconceptionEntry = {
  id: string;
  misconception: string;
  wrong_answer_plain: string;
};

// ─── Prompts (verbatim from admin app) ───────────────────────────────────────

const PROBLEM_PLANNER_SYSTEM = `You are a precalculus problem designer. Your ONLY job is to choose an expression and work out the correct answer step by step. Do NOT generate distractors or wrong answers.

PRECALCULUS SCOPE: algebra, exponent rules, radicals, polynomials, rational expressions, functions and their properties, transformations, inverses, piecewise functions, exponential and logarithmic functions, trigonometric functions and identities, conic sections. NO derivatives, NO integrals, NO limits, NO calculus.

Output JSON only. Plain text math notation — no LaTeX, no backslashes:
  ^ for exponents  * for multiplication  / for division  sqrt() for radicals  sin() cos() tan() log() ln()

Rules:
- Double-check every arithmetic step before writing correct_working
- correct_answer_plain must be fully simplified
- problem_description: one plain-English sentence describing the skill and expression type — no specific numbers, no LaTeX`;

const MISCONCEPTION_GENERATOR_SYSTEM = `You are a precalculus misconception analyst. Given a problem and its correct answer, generate exactly 6 specific student misconceptions.

Each misconception must:
- Describe a SPECIFIC wrong belief — the exact wrong rule or assumption the student holds
- NOT describe behavior ("student adds instead of multiplies") — describe the wrong mental model
- Be grounded in a real confusion students have about the mathematical rule
- Be distinct from every other misconception in the list

Do NOT compute wrong answers here. Only describe the misconceptions.

Output JSON only.`;

const WRONG_ANSWER_SYSTEM = `You are a mathematics error analyst. Given a problem and a specific student misconception, apply that misconception mechanically to the problem and return the exact wrong answer the student would write.

Return ONLY the final wrong answer. Plain text notation. No LaTeX. No explanation. No work shown.`;

const LATEX_FORMATTER_SYSTEM = `You are a LaTeX formatter for a PRECALCULUS assessment platform. Values are FIXED — do not change them. Format only.

Match the style of these examples exactly:

=== EXAMPLE 1: Exponent simplification ===
{
  "latex_content": "\\\\text{Simplify: } \\\\dfrac{x^{-2}(x^3)^0}{x^4}",
  "solution_latex": "\\\\text{ Use the zero exponent rule. } (x^3)^0 = 1.\\n\\n\\\\dfrac{x^{-2}(1)}{x^4} = x^{-6}.\\n\\n\\\\text{ Rewrite using positive exponents. } x^{-6} = \\\\dfrac{1}{x^6}.",
  "choices": ["$\\\\dfrac{1}{x^6}$", "$0$", "$x^2$", "$x^6$"],
  "correct_index": 0
}

=== EXAMPLE 2: Monomial multiplication ===
{
  "latex_content": "\\\\text{Simplify } (3x^2y^{-1})(2x^{-4}y^3)",
  "solution_latex": "\\\\text{ Multiply the coefficients. } 3 \\\\cdot 2 = 6.\\n\\n\\\\text{ Apply the product rule to each variable. } x^{2+(-4)} = x^{-2}, \\\\quad y^{-1+3} = y^2.\\n\\n\\\\text{ Rewrite with positive exponents. } 6x^{-2}y^2 = \\\\dfrac{6y^2}{x^2}.",
  "choices": ["$\\\\dfrac{6y^2}{x^2}$", "$6x^2y^2$", "$5xy^2$", "$\\\\dfrac{6x^6}{y^3}$"],
  "correct_index": 0
}

=== EXAMPLE 3: Logarithm evaluation ===
{
  "latex_content": "\\\\text{Evaluate } \\\\log_3(81)",
  "solution_latex": "\\\\text{ Ask: } 3 \\\\text{ to what power equals 81? } 3^4 = 81.\\n\\n\\\\log_3(81) = 4.",
  "choices": ["$4$", "$27$", "$3$", "$12$"],
  "correct_index": 0
}

From the examples above, the rules are self-evident — but to be explicit:
- latex_content: prose in \\\\text{}, math bare, no $...$, single line
- solution_latex: \\n\\n between every step; each step: \\\\text{ sentence. } math result.
- choices: each wrapped in $...$
- Spaces inside \\\\text{ }: after { and before } always
- Period after every math result; comma followed by a space`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  let out = s.toLowerCase().replace(/\s+/g, "").trim();
  out = out.replace(/\(([^)]+)\)\^?\(?-(\d+)\)?/g, "1/$1^$2");
  out = out.replace(/([a-z])\^?\(?-(\d+)\)?(?![a-z(])/g, "1/$1^$2");
  out = out.replace(/\^\((\d+)\)/g, "^$1");
  return out;
}

function dedup(pool: MisconceptionEntry[], correctAnswer: string): MisconceptionEntry[] {
  const correctNorm = normalize(correctAnswer);
  const seen = new Set<string>();
  const valid: MisconceptionEntry[] = [];
  for (const entry of pool) {
    if (!entry.wrong_answer_plain?.trim()) continue;
    const norm = normalize(entry.wrong_answer_plain);
    if (norm === correctNorm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    valid.push(entry);
  }
  return valid;
}

async function callModel(
  openai: OpenAI,
  system: string,
  user: string,
  temperature = 0.7
): Promise<Record<string, unknown> | string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature,
  });
  const text = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

async function callModelText(
  openai: OpenAI,
  system: string,
  user: string
): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
  });
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generatePrecalcMCQ(params: {
  openai: OpenAI;
  problemTypeName: string;
  problemTypeDescription: string;
  targetDifficulty?: number;
  previousExpressions?: string[];
  correctIndex?: number;
}): Promise<GeneratedMCQ | null> {
  const {
    openai,
    problemTypeName,
    problemTypeDescription,
    targetDifficulty = 2,
    previousExpressions,
    correctIndex: providedCorrectIndex,
  } = params;

  const correctIndex = providedCorrectIndex ?? Math.floor(Math.random() * 4);

  try {
    // ── Pass 1: Problem Planner ──────────────────────────────────────────────
    const avoidBlock = previousExpressions?.length
      ? `\nAVOID REPEATING — these expressions were already used:\n${previousExpressions.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}\nChoose a clearly different structure.\n`
      : "";

    const plannerUser = `COURSE: Precalculus (no calculus, no derivatives, no integrals, no limits)

Problem type: ${problemTypeName}
Description: ${problemTypeDescription}
Target difficulty: ${targetDifficulty}/5
${avoidBlock}
Return this exact JSON:

{
  "problem_description": "One plain-English sentence: the skill AND the type of expressions involved (e.g. 'trigonometric functions', 'rational expression', 'polynomial'). No specific numbers, no LaTeX.",
  "expression_plain": "The full expression or equation in plain notation",
  "correct_working": [
    "Step 1: which rule, applied to what, gives what",
    "Step 2: arithmetic shown explicitly",
    "Step 3: final simplified result"
  ],
  "correct_answer_plain": "Fully simplified correct answer",
  "difficulty": ${targetDifficulty}
}`;

    const planRaw = await callModel(openai, PROBLEM_PLANNER_SYSTEM, plannerUser, 0.9) as Record<string, unknown>;

    const plan: ProblemPlan = {
      problem_description: String(planRaw.problem_description ?? ""),
      expression_plain: String(planRaw.expression_plain ?? ""),
      correct_working: Array.isArray(planRaw.correct_working)
        ? (planRaw.correct_working as unknown[]).map(String)
        : [],
      correct_answer_plain: String(planRaw.correct_answer_plain ?? ""),
      difficulty: Number(planRaw.difficulty ?? targetDifficulty),
    };

    if (!plan.expression_plain || !plan.correct_answer_plain) return null;

    // ── Pass 2: Misconception Generator ─────────────────────────────────────
    const misconceptionUser = `Problem type: ${problemTypeName}
Problem: ${plan.expression_plain}
Correct answer: ${plan.correct_answer_plain}

Generate exactly 6 misconceptions students commonly hold that would lead them to a wrong answer on this problem.

Return this JSON:
{
  "misconceptions": [
    "Misconception 1: the specific wrong belief",
    "Misconception 2: another distinct wrong belief",
    "Misconception 3: ...",
    "Misconception 4: ...",
    "Misconception 5: ...",
    "Misconception 6: ..."
  ]
}`;

    const misconceptionRaw = await callModel(openai, MISCONCEPTION_GENERATOR_SYSTEM, misconceptionUser, 0.7) as Record<string, unknown>;
    const misconceptions: string[] = Array.isArray(misconceptionRaw.misconceptions)
      ? (misconceptionRaw.misconceptions as unknown[]).map(String)
      : [];

    if (misconceptions.length === 0) return null;

    // ── Pass 2b: Wrong Answer Deriver (parallel) ─────────────────────────────
    const wrongAnswerPromises = misconceptions.map((m, i) =>
      callModelText(
        openai,
        WRONG_ANSWER_SYSTEM,
        `Given the problem: ${plan.expression_plain}

Given the misconception: ${m}

Write the exact incorrect final answer a student would likely put on their paper if they used that misconception.

Return only the incorrect final answer. Do not explain.`
      ).then((answer): MisconceptionEntry => ({
        id: `m${i}`,
        misconception: m,
        wrong_answer_plain: answer,
      }))
    );

    const pool = await Promise.all(wrongAnswerPromises);
    const validPool = dedup(pool, plan.correct_answer_plain);

    if (validPool.length < 3) return null;

    // Pick first 3 valid distractors (simple selection for student app)
    const selectedDistractors = validPool.slice(0, 3);

    // ── Pass 3: LaTeX Formatter ──────────────────────────────────────────────
    const choiceLabels: string[] = [];
    let wrongIdx = 0;
    for (let i = 0; i < 4; i++) {
      if (i === correctIndex) {
        choiceLabels.push(`[CORRECT] ${plan.correct_answer_plain}`);
      } else {
        choiceLabels.push(`[WRONG ${wrongIdx + 1}] ${selectedDistractors[wrongIdx]?.wrong_answer_plain ?? "?"}`);
        wrongIdx++;
      }
    }

    const distractorBlock = selectedDistractors
      .map((d, i) => `Wrong answer ${i + 1}: "${d.wrong_answer_plain}"\n  Misconception: ${d.misconception}`)
      .join("\n\n");

    const workingBlock = plan.correct_working.map((s, i) => `  ${i + 1}. ${s}`).join("\n");

    const schemaBlock = `{
  "latex_content": string,
  "solution_latex": string,
  "choices": [string, string, string, string],
  "correct_index": ${correctIndex}
}`;

    const formatterUser = `Problem type: ${problemTypeName}
Description: ${plan.problem_description}
Expression: ${plan.expression_plain}
Correct answer: ${plan.correct_answer_plain}
Working:
${workingBlock}

${distractorBlock}

Choice layout — must match exactly:
${choiceLabels.map((l, i) => `  choices[${i}] = ${l}`).join("\n")}
correct_index = ${correctIndex}

Format into this schema:
${schemaBlock}

Format only. Values are fixed.

GOLD STANDARD EXAMPLE — match this exact style for solution_latex, choices, and latex_content:
{
  "latex_content": "\\\\text{Simplify: } \\\\dfrac{x^{-2}(x^3)^0}{x^4}",
  "solution_latex": "\\\\text{ Use the zero exponent rule. } (x^3)^0 = 1.\\n\\n\\\\dfrac{x^{-2}(x^3)^0}{x^4} = \\\\dfrac{x^{-2}(1)}{x^4}.\\n\\n\\\\text{ Apply the quotient rule for exponents. } \\\\dfrac{x^{-2}}{x^4} = x^{-2-4}.\\n\\nx^{-2-4} = x^{-6}.\\n\\n\\\\text{ Rewrite using positive exponents. } x^{-6} = \\\\dfrac{1}{x^6}.",
  "choices": ["$\\\\dfrac{1}{x^6}$", "$0$", "$x^2$", "$x^6$"],
  "correct_index": 0
}

Key style rules:
- latex_content: concise — "\\\\text{Simplify: } expression" or "\\\\text{Evaluate: } expression"
- solution_latex: \\n\\n between steps, spaces inside \\\\text{ }, period after each math result
- choices: always wrapped in $...$`;

    const formatterRaw = await callModel(openai, LATEX_FORMATTER_SYSTEM, formatterUser, 0.2) as Record<string, unknown>;

    const choices = Array.isArray(formatterRaw.choices) ? (formatterRaw.choices as unknown[]).map(String) : [];
    if (choices.length !== 4) return null;

    // Enforce pre-chosen correctIndex regardless of what the model returned
    const finalCorrectIndex =
      typeof formatterRaw.correct_index === "number" && formatterRaw.correct_index === correctIndex
        ? correctIndex
        : correctIndex;

    return {
      latex_content: String(formatterRaw.latex_content ?? ""),
      solution_latex: String(formatterRaw.solution_latex ?? ""),
      choices,
      correct_index: finalCorrectIndex,
      difficulty: plan.difficulty,
    };
  } catch {
    return null;
  }
}
