/**
 * Multi-pass precalc MCQ generation.
 *
 * Pass 1 — Problem Planner: designs the problem and correct answer only. No distractors.
 * Pass 2 — Misconception Generator: given the problem, outputs 6 named misconceptions (descriptions only).
 * Pass 2b — Wrong Answer Deriver: one targeted LLM call per misconception (run in parallel).
 *   Prompt: "Given the problem: X / Given the misconception: Y / Return only the wrong answer."
 * Pool validation: strips entries that equal the correct answer or duplicate each other.
 * Selection: picks 3 from the validated pool, weighted by least-used (batch diversity).
 * Pass 3 — LaTeX Formatter: formats the 3 selected distractors into the full MCQ JSON.
 */

import { DIFFICULTY_SCALE } from "./examPrepConstants";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProblemPlan = {
  problem_description: string;
  expression_plain: string;
  correct_working: string[];
  correct_answer_plain: string;
  difficulty: number;
};

export type MisconceptionEntry = {
  id: string;                  // stable key: "m0"..."m5"
  misconception: string;       // named wrong belief description
  wrong_answer_plain: string;  // exact wrong answer the student would write
};

export type DistractorPool = MisconceptionEntry[];

// ─── Pool validation ──────────────────────────────────────────────────────────

function normalize(s: string): string {
  let out = s.toLowerCase().replace(/\s+/g, "").trim();
  // Canonicalize a^(-n) === 1/a^n
  out = out.replace(/\(([^)]+)\)\^?\(?-(\d+)\)?/g, "1/$1^$2");
  out = out.replace(/([a-z])\^?\(?-(\d+)\)?(?![a-z(])/g, "1/$1^$2");
  // a^(n) === a^n
  out = out.replace(/\^\((\d+)\)/g, "^$1");
  return out;
}

