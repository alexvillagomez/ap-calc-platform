/**
 * MCAT Biology content generation.
 * Uses gpt-5.4-mini with JSON mode (same client pattern as learnGenerator.ts).
 * Throws McatGenError on failure — routes surface this as 502.
 */
import OpenAI from "openai";
import { buildBlueprintBlock, type ConceptBlueprint } from "./mcatBlueprint";
import { parseModelJson } from "./parseModelJson";
import { assembleChoices } from "./assembleChoices";
import { isRecallFront } from "./flashcardRecall";
import { MCAT_FIGURE_RULE, MCAT_LESSON_FIGURE_RULE } from "./figureGuidance";
import { GEN_MODELS } from "./courseEngine/config";
import { resolveSystemPrompt, promptSlot } from "./promptOverrides";
import { buildIdentityScopeBlock } from "./scopeIds";
import { clientForModel } from "./genClient";

// COST FIX (2026-06-24): every task runs gpt-5.4-mini (see GEN_MODELS in courseEngine/config).
const GEN_MODEL = GEN_MODELS.default; // gpt-5.4-mini
const QUESTION_MODEL = GEN_MODELS.question; // gpt-5.4-mini
const FLASHCARD_MODEL = GEN_MODELS.flashcard; // gpt-5.4-mini
const LESSON_MODEL = GEN_MODELS.mcatLesson; // gpt-5.4-mini

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
const MCAT_DELIMITER_RULE = `MATH/NOTATION (mandatory, EVERY field): wrap ALL math/chemistry in $...$ (inline) or $$...$$ (block) using KaTeX — NEVER bare LaTeX, NEVER \\text{}. Use KaTeX sub/superscripts for ALL biochem symbols: "$V_{max}$","$K_m$","$pK_a$","$H_2O$","$CO_2$","$NAD^+$","$FADH_2$","$OH^-$","$H^+$". Flat ASCII ("H2O","Vmax","pKa","NAD+") renders as plain text and is WRONG. BOLD/EMPHASIS: use markdown **double asterisks** ONLY — NEVER bold prose by wrapping it in math ($\\mathbf{...}$, \\textbf{...}, or any math mode); that renders words as math and is WRONG. Inside a **...** run keep math as ordinary $...$. \\mathbf/\\boldsymbol may bold a genuine math SYMBOL (e.g. a vector) but NEVER a word or sentence.`;

