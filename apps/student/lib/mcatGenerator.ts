/**
 * MCAT Biology content generation.
 * Uses gpt-5.4-mini with JSON mode (same client pattern as learnGenerator.ts).
 * Throws McatGenError on failure — routes surface this as 502.
 */
import OpenAI from "openai";
import { buildBlueprintBlock, type ConceptBlueprint } from "./mcatBlueprint";
import { parseModelJson } from "./parseModelJson";
import { assembleChoices } from "./assembleChoices";

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

// ─── Shared LaTeX delimiter rule ──────────────────────────────────────────────

/**
 * MCAT content is mostly prose, but any math/chemistry notation (pH, pKa, charges,
 * ratios, $H_2O$, aligned steps in solutions/examples) MUST be delimited or it
 * renders as literal backslashes. Included in every system prompt.
 */
const MCAT_DELIMITER_RULE = `MATH/NOTATION DELIMITERS (mandatory in EVERY field — stem, choices, explanation, example, solution):
Wrap EVERY math or chemistry expression in $...$ (inline) or $$...$$ (block). NEVER emit bare LaTeX and NEVER use \\text{}. Bare LaTeX outside delimiters does not render.
  ✅ CORRECT: "At physiological pH, the side chain carries a charge of $+1$." / "$$\\text{rate} \\propto [S]$$"
  ❌ WRONG (bare): "\\frac{[A^-]}{[HA]}" or "\\begin{aligned}...\\end{aligned}" without $$...$$

SCIENCE SUBSCRIPTS & IONS (mandatory — use KaTeX notation for ALL biochemistry/chemistry symbols):
  ✅ CORRECT enzyme kinetics: "$V_{max}$" not "Vmax" / "$K_m$" not "Km" / "$K_{cat}$" not "Kcat"
  ✅ CORRECT acid-base: "$pK_a$" not "pKa" / "$pK_b$" not "pKb" / "$K_{eq}$" not "Keq"
  ✅ CORRECT molecules: "$H_2O$" not "H2O" / "$CO_2$" not "CO2" / "$O_2$" not "O2" / "$NH_3$" not "NH3"
  ✅ CORRECT ions: "$MnO_4^-$" not "MnO4-" / "$OH^-$" not "OH-" / "$H^+$" not "H+" / "$H_3O^+$" not "H3O+"
  ✅ CORRECT cofactors: "$NAD^+$" not "NAD+" / "$FADH_2$" not "FADH2" / "$HCO_3^-$" not "HCO3-"
  ❌ WRONG: writing "H2O", "CO2", "Vmax", "Km", "pKa", "NAD+", "MnO4-", "OH-" — these render as flat ASCII`;

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
    return parseModelJson<Record<string, unknown>>(text);
  } catch {
    throw new McatGenError("AI provider returned non-JSON output");
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Validates the shape of a model-returned question (before code assigns correct_index).
 * The model no longer returns correct_index — that is assigned by the caller after validation.
 * Returns true and mutates obj.difficulty (clamp) if valid.
 */
/** Raw model output for a question, BEFORE code assembles choices/correct_index. */
interface RawQuestion {
  stem: string;
  explanation: string;
  correct_answer: string;
  distractors: string[];
  keyword_weights: Record<string, number>;
  difficulty: number;
}

function isValidQuestion(
  q: unknown,
  allowedKeywordIds: Set<string>,
  targetDifficulty?: number
): q is RawQuestion {
  if (!q || typeof q !== "object") return false;
  const obj = q as Record<string, unknown>;

  if (typeof obj.stem !== "string" || !obj.stem.trim()) return false;
  if (typeof obj.explanation !== "string" || !obj.explanation.trim()) return false;
  // Correct answer is taken from the explanation's concluded answer.
  if (typeof obj.correct_answer !== "string" || !obj.correct_answer.trim()) return false;
  // Need ≥3 distractors to assemble a 4-option item (assembleChoices re-checks distinctness).
  if (!Array.isArray(obj.distractors) || obj.distractors.length < 3) return false;
  if (!(obj.distractors as unknown[]).every((c) => typeof c === "string" && (c as string).trim())) return false;
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

/**
 * Assemble a validated raw question into a GeneratedQuestion: the correct choice
 * is correct_answer (from the explanation), placed at a random index.
 * Returns null if choices can't be formed (caller drops it).
 */
function assembleQuestion(raw: RawQuestion): GeneratedQuestion | null {
  const assembled = assembleChoices(raw.correct_answer, raw.distractors);
  if (!assembled) return null;
  return {
    stem: raw.stem,
    explanation: raw.explanation,
    keyword_weights: raw.keyword_weights,
    difficulty: raw.difficulty,
    choices: assembled.choices,
    correct_index: assembled.correct_index,
  };
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

${MCAT_DELIMITER_RULE}

KEYWORD WEIGHTS:
- keyword_weights maps keyword_id → weight. ONLY use keyword ids explicitly provided.
- Weights must be positive and sum to approximately 1.0.
- Assign higher weight to the primary concept tested.

OUTPUT ORDER — YOU MUST FOLLOW THIS EXACTLY (mandatory; do not reorder):
1. FIRST write the stem.
2. THEN write the explanation: fully work out the correct answer step by step until you reach a single best answer. Never decide the answer before completing the explanation; refer to it by its VALUE/content, never by a letter or position.
3. THEN set correct_answer to EXACTLY the answer your explanation concluded (copy it verbatim). This value WILL become the correct choice.
4. THEN write distractors: EXACTLY 3 plausible-but-wrong answers built from common MCAT misconceptions, all distinct from one another AND from correct_answer.

Do NOT output a "choices" array and do NOT output a "correct_index": the app builds the four choices from correct_answer + distractors and randomly places the correct one. Because the correct choice is taken from correct_answer, it MUST match what the explanation concluded.

Return a JSON object where each question has fields in this order:
{
  "questions": [
    {
      "stem": "string",
      "explanation": "string",
      "correct_answer": "string",
      "distractors": ["string", "string", "string"],
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

${MCAT_DELIMITER_RULE}

KEYWORD WEIGHTS: Only use the keyword ids provided. Weights sum to ~1.0.

OUTPUT ORDER — YOU MUST FOLLOW THIS EXACTLY (mandatory):
1. FIRST write the stem.
2. THEN write the explanation: fully work out the correct answer step by step. Refer to it by VALUE/content, never by letter or position.
3. THEN set correct_answer to EXACTLY the answer the explanation concluded (copy verbatim). This becomes the correct choice.
4. THEN write distractors: EXACTLY 3 plausible-but-wrong answers from common MCAT misconceptions, all distinct from each other and from correct_answer.

Do NOT output "choices" or "correct_index" — the app assembles the four options and randomly places the correct one.

Return a JSON object where each question has fields in this order:
{
  "questions": [
    {
      "stem": "string",
      "explanation": "string",
      "correct_answer": "string",
      "distractors": ["string", "string", "string"],
      "keyword_weights": { "keyword_id": 1.0 },
      "difficulty": 0.5
    }
  ]
}

Return valid JSON only. No markdown.`;

const FLASHCARD_SYSTEM = `You write SIMPLE MCAT Biology memorization flashcards — the kind a student drills to commit bare facts to memory. Think of the canonical "memorize all 20 amino acids" deck: each card is one tiny fact, term, or list to recall.

THESE ARE NOT QUIZ QUESTIONS. Do NOT write multiple-choice, scenario, reasoning, or "why/how" application cards. No cloze deletions. No elaboration paragraphs.

FLASHCARD FORMAT — keep both sides as short as possible:
- front: a bare term, name, structure, or direct cue. Usually 1 short line (≤ 12 words). Examples of GOOD fronts:
    "Lysine — charge at physiological pH?"
    "Enzyme that unwinds DNA at the replication fork"
    "Codon for Methionine / start"
    "Three stop codons"
- back: the bare fact only — a term, value, short list, or one short clause. Usually ≤ 15 words, no second "elaboration" sentence. Examples of GOOD backs:
    "Positive (+1)"
    "Helicase"
    "AUG"
    "UAA, UAG, UGA"

RULES:
- One atomic fact per card. If a fact has several parts (e.g. a short list), the list IS the answer — do not split into prose.
- Prefer recall of names, values, classifications, pairings, and short canonical lists.
- Plain text. Put any chemistry/notation in $...$ — ALWAYS use KaTeX for science symbols:
    ✅ "$H_2O$" not "H2O" / "$CO_2$" not "CO2" / "$pK_a$" not "pKa" / "$V_{max}$" not "Vmax"
    ✅ "$K_m$" not "Km" / "$NAD^+$" not "NAD+" / "$OH^-$" not "OH-" / "$MnO_4^-$" not "MnO4-"
    ✅ "$FADH_2$" not "FADH2" / "$H_3O^+$" not "H3O+" / "$NH_3$" not "NH3" / "$K_{eq}$" not "Keq"
    ❌ WRONG: plain ASCII "H2O", "CO2", "NAD+", "pKa", "Vmax" — these render as flat unformatted text
- Never use \\text{}.
- No "Explain…", "Why does…", "What happens when…" framing. Cue → fact.

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
    // Correct choice = explanation's concluded answer, placed at a random index.
    return items
      .filter((q) => isValidQuestion(q, allowedIds, effectiveTarget))
      .map((q) => assembleQuestion(q as RawQuestion))
      .filter((q): q is GeneratedQuestion => q !== null);
  };

  let valid = await runOnce();

  // Retry once if all invalid
  if (valid.length === 0) {
    valid = await runOnce();
  }

  return valid;
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
Explanation: ${question.explanation}

KEYWORDS (use ONLY these keyword ids in keyword_weights):
${keywordBlock}`;

  const runOnce = async (): Promise<GeneratedQuestion[]> => {
    const parsed = await callGen(SIMILAR_QUESTION_SYSTEM, userPrompt);
    const items = Array.isArray(parsed.questions) ? parsed.questions : [];
    return items
      .filter((q) => isValidQuestion(q, allowedIds, effectiveTarget))
      .map((q) => assembleQuestion(q as RawQuestion))
      .filter((q): q is GeneratedQuestion => q !== null);
  };

  let valid = await runOnce();

  if (valid.length === 0) {
    // Retry once
    valid = await runOnce();
  }

  if (valid.length === 0) {
    throw new McatGenError("Similar question generation produced no valid output after retry");
  }

  return valid[0];
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
Show every intermediate step.

━━━ check_question (every step) ━━━
ORDER (mandatory): write latex_content first, THEN solution_latex (work it fully to a final answer),
THEN copy that final answer verbatim into correct_answer_latex, THEN write distractors.
• latex_content: clear problem statement in plain text.
• solution_latex: worked explanation ending at the final answer; show why it is right and why the key distractor is wrong.
• correct_answer_latex: EXACTLY the answer solution_latex concluded. The app makes this the correct choice — it MUST match the solution.
• distractors: EXACTLY 3 DISTINCT wrong options, each a realistic MCAT misconception, all different from correct_answer_latex.
• Do NOT output a "choices" array or a "correct_index"; the app assembles and randomizes them.
• Step 1 check: EASY — confirm the student grasped the most basic idea. One concept, distractor is clearly wrong to anyone who read step 1.
• Step 2 check: MEDIUM — apply the idea from step 1 in a slightly different form. Distractors reflect common misconceptions.
• Steps 3–4 check: HARD — require MULTI-STEP reasoning or integration of concepts covered so far. The stem must present a scenario or specific case, not a bare-fact question. ALL FOUR options must be plausible to a student who only half-understands; distractors encode realistic partial-reasoning errors (right idea/wrong step, correct mechanism/wrong direction, swapped cause-and-effect). A well-prepared student should still have to think carefully. Do NOT make it obscure trivia — make it require reasoning.

━━━ hint_latex ━━━
One sentence, max 15 words. Guide the student toward the correct approach without giving it away.

${MCAT_DELIMITER_RULE}

Return valid JSON only. No markdown.`;

// ─── Lesson validation ────────────────────────────────────────────────────────

/** Raw check_question from the model, before code assembles choices/correct_index. */
interface RawCheckQuestion {
  latex_content: string;
  solution_latex: string;
  correct_answer_latex: string;
  distractors: string[];
}

interface RawMicroStep {
  step_index: number;
  explanation_latex: string;
  example_latex: string;
  hint_latex: string;
  check_question: RawCheckQuestion;
}

function isValidMicroStep(s: unknown): s is RawMicroStep {
  if (!s || typeof s !== "object") return false;
  const obj = s as Record<string, unknown>;
  if (typeof obj.step_index !== "number") return false;
  if (typeof obj.explanation_latex !== "string" || !obj.explanation_latex.trim()) return false;
  if (typeof obj.example_latex !== "string" || !obj.example_latex.trim()) return false;
  if (typeof obj.hint_latex !== "string") return false;
  const cq = obj.check_question as Record<string, unknown> | undefined;
  if (!cq || typeof cq !== "object") return false;
  if (typeof cq.latex_content !== "string") return false;
  if (typeof cq.solution_latex !== "string") return false;
  // Correct answer comes from the solution; need ≥3 distractors to assemble.
  if (typeof cq.correct_answer_latex !== "string" || !cq.correct_answer_latex.trim()) return false;
  if (!Array.isArray(cq.distractors) || cq.distractors.length < 3) return false;
  return true;
}

function validateLesson(parsed: Record<string, unknown>): GeneratedMcatLesson | null {
  if (!Array.isArray(parsed.micro_steps)) return null;
  const rawSteps = parsed.micro_steps.filter(isValidMicroStep);
  if (rawSteps.length < 3 || rawSteps.length > 5) return null;
  // Assemble each check question: correct choice = solution's answer, random index.
  const steps: McatMicroStep[] = [];
  for (const s of rawSteps) {
    const assembled = assembleChoices(
      s.check_question.correct_answer_latex,
      s.check_question.distractors
    );
    if (!assembled) return null; // couldn't form valid choices — reject lesson, retry
    steps.push({
      step_index: s.step_index,
      has_check: true,
      explanation_latex: s.explanation_latex,
      example_latex: s.example_latex,
      hint_latex: s.hint_latex,
      check_question: {
        latex_content: s.check_question.latex_content,
        choices: assembled.choices,
        correct_index: assembled.correct_index,
        solution_latex: s.check_question.solution_latex,
      },
    });
  }
  return { micro_steps: steps };
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

  // Choice placement is already randomized during assembly in validateLesson.
  return lesson;
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

// ─── Fast flashcard fact-checker ──────────────────────────────────────────────

export interface FastFlashcardVerifyResult {
  /** true when the verifier confirms BACK correctly answers FRONT */
  valid: boolean;
  /** false if the verifier call errored/timed out — fail-open: treat as valid */
  ok: boolean;
}

const FLASHCARD_VERIFY_SYSTEM =
  'You are a careful MCAT Biology fact-checker. ' +
  'Given a flashcard FRONT (prompt) and BACK (answer), decide whether the BACK is a correct and accurate answer to the FRONT. ' +
  'Return JSON {"correct": true|false, "reason": "<=1 sentence"}.';

const FLASHCARD_VERIFY_TIMEOUT_MS = 4000;

/**
 * Fact-checks a single flashcard by asking a gpt-5.4-mini call whether the
 * BACK correctly answers the FRONT. Fail-open: any error/timeout/unparseable
 * response returns { valid: true, ok: false } and never throws.
 */
export async function verifyFlashcardFast(
  card: { front: string; back: string },
  opts?: { timeoutMs?: number }
): Promise<FastFlashcardVerifyResult> {
  const timeoutMs = opts?.timeoutMs ?? FLASHCARD_VERIFY_TIMEOUT_MS;

  const userPrompt =
    `FRONT: ${card.front}\n\nBACK: ${card.back}\n\nIs the BACK a correct and accurate answer to the FRONT?`;

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
      (err.name === "AbortError" || err.message.toLowerCase().includes("abort"));
    if (isAbort) {
      console.warn("[verifyFlashcardFast] timed out after", timeoutMs, "ms — failing open");
    } else {
      console.warn("[verifyFlashcardFast] error — failing open:", err instanceof Error ? err.message : String(err));
    }
    return { valid: true, ok: false };
  }
}

/**
 * Runs verifyFlashcardFast concurrently on all cards so total latency ≈ one
 * call, not N. Each card fails open independently.
 */
export async function verifyFlashcardsFast(
  cards: { front: string; back: string }[],
  opts?: { timeoutMs?: number }
): Promise<FastFlashcardVerifyResult[]> {
  return Promise.all(cards.map((c) => verifyFlashcardFast(c, opts)));
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
