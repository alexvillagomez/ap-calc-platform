/**
 * MCAT Biology content generation.
 * Uses gpt-5.4-mini with JSON mode (same client pattern as learnGenerator.ts).
 * Throws McatGenError on failure — routes surface this as 502.
 */
import OpenAI from "openai";
import { buildBlueprintBlock, type ConceptBlueprint } from "./mcatBlueprint";

const GEN_MODEL = "gpt-5.4-mini";

function createGenClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new McatGenError("OPENAI_API_KEY not set", 500);
  return new OpenAI({ apiKey: key });
}

/**
 * Thrown when MCAT content generation fails.
 * Carries an HTTP status so routes can surface meaningful errors.
 */
export class McatGenError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "McatGenError";
    this.status = status;
  }
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface GeneratedQuestion {
  stem: string;
  choices: [string, string, string, string];
  correct_index: number;
  explanation: string;
  keyword_weights: Record<string, number>;
  difficulty: number;
}

export interface GeneratedFlashcard {
  front: string;
  back: string;
  keyword_weights: Record<string, number>;
}

type KeywordMeta = { id: string; label: string; description: string; blueprint?: ConceptBlueprint | null };

// ─── Shuffle helper ────────────────────────────────────────────────────────────

/**
 * Fisher–Yates shuffle of choices[] while tracking where correct_index lands.
 * Returns a new object with shuffled choices and updated correct_index.
 * Skips shuffle if choices has duplicates or length !== 4 (safety guard).
 */
function shuffleChoices<T extends { choices: string[]; correct_index: number }>(q: T): T {
  const { choices, correct_index } = q;

  // Guard: must be exactly 4 choices with no duplicates
  if (choices.length !== 4) return q;
  const unique = new Set(choices);
  if (unique.size !== 4) return q;

  // Build an index map [0,1,2,3] and shuffle it
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }

  // indices[newPos] = oldPos  →  newChoices[newPos] = choices[oldPos]
  const newChoices = indices.map((oldIdx) => choices[oldIdx]) as [string, string, string, string];
  // Find where the original correct answer ended up
  const newCorrectIndex = indices.indexOf(correct_index);

  return { ...q, choices: newChoices, correct_index: newCorrectIndex };
}

// ─── Difficulty band helpers ───────────────────────────────────────────────────

type DifficultyTier = "easy" | "medium" | "hard";

/** Canonical numeric target for each named tier. */
const TIER_TARGET: Record<DifficultyTier, number> = {
  easy: 0.30,
  medium: 0.55,
  hard: 0.80,
};

/** Return the tier name + its band range for a numeric target. */
function difficultyBandLabel(target: number): { tier: DifficultyTier; bandMin: number; bandMax: number; label: string } {
  if (target <= 0.42) {
    return { tier: "easy", bandMin: 0.20, bandMax: 0.40, label: "EASY" };
  } else if (target <= 0.67) {
    return { tier: "medium", bandMin: 0.45, bandMax: 0.65, label: "MEDIUM" };
  } else {
    return { tier: "hard", bandMin: 0.70, bandMax: 0.90, label: "HARD" };
  }
}

/** Inline description of each band's requirements to embed in prompts. */
const BAND_REQUIREMENTS: Record<DifficultyTier, string> = {
  easy: "Single-step recall or a direct definition/identification. Tests one concept. Distractors are clearly wrong to any student who has studied the material.",
  medium: "Apply a concept or perform one inference or short calculation. Distractors reflect common misconceptions a typical student might hold.",
  hard: "Requires MULTI-STEP reasoning OR integrating two related concepts OR a quantitative/mechanistic chain. The stem must present a scenario, experiment, or specific case — NOT a bare-fact question. ALL FOUR choices must be plausible to a student who only half-understands the material; distractors must encode realistic partial-reasoning errors (right idea/wrong step, correct mechanism/wrong direction, off-by-a-factor, swapped cause-and-effect). A well-prepared student should still have to think carefully. Do NOT make hard questions merely obscure trivia — make them require reasoning.",
};