// Shared depth contract — injected into every MCAT generator (flashcards, questions,
// quizzes, lessons). Calibrated to the MilesDown Anki deck: the MCAT is "a mile wide
// and an inch deep" — it tests deep UNDERSTANDING of foundational concepts, not recall
// of precise biochemical constants. See docs/mcat-depth-standard.md (authoritative).
const MCAT_DEPTH_RULE = `MCAT DEPTH — "A MILE WIDE AND AN INCH DEEP" (mandatory): the MCAT is a REASONING exam — it tests conceptual understanding (relationships, directional rules, approximate ranges, causal logic), NOT recall of precise biochemical constants. A student who understands WHY beats one who memorized a decimal.

Before stating ANY number, ask in order:
1. Universal constant (speed of light, Avogadro's, bond angle $109.5°$)? → keep the exact value.
2. Round COMPARATIVE number where the comparison IS the concept ($NADH = 2.5$ vs $FADH_2 = 1.5$ ATP; glycolysis net $2$ ATP)? → keep it.
3. Otherwise → state a RANGE / direction / qualitative relationship, never a decimal.

DO: ranges & comparisons over decimals ("strongly acidic, deprotonated at pH 7.4", not "$pK_a = 3.7$"); classifications, directional rules, compartments, structure→function.
DON'T: decimal $pK_a$/$pI$ for side chains, exact $K_m$/$V_{max}$/$K_i$, rate/equilibrium constants, full pathway intermediate lists, obscure non-regulatory enzymes.
EXCEPTION — histidine: its side-chain $pK_a$ near 6 is high-yield, but test the CONCEPT ("the only amino acid that buffers near physiological pH"), not the decimal.
Enzyme kinetics = QUALITATIVE DIRECTION only: competitive → apparent $K_m$ ↑, $V_{max}$ unchanged; noncompetitive → $V_{max}$ ↓, $K_m$ unchanged; uncompetitive → both ↓. No $K_i$/specific $K_m$ numbers.`;

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface GeneratedQuestion {
  stem: string;
  choices: [string, string, string, string];
  correct_index: number;
  explanation: string;
  keyword_weights: Record<string, number>;
  difficulty: number;
  /** Misconception descriptions aligned to the 3 distractor VALUES (pre-shuffle), if generated. */
  wrong_answer_descriptions?: string[];
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
  user: string,
  modelOverride?: string
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    const model = modelOverride ?? GEN_MODEL;
    const client = clientForModel(model);
    const completion = await client.chat.completions.create({
      model,
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
/** A misconception-grounded distractor: the specific student error + the value it produces. */
interface RawDistractor {
  misconception: string;
  value: string;
}

/** Raw model output for a question, BEFORE code assembles choices/correct_index. */
interface RawQuestion {
  stem: string;
  explanation: string;
  correct_answer: string;
  distractors: RawDistractor[];
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
  // Need ≥3 misconception-grounded distractor OBJECTS to assemble a 4-option item.
  if (!Array.isArray(obj.distractors) || obj.distractors.length < 3) return false;
  if (
    !(obj.distractors as unknown[]).every((d) => {
      if (!d || typeof d !== "object") return false;
      const o = d as Record<string, unknown>;
      return (
        typeof o.misconception === "string" &&
        o.misconception.trim().length > 0 &&
        typeof o.value === "string" &&
        o.value.trim().length > 0
      );
    })
  )
    return false;
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
  // Map misconception-grounded distractor objects to their plain VALUE strings so
  // the downstream choice-assembly contract stays string[] (assembleChoices unchanged).
  const values = raw.distractors.map((d) => d.value);
  const assembled = assembleChoices(raw.correct_answer, values);
  if (!assembled) return null;
  return {
    stem: raw.stem,
    explanation: raw.explanation,
    keyword_weights: raw.keyword_weights,
    difficulty: raw.difficulty,
    choices: assembled.choices,
    correct_index: assembled.correct_index,
    // Misconception strings aligned to the distractor values (NOT to the shuffled choices).
    wrong_answer_descriptions: raw.distractors.map((d) => d.misconception),
  };
}

function isValidFlashcard(f: unknown): f is { front: string; back: string; keyword_weights: Record<string, number> } {
  if (!f || typeof f !== "object") return false;
  const obj = f as Record<string, unknown>;
  if (typeof obj.front !== "string" || !obj.front.trim()) return false;
  if (typeof obj.back !== "string" || !obj.back.trim()) return false;
  if (!obj.keyword_weights || typeof obj.keyword_weights !== "object") return false;
  // Reject bare-statement cards: the front MUST be a real recall cue (cloze/question/prompt).
  if (!isRecallFront(obj.front)) return false;
  return true;
}

// ─── System prompts ───────────────────────────────────────────────────────────

export const QUESTION_SYSTEM = `You write MCAT Biology study questions for a practice app. Each tests conceptual understanding and reasoning — mechanisms, structure→function, directional effects, classifications, comparisons, clinical connections — and is fully self-contained.

${MCAT_DEPTH_RULE}

If a question needs a value, PROVIDE IT IN THE STEM — never one solvable only by recalling a memorized constant. Difficulty comes from reasoning.

DIFFICULTY: write at the TARGET band stated in the user prompt (its requirements are given there) and set difficulty to a number inside that band.

QUESTION RULES:
- Self-contained stem, 1–3 sentences, starting with a capital and ending in ? or . — most need no figure.
- NO GIVEAWAY: the stem — its text AND any figure caption — must not name or trivially spell the keyed answer; if a figure IS the thing to identify, caption it generically.
- Exactly 4 choices, one unambiguously correct; explanation is 2–4 sentences (why correct + why the tempting distractor is wrong).
- DIVERSITY across a batch: vary the question format; never the same task with only the answer swapped.
- COVERAGE across a batch: together the questions must touch EVERY in-scope concept/subidea — at least one question per concept, combining closely related concepts into one where natural; never pile several questions on one concept while leaving others untested.

${MCAT_DELIMITER_RULE}

${MCAT_FIGURE_RULE}

KEYWORD WEIGHTS: use ONLY the keyword ids provided; positive, summing to ~1.0; highest weight on the primary concept.

OUTPUT ORDER — MANDATORY, do not reorder:
1. stem.
2. explanation: work to the single best answer step by step; refer to it by VALUE, never a letter/position.
3. correct_answer = EXACTLY what the explanation concluded (copy verbatim) — this becomes the correct choice.
4. distractors: EXACTLY 3 OBJECTS { "misconception": ..., "value": ... } — write the misconception FIRST (the specific error a real student makes on THIS question), THEN derive value = the answer it produces. One MUST be the natural high-yield trap when one exists. All 3 values DISTINCT from each other and from correct_answer.
Do NOT output "choices" or "correct_index" — the app builds the 4 choices from correct_answer + the distractor values and places the correct one at random, so correct_answer MUST match the explanation.

STAY INSIDE THE KEYWORD'S SCOPE: the required reasoning lives entirely within this keyword's scope contract — never ask about a downstream consequence beyond it.

Return a JSON object:
{ "questions": [ { "stem": "string", "explanation": "string", "correct_answer": "string", "distractors": [ { "misconception": "string", "value": "string" }, { "misconception": "string", "value": "string" }, { "misconception": "string", "value": "string" } ], "keyword_weights": { "keyword_id": 0.8, "keyword_id_2": 0.2 }, "difficulty": 0.5 } ] }

Return valid JSON only. No markdown.`;

const SIMILAR_QUESTION_SYSTEM = `You write MCAT Biology study questions. Given an existing question, produce a NEW one testing the SAME underlying concept from a different angle or with different specifics — NOT a trivial rewording: different stem scenario, different details, FRESH distractors, same rigor and self-contained format.

${MCAT_DEPTH_RULE}

If a numeric value is needed, PROVIDE IT IN THE STEM; never require recalling a decimal $pK_a$, exact $K_m$/$V_{max}$, or constant — difficulty comes from reasoning, not obscure facts. Write at the TARGET band stated in the user prompt and set difficulty inside it. Use a DIFFERENT format from the original (mechanism / scenario / comparison), not just a swapped answer.

${MCAT_DELIMITER_RULE}

${MCAT_FIGURE_RULE}

KEYWORD WEIGHTS: use ONLY the keyword ids provided; sum to ~1.0.

OUTPUT ORDER — MANDATORY:
1. stem. 2. explanation: work to the answer, referring to it by VALUE never a letter/position (2–4 sentences). 3. correct_answer = EXACTLY what the explanation concluded (verbatim). 4. distractors: EXACTLY 3 OBJECTS { "misconception": ..., "value": ... } — misconception FIRST (a specific student error on this question), THEN derive value; all 3 values distinct from each other and correct_answer.
Do NOT output "choices" or "correct_index" — the app assembles the 4 options from correct_answer + the distractor values.

Return a JSON object:
{ "questions": [ { "stem": "string", "explanation": "string", "correct_answer": "string", "distractors": [ { "misconception": "string", "value": "string" }, { "misconception": "string", "value": "string" }, { "misconception": "string", "value": "string" } ], "keyword_weights": { "keyword_id": 1.0 }, "difficulty": 0.5 } ] }

Return valid JSON only. No markdown.`;

export const FLASHCARD_SYSTEM = `You write MCAT memorization flashcards — fill-in-the-blank recall cards for the must-memorize facts.

DEPTH — a mile wide, an inch deep: card understanding (directional rules, ranges, classifications, compartments), not precise constants. Keep universal constants and round comparative numbers; otherwise a range or direction, never a decimal. Enzyme kinetics = qualitative direction only.

WHAT TO CARD — TOUCH every in-scope item: card the memorizable nugget of each — a formula, a definition or criterion, a name/classification, a directional or positional rule/convention, a compartment, a named high-yield player, a round comparative value, or a structure. A rule, convention, or criterion the student must KNOW is an anchor — card its ACTUAL content, not just its name. Combine closely related items into ONE card; fold a DERIVED case-consequence into its anchor rather than a new card. Skip only a purely conceptual item with no memorizable nugget.

MECE + COVERAGE — each card teaches a SUBJECT no other card does: the same subject reworded (a synonym, a reverse ask, a re-aimed blank) is the SAME card — merge or drop it; a set/table/mapping is ONE card, and an anchor's facets (special cases, synonyms, what a symbol stands for) fold into its single card. The deck must be COMPLETE — every in-scope anchor drilled by some card, none dropped — and no larger: never pad or rephrase to add one.

SCOPE — HARD GATE: card ONLY in-scope facts. Anything in the out-of-scope list is FORBIDDEN even if related — a sibling or later keyword owns it.

FORMAT — the front is a CLOZE: a declarative sentence with a "_____" blank on the nugget (2–3 inseparable terms may be blanked; back lists them in order). It must read correctly once the back fills the blank — no word beside the blank that the answer repeats. Use a "?" question ONLY when a cloze would be forced or awkward. Never a bare statement, never a solve/calculate/why/how prompt — drill the fact, not reasoning. The BACK is the nugget: a real name, value, direction, classification, or compartment — never filler (varies, depends, affects, involved).

NO GIVEAWAY — the front (incl. any caption) must not contain, spell, or logically imply the answer; a front that states a property then asks you to name it is circular — recast or drop it.

NOTATION — wrap ALL math/chemistry in $...$ KaTeX with real sub/superscripts ($V_{max}$, $H_2O$, $NAD^+$); flat ASCII (H2O, Vmax) and \\text{} are WRONG. A Greek letter that NAMES a structure → write the word (alpha carbon), not the symbol. Bold only with **markdown**, never math mode.

FIGURES — optional and rare; most cards are pure text. Only for a card about a specific in-scope molecule or pathway, placed on the BACK: <Molecule smiles="..."/>, <Mermaid>graph LR; A-->B</Mermaid>, or $\\ce{...}$. Emit only a structure you are CERTAIN of, else name it in prose. Caption stays in scope.

KEYWORD WEIGHTS — use ONLY the keyword ids provided; sum to ~1.0.

Return JSON only, no markdown:
{ "flashcards": [ { "front": "string", "back": "string", "keyword_weights": { "keyword_id": 1.0 } } ] }`;

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
  /**
   * Batch diversity directive (within-subtopic-diversity design, Phase 2). When
   * generating a batch to recycle, force the items to be mutually distinct
   * across the subtopic's VALID axes (reasoning angle / sub-approach, and where
   * it genuinely fits the subtopic, representation), with a spread of difficulty
   * around the target. Stays IN SCOPE — never invents an off-scope representation.
   */
  diversityDirective?: string;
  /** Override the system prompt (dev lab live-tuning). Defaults to QUESTION_SYSTEM. */
  systemPrompt?: string;
  /** Override the model (dev lab). Defaults to QUESTION_MODEL. */
  model?: string;
  /** Receives the assembled user prompt (dev lab read-only context pane). */
  onUserPrompt?: (prompt: string) => void;
  /** Assemble the prompt and return WITHOUT calling the model (lab prompt preview). */
  previewOnly?: boolean;
}): Promise<GeneratedQuestion[]> {
  const { keywords, templateCards, count } = opts;

  // Resolve effective numeric target: tier overrides targetDifficulty; default 0.55
  const effectiveTarget: number = opts.difficultyTier
    ? TIER_TARGET[opts.difficultyTier]
    : (opts.targetDifficulty ?? 0.55);

  const allowedIds = new Set(keywords.map((k) => k.id));
  const identityBlock = await buildIdentityScopeBlock("mcat", keywords, { keywordWeights: true });

  const diversityBlock =
    count > 1 && opts.diversityDirective
      ? `\nBATCH DIVERSITY: ${opts.diversityDirective}\n`
      : count > 1
        ? `\nBATCH DIVERSITY: Make questions MATERIALLY DIFFERENT from one another — vary the reasoning angle / sub-approach and the specific scenario/setup, vary the difficulty across the set (some easier, some harder, around the target). Prefer distinct coverage; never sacrifice a question's quality or correctness to make it different.\n`
        : "";

  const userPrompt = `Generate MCAT Biology multiple-choice questions covering every in-scope concept — one per concept, combining closely related concepts into one question where natural. Let the concept count decide how many questions to write: a narrow topic may yield just a few, a broad one more. Never pad to reach a number; cap at ${count}.

${difficultyInstruction(effectiveTarget)}
${diversityBlock}
${identityBlock}`;

  opts.onUserPrompt?.(userPrompt);
  if (opts.previewOnly) return [];

  const runOnce = async (): Promise<GeneratedQuestion[]> => {
    const parsed = await callGen(
      opts.systemPrompt ?? (await resolveSystemPrompt(promptSlot("mcat", "quiz"), QUESTION_SYSTEM)),
      userPrompt,
      opts.model ?? QUESTION_MODEL
    );
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
  /**
   * Whether this page carries an understanding-check. Checks are OPTIONAL per page
   * (a simple comprehension check on what was just read) — when false, `check_question`
   * is present but blank and renderers skip the quiz UI for this page.
   */
  has_check: boolean;
  explanation_latex: string;
  example_latex: string;
  check_question: McatLessonCheckQuestion;
  hint_latex: string;
}

export interface GeneratedMcatLesson {
  micro_steps: McatMicroStep[];
}

// ─── Lesson system prompt ─────────────────────────────────────────────────────

export const MCAT_LESSON_SYSTEM = `You are an MCAT Biology tutor writing a short, intuition-first micro-lesson for a student who has NEVER seen this concept. Return valid JSON only — no markdown.

HOW IT READS
• Intuition first: open with ONE clean sentence stating the core idea — the single most important truth, as if you had only one sentence. No throat-clearing ("X matters because…"), no definition-first "A [concept] is …" opener, no "how to read it" lead-in. Add specifics and terminology only after it lands.
• Name every term, formula, and symbol in plain words on first use — never leave notation unexplained. Write a Greek letter that names a structure as a plain word, not a math symbol.
• One idea per page, simplest first, each building on the last into ONE connected story — not a list of facts. Give every distinct in-scope idea its own page (as many as needed); never repeat or pad.
• KEY FACT: after the prose, a BLANK LINE, then the one takeaway ALONE in **bold** (no "Key fact:" label) — never bolded inline at a paragraph's end.

DEPTH — the MCAT tests REASONING: directional rules, ranges, classifications, compartments, structure→function — the WHY, not memorized constants. Keep round comparative numbers ($NADH$ ≈ 2.5 vs $FADH_2$ ≈ 1.5 ATP) and universal constants; never give exact side-chain $pK_a$/$pI$ or $K_m$/$V_{max}$/$K_i$ decimals or full enzyme/pathway lists (name only rate-limiting/regulatory enzymes). Inhibition = qualitative direction only.

COVERAGE — be COMPLETE: teach EVERY in-scope concept/subidea, each with its own intuition and its own page (use as many pages as full coverage needs, never padding), and define+use every key term by its actual name — so the student could afterward answer any in-scope quiz on this keyword.
SCOPE: teach ONLY this keyword's content. Treat everything in ALREADY COVERED as known — build on it in a clause, never re-define or re-derive it. Never teach or rely on a LATER/out-of-scope topic; mention a neighbor only to mark a boundary.

${MCAT_LESSON_FIGURE_RULE}

CHECKS — optional: include one only when it confirms the page's idea and is answerable by someone who just read it; else set has_check:false. Never a multi-step exam.

OUTPUT: { "micro_steps": [ MicroStep ] }; MicroStep = { "step_index": n, "has_check": bool, "explanation_latex": str, "example_latex": str, "check_question"?: {…}, "hint_latex"?: str }.
• explanation_latex: as many plain sentences as the idea needs (never padded), then the bold key fact on its own line. No worked example here.
• example_latex: its OWN bubble — a CONCRETE named instance (never "a generic one"), showing WHY it fits the rule just taught; representative is best, a special case only if you justify it; in-scope only; a mini question→answer, not a restated definition; leave "" rather than force a hollow one.
• check_question (only if has_check) = { latex_content, solution_latex, correct_answer_latex, distractors:[3] }: write solution_latex first, copy its answer into correct_answer_latex, then add 3 distinct distractors (realistic MCAT misconceptions). Never output "choices" or "correct_index" — the app assembles them. hint_latex: one sentence, ≤15 words.

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
  has_check?: boolean;
  check_question?: RawCheckQuestion;
}

/** A page is valid as long as it teaches something — the check is OPTIONAL. */
function isValidMicroStep(s: unknown): s is RawMicroStep {
  if (!s || typeof s !== "object") return false;
  const obj = s as Record<string, unknown>;
  // A teaching page only needs a real explanation; the check is optional.
  return typeof obj.explanation_latex === "string" && obj.explanation_latex.trim().length > 0;
}

/** Blank check placeholder for a page that has no understanding-check. */
const BLANK_MCAT_CHECK: McatLessonCheckQuestion = {
  latex_content: "",
  choices: ["", "", "", ""],
  correct_index: 0,
  solution_latex: "",
};

/** True only when the raw check has every field needed to assemble 4 choices. */
function rawCheckIsComplete(cq: RawCheckQuestion | undefined): cq is RawCheckQuestion {
  return (
    !!cq &&
    typeof cq.latex_content === "string" &&
    cq.latex_content.trim().length > 0 &&
    typeof cq.solution_latex === "string" &&
    typeof cq.correct_answer_latex === "string" &&
    cq.correct_answer_latex.trim().length > 0 &&
    Array.isArray(cq.distractors) &&
    cq.distractors.length >= 3
  );
}

/**
 * Build a valid lesson from raw model output, recovering as much as possible.
 *
 * Checks are OPTIONAL: a page with a good explanation but no (or an unassemblable)
 * check is KEPT as a no-check page rather than dropped. Steps re-indexed 1..n.
 */
function validateLesson(parsed: Record<string, unknown>): GeneratedMcatLesson | null {
  if (!Array.isArray(parsed.micro_steps)) return null;
  const steps: McatMicroStep[] = [];
  for (const raw of parsed.micro_steps) {
    if (steps.length >= 5) break;
    if (!isValidMicroStep(raw)) continue;
    const s = raw as RawMicroStep & { example_latex?: unknown; hint_latex?: unknown };

    const wantsCheck = s.has_check !== false;
    const assembled =
      wantsCheck && rawCheckIsComplete(s.check_question)
        ? assembleChoices(
            s.check_question.correct_answer_latex,
            s.check_question.distractors
          )
        : null;

    steps.push({
      step_index: steps.length + 1, // re-index sequentially after any drops
      has_check: !!assembled,
      explanation_latex: s.explanation_latex,
      example_latex: typeof s.example_latex === "string" ? s.example_latex : "",
      hint_latex: typeof s.hint_latex === "string" ? s.hint_latex : "",
      check_question: assembled
        ? {
            latex_content: s.check_question!.latex_content,
            choices: assembled.choices,
            correct_index: assembled.correct_index,
            solution_latex: s.check_question!.solution_latex,
          }
        : BLANK_MCAT_CHECK,
    });
  }
  // A lesson needs at least 1 usable step; a simple keyword may legitimately be a
  // single page. Fewer than 1 (all steps dropped) → null so the caller retries.
  return steps.length >= 1 ? { micro_steps: steps } : null;
}

// ─── Exported lesson generator ────────────────────────────────────────────────

/** A neighboring keyword (earlier/later in course order) used as REFERENCE context. */
export interface McatLessonNeighbor {
  label: string;
  relation: "earlier" | "later";
}

/** Lab/override hooks for MCAT lesson generation (used by the dev Lesson Lab). */
export interface McatLessonGenOptions {
  /** Override the system prompt (lab live-tuning). Defaults to MCAT_LESSON_SYSTEM. */
  systemPrompt?: string;
  /** Override the model (lab model picker). Defaults to LESSON_MODEL. */
  model?: string;
  /** Neighboring keywords for light scope context ("reference, don't teach"). */
  neighbors?: McatLessonNeighbor[];
  /** True when this keyword OPENS its umbrella (order_index === -1) — framing-only lesson. */
  isIntro?: boolean;
  /** Receives the assembled user prompt (for the lab's read-only context pane). */
  onUserPrompt?: (prompt: string) => void;
  /** Assemble the prompt and return WITHOUT calling the model (lab prompt preview). */
  previewOnly?: boolean;
}

/** Render the neighbor "reference, don't teach" block (light-B scope context). */
function buildMcatNeighborBlock(neighbors?: McatLessonNeighbor[]): string {
  if (!neighbors || neighbors.length === 0) return "";
  const earlier = neighbors.filter((n) => n.relation === "earlier").map((n) => n.label);
  const later = neighbors.filter((n) => n.relation === "later").map((n) => n.label);
  const parts: string[] = [];
  if (earlier.length)
    parts.push(`Already covered (the student may know these): ${earlier.join("; ")}.`);
  if (later.length)
    parts.push(`Comes LATER (do NOT teach — name one in passing only to motivate today's idea): ${later.join("; ")}.`);
  return `\n\nSURROUNDING TOPICS (context only — you are NOT teaching these): ${parts.join(" ")} Teach ONLY this keyword's content; reference a neighbor only when it clarifies the current idea.\n`;
}

/**
 * Generate a MCAT Biology micro-lesson for a keyword.
 * Intuition-first, scope-disciplined, figures optional, checks optional+simple.
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
  outlineContext?: string,
  opts?: McatLessonGenOptions
): Promise<GeneratedMcatLesson> {
  const identityBlock = await buildIdentityScopeBlock("mcat", [keyword]);

  // INTRO keyword (order_index === -1) — OPENS its umbrella. Its lesson is pure
  // FRAMING: motivate the area, say why it matters, and give a brief look-ahead
  // that NAMES the upcoming subtopics without teaching or drilling any of them.
  // The subtopic keywords own the actual teaching.
  const introDirective = opts?.isIntro
    ? `\n\nINTRO LESSON — this keyword OPENS its topic; it is FRAMING ONLY, not a teaching lesson. Do exactly: (1) motivate the area and why it matters on the MCAT in 1–2 plain sentences; (2) give a brief LOOK-AHEAD that NAMES what the upcoming subtopics will cover ("next you'll see how …"), WITHOUT teaching, defining, or drilling any of them. You MAY state the umbrella's single big-picture distinction in plain words if it frames the area, but teach NO subtopic content, show NO subtopic formula/value/figure, and include NO worked specifics or check question. Keep it short — a map, never the territory.`
    : "";

  // Figures are OPTIONAL (system prompt's MCAT_LESSON_FIGURE_RULE governs them);
  // there is NO forced-figure directive — a figure is added only when it makes the
  // page's one idea clearer. Checks are optional+simple (governed by system prompt).
  const userPrompt = `${identityBlock}${introDirective}`;

  opts?.onUserPrompt?.(userPrompt);
  if (opts?.previewOnly) return { micro_steps: [] };

  const systemPrompt =
    opts?.systemPrompt ?? (await resolveSystemPrompt(promptSlot("mcat", "lesson"), MCAT_LESSON_SYSTEM));
  const model = opts?.model ?? LESSON_MODEL;

  let lesson: GeneratedMcatLesson | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = await callGen(systemPrompt, userPrompt, model);
    lesson = validateLesson(parsed);
    if (lesson) break;
  }

  if (!lesson) {
    throw new McatGenError("Lesson generation produced no valid output after retry");
  }

  // Choice placement is already randomized during assembly in validateLesson.
  // Deterministic safety net: convert any LEAKED literal escape sequences
  // (backslash-n/t/r the model writes in prose) to real whitespace at storage
  // time, so they don't render as raw "\n" / run words together. Math-safe.
  return deepSanitizeEscapes(lesson);
}

/** Convert leaked literal escape sequences to real whitespace (math-safe). */
function sanitizeEscapes(s: string): string {
  return s
    .replace(/\\n(?![a-z])/g, "\n")
    .replace(/\\t(?![a-z])/g, " ")
    .replace(/\\r(?![a-z])/g, "");
}

/** Recursively apply sanitizeEscapes to every string in an object/array. */
function deepSanitizeEscapes<T>(value: T): T {
  if (typeof value === "string") return sanitizeEscapes(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepSanitizeEscapes(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) {
      out[k] = deepSanitizeEscapes((value as Record<string, unknown>)[k]);
    }
    return out as T;
  }
  return value;
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
  'You are a careful MCAT question checker. FIRST decide if the question is WELL-POSED: the stem must be complete, unambiguous, self-consistent (no contradictory premises), and answerable from the stem + choices alone, WITHOUT requiring knowledge beyond what the question is testing. THEN, if well-posed, solve it independently and pick the single best answer. Return JSON {"well_posed": true|false, "answer_index": 0-3, "reason": "<=1 short sentence"}. If not well-posed, set well_posed=false and still give your best answer_index.';

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
        max_completion_tokens: 120,
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

    // Well-posedness gate: EXPLICIT false drops the question; missing/invalid field falls through.
    if (parsed.well_posed === false) {
      return { agrees: false, predicted_index: null, ok: true };
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

// ─── Flashcard post-processing (quality + render fail-soft) ───────────────────

/** Words too generic to be the WHOLE answer of a card (no course content). */
const FILLER_BACKS = new Set([
  "overlap", "overlaps", "overlapping", "relate", "related", "relates",
  "vary", "varies", "varying", "depend", "depends", "involved", "involves",
  "associated", "affect", "affects", "change", "changes", "differ", "differs",
  "important", "various", "several", "many", "some", "it", "them", "yes", "no",
]);

/** True when the back is just a filler/grammatical word — not meaningful content. */
function isFillerBack(back: string): boolean {
  // Strip math delimiters/punctuation; look at the bare word(s).
  const bare = back.replace(/\$[^$]*\$/g, "").replace(/[.,;:!?()"]/g, "").trim().toLowerCase();
  if (!bare) return back.replace(/[^a-z0-9]/gi, "").length === 0; // empty after stripping math → keep (math IS the answer)
  const words = bare.split(/\s+/).filter(Boolean);
  return words.length === 1 && FILLER_BACKS.has(words[0]);
}

/**
 * Repair or remove malformed figure tags so a card never renders raw tag text.
 * The renderer only intercepts SELF-CLOSING <Molecule.../> and CLOSED
 * <Mermaid>...</Mermaid>; anything else leaks as literal text. We:
 *  - add the missing "/>" to a <Molecule ...> that has a smiles attr;
 *  - drop a <Molecule> with no usable smiles, or any leftover stray figure tag.
 * Returns the cleaned text (figure removed rather than shown broken = fail soft).
 */
function sanitizeFlashcardFigures(text: string): string {
  let s = text;
  // <Molecule ...>  (no self-close) → add "/>" when it carries a smiles attr; else drop.
  s = s.replace(/<Molecule\b([^>]*?)\/?>/gi, (m, attrs) => {
    if (/smiles\s*=\s*["'][^"']+["']/i.test(attrs)) {
      return `<Molecule${attrs.replace(/\s*\/\s*$/, "")} />`;
    }
    return ""; // no usable structure — drop the tag, keep surrounding text
  });
  // <Mermaid> without a closing tag → drop the dangling opener (keep any inner text removed too is unsafe; just remove opener+to-EOL fragment if unclosed).
  if (/<Mermaid\b/i.test(s) && !/<\/Mermaid\s*>/i.test(s)) {
    s = s.replace(/<Mermaid\b[^>]*>[\s\S]*$/i, "");
  }
  // Any remaining stray opening/closing figure tag fragment → strip (never show raw).
  s = s.replace(/<\/?(FunctionGraph|SlopeField)\b[^>]*>/gi, "");
  return s.replace(/\s{2,}/g, " ").trim();
}

/**
 * Clean a generated card: sanitize figures on both sides and restrict its
 * keyword_weights to the allowed in-category ids (drops cross-category /
 * hallucinated tags). Returns null if the card is unusable after cleaning.
 */
function postProcessFlashcard(
  c: GeneratedFlashcard,
  allowedKwIds: Set<string>,
): GeneratedFlashcard | null {
  const front = sanitizeFlashcardFigures(c.front);
  const back = sanitizeFlashcardFigures(c.back);
  if (!front.trim() || !back.trim()) return null;
  if (isFillerBack(back)) return null; // meaningless answer — drop it
  // Keep only in-category keyword ids; if none survive, fall back to all weight
  // on the (single) primary keyword so the card is still served + tagged in-scope.
  const weights = c.keyword_weights ?? {};
  const kept: Record<string, number> = {};
  for (const [id, w] of Object.entries(weights)) {
    if (allowedKwIds.has(id) && typeof w === "number" && w > 0) kept[id] = w;
  }
  if (Object.keys(kept).length === 0) {
    const primary = [...allowedKwIds][0];
    if (!primary) return null;
    kept[primary] = 1;
  }
  return { ...c, front, back, keyword_weights: kept };
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
  /**
   * COMPLETE-DECK mode (the headline). When true, the model is told to FIRST
   * enumerate the COMPLETE, MECE list of every memorizable fact for this subtopic's
   * scope, THEN emit exactly one card per item — so coverage is explicit and
   * content-determined (no fixed count, no padding). `count` becomes an upper
   * safety cap only. Runs on gpt-5.5 for breadth. Intended to be called per
   * SUBTOPIC (a single in-depth keyword + optional umbrella context).
   */
  complete?: boolean;
  /**
   * SIBLING SCOPE (MECE-across-keywords). The OTHER keywords in the same unit
   * that each OWN their own content. Passed so the model partitions the unit:
   * it covers ONLY the target keyword(s) and EXCLUDES any fact that squarely
   * belongs to a sibling (e.g. the "what is an amino acid" intro deck must NOT
   * include zwitterions / classification / chirality — those are sibling keywords).
   * Target keyword(s) are filtered out by the caller.
   */
  siblingKeywords?: { label: string; description?: string }[];
  /**
   * Human-readable CATEGORY/unit name (e.g. "Amino Acids and Proteins"). Stated
   * in the prompt so the model keeps every card — text AND figures — inside this
   * one biology category (no cross-category leak, e.g. no glycolysis in an
   * amino-acids deck).
   */
  categoryLabel?: string;
  /**
   * BATCH-ACROSS-KEYWORDS first-generation (MECE partition). When true (with
   * multiple `keywords`), the model builds the COMPLETE decks for ALL listed
   * keywords IN ONE PASS and PARTITIONS the unit's facts across them — every card
   * tagged (keyword_weights) to the ONE keyword that owns it, every keyword
   * covered (no holes), no fact duplicated across keywords (no overlap). This
   * beats generating each deck in isolation, which can't see the partition.
   * Implies `complete` semantics. Intended for the first build of an umbrella's
   * in-depth decks; per-keyword `complete` remains the fallback/top-up path.
   */
  batchPartition?: boolean;
  /**
   * INTRO mode. The keyword OPENS its umbrella (framing-only). Cards are limited
   * to GENERAL, cross-cutting terms the upcoming subtopics will assume — never a
   * subtopic-specific fact — and the deck MAY be empty. Skips complete-enumeration
   * and the empty-retry (empty is a valid result).
   */
  intro?: boolean;
  /** Override the system prompt (dev lab live-tuning). Defaults to FLASHCARD_SYSTEM. */
  systemPrompt?: string;
  /** Override the model (dev lab). Defaults to the per-mode flashcard model. */
  model?: string;
  /** Receives the assembled user prompt (dev lab read-only context pane). */
  onUserPrompt?: (prompt: string) => void;
  /** Assemble the prompt and return WITHOUT calling the model (lab prompt preview). */
  previewOnly?: boolean;
}): Promise<GeneratedFlashcard[]> {
  // INTRO keywords are framing-only; they get no flashcards at all.
  if (opts.intro) return [];

  const { keywords, templateCards } = opts;
  const isBatch = opts.batchPartition === true && keywords.length > 1;
  // Allowed keyword ids for THIS category — used to strip any cross-category /
  // hallucinated keyword tag the model emits (defense-in-depth vs leakage).
  const allowedKwIds = new Set(keywords.map((k) => k.id));

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

  // ── MECE-across-keywords: sibling scope exclusion ───────────────────────────
  // A per-keyword deck must stay STRICTLY within that keyword's lane. Passing the
  // sibling keywords (each owns its own content) lets the model partition the unit
  // so it never bleeds a neighbor's topic (e.g. the "what is an amino acid" intro
  // deck must not include zwitterions / classification / chirality — those are
  // siblings). Fires regardless of whether a blueprint exists (intro keywords often
  // lack one, which is exactly when leakage is worst).
  const siblings = opts.siblingKeywords ?? [];
  const siblingBlock =
    siblings.length > 0
      ? `SCOPE PARTITION — MECE ACROSS KEYWORDS (mandatory). You are building the deck for ONLY the target keyword(s) under "KEYWORDS TO COVER" below. The following SIBLING keywords are SEPARATE topics in this unit — each has its OWN deck. Do NOT put their content in this deck; if a fact squarely belongs to one of them, EXCLUDE it (that sibling covers it):
${siblings.map((s) => `  - ${s.label}${s.description ? ` — ${s.description.slice(0, 110)}` : ""}`).join("\n")}
Cover ONLY facts specific to the target keyword's narrow scope. When unsure whether a fact belongs here or to a sibling above, leave it OUT.

`
      : "";

  // ── Amino-acid abbreviation/identity mode (NARROW) ──────────────────────────
  // ONLY the residue-identity keyword owns "memorize name ↔ 3-letter ↔ 1-letter
  // code" enumeration. This block used to fire for ANY amino-acid keyword and
  // force-injected the whole unit (codes + classification + special cases),
  // leaking sibling content into every deck. It is now gated tightly to the
  // abbreviation/identity keyword and trimmed to codes only — classification and
  // special cases are owned by their OWN keywords (see SCOPE PARTITION above).
  const aaCodesContext = keywords.some((k) => {
    const t = `${k.label} ${k.description ?? ""} ${k.id}`.toLowerCase();
    return /abbreviation|one[- ]?letter|three[- ]?letter|1[- ]?letter|3[- ]?letter|\bidentity\b|\bcodes?\b/.test(t);
  });
  const aaBlock = aaCodesContext
    ? `MEMORIZE THE 20 STANDARD AMINO ACIDS — this keyword owns the recall set for all 20 residues. This is a MEMORIZATION deck: build it so a student who drills it can produce, for each of the 20, its name ↔ three-letter code ↔ one-letter code ↔ side-chain CLASS. Two card families, cover ALL 20:
  • CODE cards (name ↔ 3-letter ↔ 1-letter): identify the residue by its FULL NAME (or by ONE code when asking for a different one), and NEVER show the exact code you are asking the student to recall. Include the non-obvious 1-letter codes (W=Trp, F=Phe, Y=Tyr, K=Lys, R=Arg, D=Asp, E=Glu, N=Asn, Q=Gln).
  • CLASS cards (residue → side-chain class): use the four classes nonpolar/hydrophobic, polar uncharged, acidic, basic (note glycine/proline/cysteine special cases where relevant).
This recall set is the EXCEPTION to small-deck sizing: it legitimately needs broad coverage (~20–40 cards) because there are 20 residues with multiple recallable attributes each. Still no rephrasings — one card per (residue, attribute), never two cards asking the same residue's code two ways. Do NOT add ionization/pKa math, stereochemistry, or per-class chemistry reasoning — those are sibling keywords.

`
    : "";

  // INTRO deck — framing-only keyword (opens its umbrella). Make a card ONLY for a
  // general, cross-cutting term/distinction the upcoming subtopics will assume but
  // none is itself dedicated to teaching. Never a subtopic-specific fact. May be empty.
  const introBlock = opts.intro
    ? `INTRO DECK — this keyword OPENS its topic; it is FRAMING, not a subtopic. Make a flashcard ONLY for a GENERAL, cross-cutting term or distinction that the UPCOMING subtopics will assume but that none of them is itself dedicated to teaching (the umbrella's foundational vocabulary or a high-level "X vs Y" distinction). HARD GATES: (1) NEVER a fact that belongs to a specific subtopic — a sibling owns it, so it is out of scope here; (2) NEVER a value, formula, mechanism step, or fine detail — only a general definition/distinction; (3) if there is no genuinely new general term worth pre-teaching, return an EMPTY flashcards array — do NOT manufacture cards. Let content decide the count; an empty deck is correct and common.

`
    : "";

  const categoryBlock = opts.categoryLabel
    ? `CATEGORY: This deck is for the "${opts.categoryLabel}" unit ONLY. Every card — text and any figure — must be about ${opts.categoryLabel}. Do NOT include content from any other MCAT biology unit (no glycolysis/metabolism, genetics, physiology, etc. unless THIS unit IS that topic).\n\n`
    : "";

  const focusLabel = keywords.length > 0 ? keywords[0].label : "this subtopic";
  const completeBlock = opts.complete
    ? `DECK for "${focusLabel}": walk this keyword's IN-SCOPE list and make ONE card for each in-scope idea that is a hard memorizable fact (a name, value, direction, classification, compartment, or structure to recognize). SKIP any in-scope idea that is conceptual/intuition — that is taught in the lesson, not drilled. The deck is exactly those facts — often just a few, sometimes none.

COMBINE — mandatory: any set, list, table, or mapping within scope is EXACTLY ONE card listing all members together, never one card per row.

MECE — no two cards test the same fact, no rephrasings; never pad.

`
    : "";

  // BATCH-ACROSS-KEYWORDS partition — build lean decks for the WHOLE set
  // of keywords below in one pass, partitioning the unit's memorizable facts so
  // no fact is double-counted and no keyword is empty. Replaces completeBlock when isBatch.
  const batchBlock = isBatch
    ? `BATCH PARTITION MODE — build the flashcard decks for ALL ${keywords.length} keywords listed below IN ONE PASS, partitioning the unit's memorizable facts so each fact is owned by exactly one keyword.

For each keyword: walk its IN-SCOPE list and make ONE card per in-scope idea that is a hard memorizable fact; SKIP conceptual ideas (lesson-only); a set/table/mapping is ONE combined card. Many keywords yield just a few cards, some none.

MECE ACROSS THE SET:
- NO OVERLAP: each fact goes to exactly one keyword (when it could fit two, give it to the more specific one); no two cards test the same fact; no rephrasings.
- An empty deck for a keyword with nothing memorizable is correct — do not invent cards to fill it.

Every card's keyword_weights MUST name exactly one of the keyword ids listed below.

`
    : "";

  const identityBlock = await buildIdentityScopeBlock("mcat", keywords, { keywordWeights: true, forFlashcards: true });

  const userPrompt = opts.intro
    ? `Generate framing flashcards for an MCAT topic INTRO keyword (there may be NONE — an empty deck is valid).

${introBlock}${identityBlock}`
    : isBatch
    ? `Generate MCAT Biology flashcard decks for several keywords as one MECE partition.

${aaBlock}${batchBlock}${identityBlock}`
    : opts.complete
    ? `Generate a COMPLETE MCAT Biology flashcard deck for one subtopic.

${aaBlock}${completeBlock}${identityBlock}`
    : `Generate this keyword's flashcard deck — only its in-scope memorizable facts (there may be just a few, or none).

${aaBlock}${identityBlock}`;

  // Dedup helper — MECE safety net dropping duplicate AND near-duplicate cards the
  // model emits. Two passes:
  //  (1) exact: identical normalized front.
  //  (2) near-dup: SAME normalized answer (back) + high front-token overlap. This
  //      catches the common failure where a small topic gets the same fact asked
  //      many ways (e.g. ~12 cards whose answer is "R group"). Cards that share an
  //      answer but test genuinely different fronts (low overlap) are kept.
  const STOP = new Set([
    "the","a","an","of","is","are","to","in","on","and","or","that","this","what",
    "which","does","do","each","every","all","its","it","for","with","by","at","as",
    "amino","acid","acids","standard","group","groups",
  ]);
  const contentTokens = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/<[^>]+>/g, " ") // strip figure tags
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((t) => t.length > 2 && !STOP.has(t))
    );
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 && b.size === 0) return 1;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
  };
  const normBack = (s: string): string =>
    s.toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const dedup = (cards: GeneratedFlashcard[]): GeneratedFlashcard[] => {
    const seen = new Set<string>();
    const kept: { card: GeneratedFlashcard; back: string; toks: Set<string> }[] = [];
    for (const c of cards) {
      const exactKey = c.front.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(exactKey)) continue;
      const back = normBack(c.back);
      const toks = contentTokens(c.front);
      // Near-dup: an already-kept card with the same answer and a very similar front.
      const dup = kept.some(
        (k) => k.back === back && jaccard(k.toks, toks) >= 0.6
      );
      if (dup) continue;
      seen.add(exactKey);
      kept.push({ card: c, back, toks });
    }
    return kept.map((k) => k.card);
  };

  opts.onUserPrompt?.(userPrompt);
  if (opts.previewOnly) return [];

  const runOnce = async (): Promise<GeneratedFlashcard[]> => {
    const parsed = await callGen(
      opts.systemPrompt ?? (await resolveSystemPrompt(promptSlot("mcat", "flashcards"), FLASHCARD_SYSTEM)),
      userPrompt,
      opts.model ?? (opts.complete || isBatch ? FLASHCARD_MODEL : undefined)
    );
    const items = Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
    const valid = (items.filter(isValidFlashcard) as GeneratedFlashcard[])
      .map((c) => postProcessFlashcard(c, allowedKwIds))
      .filter((c): c is GeneratedFlashcard => c !== null);
    return dedup(valid);
  };

  // Retry once if the model returns zero valid cards (occasional empty/malformed
  // JSON, especially on the longer complete-deck enumeration prompt). Mirrors the
  // single-retry the question generator uses — a cold deck must never come back empty.
  let deduped = await runOnce();
  // INTRO decks may legitimately be empty — don't retry-fight an intentional zero.
  if (deduped.length === 0 && !opts.intro) {
    deduped = await runOnce();
  }
  // Deck size is content-decided (no count target). Cap only as a silent runaway
  // guard — generous enough to never bite a legit deck (incl. the 20-AA exception).
  return deduped.slice(0, 60);
}
