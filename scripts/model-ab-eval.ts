/**
 * Model A/B evaluation harness.
 * Tests gpt-5.4-mini, gpt-5.5, and Gemini Flash across generation tasks.
 * Run: cd apps/student && npx tsx ../../scripts/model-ab-eval.ts
 */

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");

const oai = new OpenAI({ apiKey: OPENAI_KEY });

const OPENAI_MODELS = ["gpt-5.4-mini", "gpt-5.5"] as const;
const GEMINI_MODEL = "gemini-2.5-flash"; // REST call
const ALL_MODELS = [...OPENAI_MODELS, "gemini-2.5-flash"];

// ─── Prompt constants (copied verbatim from generators) ───────────────────────

const DELIMITER_FEWSHOT = `DELIMITERS ARE MANDATORY IN EVERY FIELD (stem, choices, solution, hint, example).
EVERY piece of math — every variable, number-in-math, operator, fraction, integral, derivative, or aligned block — MUST be wrapped in $...$ (inline) or $$...$$ (block). Bare LaTeX outside delimiters does NOT render — it shows literal backslashes to the student.
  ✅ CORRECT: "Differentiate: $\\dfrac{d}{dx}(x+3)^4 = 4(x+3)^3$."
  ✅ CORRECT (block step): "$$\\int_0^2 3\\,dt = 6$$"
  ✅ CORRECT (aligned): "$$\\begin{aligned} x^3\\cdot x^5 &= x^{3+5} \\\\ &= x^8 \\end{aligned}$$"
  ❌ WRONG (bare — never do this): "\\frac{d}{dx}(x+3)^4"
  ❌ WRONG (bare aligned): "\\begin{aligned} ... \\end{aligned}"  ← must be inside $$...$$
  ❌ WRONG (mixing prose into math): "\\text{the slope is } 3x^2"  ← write prose as plain text, then $3x^2$`;

const LATEX_RULES = `LATEX RULES (MANDATORY — violations produce unusable output):
- ALL math MUST be in KaTeX-compatible LaTeX: $...$ for inline, $$...$$ for display.
${DELIMITER_FEWSHOT}
- stem_latex: the problem statement as PLAIN PROSE with every math expression wrapped in $...$.
- solution_latex: full WORKED SOLUTION showing every step with \\n\\n between steps.
- hint_latex: one sentence max 15 words guiding toward the approach without giving the answer.
- NO unicode math symbols (×, ÷, ≤, ≥, √, π in plain text, etc.) — use \\times, \\div, \\leq, \\geq, \\sqrt{}, \\pi instead.`;

const DISTRACTOR_RULES = `DISTRACTOR RULES — distractors must be MISCONCEPTION-GROUNDED (the answers a real student actually arrives at):
- Each distractor is an OBJECT { "misconception": ..., "value_latex": ... }. Write the misconception FIRST, then DERIVE value_latex = the answer that misconception literally produces.
- All THREE value_latex must be DISTINCT from one another AND from final_answer_latex.`;

const MATH_QUESTION_SYSTEM = `You write math practice questions for an AP Precalculus / AP Calculus AB adaptive learning app.

Questions test procedural skills, conceptual understanding, and applied reasoning — fully self-contained.

STEM FORMATTING: The stem MUST start with a capital letter and end with a question mark or period.

${LATEX_RULES}

${DISTRACTOR_RULES}

DIFFICULTY BANDS:
  EASY (0.20–0.40): Single-step application of one rule.
  MEDIUM (0.45–0.65): Apply one concept or execute one algebraic/calculus step.
  HARD (0.70–0.90): Multi-step reasoning or integrating two related concepts.

OUTPUT ORDER (mandatory):
1. FIRST write stem_latex.
2. THEN write solution_latex: fully work the problem step by step.
3. THEN set final_answer_latex to EXACTLY the value your solution concluded.
4. THEN write distractors: EXACTLY 3 OBJECTS { "misconception": ..., "value_latex": ... }.

Do NOT output a "choices" array and do NOT output a "correct_index".

Return a JSON object:
{
  "questions": [
    {
      "stem_latex": "string",
      "solution_latex": "string",
      "final_answer_latex": "string",
      "distractors": [
        { "misconception": "string", "value_latex": "string" },
        { "misconception": "string", "value_latex": "string" },
        { "misconception": "string", "value_latex": "string" }
      ],
      "hint_latex": "string",
      "keyword_weights": { "keyword_id": 1.0 },
      "difficulty": 0.5
    }
  ]
}

Return valid JSON only. No markdown.`;