/** Build the TARGET DIFFICULTY instruction block for a user prompt. */
function difficultyInstruction(target: number): string {
  const { label, bandMin, bandMax, tier } = difficultyBandLabel(target);
  return `TARGET DIFFICULTY: ${target.toFixed(2)} → ${label} band (${bandMin.toFixed(2)}–${bandMax.toFixed(2)}). Requirements: ${BAND_REQUIREMENTS[tier]}
Set the difficulty field to a number inside that band that honestly reflects the cognitive load of your question.`;
}

/** Clamp a returned difficulty into [0.2, 0.9], then optionally nudge toward the target band edge if it strayed >0.2 from band. */
function clampDifficulty(returned: number, target: number): number {
  // Hard clamp to global valid range
  let d = Math.min(0.9, Math.max(0.2, returned));

  const { bandMin, bandMax } = difficultyBandLabel(target);
  // If more than 0.2 outside the requested band, clamp toward band edge
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
    throw new McatGenError(`AI provider request failed: ${msg}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new McatGenError("AI provider returned non-JSON output");
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function isValidQuestion(
  q: unknown,
  allowedKeywordIds: Set<string>,
  targetDifficulty?: number
): q is GeneratedQuestion {
  if (!q || typeof q !== "object") return false;
  const obj = q as Record<string, unknown>;

  if (typeof obj.stem !== "string" || !obj.stem.trim()) return false;
  if (!Array.isArray(obj.choices) || obj.choices.length !== 4) return false;
  if (!(obj.choices as unknown[]).every((c) => typeof c === "string" && (c as string).trim())) return false;
  if (typeof obj.correct_index !== "number") return false;
  const ci = obj.correct_index as number;
  if (ci < 0 || ci > 3 || !Number.isInteger(ci)) return false;
  if (typeof obj.explanation !== "string" || !obj.explanation.trim()) return false;
  if (!obj.keyword_weights || typeof obj.keyword_weights !== "object") return false;
  // keyword ids must be a subset of allowed
  for (const id of Object.keys(obj.keyword_weights as object)) {
    if (!allowedKeywordIds.has(id)) return false;
  }
  if (typeof obj.difficulty !== "number") return false;

  // Clamp difficulty rather than rejecting on it
  const rawD = obj.difficulty as number;
  const target = targetDifficulty ?? 0.55;
  obj.difficulty = clampDifficulty(rawD, target);

  return true;
}

function isValidFlashcard(f: unknown): f is { front: string; back: string; keyword_weights: Record<string, number> } {
  if (!f || typeof f !== "object") return false;
  const obj = f as Record<string, unknown>;
  if (typeof obj.front !== "string" || !obj.front.trim()) return false;
  if (typeof obj.back !== "string" || !obj.back.trim()) return false;
  if (!obj.keyword_weights || typeof obj.keyword_weights !== "object") return false;
  return true;
}

// ─── System prompts ───────────────────────────────────────────────────────────

const QUESTION_SYSTEM = `You write MCAT Biology study questions for a practice app.

Questions test conceptual understanding and specific factual recall — definitions, mechanisms, structures, pathways, classifications — NOT passage-based MCAT-style reasoning. Each question must be fully self-contained.

DIFFICULTY BANDS:
Use the TARGET DIFFICULTY band specified in the user prompt. Write the question AT that band.

  EASY (0.20–0.40): Single-step recall or a direct definition/identification. Tests one concept. Distractors are clearly wrong to any student who has studied the material.

  MEDIUM (0.45–0.65): Apply a concept or perform one inference or short calculation. Distractors reflect common misconceptions a typical student might hold.

  HARD (0.70–0.90): Requires MULTI-STEP reasoning OR integrating two related concepts OR a quantitative/mechanistic chain. The stem must present a scenario, experiment, or specific case — NOT a bare-fact question. ALL FOUR choices must be plausible to a student who only half-understands the material; distractors must encode realistic partial-reasoning errors (right idea/wrong step, correct mechanism/wrong direction, off-by-a-factor, swapped cause-and-effect). A well-prepared student should still have to think carefully. Do NOT make hard questions merely obscure trivia — make them require reasoning.

You will be given a TARGET DIFFICULTY band. Write the question at that band and set the difficulty field to a number inside that band that reflects the actual cognitive load.

QUESTION RULES:
- Self-contained stem of 1–3 sentences. No external passages or figures required.
- Exactly 4 answer choices (A–D as array indices 0–3). One is unambiguously correct.
- Three plausible distractors built from common MCAT misconceptions or closely related concepts.
- Explanation: 2–4 sentences explaining why the correct answer is right AND why the most tempting distractor is wrong.

KEYWORD WEIGHTS:
- keyword_weights maps keyword_id → weight. ONLY use keyword ids explicitly provided.
- Weights must be positive and sum to approximately 1.0.
- Assign higher weight to the primary concept tested.

Return a JSON object:
{
  "questions": [
    {
      "stem": "string",
      "choices": ["string", "string", "string", "string"],
      "correct_index": 0,
      "explanation": "string",
      "keyword_weights": { "keyword_id": 0.8, "keyword_id_2": 0.2 },
      "difficulty": 0.5
    }
  ]
}

Return valid JSON only. No markdown.`;

const SIMILAR_QUESTION_SYSTEM = `You write MCAT Biology study questions for a practice app.

Given an existing question, produce a NEW question that tests the SAME underlying concept from a different angle or with different specifics. Requirements:
- Must NOT be a trivial rewording of the original.
- Different stem scenario, different specific details, different distractors.
- Same level of rigor and self-contained format.
- Distractors must be fresh — do not reuse the original distractors.

DIFFICULTY BANDS:
Match the TARGET DIFFICULTY band specified in the user prompt. Write the question AT that band and set the difficulty field to a number inside that band.

  EASY (0.20–0.40): Single-step recall or a direct definition/identification. Tests one concept. Distractors are clearly wrong to any student who has studied the material.

  MEDIUM (0.45–0.65): Apply a concept or perform one inference or short calculation. Distractors reflect common misconceptions a typical student might hold.

  HARD (0.70–0.90): Requires MULTI-STEP reasoning OR integrating two related concepts OR a quantitative/mechanistic chain. The stem must present a scenario, experiment, or specific case — NOT a bare-fact question. ALL FOUR choices must be plausible to a student who only half-understands the material; distractors must encode realistic partial-reasoning errors (right idea/wrong step, correct mechanism/wrong direction, off-by-a-factor, swapped cause-and-effect). Do NOT make hard questions merely obscure trivia — make them require reasoning.

QUESTION RULES:
- Self-contained stem of 1–3 sentences.
- Exactly 4 answer choices. One unambiguously correct.
- Three plausible distractors from common MCAT misconceptions.
- Explanation: 2–4 sentences on why correct and why the tempting distractor is wrong.

KEYWORD WEIGHTS: Only use the keyword ids provided. Weights sum to ~1.0.

Return a JSON object:
{
  "questions": [
    {
      "stem": "string",
      "choices": ["string", "string", "string", "string"],
      "correct_index": 0,
      "explanation": "string",
      "keyword_weights": { "keyword_id": 1.0 },
      "difficulty": 0.5
    }
  ]
}

Return valid JSON only. No markdown.`;

const FLASHCARD_SYSTEM = `You write MCAT Biology flashcards for a practice app.

FLASHCARD FORMAT:
- front: a focused prompt, question, or cloze-style cue (1–2 sentences). Clear and specific.
- back: a concise direct answer (1–3 sentences) plus one additional sentence elaborating on mechanism, significance, or a common point of confusion.

KEYWORD WEIGHTS: Only use the keyword ids provided. Weights sum to ~1.0.

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

// ─── Exported generators ──────────────────────────────────────────────────────

/**
 * Generate MCAT Biology multiple-choice questions.
 * Validates response shape strictly; retries once if all items are invalid.
 *
 * @param opts.targetDifficulty - numeric target in [0,1]; mapped to EASY/MEDIUM/HARD band
 * @param opts.difficultyTier   - named tier override ('easy'|'medium'|'hard'); overrides targetDifficulty
 */
export async function generateMcatQuestions(opts: {
  keywords: KeywordMeta[];
  templateCards: { plain_text: string }[];
  count: number;
  targetDifficulty?: number;
  difficultyTier?: DifficultyTier;
  outlineContext?: string;
}): Promise<GeneratedQuestion[]> {
  const { keywords, templateCards, count } = opts;

  // Resolve effective numeric target: tier overrides targetDifficulty; default 0.55
  const effectiveTarget: number = opts.difficultyTier
    ? TIER_TARGET[opts.difficultyTier]
    : (opts.targetDifficulty ?? 0.55);

  const allowedIds = new Set(keywords.map((k) => k.id));

  const keywordBlock = keywords
    .map((k) => {
      const base = `  - id: "${k.id}"\n    label: "${k.label}"\n    description: "${k.description}"`;
      const blueprintText = buildBlueprintBlock(k.blueprint);
      if (!blueprintText) return base;
      const indented = blueprintText.split("\n").map((line) => `    ${line}`).join("\n");
      return `${base}\n${indented}`;
    })
    .join("\n");

  const hasBlueprintKeyword = keywords.some((k) => !!k.blueprint);
  const scopeEnforcement = hasBlueprintKeyword
    ? `SCOPE ENFORCEMENT: Each item targets exactly ONE keyword. You MUST obey that keyword's SCOPE CONTRACT (shown under it): test only its in-scope concepts, never require a concept or formula listed OUT OF SCOPE for it. A question/flashcard that requires an out-of-scope concept is INVALID — regenerate it within scope.\n\n`
    : "";

  const templateBlock =
    templateCards.length > 0
      ? `\nREFERENCE FACTS (from a trusted MCAT flashcard deck — ground your content in these where relevant, but do not copy them verbatim):\n${templateCards.map((c, i) => `  [${i + 1}] ${c.plain_text}`).join("\n")}`
      : "";

  const outlineBlock =
    opts.outlineContext
      ? `${opts.outlineContext}\n\nUse the outline above to keep this question within the scope and depth the MCAT actually tests for this area: prefer the listed canonical topics, use MCAT-appropriate terminology, and do not drift into out-of-scope trivia.\n`
      : "";

  const userPrompt = `Generate ${count} MCAT Biology multiple-choice questions.

${outlineBlock}${scopeEnforcement}${difficultyInstruction(effectiveTarget)}

KEYWORDS TO TEST (use ONLY these keyword ids in keyword_weights):
${keywordBlock}
${templateBlock}`;

  const runOnce = async (): Promise<GeneratedQuestion[]> => {
    const parsed = await callGen(QUESTION_SYSTEM, userPrompt);
    const items = Array.isArray(parsed.questions) ? parsed.questions : [];
    return items.filter((q) => isValidQuestion(q, allowedIds, effectiveTarget)) as GeneratedQuestion[];
  };

  let valid = await runOnce();

  // Retry once if all invalid
  if (valid.length === 0) {
    valid = await runOnce();
  }

  // Shuffle choices on every question before returning
  return valid.map(shuffleChoices);
}

/**
 * Generate a single new question that tests the same concept as the source
 * question but from a different angle.
 *
 * @param opts.targetDifficulty - optional numeric target; defaults to source question's difficulty (or 0.6)
 */
export async function generateSimilarQuestion(opts: {
  question: {
    stem: string;
    choices: string[];
    correct_index: number;
    explanation: string;
    keyword_weights: Record<string, number>;
    difficulty?: number;
  };
  keywords: KeywordMeta[];
  targetDifficulty?: number;
  outlineContext?: string;
}): Promise<GeneratedQuestion> {
  const { question, keywords } = opts;

  // Default: match source difficulty; fallback 0.6
  const effectiveTarget: number = opts.targetDifficulty ?? question.difficulty ?? 0.6;

  const allowedIds = new Set(keywords.map((k) => k.id));

  const keywordBlock = keywords
    .map((k) => {
      const base = `  - id: "${k.id}"\n    label: "${k.label}"\n    description: "${k.description}"`;
      const blueprintText = buildBlueprintBlock(k.blueprint);
      if (!blueprintText) return base;
      const indented = blueprintText.split("\n").map((line) => `    ${line}`).join("\n");
      return `${base}\n${indented}`;
    })
    .join("\n");

  const hasBlueprintKeyword = keywords.some((k) => !!k.blueprint);
  const scopeEnforcement = hasBlueprintKeyword
    ? `SCOPE ENFORCEMENT: Each item targets exactly ONE keyword. You MUST obey that keyword's SCOPE CONTRACT (shown under it): test only its in-scope concepts, never require a concept or formula listed OUT OF SCOPE for it. A question/flashcard that requires an out-of-scope concept is INVALID — regenerate it within scope.\n\n`
    : "";

  const outlineBlock =
    opts.outlineContext
      ? `${opts.outlineContext}\n\nUse the outline above to keep this question within the scope and depth the MCAT actually tests for this area: prefer the listed canonical topics, use MCAT-appropriate terminology, and do not drift into out-of-scope trivia.\n\n`
      : "";

  const userPrompt = `Generate a NEW question testing the same concept from a different angle.

${outlineBlock}${scopeEnforcement}${difficultyInstruction(effectiveTarget)}

ORIGINAL QUESTION:
Stem: ${question.stem}
Choices: ${question.choices.map((c, i) => `[${i}] ${c}`).join("; ")}
Correct index: ${question.correct_index}
Explanation: ${question.explanation}

KEYWORDS (use ONLY these keyword ids in keyword_weights):
${keywordBlock}`;

  const runOnce = async (): Promise<GeneratedQuestion[]> => {
    const parsed = await callGen(SIMILAR_QUESTION_SYSTEM, userPrompt);
    const items = Array.isArray(parsed.questions) ? parsed.questions : [];
    return items.filter((q) => isValidQuestion(q, allowedIds, effectiveTarget)) as GeneratedQuestion[];
  };

  let valid = await runOnce();

  if (valid.length === 0) {
    // Retry once
    valid = await runOnce();
  }

  if (valid.length === 0) {
    throw new McatGenError("Similar question generation produced no valid output after retry");
  }

  // Shuffle choices before returning
  return shuffleChoices(valid[0]);
}

// ─── Lesson types ─────────────────────────────────────────────────────────────

export interface McatLessonCheckQuestion {
  latex_content: string;
  choices: [string, string, string, string];
  correct_index: number;
  solution_latex: string;
}

export interface McatMicroStep {
  step_index: number;
  has_check: true;
  explanation_latex: string;
  example_latex: string;
  check_question: McatLessonCheckQuestion;
  hint_latex: string;
}

export interface GeneratedMcatLesson {
  micro_steps: McatMicroStep[];
}

// ─── Lesson system prompt ─────────────────────────────────────────────────────

const MCAT_LESSON_SYSTEM = `You are an MCAT Biology tutor writing micro-lessons. Assume the student has NEVER seen this concept before.

GROUND-UP INSTRUCTION: Step 1 must use the SIMPLEST possible case. Each subsequent step adds exactly one new idea. Steps 3–4 have progressively harder checks.

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
2–4 sentences (max 90 words). Plain prose; chemistry/math in $...$ only when needed.
Steps 2–4 MUST begin with a sentence connecting to the previous step.
Explain the WHY, not just the procedure.

━━━ example_latex ━━━
A concrete worked example or applied MCAT scenario. Plain prose with math in $...$ when needed.
Show every intermediate step.

━━━ check_question (every step) ━━━
• latex_content: clear problem statement in plain text.
• choices: exactly 4 DISTINCT options. Each is a realistic MCAT misconception or plausible distractor.
• correct_index: 0–3.
• Step 1 check: EASY — confirm the student grasped the most basic idea. One concept, distractor is clearly wrong to anyone who read step 1.
• Step 2 check: MEDIUM — apply the idea from step 1 in a slightly different form. Distractors reflect common misconceptions.
• Steps 3–4 check: HARD — require MULTI-STEP reasoning or integration of concepts covered so far. The stem must present a scenario or specific case, not a bare-fact question. ALL FOUR choices must be plausible to a student who only half-understands; distractors encode realistic partial-reasoning errors (right idea/wrong step, correct mechanism/wrong direction, swapped cause-and-effect). A well-prepared student should still have to think carefully. Do NOT make it obscure trivia — make it require reasoning.
• solution_latex: worked explanation showing why the correct answer is right and why the key distractor is wrong.

━━━ hint_latex ━━━
One sentence, max 15 words. Guide the student toward the correct approach without giving it away.

Return valid JSON only. No markdown.`;

// ─── Lesson validation ────────────────────────────────────────────────────────

function isValidMicroStep(s: unknown): s is McatMicroStep {
  if (!s || typeof s !== "object") return false;
  const obj = s as Record<string, unknown>;
  if (typeof obj.step_index !== "number") return false;
  if (typeof obj.explanation_latex !== "string" || !obj.explanation_latex.trim()) return false;
  if (typeof obj.example_latex !== "string" || !obj.example_latex.trim()) return false;
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

function validateLesson(parsed: Record<string, unknown>): GeneratedMcatLesson | null {
  if (!Array.isArray(parsed.micro_steps)) return null;
  const steps = parsed.micro_steps.filter(isValidMicroStep);
  if (steps.length < 3 || steps.length > 5) return null;
  return {
    micro_steps: steps.map((s): McatMicroStep => ({
      step_index: s.step_index,
      has_check: true,
      explanation_latex: s.explanation_latex,
      example_latex: s.example_latex,
      hint_latex: s.hint_latex,
      check_question: {
        latex_content: s.check_question.latex_content,
        choices: (s.check_question.choices as string[]).slice(0, 4) as [string, string, string, string],
        correct_index: s.check_question.correct_index,
        solution_latex: s.check_question.solution_latex,
      },
    })),
  };
}

/** Shuffle each micro-step's check_question choices (Fisher–Yates, same logic as shuffleChoices). */
function shuffleLessonStep(step: McatMicroStep): McatMicroStep {
  const cq = step.check_question;
  const shuffled = shuffleChoices({ choices: [...cq.choices], correct_index: cq.correct_index });
  return {
    ...step,
    check_question: {
      ...cq,
      choices: shuffled.choices as [string, string, string, string],
      correct_index: shuffled.correct_index,
    },
  };
}

// ─── Exported lesson generator ────────────────────────────────────────────────

/**
 * Generate a MCAT Biology micro-lesson for a keyword.
 * Validates shape (3–5 steps, 4 choices, correct_index 0–3).
 * Retries once if invalid; throws McatGenError after.
 */
export async function generateMcatLesson(
  keyword: {
    id: string;
    label: string;
    description: string;
    examples?: string;
    blueprint?: ConceptBlueprint | null;
  },
  outlineContext?: string
): Promise<GeneratedMcatLesson> {
  const outlineBlock =
    outlineContext
      ? `${outlineContext}\n\nUse the outline above to keep the lesson content within the scope the MCAT tests for this area: prefer the listed canonical topics, use MCAT-appropriate terminology, and do not drift into out-of-scope trivia.\n\n`
      : "";

  const scopeBlock = keyword.blueprint ? buildBlueprintBlock(keyword.blueprint) + "\n\n" : "";

  const userPrompt = `${scopeBlock}${outlineBlock}Keyword ID: ${keyword.id}
Label: ${keyword.label}
Description: ${keyword.description}${keyword.examples ? `\nExamples: ${keyword.examples}` : ""}

Think carefully about what a student who has NEVER seen this MCAT Biology concept before would find confusing. Build from the absolute simplest case. Every step must have a check question with distractors based on real MCAT misconceptions. Teach EXACTLY the in-scope concepts listed in the scope contract above, and ensure every check question stays within that scope contract.`;

  let parsed = await callGen(MCAT_LESSON_SYSTEM, userPrompt);
  let lesson = validateLesson(parsed);

  if (!lesson) {
    // Retry once
    parsed = await callGen(MCAT_LESSON_SYSTEM, userPrompt);
    lesson = validateLesson(parsed);
  }

  if (!lesson) {
    throw new McatGenError("Lesson generation produced no valid output after retry");
  }

  // Shuffle choices in every micro-step's check_question
  return {
    micro_steps: lesson.micro_steps.map(shuffleLessonStep),
  };
}

// ─── Fast correctness verifier ────────────────────────────────────────────────

export interface FastVerifyResult {
  /** verifier's independent answer matches correct_index */
  agrees: boolean;
  predicted_index: number | null;
  /** false if the verifier call errored/timed out — fail-open: treat as agrees */
  ok: boolean;
}

const VERIFY_SYSTEM =
  'You are a careful MCAT question solver. Solve the question independently. ' +
  'Pick the single best answer. Return JSON {"answer_index": 0-3, "reason": "<=1 short sentence"}.';

const VERIFY_TIMEOUT_MS = 4000;

/**
 * Runs a single fast, latency-conscious correctness check on a generated
 * MCAT question. Makes one gpt-5.4-mini call in JSON mode without revealing
 * the correct answer. Returns fail-open on any error or timeout.
 */
export async function verifyQuestionFast(
  q: { stem: string; choices: string[]; correct_index: number },
  opts?: { timeoutMs?: number }
): Promise<FastVerifyResult> {
  const timeoutMs = opts?.timeoutMs ?? VERIFY_TIMEOUT_MS;

  const choiceLines = q.choices
    .map((c, i) => `${i}: ${c}`)
    .join("\n");

  const userPrompt =
    `Question:\n${q.stem}\n\nChoices:\n${choiceLines}\n\nWhich choice (0–3) is the single best answer?`;

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
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 3) {
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
      (err.name === "AbortError" || err.message.toLowerCase().includes("abort"));
    if (isAbort) {
      console.warn("[verifyQuestionFast] timed out after", timeoutMs, "ms — failing open");
    } else {
      console.warn("[verifyQuestionFast] error — failing open:", err instanceof Error ? err.message : String(err));
    }
    return { agrees: true, predicted_index: null, ok: false };
  }
}

/**
 * Runs verifyQuestionFast concurrently on all items so total latency ≈ one
 * call, not N. Each item fails open independently.
 */
export async function verifyQuestionsFast(
  qs: { stem: string; choices: string[]; correct_index: number }[],
  opts?: { timeoutMs?: number }
): Promise<FastVerifyResult[]> {
  return Promise.all(qs.map((q) => verifyQuestionFast(q, opts)));
}

// ─── Flashcard generator ──────────────────────────────────────────────────────

/**
 * Generate MCAT Biology flashcards.
 */
export async function generateMcatFlashcards(opts: {
  keywords: KeywordMeta[];
  templateCards: { plain_text: string }[];
  count: number;
  outlineContext?: string;
}): Promise<GeneratedFlashcard[]> {
  const { keywords, templateCards, count } = opts;

  const keywordBlock = keywords
    .map((k) => {
      const base = `  - id: "${k.id}"\n    label: "${k.label}"\n    description: "${k.description}"`;
      const blueprintText = buildBlueprintBlock(k.blueprint);
      if (!blueprintText) return base;
      const indented = blueprintText.split("\n").map((line) => `    ${line}`).join("\n");
      return `${base}\n${indented}`;
    })
    .join("\n");

  const hasBlueprintKeyword = keywords.some((k) => !!k.blueprint);
  const scopeEnforcement = hasBlueprintKeyword
    ? `SCOPE ENFORCEMENT: Each item targets exactly ONE keyword. You MUST obey that keyword's SCOPE CONTRACT (shown under it): test only its in-scope concepts, never require a concept or formula listed OUT OF SCOPE for it. A question/flashcard that requires an out-of-scope concept is INVALID — regenerate it within scope.\n\n`
    : "";

  const templateBlock =
    templateCards.length > 0
      ? `\nREFERENCE FACTS (from a trusted MCAT flashcard deck — ground your content here, but do not copy verbatim):\n${templateCards.map((c, i) => `  [${i + 1}] ${c.plain_text}`).join("\n")}`
      : "";

  const outlineBlock =
    opts.outlineContext
      ? `${opts.outlineContext}\n\nUse the outline above to keep cards within the scope the MCAT tests for this area: prefer the listed canonical topics, use MCAT-appropriate terminology, and do not drift into out-of-scope trivia.\n`
      : "";

  const userPrompt = `Generate ${count} MCAT Biology flashcards.

${outlineBlock}${scopeEnforcement}KEYWORDS TO COVER (use ONLY these keyword ids in keyword_weights):
${keywordBlock}
${templateBlock}`;

  const parsed = await callGen(FLASHCARD_SYSTEM, userPrompt);
  const items = Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
  return items.filter(isValidFlashcard) as GeneratedFlashcard[];
}
