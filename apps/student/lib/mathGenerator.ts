/**
 * Math content generation (precalc + calc_ab).
 * Uses gpt-5.4-mini with JSON mode — reason-first pipeline:
 *   stem → solution → choices (never the other way around).
 *
 * Key adaptations from MCAT:
 * - `stem_latex` / `solution_latex` / `hint_latex` / `choices` fields (spec schema)
 * - ALL math in KaTeX-compatible LaTeX ($...$ inline, $$...$$ display)
 * - Distractors each embody ONE specific predictable student error; solution
 *   briefly names the trap where natural
 * - Lesson generation: 3–4 micro-steps, each with a worked example in LaTeX,
 *   a common-mistake callout, and a check question with LaTeX choices
 * - Grounding: blueprint + outline context + exemplar problems (mathExemplars.ts)
 * - Fast blind-solve verification (~4s timeout, fail-open) for questions + lessons
 * - Difficulty: continuous 0.2–0.9 with easy/medium/hard band mapping
 * - Code-assigned random correct index (model never decides placement)
 */
import OpenAI from "openai";
import { buildBlueprintBlock } from "./mathBlueprint";
import type {
  ConceptBlueprint,
  GeneratedMathQuestion,
  GeneratedMathFlashcard,
  GeneratedMathLesson,
  MathMicroStep,
  MathLessonCheckQuestion,
  FastVerifyResult,
  FastFlashcardVerifyResult,
  MathKeywordMeta,
} from "./mathTypes";

export type { MathKeywordMeta };

const GEN_MODEL = "gpt-5.4-mini";

function createGenClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new MathGenError("OPENAI_API_KEY not set", 500);
  return new OpenAI({ apiKey: key });
}

/**
 * Thrown when math content generation fails.
 * Carries an HTTP status so routes can surface meaningful errors.
 */
export class MathGenError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "MathGenError";
    this.status = status;
  }
}

// ─── Shuffle helper ────────────────────────────────────────────────────────────

/**
 * Fisher–Yates shuffle of choices[] while tracking where correct_index lands.
 */
function shuffleChoices<T extends { choices: string[]; correct_index: number }>(
  q: T
): T {
  const { choices, correct_index } = q;

  if (choices.length !== 4) return q;
  const unique = new Set(choices);
  if (unique.size !== 4) return q;

  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }

  const newChoices = indices.map((oldIdx) => choices[oldIdx]) as [
    string,
    string,
    string,
    string
  ];
  const newCorrectIndex = indices.indexOf(correct_index);

  return { ...q, choices: newChoices, correct_index: newCorrectIndex };
}

// ─── Difficulty band helpers ───────────────────────────────────────────────────

type DifficultyTier = "easy" | "medium" | "hard";

const TIER_TARGET: Record<DifficultyTier, number> = {
  easy: 0.3,
  medium: 0.55,
  hard: 0.8,
};

function difficultyBandLabel(target: number): {
  tier: DifficultyTier;
  bandMin: number;
  bandMax: number;
  label: string;
} {
  if (target <= 0.42) {
    return { tier: "easy", bandMin: 0.2, bandMax: 0.4, label: "EASY" };
  } else if (target <= 0.67) {
    return { tier: "medium", bandMin: 0.45, bandMax: 0.65, label: "MEDIUM" };
  } else {
    return { tier: "hard", bandMin: 0.7, bandMax: 0.9, label: "HARD" };
  }
}

const BAND_REQUIREMENTS: Record<DifficultyTier, string> = {
  easy: "Single-step recall or a direct application of one rule. Tests one concept. Distractors are clearly wrong to any student who studied the material.",
  medium:
    "Apply a concept, perform one algebraic manipulation, or execute one short calculation. Distractors reflect common misconceptions or sign errors a typical student might make.",
  hard: "Requires MULTI-STEP reasoning OR integrating two related concepts OR a multi-step algebraic/calculus chain. The stem must present a specific problem requiring work — NOT a bare-fact question. ALL FOUR choices must be plausible to a student who only half-understands the material; distractors must encode realistic partial-reasoning errors (dropped chain factor, sign flip, wrong formula variant, incorrect exponent rule). A well-prepared student should have to work carefully. Do NOT make hard questions obscure trivia — make them require reasoning.",
};