const MATH_LESSON_SYSTEM = `You are a math tutor writing micro-lessons for an AP Precalculus / AP Calculus AB app. Assume the student has NEVER seen this concept before.

GROUND-UP INSTRUCTION: Step 1 uses the SIMPLEST possible case. Each subsequent step adds exactly one new idea. Steps 3–4 have progressively harder check questions.

Return a JSON object: { "micro_steps": [ MicroStep, ... ] }

Produce 3 micro-steps for simple keywords, 4 for complex keywords.

MicroStep:
{
  "step_index": 1, 2, 3, or 4,
  "has_check": true,
  "explanation_latex": string,
  "example_latex": string,
  "check_question": {
    "latex_content": string,
    "solution_latex": string,
    "correct_answer_latex": string,
    "distractors": [string, string, string]
  },
  "hint_latex": string
}

━━━ explanation_latex ━━━
2–4 sentences (max 90 words). Plain prose with $...$ math only when needed.
Steps 2–4 MUST begin with a sentence connecting to the previous step.
Explain the WHY, not just the procedure.
CRITICAL: teach EXACTLY the ONE in-scope skill defined in the scope contract.

━━━ example_latex ━━━
A concrete WORKED EXAMPLE applying the in-scope skill. Show every intermediate step.
Write prose as PLAIN TEXT and wrap EVERY math expression in $...$ (inline) or $$...$$ (a standalone step result).
SPACING: keep normal spaces between words and around inline math.
Include a "Common mistake:" callout.

━━━ check_question ━━━
ORDER (mandatory): write latex_content first, THEN solution_latex, THEN correct_answer_latex, THEN distractors.
• correct_answer_latex: EXACTLY the final answer solution_latex concluded.
• distractors: EXACTLY 3 DISTINCT wrong options, each a realistic student error.
• Do NOT output a "choices" array or a "correct_index".

━━━ hint_latex ━━━
One sentence, max 15 words. Guide toward the correct approach without giving it away.

LATEX RULES: All math in $...$ (inline) or $$...$$ (display). No unicode math symbols.

Return valid JSON only. No markdown.`;

const MATH_FLASHCARD_SYSTEM = `You write SIMPLE memorization flashcards for AP Precalculus / AP Calculus AB.

THESE ARE NOT QUIZ QUESTIONS. Do NOT write problem-solving prompts. NEVER ask the student to "solve", "evaluate", "find", "compute", "simplify", "differentiate".

A flashcard tests RECALL of ONE idea: a definition, a piece of notation, a formula/rule, a property, or a theorem statement.

FLASHCARD FORMAT:
- front_latex: a bare term, definition cue, notation prompt, or "name the rule/formula" prompt. Usually ≤ 12 words. Use $...$ for math.
- back_latex: the bare fact only — a definition, formula, or one short statement. Usually ≤ 20 words, ONE idea. Use $...$ for math.

Return a JSON object:
{
  "flashcards": [
    {
      "front_latex": "string",
      "back_latex": "string",
      "keyword_weights": { "keyword_id": 1.0 }
    }
  ]
}

Return valid JSON only. No markdown.`;

const MCAT_DELIMITER_RULE = `MATH/NOTATION DELIMITERS (mandatory):
Wrap EVERY math or chemistry expression in $...$ (inline) or $$...$$ (block).
  ✅ CORRECT: "$V_{max}$" not "Vmax" / "$K_m$" not "Km" / "$pK_a$" not "pKa"
  ✅ CORRECT: "$H_2O$" not "H2O" / "$CO_2$" not "CO2" / "$NAD^+$" not "NAD+"`;

const MCAT_LESSON_SYSTEM = `You are an MCAT Biology tutor writing micro-lessons. Assume the student has NEVER seen this concept before.

GROUND-UP INSTRUCTION: Step 1 must use the SIMPLEST possible case. Each subsequent step adds exactly one new idea.

Return a JSON object: { "micro_steps": [ MicroStep, ... ] }

Produce 3 micro-steps for simple keywords, 4 for complex keywords.

MicroStep:
{
  "step_index": 1, 2, 3, or 4,
  "has_check": true,
  "explanation_latex": string,
  "example_latex": string,
  "check_question": {
    "latex_content": string,
    "solution_latex": string,
    "correct_answer_latex": string,
    "distractors": [string, string, string]
  },
  "hint_latex": string
}

━━━ explanation_latex ━━━
2–4 sentences (max 90 words). Plain prose; chemistry/math in $...$ only when needed.
Steps 2–4 MUST begin with a sentence connecting to the previous step.
Explain the WHY, not just the procedure.

━━━ example_latex ━━━
A concrete worked example or applied MCAT scenario. Plain prose with math in $...$ when needed.

━━━ check_question (every step) ━━━
ORDER (mandatory): write latex_content first, THEN solution_latex, THEN correct_answer_latex, THEN distractors.
• correct_answer_latex: EXACTLY the answer solution_latex concluded.
• distractors: EXACTLY 3 DISTINCT wrong options, each a realistic MCAT misconception.
• Do NOT output a "choices" array or a "correct_index".

━━━ hint_latex ━━━
One sentence, max 15 words. Guide the student toward the correct approach without giving it away.

${MCAT_DELIMITER_RULE}

Return valid JSON only. No markdown.`;