/** Remove pool entries that equal the correct answer or duplicate each other. */
export function validatePool(pool: DistractorPool, correctAnswer: string): DistractorPool {
  const correctNorm = normalize(correctAnswer);
  const seen = new Set<string>();
  const valid: DistractorPool = [];
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

// ─── Pool selection (usage-weighted) ─────────────────────────────────────────

/**
 * Pick `count` entries from the pool. Entries used less often get priority.
 * usageCounts maps entry.id → number of times selected so far in this batch.
 * Ties broken by a small random jitter so different students get variety.
 */
export function selectFromPool(
  pool: DistractorPool,
  usageCounts: Map<string, number>,
  count: number = 3
): DistractorPool {
  if (pool.length <= count) return [...pool];
  const scored = pool.map((entry) => ({
    entry,
    score: (usageCounts.get(entry.id) ?? 0) + Math.random() * 0.4,
  }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, count).map((s) => s.entry);
}

// ─── Pass 1: Problem Planner ──────────────────────────────────────────────────

export const PROBLEM_PLANNER_SYSTEM = `You are a precalculus problem designer. Your ONLY job is to choose an expression and work out the correct answer step by step. Do NOT generate distractors or wrong answers.

PRECALCULUS SCOPE: algebra, exponent rules, radicals, polynomials, rational expressions, functions and their properties, transformations, inverses, piecewise functions, exponential and logarithmic functions, trigonometric functions and identities, conic sections. NO derivatives, NO integrals, NO limits, NO calculus.

Output JSON only. Plain text math notation — no LaTeX, no backslashes:
  ^ for exponents  * for multiplication  / for division  sqrt() for radicals  sin() cos() tan() log() ln()

Rules:
- Double-check every arithmetic step before writing correct_working
- correct_answer_plain must be fully simplified
- problem_description: one plain-English sentence describing the skill and expression type — no specific numbers, no LaTeX`;

export function buildProblemPlannerPrompt(args: {
  problemTypeName: string;
  problemTypeDescription: string;
  varietyHint: string;
  targetDifficulty: number;
  previousExpressions?: string[];
}): string {
  const avoidBlock = args.previousExpressions?.length
    ? `\nAVOID REPEATING — these expressions were already used:\n${args.previousExpressions.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}\nChoose a clearly different structure.\n`
    : "";

  return `COURSE: Precalculus (no calculus, no derivatives, no integrals, no limits)

Problem type: ${args.problemTypeName}
Description: ${args.problemTypeDescription}
Style: ${args.varietyHint}
Target difficulty: ${args.targetDifficulty}/5
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
  "difficulty": ${args.targetDifficulty}
}

DIFFICULTY SCALE:
${DIFFICULTY_SCALE}`;
}

// ─── Pass 2: Misconception Generator ─────────────────────────────────────────

export const MISCONCEPTION_GENERATOR_SYSTEM = `You are a precalculus misconception analyst. Given a problem and its correct answer, generate exactly 6 specific student misconceptions.

Each misconception must:
- Describe a SPECIFIC wrong belief — the exact wrong rule or assumption the student holds
- NOT describe behavior ("student adds instead of multiplies") — describe the wrong mental model
- Be grounded in a real confusion students have about the mathematical rule
- Be distinct from every other misconception in the list

Do NOT compute wrong answers here. Only describe the misconceptions.

Output JSON only.`;

export function buildMisconceptionGeneratorPrompt(args: {
  expression: string;
  correctAnswer: string;
  problemTypeName: string;
}): string {
  return `Problem type: ${args.problemTypeName}
Problem: ${args.expression}
Correct answer: ${args.correctAnswer}

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
}

GOOD misconception examples:
- "Treating a zero exponent as making the expression equal 0."
- "Adding exponents across a fraction instead of subtracting denominator from numerator."
- "Applying the power rule to a sum as if (a+b)^n = a^n + b^n."
- "Forgetting that a negative exponent means reciprocal, not a negative result."

BAD misconception examples (do not write these):
- "Student makes an arithmetic error" — this is behavior, not a belief
- "I think x^0 = 0" — formula, not a description
- "Student misapplies the rule" — too vague`;
}

// ─── Pass 2b: Wrong Answer Deriver ───────────────────────────────────────────

export const WRONG_ANSWER_SYSTEM = `You are a mathematics error analyst. Given a problem and a specific student misconception, apply that misconception mechanically to the problem and return the exact wrong answer the student would write.

Return ONLY the final wrong answer. Plain text notation. No LaTeX. No explanation. No work shown.`;

export function buildWrongAnswerPrompt(args: {
  expression: string;
  correctAnswer: string;
  misconception: string;
}): string {
  return `Given the problem: ${args.expression}

Given the misconception: ${args.misconception}

Write the exact incorrect final answer a student would likely put on their paper if they used that misconception.

Return only the incorrect final answer. Do not explain.`;
}

// ─── Pass 3: LaTeX Formatter ──────────────────────────────────────────────────

export const LATEX_FORMATTER_SYSTEM = `You are a LaTeX formatter for a PRECALCULUS assessment platform. Values are FIXED — do not change them. Format only.

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

export function buildLatexFormatterUserPrompt(args: {
  problemTypeName: string;
  plan: ProblemPlan;
  selectedDistractors: MisconceptionEntry[];  // exactly 3
  correctIndex: number;
  schemaBlock: string;
}): string {
  const { plan, selectedDistractors, correctIndex } = args;

  const wrongSlots = selectedDistractors.map((d) => d.wrong_answer_plain);
  const choiceLabels: string[] = [];
  let wrongIdx = 0;
  for (let i = 0; i < 4; i++) {
    if (i === correctIndex) {
      choiceLabels.push(`[CORRECT] ${plan.correct_answer_plain}`);
    } else {
      choiceLabels.push(`[WRONG ${wrongIdx + 1}] ${wrongSlots[wrongIdx] ?? "?"}`);
      wrongIdx++;
    }
  }

  const distractorBlock = selectedDistractors
    .map((d, i) =>
      `Wrong answer ${i + 1}: "${d.wrong_answer_plain}"\n  Misconception: ${d.misconception}`
    )
    .join("\n\n");

  const workingBlock = plan.correct_working.map((s, i) => `  ${i + 1}. ${s}`).join("\n");

  return `Problem type: ${args.problemTypeName}
Description: ${plan.problem_description}
Expression: ${plan.expression_plain}
Correct answer: ${plan.correct_answer_plain}
Working:
${workingBlock}

${distractorBlock}

Choice layout — must match exactly:
${choiceLabels.map((l, i) => `  choices[${i}] = ${l}`).join("\n")}
correct_index = ${correctIndex}
wrong_answer_descriptions: 4 entries, null at index ${correctIndex}, plain-English misconception at other indices.

Format into this schema:
${args.schemaBlock}

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
}