function difficultyInstruction(target: number): string {
  const { label, bandMin, bandMax, tier } = difficultyBandLabel(target);
  return `TARGET DIFFICULTY: ${target.toFixed(2)} → ${label} band (${bandMin.toFixed(2)}–${bandMax.toFixed(2)}). Requirements: ${BAND_REQUIREMENTS[tier]}
Set the difficulty field to a number inside that band that honestly reflects the cognitive load of your question.`;
}

function clampDifficulty(returned: number, target: number): number {
  let d = Math.min(0.9, Math.max(0.2, returned));
  const { bandMin, bandMax } = difficultyBandLabel(target);
  if (d < bandMin - 0.2) d = bandMin;
  else if (d > bandMax + 0.2) d = bandMax;
  return d;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function callGen(
  system: string,
  user: string
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    const client = createGenClient();
    const completion = await client.chat.completions.create({
      model: GEN_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    text = completion.choices[0]?.message?.content ?? "{}";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MathGenError(`AI provider request failed: ${msg}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new MathGenError("AI provider returned non-JSON output");
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function isValidMathQuestion(
  q: unknown,
  allowedKeywordIds: Set<string>,
  targetDifficulty?: number
): q is Omit<GeneratedMathQuestion, "correct_index"> {
  if (!q || typeof q !== "object") return false;
  const obj = q as Record<string, unknown>;

  if (typeof obj.stem_latex !== "string" || !obj.stem_latex.trim())
    return false;
  if (!Array.isArray(obj.choices) || obj.choices.length !== 4) return false;
  if (
    !(obj.choices as unknown[]).every(
      (c) => typeof c === "string" && (c as string).trim()
    )
  )
    return false;
  const uniqueChoices = new Set(obj.choices as string[]);
  if (uniqueChoices.size !== 4) return false;
  if (typeof obj.solution_latex !== "string" || !obj.solution_latex.trim())
    return false;
  if (typeof obj.hint_latex !== "string") return false;
  if (!obj.keyword_weights || typeof obj.keyword_weights !== "object")
    return false;
  for (const id of Object.keys(obj.keyword_weights as object)) {
    if (!allowedKeywordIds.has(id)) return false;
  }
  if (typeof obj.difficulty !== "number") return false;

  const rawD = obj.difficulty as number;
  const target = targetDifficulty ?? 0.55;
  obj.difficulty = clampDifficulty(rawD, target);

  return true;
}

function isValidFlashcard(
  f: unknown
): f is {
  front_latex: string;
  back_latex: string;
  keyword_weights: Record<string, number>;
} {
  if (!f || typeof f !== "object") return false;
  const obj = f as Record<string, unknown>;
  if (typeof obj.front_latex !== "string" || !obj.front_latex.trim())
    return false;
  if (typeof obj.back_latex !== "string" || !obj.back_latex.trim())
    return false;
  if (!obj.keyword_weights || typeof obj.keyword_weights !== "object")
    return false;
  return true;
}

// ─── System prompts ───────────────────────────────────────────────────────────

const LATEX_RULES = `LATEX RULES (MANDATORY — violations produce unusable output):
- ALL math MUST be in KaTeX-compatible LaTeX: $...$ for inline, $$...$$ for display.
- stem_latex: the problem statement as PLAIN PROSE with every math expression wrapped in $...$.
  E.g. "What is the sign of $\\dfrac{-9}{-3}$?" — never \\text{} for prose, never bare commands.
- solution_latex: full WORKED SOLUTION showing every step with \\n\\n between steps.
  Format: PLAIN PROSE sentences with every math expression wrapped in $...$ (or $$...$$ for a
  standalone step result). NEVER write bare LaTeX commands outside $ delimiters, and never put
  prose inside \\text{}.
  E.g. "Apply the power rule: $\\dfrac{d}{dx}[x^3] = 3x^2$.\\n\\nSo the slope at $x = 2$ is $3(2)^2 = 12$."
- hint_latex: one sentence max 15 words guiding toward the approach without giving the answer.
- choices: EXACTLY 4 strings. Each choice that contains math MUST wrap it in $...$. Prose-only choices need no delimiters.
- NO unicode math symbols (×, ÷, ≤, ≥, √, π in plain text, etc.) — use \\times, \\div, \\leq, \\geq, \\sqrt{}, \\pi instead.
- NO \\text{} abuse for math: do not write \\text{3x^2} — write $3x^2$ or just 3x^2 in the math context.`;

const DISTRACTOR_RULES = `DISTRACTOR RULES:
- Each of the 3 wrong choices must embody ONE specific, predictable student error:
  e.g., forgetting the chain factor, sign flip on a negative exponent, adding instead of multiplying exponents, wrong formula variant, off-by-one on a derivative index.
- Name the trap briefly in solution_latex when natural (e.g., "Note: choice $2x^3$ results from forgetting to bring down the exponent in the power rule.").
- All 4 choices must be distinct and plausible to a student who partially understands the material.`;

const QUESTION_SYSTEM = `You write math practice questions for an AP Precalculus / AP Calculus AB adaptive learning app.

Questions test procedural skills, conceptual understanding, and applied reasoning — fully self-contained.

${LATEX_RULES}

${DISTRACTOR_RULES}

DIFFICULTY BANDS:
  EASY (0.20–0.40): Single-step application of one rule. One concept tested. Distractors are clearly wrong to any student who studied.
  MEDIUM (0.45–0.65): Apply one concept or execute one algebraic/calculus step. Distractors reflect common sign errors or formula confusions.
  HARD (0.70–0.90): Multi-step reasoning or integrating two related concepts. Stem presents a specific problem requiring work. ALL FOUR choices must be plausible to a student who only half-understands; distractors encode realistic partial-reasoning errors. Do NOT make hard questions obscure trivia.

OUTPUT ORDER — FOLLOW EXACTLY:
FIRST write stem_latex. THEN write solution_latex: fully work out the correct answer step by step. THEN write the four choices. Never decide the answer before completing solution_latex. In solution_latex, refer to the correct answer by its VALUE, never by a letter or position.

The user prompt specifies an ANSWER PLACEMENT: which 0-based index the correct answer must occupy. Place the correct answer at exactly that index; fill the other three with plausible distractors. Do NOT include a correct_index field in your output.

Return a JSON object:
{
  "questions": [
    {
      "stem_latex": "string",
      "solution_latex": "string",
      "hint_latex": "string",
      "choices": ["string", "string", "string", "string"],
      "keyword_weights": { "keyword_id": 0.8, "keyword_id_2": 0.2 },
      "difficulty": 0.5
    }
  ]
}

Return valid JSON only. No markdown.`;

const SIMILAR_QUESTION_SYSTEM = `You write math practice questions for an AP Precalculus / AP Calculus AB adaptive learning app.

Given an existing question, produce a NEW question testing the SAME underlying concept from a different angle or with different specific numbers/expressions. Requirements:
- MUST NOT be a trivial rewording of the original.
- Different stem scenario, different specific values, different distractors.
- Same level of rigor and self-contained format.
- Distractors must be fresh — do not reuse the original distractors.

${LATEX_RULES}

${DISTRACTOR_RULES}

DIFFICULTY BANDS (match the target):
  EASY (0.20–0.40) | MEDIUM (0.45–0.65) | HARD (0.70–0.90) — see main system prompt for details.

OUTPUT ORDER — FOLLOW EXACTLY:
FIRST write stem_latex. THEN write solution_latex. THEN write choices. Refer to the correct answer by VALUE in solution_latex.

The user prompt specifies an ANSWER PLACEMENT index. Do NOT include correct_index.

Return a JSON object:
{
  "questions": [
    {
      "stem_latex": "string",
      "solution_latex": "string",
      "hint_latex": "string",
      "choices": ["string", "string", "string", "string"],
      "keyword_weights": { "keyword_id": 1.0 },
      "difficulty": 0.5
    }
  ]
}

Return valid JSON only. No markdown.`;

const FLASHCARD_SYSTEM = `You write math flashcards for an AP Precalculus / AP Calculus AB adaptive learning app.

FLASHCARD FORMAT:
- front_latex: a focused prompt, definition cue, or fill-in-the-blank (1–2 sentences). Use $...$ for any math.
- back_latex: concise direct answer (1–3 sentences) plus one additional sentence elaborating on the mechanism or common confusion. Use $...$ for any math.

${LATEX_RULES.split("\n").slice(0, 3).join("\n")}

KEYWORD WEIGHTS: Only use the keyword ids provided. Weights sum to ~1.0.

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

// ─── Lesson system prompt ─────────────────────────────────────────────────────

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
    "choices": ["A", "B", "C", "D"],
    "correct_index": 0-3,
    "solution_latex": string
  },
  "hint_latex": string
}

━━━ explanation_latex ━━━
2–4 sentences (max 90 words). Plain prose with $...$ math only when needed.
Steps 2–4 MUST begin with a sentence connecting to the previous step.
Explain the WHY, not just the procedure.
CRITICAL: teach EXACTLY the ONE in-scope skill defined in the scope contract — do not expand.

━━━ example_latex ━━━
A concrete WORKED EXAMPLE applying the in-scope skill. Show every intermediate step.
Use \\text{ prose. } math_result format. Separate steps with \\n\\n.
Include a common-mistake callout: "\\text{Common mistake: } ..." pointing to the most likely error.

━━━ check_question ━━━
• latex_content: clear problem statement using $...$ for math.
• choices: exactly 4 DISTINCT options in $...$ if they contain math.
• correct_index: 0–3.
• Step 1: EASY — confirm the student grasped the most basic idea. One concept; distractor is clearly wrong to anyone who read step 1.
• Step 2: MEDIUM — apply the idea in a slightly different form. Distractors reflect common misconceptions (sign error, wrong rule, off-by-one exponent).
• Steps 3–4: HARD — multi-step reasoning or integration of concepts so far. ALL FOUR choices plausible to a half-understanding student; distractors encode realistic partial-reasoning errors. Make it require work, not trivia.
• solution_latex: worked explanation; state why the correct answer is right and why the key distractor is wrong.

━━━ hint_latex ━━━
One sentence, max 15 words. Guide toward the correct approach without giving it away.

LATEX RULES: All math in $...$ (inline) or $$...$$ (display). No unicode math symbols. No \\text{} abuse.

Return valid JSON only. No markdown.`;

// ─── Lesson validation ────────────────────────────────────────────────────────

function isValidMicroStep(s: unknown): s is MathMicroStep {
  if (!s || typeof s !== "object") return false;
  const obj = s as Record<string, unknown>;
  if (typeof obj.step_index !== "number") return false;
  if (
    typeof obj.explanation_latex !== "string" ||
    !obj.explanation_latex.trim()
  )
    return false;
  if (typeof obj.example_latex !== "string" || !obj.example_latex.trim())
    return false;
  if (typeof obj.hint_latex !== "string") return false;
  const cq = obj.check_question as Record<string, unknown> | undefined;
  if (!cq || typeof cq !== "object") return false;
  if (typeof cq.latex_content !== "string") return false;
  if (!Array.isArray(cq.choices) || cq.choices.length !== 4) return false;
  if (typeof cq.correct_index !== "number") return false;
  const ci = cq.correct_index as number;
  if (ci < 0 || ci > 3 || !Number.isInteger(ci)) return false;
  if (typeof cq.solution_latex !== "string") return false;
  return true;
}

function validateLesson(
  parsed: Record<string, unknown>
): GeneratedMathLesson | null {
  if (!Array.isArray(parsed.micro_steps)) return null;
  const steps = parsed.micro_steps.filter(isValidMicroStep);
  if (steps.length < 3 || steps.length > 5) return null;
  return {
    micro_steps: steps.map(
      (s): MathMicroStep => ({
        step_index: s.step_index,
        has_check: true,
        explanation_latex: s.explanation_latex,
        example_latex: s.example_latex,
        hint_latex: s.hint_latex,
        check_question: {
          latex_content: s.check_question.latex_content,
          choices: (s.check_question.choices as string[]).slice(0, 4) as [
            string,
            string,
            string,
            string
          ],
          correct_index: s.check_question.correct_index,
          solution_latex: s.check_question.solution_latex,
        } as MathLessonCheckQuestion,
      })
    ),
  };
}

function shuffleLessonStep(step: MathMicroStep): MathMicroStep {
  const cq = step.check_question;
  const shuffled = shuffleChoices({
    choices: [...cq.choices],
    correct_index: cq.correct_index,
  });
  return {
    ...step,
    check_question: {
      ...cq,
      choices: shuffled.choices as [string, string, string, string],
      correct_index: shuffled.correct_index,
    },
  };
}

// ─── Keyword block builder ────────────────────────────────────────────────────

function buildKeywordBlock(keywords: MathKeywordMeta[]): string {
  return keywords
    .map((k) => {
      const base = `  - id: "${k.id}"\n    label: "${k.label}"\n    description: "${k.description}"`;
      const blueprintText = buildBlueprintBlock(k.blueprint);
      if (!blueprintText) return base;
      const indented = blueprintText
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
      return `${base}\n${indented}`;
    })
    .join("\n");
}

// ─── Exported question generator ─────────────────────────────────────────────

/**
 * Generate AP math multiple-choice questions.
 * Validates response shape strictly; retries once if all items are invalid.
 *
 * @param opts.targetDifficulty - numeric target in [0,1]; mapped to EASY/MEDIUM/HARD band
 * @param opts.difficultyTier   - named tier override ('easy'|'medium'|'hard'); overrides targetDifficulty
 * @param opts.exemplarBlock    - pre-built house-style exemplar block (from buildExemplarBlock)
 */
export async function generateMathQuestions(opts: {
  keywords: MathKeywordMeta[];
  count: number;
  targetDifficulty?: number;
  difficultyTier?: DifficultyTier;
  outlineContext?: string;
  exemplarBlock?: string;
}): Promise<GeneratedMathQuestion[]> {
  const { keywords, count } = opts;

  const effectiveTarget: number = opts.difficultyTier
    ? TIER_TARGET[opts.difficultyTier]
    : (opts.targetDifficulty ?? 0.55);

  const allowedIds = new Set(keywords.map((k) => k.id));
  const keywordBlock = buildKeywordBlock(keywords);
  const hasBlueprintKeyword = keywords.some((k) => !!k.blueprint);

  const scopeEnforcement = hasBlueprintKeyword
    ? `SCOPE ENFORCEMENT: Each item targets exactly ONE keyword. You MUST obey that keyword's SCOPE CONTRACT: test only its in-scope concepts; never require a concept or formula listed OUT OF SCOPE. A question whose PRIMARY tested skill is out-of-scope is INVALID — regenerate it within scope.\n\n`
    : "";

  const outlineBlock = opts.outlineContext
    ? `${opts.outlineContext}\n\nUse the outline above to keep questions within the scope and depth the AP exam tests for this area: prefer the listed canonical topics, use correct mathematical notation, and do not drift into out-of-scope content.\n\n`
    : "";

  const exemplarSection = opts.exemplarBlock
    ? `\n${opts.exemplarBlock}\n\nMATCH the above house style exactly: KaTeX stems, $...$ choices, worked solution with steps, distractors that each embody one specific student error.\n`
    : "";

  const targetIndices = Array.from({ length: count }, () =>
    Math.floor(Math.random() * 4)
  );

  const placementLines = targetIndices
    .map((t, i) => `Question ${i + 1} → index ${t}`)
    .join("; ");

  const placementBlock = `\nANSWER PLACEMENT (the correct answer MUST be at this index in choices; fill the other three with plausible distractors): ${placementLines}`;

  const userPrompt = `Generate ${count} AP math multiple-choice question${count > 1 ? "s" : ""}.

${outlineBlock}${scopeEnforcement}${difficultyInstruction(effectiveTarget)}

KEYWORDS TO TEST (use ONLY these keyword ids in keyword_weights):
${keywordBlock}
${exemplarSection}${placementBlock}`;

  const runOnce = async (): Promise<GeneratedMathQuestion[]> => {
    const parsed = await callGen(QUESTION_SYSTEM, userPrompt);
    const items = Array.isArray(parsed.questions) ? parsed.questions : [];
    const validItems = items.filter((q) =>
      isValidMathQuestion(q, allowedIds, effectiveTarget)
    );
    return validItems.map((q, i) => ({
      ...(q as Omit<GeneratedMathQuestion, "correct_index">),
      correct_index: targetIndices[i] ?? 0,
    })) as GeneratedMathQuestion[];
  };

  let valid = await runOnce();

  if (valid.length === 0) {
    valid = await runOnce();
  }

  return valid;
}

// ─── Similar question generator ───────────────────────────────────────────────

/**
 * Generate a new question testing the same concept as the source question
 * but from a different angle or with different specifics.
 */
export async function generateSimilarMathQuestion(opts: {
  question: {
    stem_latex: string;
    choices: string[];
    correct_index: number;
    solution_latex: string;
    keyword_weights: Record<string, number>;
    difficulty?: number;
  };
  keywords: MathKeywordMeta[];
  targetDifficulty?: number;
  outlineContext?: string;
  exemplarBlock?: string;
}): Promise<GeneratedMathQuestion> {
  const { question, keywords } = opts;
  const effectiveTarget: number =
    opts.targetDifficulty ?? question.difficulty ?? 0.6;

  const allowedIds = new Set(keywords.map((k) => k.id));
  const keywordBlock = buildKeywordBlock(keywords);
  const hasBlueprintKeyword = keywords.some((k) => !!k.blueprint);

  const scopeEnforcement = hasBlueprintKeyword
    ? `SCOPE ENFORCEMENT: You MUST obey the keyword's SCOPE CONTRACT. A question whose PRIMARY tested skill is out-of-scope is INVALID.\n\n`
    : "";

  const outlineBlock = opts.outlineContext
    ? `${opts.outlineContext}\n\nKeep within scope and depth the AP exam tests.\n\n`
    : "";

  const exemplarSection = opts.exemplarBlock
    ? `\n${opts.exemplarBlock}\n\nMatch the house style: KaTeX stems, $...$ choices, worked solution.\n`
    : "";

  const targetIndex = Math.floor(Math.random() * 4);

  const userPrompt = `Generate a NEW question testing the same concept from a different angle.

${outlineBlock}${scopeEnforcement}${difficultyInstruction(effectiveTarget)}

ORIGINAL QUESTION:
stem_latex: ${question.stem_latex}
choices: ${question.choices.map((c, i) => `[${i}] ${c}`).join("; ")}
solution: ${question.solution_latex.slice(0, 200)}...

ANSWER PLACEMENT: Question 1 → index ${targetIndex}

KEYWORDS (use ONLY these keyword ids):
${keywordBlock}
${exemplarSection}`;

  const runOnce = async (): Promise<GeneratedMathQuestion[]> => {
    const parsed = await callGen(SIMILAR_QUESTION_SYSTEM, userPrompt);
    const items = Array.isArray(parsed.questions) ? parsed.questions : [];
    const validItems = items.filter((q) =>
      isValidMathQuestion(q, allowedIds, effectiveTarget)
    );
    return validItems.map((q) => ({
      ...(q as Omit<GeneratedMathQuestion, "correct_index">),
      correct_index: targetIndex,
    })) as GeneratedMathQuestion[];
  };

  let valid = await runOnce();

  if (valid.length === 0) {
    valid = await runOnce();
  }

  if (valid.length === 0) {
    throw new MathGenError(
      "Similar question generation produced no valid output after retry"
    );
  }

  return valid[0];
}

// ─── Flashcard generator ──────────────────────────────────────────────────────

/**
 * Generate math flashcards.
 */
export async function generateMathFlashcards(opts: {
  keywords: MathKeywordMeta[];
  count: number;
  outlineContext?: string;
}): Promise<GeneratedMathFlashcard[]> {
  const { keywords, count } = opts;
  const keywordBlock = buildKeywordBlock(keywords);
  const hasBlueprintKeyword = keywords.some((k) => !!k.blueprint);

  const scopeEnforcement = hasBlueprintKeyword
    ? `SCOPE ENFORCEMENT: Each flashcard targets exactly ONE keyword and must stay within its SCOPE CONTRACT.\n\n`
    : "";

  const outlineBlock = opts.outlineContext
    ? `${opts.outlineContext}\n\nUse the outline to keep cards within the scope the AP exam tests.\n`
    : "";

  const userPrompt = `Generate ${count} AP math flashcard${count > 1 ? "s" : ""}.

${outlineBlock}${scopeEnforcement}KEYWORDS TO COVER (use ONLY these keyword ids in keyword_weights):
${keywordBlock}`;

  const parsed = await callGen(FLASHCARD_SYSTEM, userPrompt);
  const items = Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
  return items.filter(isValidFlashcard) as GeneratedMathFlashcard[];
}

// ─── Lesson generator ─────────────────────────────────────────────────────────

/**
 * Generate a math micro-lesson for a keyword.
 * 3–4 steps: worked example with LaTeX + common-mistake callout + check question.
 * Retries once if invalid; throws MathGenError after.
 */
export async function generateMathLesson(
  keyword: {
    id: string;
    label: string;
    description: string;
    examples?: string;
    blueprint?: ConceptBlueprint | null;
  },
  outlineContext?: string,
  exemplarBlock?: string
): Promise<GeneratedMathLesson> {
  const outlineBlock = outlineContext
    ? `${outlineContext}\n\nUse the outline to keep the lesson within the scope the AP exam tests for this area.\n\n`
    : "";

  const scopeBlock = keyword.blueprint
    ? buildBlueprintBlock(keyword.blueprint) + "\n\n"
    : "";

  const exemplarSection = exemplarBlock
    ? `${exemplarBlock}\n\nMatch this worked-example style in your example_latex fields.\n\n`
    : "";

  const userPrompt = `${scopeBlock}${outlineBlock}${exemplarSection}Keyword ID: ${keyword.id}
Label: ${keyword.label}
Description: ${keyword.description}${keyword.examples ? `\nExamples: ${keyword.examples}` : ""}

Think carefully about what a student who has NEVER seen this AP math concept before would find confusing.
Build from the absolute simplest case in step 1.
Teach EXACTLY the ONE in-scope skill defined in the scope contract above.
In example_latex, always include:
  (a) a fully worked example with KaTeX notation showing each step,
  (b) a "Common mistake:" callout identifying the most predictable error.
Every check question must stay strictly within the scope contract.`;

  let parsed = await callGen(MATH_LESSON_SYSTEM, userPrompt);
  let lesson = validateLesson(parsed);

  if (!lesson) {
    parsed = await callGen(MATH_LESSON_SYSTEM, userPrompt);
    lesson = validateLesson(parsed);
  }

  if (!lesson) {
    throw new MathGenError(
      "Lesson generation produced no valid output after retry"
    );
  }

  return {
    micro_steps: lesson.micro_steps.map(shuffleLessonStep),
  };
}

// ─── Fast correctness verifier ────────────────────────────────────────────────

const VERIFY_SYSTEM =
  "You are a careful AP math problem solver. Solve the question independently. " +
  "Pick the single best answer. Return JSON {\"answer_index\": 0-3, \"reason\": \"<=1 short sentence\"}.";

const VERIFY_TIMEOUT_MS = 4000;

/**
 * Runs a single fast, latency-conscious correctness check on a generated
 * math question. Returns fail-open on any error or timeout.
 */
export async function verifyMathQuestionFast(
  q: { stem_latex: string; choices: string[]; correct_index: number },
  opts?: { timeoutMs?: number }
): Promise<FastVerifyResult> {
  const timeoutMs = opts?.timeoutMs ?? VERIFY_TIMEOUT_MS;

  const choiceLines = q.choices.map((c, i) => `${i}: ${c}`).join("\n");

  const userPrompt = `Question:\n${q.stem_latex}\n\nChoices:\n${choiceLines}\n\nWhich choice (0–3) is the single best answer?`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return { agrees: true, predicted_index: null, ok: false };
    }
    const client = new OpenAI({ apiKey: key });

    const completion = await client.chat.completions.create(
      {
        model: GEN_MODEL,
        messages: [
          { role: "system", content: VERIFY_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 80,
      },
      { signal: controller.signal }
    );

    clearTimeout(timer);

    const text = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { agrees: true, predicted_index: null, ok: false };
    }

    const raw = parsed.answer_index;
    if (
      typeof raw !== "number" ||
      !Number.isInteger(raw) ||
      raw < 0 ||
      raw > 3
    ) {
      return { agrees: true, predicted_index: null, ok: false };
    }

    const predicted_index = raw as number;
    return {
      agrees: predicted_index === q.correct_index,
      predicted_index,
      ok: true,
    };
  } catch (err) {
    clearTimeout(timer);
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" ||
        err.message.toLowerCase().includes("abort"));
    if (isAbort) {
      console.warn(
        "[verifyMathQuestionFast] timed out after",
        timeoutMs,
        "ms — failing open"
      );
    } else {
      console.warn(
        "[verifyMathQuestionFast] error — failing open:",
        err instanceof Error ? err.message : String(err)
      );
    }
    return { agrees: true, predicted_index: null, ok: false };
  }
}