const MCAT_QUESTION_SYSTEM = `You write MCAT Biology study questions for a practice app.

Questions test conceptual understanding and specific factual recall. Each question must be fully self-contained.

DIFFICULTY BANDS:
  EASY (0.20–0.40): Single-step recall or a direct definition/identification.
  MEDIUM (0.45–0.65): Apply a concept or perform one inference.
  HARD (0.70–0.90): Multi-step reasoning integrating two related concepts.

QUESTION RULES:
- Self-contained stem of 1–3 sentences.
- Three MISCONCEPTION-GROUNDED distractors as OBJECTS { "misconception": ..., "value": ... }: write the misconception first, then derive value.
- Explanation: 2–4 sentences explaining why correct and why the tempting distractor is wrong.
- STEM FORMATTING: start with a capital letter, end with a question mark or period.

${MCAT_DELIMITER_RULE}

OUTPUT ORDER (mandatory):
1. FIRST write the stem.
2. THEN write the explanation: fully work out the correct answer.
3. THEN set correct_answer to EXACTLY the answer your explanation concluded.
4. THEN write distractors: EXACTLY 3 OBJECTS { "misconception": ..., "value": ... }.

Do NOT output a "choices" array or a "correct_index".

Return a JSON object:
{
  "questions": [
    {
      "stem": "string",
      "explanation": "string",
      "correct_answer": "string",
      "distractors": [
        { "misconception": "string", "value": "string" },
        { "misconception": "string", "value": "string" },
        { "misconception": "string", "value": "string" }
      ],
      "keyword_weights": { "keyword_id": 1.0 },
      "difficulty": 0.5
    }
  ]
}

Return valid JSON only. No markdown.`;

const MCAT_FLASHCARD_SYSTEM = `You write MCAT-LEVEL Biology/Biochemistry memorization flashcards.

DEPTH — THIS IS THE MCAT, NOT AP BIOLOGY. Each card must capture high-yield, precise, discriminating facts:
- exact values: $pK_a$ values, net charge at a stated pH, ATP/NADH yields, carbon counts.
- named players WITH specifics: enzyme + cofactor + allosteric regulators; rate-limiting enzyme; hormone source/target/effect.
- mechanism-level facts: directionality, kinetic relationships ($K_m = [S]$ at ½ $V_{max}$; competitive inhibitor raises $K_m$ with $V_{max}$ unchanged).

THESE ARE NOT QUIZ QUESTIONS. Pure recall: front = a precise cue, back = the precise fact.

FLASHCARD FORMAT:
- front: a precise term/cue (≤ ~14 words).
- back: the bare fact — a value, name(s), short canonical list, or one short clause (≤ ~20 words).

${MCAT_DELIMITER_RULE}

Return a JSON object:
{
  "flashcards": [
    {
      "front": "string",
      "back": "string",
      "keyword_weights": { "keyword_id": 1.0 }
    }
  ]
}

Return valid JSON only. No markdown.`;

// ─── Test prompts (representative real keywords) ──────────────────────────────

const MATH_LESSON_USER = `Keyword ID: calc_ab_avg_vs_instant_rate
Label: Average rate of change vs. instantaneous rate of change
Description: Understanding the difference between average rate of change (slope of secant) and instantaneous rate of change (slope of tangent), and how limits connect them.
Examples: average velocity over an interval vs. speedometer reading at one moment; slope of secant line vs. tangent line

Think carefully about what a student who has NEVER seen this AP Calculus concept before would find confusing.
Build from the absolute simplest case in step 1.
In example_latex, always include:
  (a) a fully worked example with KaTeX notation showing each step,
  (b) a "Common mistake:" callout identifying the most predictable error.
Every check question must stay strictly within the scope contract.`;

const MATH_QUESTION_USER = `Generate 1 AP math multiple-choice question.

TARGET DIFFICULTY: 0.55 → MEDIUM band (0.45–0.65). Requirements: Apply one concept or execute one algebraic/calculus step. Distractors reflect common sign errors or formula confusions.

KEYWORDS TO TEST (use ONLY these keyword ids in keyword_weights):
  - id: "calc_ab_avg_vs_instant_rate"
    label: "Average rate of change vs. instantaneous rate of change"
    description: "Understanding the difference between average rate of change (slope of secant) and instantaneous rate of change (slope of tangent), and how limits connect them."`;

const MATH_FLASHCARD_USER = `Generate 3 AP math flashcards.

KEYWORDS TO COVER (use ONLY these keyword ids in keyword_weights):
  - id: "calc_ab_avg_vs_instant_rate"
    label: "Average rate of change vs. instantaneous rate of change"
    description: "Understanding the difference between average rate of change (slope of secant) and instantaneous rate of change (slope of tangent), and how limits connect them."`;

const MCAT_LESSON_USER = `Keyword ID: mcat_enzyme_km
Label: Michaelis constant ($K_m$) — definition and significance
Description: $K_m$ is the substrate concentration at which reaction velocity is half of $V_{max}$; measures enzyme-substrate affinity (lower $K_m$ = higher affinity). Includes the Michaelis-Menten equation and its graphical interpretation.

Think carefully about what a student who has NEVER seen this MCAT Biology concept before would find confusing. Build from the absolute simplest case. Every step must have a check question with distractors based on real MCAT misconceptions.`;

const MCAT_QUESTION_USER = `Generate 1 MCAT Biology multiple-choice question.

TARGET DIFFICULTY: 0.55 → MEDIUM band (0.45–0.65). Requirements: Apply a concept or perform one inference. Distractors reflect common misconceptions a typical student might hold.

KEYWORDS TO TEST (use ONLY these keyword ids in keyword_weights):
  - id: "mcat_enzyme_km"
    label: "Michaelis constant (Km) — definition and significance"
    description: "Km is the substrate concentration at which reaction velocity is half of Vmax; measures enzyme-substrate affinity."`;