/**
 * Runs verifyMathQuestionFast concurrently on all items so total latency ≈ one call.
 */
export async function verifyMathQuestionsFast(
  qs: { stem_latex: string; choices: string[]; correct_index: number }[],
  opts?: { timeoutMs?: number }
): Promise<FastVerifyResult[]> {
  return Promise.all(qs.map((q) => verifyMathQuestionFast(q, opts)));
}

// ─── Fast flashcard fact-checker ──────────────────────────────────────────────

const FLASHCARD_VERIFY_SYSTEM =
  "You are a careful AP math fact-checker. " +
  "Given a flashcard FRONT (prompt) and BACK (answer), decide whether the BACK is correct and accurate. " +
  'Return JSON {"correct": true|false, "reason": "<=1 sentence"}.';

const FLASHCARD_VERIFY_TIMEOUT_MS = 4000;

/**
 * Fact-checks a single flashcard. Fail-open on any error/timeout.
 */
export async function verifyMathFlashcardFast(
  card: { front_latex: string; back_latex: string },
  opts?: { timeoutMs?: number }
): Promise<FastFlashcardVerifyResult> {
  const timeoutMs = opts?.timeoutMs ?? FLASHCARD_VERIFY_TIMEOUT_MS;

  const userPrompt = `FRONT: ${card.front_latex}\n\nBACK: ${card.back_latex}\n\nIs the BACK a correct and accurate answer to the FRONT?`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return { valid: true, ok: false };
    }
    const client = new OpenAI({ apiKey: key });

    const completion = await client.chat.completions.create(
      {
        model: GEN_MODEL,
        messages: [
          { role: "system", content: FLASHCARD_VERIFY_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 80,
      },
      { signal: controller.signal }
    );

    clearTimeout(timer);

    const text = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { valid: true, ok: false };
    }

    const correct = parsed.correct;
    if (typeof correct !== "boolean") {
      return { valid: true, ok: false };
    }

    return { valid: correct === true, ok: true };
  } catch (err) {
    clearTimeout(timer);
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" ||
        err.message.toLowerCase().includes("abort"));
    if (isAbort) {
      console.warn(
        "[verifyMathFlashcardFast] timed out after",
        timeoutMs,
        "ms — failing open"
      );
    } else {
      console.warn(
        "[verifyMathFlashcardFast] error — failing open:",
        err instanceof Error ? err.message : String(err)
      );
    }
    return { valid: true, ok: false };
  }
}

/**
 * Runs verifyMathFlashcardFast concurrently on all cards.
 */
export async function verifyMathFlashcardsFast(
  cards: { front_latex: string; back_latex: string }[],
  opts?: { timeoutMs?: number }
): Promise<FastFlashcardVerifyResult[]> {
  return Promise.all(cards.map((c) => verifyMathFlashcardFast(c, opts)));
}

// ─── Lesson verifier ──────────────────────────────────────────────────────────

const LESSON_VERIFY_SYSTEM =
  "You are a careful AP math content reviewer. " +
  "Given a micro-lesson step, check: (1) is the example_latex mathematically correct? " +
  "(2) does the check_question have a clearly correct unique answer at the stated correct_index? " +
  'Return JSON {"step_ok": true|false, "reason": "<=1 sentence"}.';

/**
 * Fast check on a single lesson step — fail-open.
 */
export async function verifyLessonStepFast(
  step: MathMicroStep,
  opts?: { timeoutMs?: number }
): Promise<{ step_ok: boolean; ok: boolean }> {
  const timeoutMs = opts?.timeoutMs ?? VERIFY_TIMEOUT_MS;

  const userPrompt =
    `Step ${step.step_index} example:\n${step.example_latex}\n\n` +
    `Check question:\n${step.check_question.latex_content}\n` +
    `Choices: ${step.check_question.choices.map((c, i) => `${i}: ${c}`).join("  ")}\n` +
    `Stated correct_index: ${step.check_question.correct_index}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { step_ok: true, ok: false };
    const client = new OpenAI({ apiKey: key });

    const completion = await client.chat.completions.create(
      {
        model: GEN_MODEL,
        messages: [
          { role: "system", content: LESSON_VERIFY_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 80,
      },
      { signal: controller.signal }
    );

    clearTimeout(timer);

    const text = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { step_ok: true, ok: false };
    }

    const step_ok = parsed.step_ok;
    if (typeof step_ok !== "boolean") return { step_ok: true, ok: false };
    return { step_ok, ok: true };
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      "[verifyLessonStepFast] error/timeout — failing open:",
      err instanceof Error ? err.message : String(err)
    );
    return { step_ok: true, ok: false };
  }
}