const MCAT_FLASHCARD_USER = `Generate 3 MCAT Biology flashcards.

KEYWORDS TO COVER (use ONLY these keyword ids in keyword_weights):
  - id: "mcat_enzyme_km"
    label: "Michaelis constant (Km) — definition and significance"
    description: "Km is the substrate concentration at which reaction velocity is half of Vmax; measures enzyme-substrate affinity (lower Km = higher affinity)."`;

// ─── API wrappers ─────────────────────────────────────────────────────────────

interface CallResult {
  model: string;
  output: string;
  parsed: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
}

async function callOpenAI(
  model: string,
  system: string,
  user: string
): Promise<CallResult> {
  const start = Date.now();
  try {
    const res = await oai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    const latencyMs = Date.now() - start;
    const output = res.choices[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try { parsed = JSON.parse(output); } catch { parsed = null; }
    return {
      model,
      output,
      parsed,
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
      latencyMs,
    };
  } catch (err) {
    return {
      model,
      output: "",
      parsed: null,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function callGemini(
  system: string,
  user: string
): Promise<CallResult> {
  if (!GEMINI_KEY) {
    return {
      model: GEMINI_MODEL,
      output: "",
      parsed: null,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      error: "GEMINI_API_KEY not set",
    };
  }

  const start = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7,
    },
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        model: GEMINI_MODEL,
        output: "",
        parsed: null,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        error: `Gemini HTTP ${resp.status}: ${errText.slice(0, 300)}`,
      };
    }

    const json = (await resp.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const output = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let parsed: unknown;
    try { parsed = JSON.parse(output); } catch { parsed = null; }

    return {
      model: GEMINI_MODEL,
      output,
      parsed,
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs,
    };
  } catch (err) {
    return {
      model: GEMINI_MODEL,
      output: "",
      parsed: null,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runAll(system: string, user: string): Promise<CallResult[]> {
  const results = await Promise.all([
    callOpenAI("gpt-5.4-mini", system, user),
    callOpenAI("gpt-5.5", system, user),
    callGemini(system, user),
  ]);
  return results;
}

// ─── Scoring rubric ───────────────────────────────────────────────────────────

function codeBlock(text: string, maxLen = 3000): string {
  const trimmed = text.length > maxLen ? text.slice(0, maxLen) + "\n... [truncated]" : text;
  return "```json\n" + trimmed + "\n```";
}

function safeStr(x: unknown): string {
  if (x === null || x === undefined) return "";
  return String(x);
}

// Heuristic quality checks for lessons
function scoreLessonOutput(r: CallResult): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;

  if (r.error) {
    notes.push(`❌ ERROR: ${r.error}`);
    return { score: 0, notes };
  }

  const parsed = r.parsed as Record<string, unknown> | null;
  if (!parsed) {
    notes.push("❌ Invalid JSON");
    return { score: 0, notes };
  }

  const steps = Array.isArray(parsed.micro_steps) ? parsed.micro_steps : [];
  if (steps.length >= 3) {
    score += 20;
    notes.push(`✅ ${steps.length} micro-steps (expected 3–4)`);
  } else {
    notes.push(`❌ Only ${steps.length} steps (need ≥3)`);
  }

  // Check each step for required fields
  let validSteps = 0;
  let hasCheckQuestions = 0;
  let hasDistractors = 0;
  let hasCommonMistake = 0;
  let hasLatexDelimiters = 0;
  let hasProseInsideMath = 0;

  for (const s of steps as Record<string, unknown>[]) {
    const expl = safeStr(s.explanation_latex);
    const ex = safeStr(s.example_latex);
    const hint = safeStr(s.hint_latex);
    const cq = s.check_question as Record<string, unknown> | undefined;

    if (expl && ex && hint) validSteps++;
    if (cq && safeStr(cq.correct_answer_latex)) hasCheckQuestions++;
    if (cq && Array.isArray(cq.distractors) && (cq.distractors as unknown[]).length >= 3) hasDistractors++;
    if (ex.toLowerCase().includes("common mistake")) hasCommonMistake++;
    // Check for proper $...$ delimiters
    if (ex.includes("$") || expl.includes("$")) hasLatexDelimiters++;
    // Check for bare LaTeX (a rough heuristic)
    if (/\\frac{|\\dfrac{|\\int_|\\lim_/.test(ex + expl) && !(ex + expl).match(/\$[^$]+\\frac/)) {
      hasProseInsideMath++;
    }
  }

  if (validSteps === steps.length && steps.length > 0) {
    score += 20;
    notes.push("✅ All steps have required fields (explanation, example, hint)");
  } else if (validSteps > 0) {
    score += 10;
    notes.push(`⚠️ ${validSteps}/${steps.length} steps complete`);
  }

  if (hasCheckQuestions === steps.length && steps.length > 0) {
    score += 20;
    notes.push("✅ All steps have check questions with correct_answer_latex");
  } else {
    notes.push(`⚠️ ${hasCheckQuestions}/${steps.length} steps have valid check questions`);
  }

  if (hasDistractors === steps.length && steps.length > 0) {
    score += 15;
    notes.push("✅ All check questions have 3 distractors");
  } else {
    notes.push(`⚠️ ${hasDistractors}/${steps.length} have ≥3 distractors`);
  }

  if (hasCommonMistake >= Math.max(1, steps.length - 1)) {
    score += 10;
    notes.push("✅ Common mistake callouts present");
  } else {
    notes.push(`⚠️ Common mistake callouts: ${hasCommonMistake}/${steps.length}`);
  }

  if (hasLatexDelimiters === steps.length && steps.length > 0) {
    score += 10;
    notes.push("✅ LaTeX $...$ delimiters used throughout");
  } else {
    notes.push(`⚠️ LaTeX delimiter coverage: ${hasLatexDelimiters}/${steps.length} steps`);
  }

  if (hasProseInsideMath === 0) {
    score += 5;
    notes.push("✅ No obvious bare LaTeX detected");
  } else {
    notes.push(`⚠️ Possible bare LaTeX in ${hasProseInsideMath} step(s)`);
  }

  return { score, notes };
}

function scoreQuestionOutput(r: CallResult, isMcat: boolean): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;

  if (r.error) {
    notes.push(`❌ ERROR: ${r.error}`);
    return { score: 0, notes };
  }

  const parsed = r.parsed as Record<string, unknown> | null;
  if (!parsed) {
    notes.push("❌ Invalid JSON");
    return { score: 0, notes };
  }

  const qs = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (qs.length === 0) {
    notes.push("❌ No questions returned");
    return { score: 0, notes };
  }

  score += 20;
  notes.push(`✅ ${qs.length} question(s) returned`);

  const q = qs[0] as Record<string, unknown>;
  const stemField = isMcat ? "stem" : "stem_latex";
  const answerField = isMcat ? "correct_answer" : "final_answer_latex";
  const explField = isMcat ? "explanation" : "solution_latex";

  const stem = safeStr(q[stemField]);
  const answer = safeStr(q[answerField]);
  const explanation = safeStr(q[explField]);
  const distractors = Array.isArray(q.distractors) ? q.distractors as Record<string, unknown>[] : [];

  if (stem && /[A-Z]/.test(stem[0]) && /[?.)]$/.test(stem.trim())) {
    score += 15;
    notes.push("✅ Stem properly capitalized and terminated");
  } else {
    notes.push("⚠️ Stem formatting issue (capitalization or termination)");
  }

  if (answer && answer.trim().length > 0) {
    score += 15;
    notes.push("✅ final_answer_latex / correct_answer present");
  } else {
    notes.push("❌ Missing answer field");
  }

  if (explanation && explanation.length > 50) {
    score += 15;
    notes.push("✅ Explanation/solution present and substantial");
  } else {
    notes.push("⚠️ Explanation too short or missing");
  }

  const miscField = isMcat ? "value" : "value_latex";
  const validDistractors = distractors.filter(
    (d) => d.misconception && safeStr(d.misconception).length > 10 && safeStr(d[miscField]).length > 0
  );

  if (validDistractors.length >= 3) {
    score += 20;
    notes.push("✅ 3 misconception-grounded distractors with explanations");
  } else {
    score += validDistractors.length * 5;
    notes.push(`⚠️ Only ${validDistractors.length}/3 distractors are well-formed`);
  }

  const allValues = validDistractors.map((d) => safeStr(d[miscField]));
  const unique = new Set(allValues);
  if (unique.size === allValues.length && allValues.length >= 3 && !allValues.includes(answer)) {
    score += 15;
    notes.push("✅ All distractor values distinct from each other and from correct answer");
  } else if (allValues.length >= 3) {
    notes.push("⚠️ Some distractor values may not be distinct");
  }

  const noChoices = !q.choices && !q.correct_index;
  if (noChoices) {
    notes.push("✅ No choices/correct_index in output (as required)");
  } else {
    notes.push("⚠️ Model included choices or correct_index (should not)");
  }

  return { score, notes };
}

function scoreFlashcardOutput(r: CallResult, isMcat: boolean): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;

  if (r.error) {
    notes.push(`❌ ERROR: ${r.error}`);
    return { score: 0, notes };
  }

  const parsed = r.parsed as Record<string, unknown> | null;
  if (!parsed) {
    notes.push("❌ Invalid JSON");
    return { score: 0, notes };
  }

  const cards = Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
  if (cards.length === 0) {
    notes.push("❌ No flashcards returned");
    return { score: 0, notes };
  }

  score += 20;
  notes.push(`✅ ${cards.length} flashcard(s) returned`);

  const frontField = isMcat ? "front" : "front_latex";
  const backField = isMcat ? "back" : "back_latex";

  let recallCards = 0;
  let quizCards = 0;
  let conciseCards = 0;
  let hasLatex = 0;

  const quizVerbs = /\b(solve|evaluate|find|compute|simplify|differentiate|calculate|why|how|what happens)\b/i;

  for (const c of cards as Record<string, unknown>[]) {
    const front = safeStr(c[frontField]);
    const back = safeStr(c[backField]);

    if (quizVerbs.test(front)) {
      quizCards++;
    } else {
      recallCards++;
    }

    if (front.split(" ").length <= 14 && back.split(" ").length <= 25) {
      conciseCards++;
    }

    if (front.includes("$") || back.includes("$")) {
      hasLatex++;
    }
  }

  if (recallCards === cards.length) {
    score += 30;
    notes.push(`✅ All ${cards.length} cards are pure recall (no quiz-style fronts)`);
  } else {
    score += recallCards * 10;
    notes.push(`⚠️ ${quizCards}/${cards.length} cards have quiz-style fronts (should be recall only)`);
  }

  if (conciseCards === cards.length) {
    score += 20;
    notes.push("✅ All cards are concise (front ≤14 words, back ≤25 words)");
  } else {
    notes.push(`⚠️ ${conciseCards}/${cards.length} cards are concise`);
  }

  if (isMcat && hasLatex === cards.length) {
    score += 20;
    notes.push("✅ All MCAT cards use $...$ notation for scientific terms");
  } else if (!isMcat && hasLatex >= Math.ceil(cards.length * 0.5)) {
    score += 10;
    notes.push(`✅ ${hasLatex}/${cards.length} math cards use LaTeX notation`);
  } else {
    notes.push(`⚠️ LaTeX notation in ${hasLatex}/${cards.length} cards`);
  }

  if (isMcat) {
    // Check for MCAT-depth terms
    const allText = (cards as Record<string, unknown>[])
      .map((c) => safeStr(c[frontField]) + " " + safeStr(c[backField]))
      .join(" ");
    const mcatTerms = /K_m|V_\{max\}|V_{max}|pK_a|½|half of|allosteric|cofactor|½ V|rate-limiting|inhibitor/i;
    if (mcatTerms.test(allText)) {
      score += 10;
      notes.push("✅ Cards contain MCAT-depth terminology (Km, Vmax, allosteric, etc.)");
    } else {
      notes.push("⚠️ Cards may lack MCAT-specific depth (no Km/Vmax/allosteric terms detected)");
    }
  }

  return { score, notes };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface TaskResult {
  taskName: string;
  results: CallResult[];
  scores: { score: number; notes: string[] }[];
}

async function main() {
  console.log("Running model A/B evaluation...\n");

  const allTaskResults: TaskResult[] = [];

  // Task 1: Math Lesson
  console.log("1/6 Math lesson...");
  const mathLessonResults = await runAll(MATH_LESSON_SYSTEM, MATH_LESSON_USER);
  allTaskResults.push({
    taskName: "Math Lesson (avg vs instantaneous rate of change)",
    results: mathLessonResults,
    scores: mathLessonResults.map((r) => scoreLessonOutput(r)),
  });

  // Task 2: MCAT Lesson
  console.log("2/6 MCAT lesson...");
  const mcatLessonResults = await runAll(MCAT_LESSON_SYSTEM, MCAT_LESSON_USER);
  allTaskResults.push({
    taskName: "MCAT Lesson (Km — Michaelis constant)",
    results: mcatLessonResults,
    scores: mcatLessonResults.map((r) => scoreLessonOutput(r)),
  });

  // Task 3: Math Question
  console.log("3/6 Math question...");
  const mathQResults = await runAll(MATH_QUESTION_SYSTEM, MATH_QUESTION_USER);
  allTaskResults.push({
    taskName: "Math Question (avg rate of change, medium difficulty)",
    results: mathQResults,
    scores: mathQResults.map((r) => scoreQuestionOutput(r, false)),
  });

  // Task 4: MCAT Question
  console.log("4/6 MCAT question...");
  const mcatQResults = await runAll(MCAT_QUESTION_SYSTEM, MCAT_QUESTION_USER);
  allTaskResults.push({
    taskName: "MCAT Question (Km, medium difficulty)",
    results: mcatQResults,
    scores: mcatQResults.map((r) => scoreQuestionOutput(r, true)),
  });

  // Task 5: Math Flashcard
  console.log("5/6 Math flashcards...");
  const mathFCResults = await runAll(MATH_FLASHCARD_SYSTEM, MATH_FLASHCARD_USER);
  allTaskResults.push({
    taskName: "Math Flashcards (avg rate of change, 3 cards)",
    results: mathFCResults,
    scores: mathFCResults.map((r) => scoreFlashcardOutput(r, false)),
  });

  // Task 6: MCAT Flashcard
  console.log("6/6 MCAT flashcards...");
  const mcatFCResults = await runAll(MCAT_FLASHCARD_SYSTEM, MCAT_FLASHCARD_USER);
  allTaskResults.push({
    taskName: "MCAT Flashcards (Km, 3 cards)",
    results: mcatFCResults,
    scores: mcatFCResults.map((r) => scoreFlashcardOutput(r, true)),
  });

  console.log("\nAll API calls done. Writing report...");

  // ─── Build report ────────────────────────────────────────────────────────────

  const now = new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    `# Model A/B Evaluation — ${now}`,
    "",
    "Comparing **gpt-5.4-mini** (current default), **gpt-5.5** (current question model), and **Gemini 2.5 Flash** (REST API) across all generation tasks.",
    "",
    "## Setup",
    "- All calls use the **exact system/user prompts from the production generators** (`mathGenerator.ts`, `mcatGenerator.ts`).",
    "- Gemini called via REST (`gemini-2.5-flash`, `responseMimeType: application/json`). No client package installed — key exists in `apps/student/.env.local`.",
    "- Scores are heuristic (automated checks against prompt constraints). Human judgment notes supplement each section.",
    "- Token counts from API usage metadata; latency = wall-clock per call.",
    "",
    "## Pricing reference (as of evaluation date)",
    "",
    "| Model | Input (per 1M tokens) | Output (per 1M tokens) | Notes |",
    "|---|---|---|---|",
    "| gpt-5.4-mini | ~\\$0.40 | ~\\$1.60 | Current GEN_MODEL; check OpenAI pricing page for exact rates |",
    "| gpt-5.5 | ~\\$2.00 | ~\\$8.00 | Current QUESTION_MODEL; estimated from observed cost patterns |",
    "| Gemini 2.5 Flash | ~\\$0.15 | ~\\$0.60 | Google AI Studio pricing; significantly cheaper |",
    "",
    "> Pricing estimates — verify at platform pricing pages before budgeting. Ratios are more reliable than absolutes.",
    "",
  ];

  // Per-task sections
  for (const task of allTaskResults) {
    lines.push(`## ${task.taskName}`);
    lines.push("");

    // Score summary table
    lines.push("### Automated quality scores (0–100)");
    lines.push("");
    lines.push("| Model | Score | Latency | Input tok | Output tok |");
    lines.push("|---|---|---|---|---|");
    for (let i = 0; i < task.results.length; i++) {
      const r = task.results[i];
      const s = task.scores[i];
      lines.push(`| **${r.model}** | ${s.score}/100 | ${r.latencyMs}ms | ${r.inputTokens} | ${r.outputTokens} |`);
    }
    lines.push("");

    // Score notes per model
    for (let i = 0; i < task.results.length; i++) {
      const r = task.results[i];
      const s = task.scores[i];
      lines.push(`**${r.model}** checks:`);
      for (const note of s.notes) {
        lines.push(`- ${note}`);
      }
      lines.push("");
    }

    // Raw output comparison
    lines.push("### Raw output samples (side by side)");
    lines.push("");
    for (const r of task.results) {
      lines.push(`<details><summary><strong>${r.model}</strong> — ${r.latencyMs}ms, ${r.outputTokens} output tokens${r.error ? " ❌ ERROR" : ""}</summary>`);
      lines.push("");
      if (r.error) {
        lines.push(`**Error:** ${r.error}`);
      } else {
        // Pretty-print JSON for readability
        let displayOutput = r.output;
        try {
          displayOutput = JSON.stringify(JSON.parse(r.output), null, 2);
        } catch { /* leave as-is */ }
        lines.push(codeBlock(displayOutput, 4000));
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  // ─── Cost estimate per task ──────────────────────────────────────────────────

  lines.push("## Cost analysis");
  lines.push("");
  lines.push("Estimated cost per generation using observed token counts and approximate pricing:");
  lines.push("");

  // Pricing per 1M tokens (input/output)
  const pricing: Record<string, { input: number; output: number }> = {
    "gpt-5.4-mini": { input: 0.40, output: 1.60 },
    "gpt-5.5": { input: 2.00, output: 8.00 },
    "gemini-2.5-flash": { input: 0.15, output: 0.60 },
  };

  lines.push("| Task | Model | Input tok | Output tok | Est. cost (per call) |");
  lines.push("|---|---|---|---|---|");

  for (const task of allTaskResults) {
    for (const r of task.results) {
      const p = pricing[r.model];
      if (!p || r.error) {
        lines.push(`| ${task.taskName.slice(0, 40)} | ${r.model} | ${r.inputTokens} | ${r.outputTokens} | ${r.error ? "ERROR" : "—"} |`);
        continue;
      }
      const costUsd = ((r.inputTokens / 1_000_000) * p.input) + ((r.outputTokens / 1_000_000) * p.output);
      lines.push(`| ${task.taskName.slice(0, 40)} | ${r.model} | ${r.inputTokens} | ${r.outputTokens} | \\$${costUsd.toFixed(5)} |`);
    }
  }

  lines.push("");

  // ─── Recommendations ─────────────────────────────────────────────────────────

  lines.push("## Recommendation summary");
  lines.push("");
  lines.push("_Filled in after reviewing raw outputs and scores above. See final message for concise per-task picks._");
  lines.push("");

  // Compute aggregate scores per model per task group
  const lessonTasks = allTaskResults.filter(t => t.taskName.includes("Lesson"));
  const questionTasks = allTaskResults.filter(t => t.taskName.includes("Question"));
  const flashcardTasks = allTaskResults.filter(t => t.taskName.includes("Flashcard"));

  function avgScoreByModel(tasks: TaskResult[], modelIdx: number): number {
    const scores = tasks.map(t => t.scores[modelIdx]?.score ?? 0);
    return scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
  }

  const modelLabels = ["gpt-5.4-mini", "gpt-5.5", "gemini-2.5-flash"];

  lines.push("### Aggregate quality scores (avg across relevant tasks)");
  lines.push("");
  lines.push("| Task group | gpt-5.4-mini | gpt-5.5 | Gemini 2.5 Flash |");
  lines.push("|---|---|---|---|");
  lines.push(`| Lessons | ${avgScoreByModel(lessonTasks, 0).toFixed(0)}/100 | ${avgScoreByModel(lessonTasks, 1).toFixed(0)}/100 | ${avgScoreByModel(lessonTasks, 2).toFixed(0)}/100 |`);
  lines.push(`| Questions | ${avgScoreByModel(questionTasks, 0).toFixed(0)}/100 | ${avgScoreByModel(questionTasks, 1).toFixed(0)}/100 | ${avgScoreByModel(questionTasks, 2).toFixed(0)}/100 |`);
  lines.push(`| Flashcards | ${avgScoreByModel(flashcardTasks, 0).toFixed(0)}/100 | ${avgScoreByModel(flashcardTasks, 1).toFixed(0)}/100 | ${avgScoreByModel(flashcardTasks, 2).toFixed(0)}/100 |`);
  lines.push("");

  // Cost ratio table
  lines.push("### Relative cost (gpt-5.4-mini = 1.0×)");
  lines.push("");

  function avgCostByModel(tasks: TaskResult[], modelIdx: number): number {
    const costs = tasks.map(t => {
      const r = t.results[modelIdx];
      const p = pricing[r.model];
      if (!p || r.error || !r.inputTokens) return 0;
      return ((r.inputTokens / 1_000_000) * p.input) + ((r.outputTokens / 1_000_000) * p.output);
    });
    return costs.reduce((a, b) => a + b, 0) / (costs.length || 1);
  }

  const miniCostL = avgCostByModel(lessonTasks, 0);
  const miniCostQ = avgCostByModel(questionTasks, 0);
  const miniCostF = avgCostByModel(flashcardTasks, 0);

  function ratio(cost: number, base: number): string {
    if (!base) return "—";
    return (cost / base).toFixed(1) + "×";
  }

  lines.push("| Task group | gpt-5.4-mini | gpt-5.5 | Gemini 2.5 Flash |");
  lines.push("|---|---|---|---|");
  lines.push(`| Lessons | 1.0× | ${ratio(avgCostByModel(lessonTasks, 1), miniCostL)} | ${ratio(avgCostByModel(lessonTasks, 2), miniCostL)} |`);
  lines.push(`| Questions | 1.0× | ${ratio(avgCostByModel(questionTasks, 1), miniCostQ)} | ${ratio(avgCostByModel(questionTasks, 2), miniCostQ)} |`);
  lines.push(`| Flashcards | 1.0× | ${ratio(avgCostByModel(flashcardTasks, 1), miniCostF)} | ${ratio(avgCostByModel(flashcardTasks, 2), miniCostF)} |`);
  lines.push("");

  lines.push("### Per-task recommendation (fill after reviewing raw outputs)");
  lines.push("");
  lines.push("| Task | Recommended model | Reasoning |");
  lines.push("|---|---|---|");
  lines.push("| Math lessons | _TBD after review_ | |");
  lines.push("| MCAT lessons | _TBD after review_ | |");
  lines.push("| Math questions | _TBD after review_ | |");
  lines.push("| MCAT questions | _TBD after review_ | |");
  lines.push("| Flashcards (math + MCAT) | _TBD after review_ | |");
  lines.push("| Verification calls | gpt-5.4-mini (no change) | Short task, already cheap; Gemini savings marginal vs. consistency risk |");
  lines.push("");

  lines.push("## Caveats");
  lines.push("");
  lines.push("- **Gemini availability**: `GEMINI_API_KEY` exists in `apps/student/.env.local` but `@google/generative-ai` is NOT installed. Integration requires installing the package or using the REST path shown in the harness. For production wiring, a separate session should add the Gemini client to `apps/student/package.json` and adapt `mathGenerator.ts` / `mcatGenerator.ts` to a provider-agnostic interface.");
  lines.push("- **Sample size**: 1 run per task per model. Stochastic variance is real — production decisions should average 3–5 runs.");
  lines.push("- **Pricing**: model pricing changes frequently. The ratios (relative cost) are more durable than absolute dollar figures.");
  lines.push("- **Lesson caching**: lessons are cached after first generation (stored in DB), so per-student cost is amortized across the full course enrollment. A 5× more expensive lesson model costs proportionally less per student than a 5× more expensive question model (which fires every single practice round).");
  lines.push("");

  const report = lines.join("\n");
  const reportPath = path.resolve(__dirname, "../docs/model-ab-eval.md");
  fs.writeFileSync(reportPath, report, "utf-8");
  console.log(`\nReport written to ${reportPath}`);

  // Print a concise console summary
  console.log("\n=== SCORE SUMMARY ===");
  for (const task of allTaskResults) {
    console.log(`\n${task.taskName}`);
    for (let i = 0; i < task.results.length; i++) {
      const r = task.results[i];
      const s = task.scores[i];
      console.log(`  ${r.model.padEnd(20)} score=${s.score}/100  latency=${r.latencyMs}ms  tokens=${r.inputTokens}in/${r.outputTokens}out${r.error ? "  ERROR=" + r.error.slice(0, 60) : ""}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
