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
import { parseModelJson } from "./parseModelJson";
import { assembleChoices } from "./assembleChoices";
import { isRecallFront } from "./flashcardRecall";
import { hasMemorizableMath } from "./flashcardValidate";
import { MATH_FIGURE_RULE } from "./figureGuidance";
import { GEN_MODELS } from "./courseEngine/config";
import { resolveSystemPrompt, promptSlot } from "./promptOverrides";
import { buildIdentityScopeBlock } from "./scopeIds";
import { clientForModel } from "./genClient";
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
/** Question generation uses the stronger model (A/B winner for misconception-grounded distractors). */
const QUESTION_MODEL = GEN_MODELS.question; // gpt-5.4-mini (all generation on mini)
/** Lessons run on gpt-5.4-mini (all generation on mini; see GEN_MODELS). */
const LESSON_MODEL = GEN_MODELS.mathLesson; // gpt-5.4-mini

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
    throw new MathGenError(`AI provider request failed: ${msg}`);
  }
  try {
    return parseModelJson<Record<string, unknown>>(text);
  } catch {
    throw new MathGenError("AI provider returned non-JSON output");
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/** A misconception-grounded distractor: the specific student error + the value it produces. */
interface RawMathDistractor {
  misconception: string;
  value_latex: string;
}

/** Raw model output for a question, BEFORE code assembles choices/correct_index. */
interface RawMathQuestion {
  stem_latex: string;
  solution_latex: string;
  final_answer_latex: string;
  distractors: RawMathDistractor[];
  hint_latex: string;
  keyword_weights: Record<string, number>;
  difficulty: number;
}

function isValidMathQuestion(
  q: unknown,
  allowedKeywordIds: Set<string>,
  targetDifficulty?: number
): q is RawMathQuestion {
  if (!q || typeof q !== "object") return false;
  const obj = q as Record<string, unknown>;

  if (typeof obj.stem_latex !== "string" || !obj.stem_latex.trim())
    return false;
  if (typeof obj.solution_latex !== "string" || !obj.solution_latex.trim())
    return false;
  // Correct answer is taken from the solution's concluded final answer.
  if (
    typeof obj.final_answer_latex !== "string" ||
    !obj.final_answer_latex.trim()
  )
    return false;
  // Need 3 misconception-grounded distractor OBJECTS to assemble a 4-option item.
  if (!Array.isArray(obj.distractors) || obj.distractors.length < 3)
    return false;
  if (
    !(obj.distractors as unknown[]).every((d) => {
      if (!d || typeof d !== "object") return false;
      const o = d as Record<string, unknown>;
      return (
        typeof o.misconception === "string" &&
        o.misconception.trim().length > 0 &&
        typeof o.value_latex === "string" &&
        o.value_latex.trim().length > 0
      );
    })
  )
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

/**
 * Assemble a validated raw question into a GeneratedMathQuestion: the correct
 * choice is final_answer_latex (from the solution), placed at a random index.
 * Returns null if choices can't be formed (caller drops it).
 */
function assembleMathQuestion(raw: RawMathQuestion): GeneratedMathQuestion | null {
  // Map misconception-grounded distractor objects to their plain VALUE strings so
  // the downstream choice-assembly contract stays string[] (assembleChoices unchanged).
  const values = raw.distractors.map((d) => d.value_latex);
  const assembled = assembleChoices(raw.final_answer_latex, values);
  if (!assembled) return null;
  return {
    stem_latex: raw.stem_latex,
    solution_latex: raw.solution_latex,
    hint_latex: raw.hint_latex,
    keyword_weights: raw.keyword_weights,
    difficulty: raw.difficulty,
    choices: assembled.choices,
    correct_index: assembled.correct_index,
    // Misconception strings aligned to the distractor values (NOT to the shuffled choices).
    wrong_answer_descriptions: raw.distractors.map((d) => d.misconception),
  };
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
  // Reject bare-statement cards: the front MUST be a real recall cue.
  if (!isRecallFront(obj.front_latex)) return false;
  return true;
}

// ─── System prompts ───────────────────────────────────────────────────────────

const DELIMITER_FEWSHOT = `DELIMITERS ARE MANDATORY IN EVERY FIELD (stem, choices, solution, hint, example).
EVERY piece of math — variable, number, operator, fraction, integral, derivative, aligned block — MUST be wrapped in $...$ (inline) or $$...$$ (block); bare LaTeX outside delimiters shows literal backslashes to the student.
  ✅ "Differentiate: $\\dfrac{d}{dx}(x+3)^4 = 4(x+3)^3$."   ✅ block: "$$\\int_0^2 3\\,dt = 6$$"   ✅ aligned: "$$\\begin{aligned} x^3\\cdot x^5 &= x^{3+5} \\\\ &= x^8 \\end{aligned}$$"
  ❌ bare (never): "\\frac{d}{dx}(x+3)^4"   ❌ prose inside math: "\\text{the slope is } 3x^2" → write prose as text, then $3x^2$`;

const LATEX_RULES = `LATEX RULES (MANDATORY — violations produce unusable output):
- ALL math MUST be in KaTeX-compatible LaTeX: $...$ for inline, $$...$$ for display.
${DELIMITER_FEWSHOT}
- stem_latex: the problem as PLAIN PROSE, every math expression in $...$ (e.g. "What is the sign of $\\dfrac{-9}{-3}$?"); never \\text{} for prose, never bare commands.
- solution_latex: full worked solution, every step in $...$ (or $$...$$ for a standalone result), \\n\\n between steps. e.g. "Apply the power rule: $\\dfrac{d}{dx}[x^3] = 3x^2$.\\n\\nSo the slope at $x = 2$ is $3(2)^2 = 12$."
- hint_latex: one sentence, ≤15 words, guiding the approach without giving the answer.
- NO unicode math symbols (×, ÷, ≤, ≥, √, π) — use \\times, \\div, \\leq, \\geq, \\sqrt{}, \\pi. NO \\text{} for math (write $3x^2$, not \\text{3x^2}).
- SCIENCE/CHEMISTRY SUBSCRIPTS in $...$: "$CO_2$" not "CO2", "$H_2O$" not "H2O", "$pK_a$" not "pKa".`;

const DISTRACTOR_RULES = `DISTRACTOR RULES — distractors must be MISCONCEPTION-GROUNDED (answers a real student actually arrives at):
- Each is an OBJECT { "misconception": ..., "value_latex": ... }: write the misconception FIRST (a SPECIFIC, named, plausible error a real student makes on THIS problem — e.g. "cancels the $(x+1)$ factor but flips its sign", "plugs in before cancelling the removable factor, gets $0/0$ and reports $0$", "treats the one-sided limit as two-sided"), then DERIVE value_latex = the answer it produces. NOT random, NOT filler.
- When a natural HIGH-YIELD trap exists, ONE distractor MUST be it (vanishing denominator → "undefined"/"DNE"; one-sided vs two-sided mismatch; a sign error; evaluating before cancelling; an off-by-one).
- value_latex same TYPE as final_answer_latex (a number answer → numeric distractors, or "DNE"/"undefined"; never a nonsensical expression unless a student would literally submit it).
- All THREE value_latex DISTINCT from one another AND from final_answer_latex.`;

export const QUESTION_SYSTEM = `You write math practice questions for an AP Precalculus / AP Calculus AB adaptive learning app. Each tests procedural skill, conceptual understanding, or applied reasoning, is fully self-contained, and starts with a capital ending in ? or .

${LATEX_RULES}

${DISTRACTOR_RULES}

${MATH_FIGURE_RULE}

DIFFICULTY: write at the TARGET band stated in the user prompt (its requirements are given there) and set difficulty to a number inside that band.

COVERAGE across a batch: together the questions must touch EVERY in-scope concept/subidea — at least one question per concept, combining closely related concepts into one where natural; never pile several questions on one concept while leaving others untested.

OUTPUT ORDER — MANDATORY, do not reorder:
1. stem_latex (the problem).
2. solution_latex: work it step by step to a single final answer — do not pick an answer before finishing.
3. final_answer_latex = EXACTLY the value solution_latex concluded (copy from its end verbatim; do not recompute) — this becomes the correct choice.
4. distractors: EXACTLY 3 OBJECTS per the DISTRACTOR RULES above (misconception FIRST, then derive value_latex; all 3 distinct from each other and final_answer_latex, same type).
Do NOT output a "choices" array or "correct_index": the app builds the 4 choices from final_answer_latex + the distractor value_latex strings and places the correct one at random. So final_answer_latex MUST equal what solution_latex concluded — a solution deriving X but a final_answer_latex ≠ X is INVALID.

STAY INSIDE THE KEYWORD'S SCOPE: the required reasoning lives entirely within this keyword's scope contract — never ask about a downstream consequence or application needing a concept beyond it.

Return a JSON object:
{ "questions": [ { "stem_latex": "string", "solution_latex": "string", "final_answer_latex": "string", "distractors": [ { "misconception": "string", "value_latex": "string" }, { "misconception": "string", "value_latex": "string" }, { "misconception": "string", "value_latex": "string" } ], "hint_latex": "string", "keyword_weights": { "keyword_id": 0.8, "keyword_id_2": 0.2 }, "difficulty": 0.5 } ] }

Return valid JSON only. No markdown.`;

const SIMILAR_QUESTION_SYSTEM = `You write math practice questions for an AP Precalculus / AP Calculus AB adaptive learning app. Given an existing question, produce a NEW one testing the SAME concept from a different angle or with different numbers/expressions — NOT a trivial rewording: different stem, different values, FRESH distractors, same rigor and self-contained format.

${LATEX_RULES}

${DISTRACTOR_RULES}

Write at the TARGET DIFFICULTY band stated in the user prompt; set difficulty inside it.

OUTPUT ORDER — MANDATORY:
1. stem_latex. 2. solution_latex: work step by step to a single final answer. 3. final_answer_latex = EXACTLY what solution_latex concluded (verbatim) — the correct choice. 4. distractors: EXACTLY 3 OBJECTS { "misconception": ..., "value_latex": ... } per the DISTRACTOR RULES (misconception first, then derive value_latex; all 3 distinct from each other and final_answer_latex, same type).
Do NOT output "choices" or "correct_index" — the app assembles the 4 options from final_answer_latex + the distractor value_latex strings.

Return a JSON object:
{ "questions": [ { "stem_latex": "string", "solution_latex": "string", "final_answer_latex": "string", "distractors": [ { "misconception": "string", "value_latex": "string" }, { "misconception": "string", "value_latex": "string" }, { "misconception": "string", "value_latex": "string" } ], "hint_latex": "string", "keyword_weights": { "keyword_id": 1.0 }, "difficulty": 0.5 } ] }

Return valid JSON only. No markdown.`;

export const FLASHCARD_SYSTEM = `You write memorization flashcards for AP Precalculus / AP Calculus AB — two-sided cards (a cue on the front, the exact fact on the back) for the things a student must commit to memory.

WHEN TO MAKE A CARD — the IN-SCOPE list is the LESSON's full coverage, and MOST of it is conceptual and NOT carded. Card ONLY the discrete must-memorize ANCHORS in it: a formula or rule, a key theorem statement, a standard value or identity, or a canonical definition that IS itself a formula. A special case, behavior, or implication of an anchor is part of UNDERSTANDING it — taught in the lesson, never its own card. Usually a keyword has ONE such anchor → one card; sometimes a few, sometimes none.

SKIP WHEN THERE IS NOTHING TO MEMORIZE: if no in-scope item is a genuine formula/rule/theorem/value/identity (the keyword is purely conceptual), return an EMPTY flashcards array and set "no_memorizable_facts": true — those keywords are practiced via quiz, not drilled.

MECE — each card teaches a SUBJECT (a term, definition, formula, or relationship) that NO other card in the deck teaches. Two cards about the same subject are the SAME card even if worded differently or the back differs — a synonym, a reverse-direction ask, or a blank re-aimed on the same idea is NOT a new card; merge or drop it. A related family (a set of identities, a table of standard values) is ONE card; the facets of one anchor (special cases, synonyms, what a symbol stands for) fold into that anchor's SINGLE card. The deck size is simply the number of distinct in-scope facts — never pad, never rephrase to add a card.

COVERAGE — the deck must be COMPLETE: every in-scope memorizable fact must be drilled by SOME card, none left out. Combine related facts onto one card where it's natural; just never silently drop an in-scope fact.

NEVER A QUIZ QUESTION: no "solve/evaluate/find/compute/simplify/differentiate", no numeric problem — applying a formula to a specific instance is a QUIZ. Every front is a real cue (a "name the rule" / "formula for…" / "derivative of…" prompt, a definition or notation cue, or a "_____" cloze), never a bare declarative statement.

OUT-OF-SCOPE BAN — HARD GATE: anything in the keyword's OUT-OF-SCOPE list (or owned by a later keyword) is FORBIDDEN even if related — do not make a card for it or mention it.

FORMAT — both sides short:
- front_latex: a bare term, definition, or notation cue, usually ≤12 words.
- back_latex: the bare fact only — one definition, formula, or short statement, usually ≤20 words, ONE idea, NO worked example.
${LATEX_RULES.split("\n").slice(0, 3).join("\n")}
- Never put prose inside \\text{}.

FIGURES — most math cards stay pure text; add one only when it genuinely aids recall (a small graph of a behavior to recognize, or a data table), inline in front_latex/back_latex to SUPPORT the cue→fact, never replacing it. Never add a graph to a purely symbolic formula card.
${MATH_FIGURE_RULE}

KEYWORD WEIGHTS: use ONLY the keyword ids provided; sum to ~1.0.

Return a JSON object (front/back are plain strings; any figure is inline text inside them). If nothing is memorization-worthy, return an empty list and the flag:
{ "flashcards": [ { "front_latex": "string", "back_latex": "string", "keyword_weights": { "keyword_id": 1.0 } } ], "no_memorizable_facts": false }

Return valid JSON only. No markdown.`;

// ─── Lesson system prompt ─────────────────────────────────────────────────────

export const MATH_LESSON_SYSTEM = `You are a math tutor writing a short, intuition-first micro-lesson for an AP Precalculus / AP Calculus AB app, for a student who has NEVER seen this concept. Return valid JSON only — no markdown.

HOW IT READS
• Intuition first: open with ONE clean sentence stating the core idea — the single most important thing to grasp, as if you had only one sentence. No throat-clearing ("X matters because…"), no definition-first "A [concept] is …" opener, no "how to read it" lead-in. Bring in symbols and notation only after it lands.
• Name every term, symbol, and notation in plain words on first use — never leave notation unexplained.
• One idea per page, simplest first, each building on the last into ONE connected story — not a list of facts. Give every distinct in-scope idea — and distinct CASES of one idea — its own page (as many as needed); never repeat or pad.
• KEY RULE: after the prose, a BLANK LINE, then the one takeaway ALONE in **bold** (no "Key rule:" label) — never bolded inline at a paragraph's end.

COVERAGE — be COMPLETE: teach EVERY in-scope concept/subidea (combine closely related ones onto one page where natural; leave none untaught) and define+use every key term by its actual name — so the student could afterward answer any in-scope quiz on this keyword. Concise, not verbose; never pad.
SCOPE: teach ONLY this keyword's idea. Treat everything in ALREADY COVERED as known — build on it in a clause, never re-define or re-derive it. Never teach or rely on a LATER/out-of-scope topic; mention a neighbor only to mark a boundary.

FIGURES — optional, default NONE. Add one ONLY when a picture makes this page's one idea clearer, annotated to show it (a decorative graph is a defect). Tag as plain text, not inside $...$: <FunctionGraph equation="x+1" rangeX="-3,4" rangeY="-2,5"/> — * for multiply, ^ for power, holes="x,y" for a removable discontinuity, points="x,y;label" for a point. A markdown table can show a trend of values. Most pages need none.

CHECKS — optional: include one only when it confirms the page's idea and is answerable by someone who just read it; else set has_check:false. Never a multi-step exam.

OUTPUT: { "micro_steps": [ MicroStep ] }; MicroStep = { "step_index": n, "has_check": bool, "explanation_latex": str, "example_latex": str, "check_question"?: {…}, "hint_latex"?: str }.
• explanation_latex: as many plain sentences as the idea needs (never padded), then the bold key rule on its own line. No worked example here.
• example_latex: its OWN bubble — a CONCRETE in-scope case (never "a generic one") showing the rule USED, worked in steps; representative is best, a special case only if you justify it; a mini question→answer, not a restated definition; leave "" rather than force a hollow one.
• check_question (only if has_check) = { latex_content, solution_latex, correct_answer_latex, distractors:[3] }: write solution_latex first, copy its final answer into correct_answer_latex, then 3 DISTINCT distractors (realistic student errors). Never output "choices" or "correct_index" — the app assembles them. hint_latex: one sentence, ≤15 words.

LATEX: all math in $...$ or $$...$$; no unicode math symbols; no bare LaTeX; never prose inside \\text{}; bold with markdown **double asterisks** (NEVER \\textbf/\\mathbf or any math-mode bold for words; \\mathbf only for a true math symbol like a vector, never prose); normal spaces around inline math ("in $1$ hour", not "in $1$hour"); real newlines, never literal backslash-n.

Return valid JSON only. No markdown.`;

/**
 * OVERVIEW-MODE system prompt — used for UMBRELLA (topic) keywords only.
 *
 * An umbrella keyword is a TOPIC that groups several in_depth sub-skills, each of
 * which has its own teaching lesson. The umbrella lesson must NOT re-teach those
 * sub-skills (that duplicates the child lessons — and, when the first child is an
 * intro like "What the elimination method is", it makes the topic lesson identical
 * to the intro lesson). Instead it is a BRIEF ORIENTATION that motivates the topic
 * and names the sub-skills as a roadmap. The child lessons do the actual teaching.
 */
export const MATH_LESSON_OVERVIEW_SYSTEM = `You are a math tutor writing a BRIEF TOPIC OVERVIEW for an AP Precalculus / AP Calculus AB app. This is NOT a teaching lesson — it orients a student to a topic right before they work through that topic's individual sub-skill lessons. Return valid JSON only — no markdown.

WHAT AN OVERVIEW IS
• Exactly ONE short page. A few sentences — never a second page.
• It has only TWO jobs: (1) MOTIVATE — in plain language a beginner can feel, why this topic matters or what it lets them do; (2) ROADMAP — name the sub-skills coming up (from the SCOPE list below) in one natural sentence or a short inline list, so the student sees the path ahead.
• Open with the WHY/intuition. Never open with a wall of symbols, and never open with a formal "A [concept] is …" definition.
• You may put the topic name or a key phrase in **bold**. There is NO single "key rule" to land here — that belongs to the sub-skill lessons.

HARD RULES — DO NOT TEACH
• Do NOT teach, define, derive, or work an example for ANY sub-skill. Each one has its own dedicated lesson next. NAMING a sub-skill ("you'll see how to line up coefficients, then scale one equation, then both") is good; explaining or demonstrating HOW to do it is FORBIDDEN.
• No worked example — leave example_latex "".
• No understanding-check — set has_check:false and omit check_question.
• Stay inside this topic; never pull in material from the OUT OF SCOPE list.

FIGURES: none. An overview needs no figure.

OUTPUT: { "micro_steps": [ MicroStep ] }  — exactly ONE MicroStep.
MicroStep = { "step_index": 1, "has_check": false, "explanation_latex": str, "example_latex": "", "hint_latex": "" }.

LATEX: all math in $...$ or $$...$$; no unicode math symbols; no bare LaTeX; never put prose inside \\text{}; bold a key phrase with markdown **double asterisks** (NEVER \\textbf/\\mathbf or math-mode bold for words; \\mathbf only for a true math symbol like a vector); keep normal spaces around inline math; use real newlines, never the literal characters backslash-n.

Return valid JSON only. No markdown.`;

/**
 * Scope block for an UMBRELLA overview lesson. Unlike `buildBlueprintBlock`
 * (which says "teach only these"), this lists the umbrella's sub-skills as a
 * ROADMAP to NAME — never to teach — and keeps the out-of-scope fence.
 */
function buildOverviewScopeBlock(blueprint: ConceptBlueprint): string {
  const subSkills = blueprint.in_scope_concepts.map((c) => `  • ${c}`).join("\n");
  const outOfScope = blueprint.out_of_scope.length
    ? blueprint.out_of_scope.map((c) => `  • ${c}`).join("\n")
    : "  • (other topics in this unit)";
  return [
    "TOPIC OVERVIEW SCOPE (obey exactly):",
    "This is a BRIEF overview of ONE topic. The student will learn each sub-skill below in its OWN lesson next — your job is to orient and preview, NOT to teach.",
    `SUB-SKILLS UNDER THIS TOPIC — name these as the roadmap of what's coming; do NOT teach, define, derive, or work an example for any of them:\n${subSkills}`,
    `OUT OF SCOPE — never pull in material from other topics:\n${outOfScope}`,
    "An overview that teaches or demonstrates any sub-skill is INVALID. Motivate the topic, then name the path ahead.",
  ].join("\n");
}

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
  return (
    typeof obj.explanation_latex === "string" && obj.explanation_latex.trim().length > 0
  );
}

/** Blank check placeholder for a page that has no understanding-check. */
const BLANK_MATH_CHECK: MathLessonCheckQuestion = {
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

// Checks are OPTIONAL: a page with a good explanation but no (or an unassemblable)
// check is KEPT as a no-check page rather than dropped. Steps are re-indexed 1..n.
function validateLesson(
  parsed: Record<string, unknown>
): GeneratedMathLesson | null {
  if (!Array.isArray(parsed.micro_steps)) return null;
  const steps: MathMicroStep[] = [];
  for (const raw of parsed.micro_steps) {
    if (steps.length >= 5) break;
    if (!isValidMicroStep(raw)) continue;
    const s = raw as RawMicroStep & { example_latex?: unknown; hint_latex?: unknown };

    // Assemble a check only when the model both wanted one (has_check !== false)
    // and supplied a complete, assemblable check_question; otherwise no-check page.
    const wantsCheck = s.has_check !== false;
    const assembled =
      wantsCheck && rawCheckIsComplete(s.check_question)
        ? assembleChoices(
            s.check_question.correct_answer_latex,
            s.check_question.distractors
          )
        : null;

    steps.push({
      step_index: steps.length + 1,
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
        : BLANK_MATH_CHECK,
    });
  }
  // A lesson needs at least 1 usable page; a simple keyword may legitimately be a
  // single page. Fewer than 1 (no teaching content at all) → null so caller retries.
  return steps.length >= 1 ? { micro_steps: steps } : null;
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
  /**
   * Batch diversity directive (within-subtopic-diversity design, Phase 2). When
   * generating a batch to recycle, force the items to be mutually distinct
   * across the subtopic's VALID axes (solution method / sub-approach, and where
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
}): Promise<GeneratedMathQuestion[]> {
  const { keywords, count } = opts;

  const effectiveTarget: number = opts.difficultyTier
    ? TIER_TARGET[opts.difficultyTier]
    : (opts.targetDifficulty ?? 0.55);

  const allowedIds = new Set(keywords.map((k) => k.id));
  const identityBlock = await buildIdentityScopeBlock("math", keywords, { keywordWeights: true });

  const diversityBlock =
    count > 1 && opts.diversityDirective
      ? `\nBATCH DIVERSITY: ${opts.diversityDirective}\n`
      : count > 1
        ? `\nBATCH DIVERSITY: Make questions MATERIALLY DIFFERENT from one another — vary the solution method / sub-approach and the specific numbers/setup, vary the difficulty across the set (some easier, some harder, around the target). Prefer distinct coverage; never sacrifice a question's quality or correctness to make it different.\n`
        : "";

  const userPrompt = `Generate AP math multiple-choice questions covering every in-scope concept — one per concept, combining closely related concepts into one question where natural. Let the concept count decide how many questions to write: a narrow topic may yield just a few, a broad one more. Never pad to reach a number; cap at ${count}.

${difficultyInstruction(effectiveTarget)}
${diversityBlock}
${identityBlock}`;

  opts.onUserPrompt?.(userPrompt);
  if (opts.previewOnly) return [];

  const runOnce = async (): Promise<GeneratedMathQuestion[]> => {
    const parsed = await callGen(
      opts.systemPrompt ?? (await resolveSystemPrompt(promptSlot("math", "quiz"), QUESTION_SYSTEM)),
      userPrompt,
      opts.model ?? QUESTION_MODEL
    );
    const items = Array.isArray(parsed.questions) ? parsed.questions : [];
    return items
      .filter((q) => isValidMathQuestion(q, allowedIds, effectiveTarget))
      .map((q) => assembleMathQuestion(q as RawMathQuestion))
      .filter((q): q is GeneratedMathQuestion => q !== null);
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

  const userPrompt = `Generate a NEW question testing the same concept from a different angle.

${outlineBlock}${scopeEnforcement}${difficultyInstruction(effectiveTarget)}

ORIGINAL QUESTION:
stem_latex: ${question.stem_latex}
choices: ${question.choices.map((c, i) => `[${i}] ${c}`).join("; ")}
solution: ${question.solution_latex.slice(0, 200)}...

KEYWORDS (use ONLY these keyword ids):
${keywordBlock}
${exemplarSection}`;

  const runOnce = async (): Promise<GeneratedMathQuestion[]> => {
    const parsed = await callGen(SIMILAR_QUESTION_SYSTEM, userPrompt);
    const items = Array.isArray(parsed.questions) ? parsed.questions : [];
    return items
      .filter((q) => isValidMathQuestion(q, allowedIds, effectiveTarget))
      .map((q) => assembleMathQuestion(q as RawMathQuestion))
      .filter((q): q is GeneratedMathQuestion => q !== null);
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
  /** Existing cards (front → back text) used as STYLE templates; new cards must
   *  match the voice but cover DIFFERENT facts (no duplicates). */
  templateText?: string[];
  /**
   * COMPLETE-DECK mode: the model first ENUMERATES every distinct memorizable
   * fact inside this keyword's scope, then emits exactly one card per fact (up to
   * `count` as a safety cap). Used for per-keyword deck generation so each deck is
   * MECE within itself. Runs on gpt-5.5 for breadth.
   */
  complete?: boolean;
  /** Sibling keywords (other subtopics in the same category) — their content is
   *  OFF-LIMITS so decks stay MECE ACROSS keywords. */
  siblingKeywords?: { label: string; description?: string }[];
  /** Human category name — keeps cards inside this one unit. */
  categoryLabel?: string;
  /** Override the system prompt (dev lab live-tuning). Defaults to FLASHCARD_SYSTEM. */
  systemPrompt?: string;
  /** Override the model (dev lab). Defaults to the per-mode flashcard model. */
  model?: string;
  /** Receives the assembled user prompt (dev lab read-only context pane). */
  onUserPrompt?: (prompt: string) => void;
  /** Assemble the prompt and return WITHOUT calling the model (lab prompt preview). */
  previewOnly?: boolean;
}): Promise<GeneratedMathFlashcard[]> {
  const { keywords } = opts;
  const identityBlock = await buildIdentityScopeBlock("math", keywords, { keywordWeights: true, forFlashcards: true });

  const completeBlock = opts.complete
    ? `DECK MODE — walk this keyword's IN-SCOPE list and make ONE card for each in-scope item that is a hard memorizable fact (a formula, rule, theorem statement, standard value, or identity). SKIP any in-scope item that is conceptual — that is taught in the lesson, not drilled. NO two cards on the same fact. Math recall decks are usually SMALL — often just a few cards, sometimes none; let the content decide and never pad.\n\n`
    : "";

  // Figure directive for visual decks (graph-recognition / shape cards).
  const fcVisualHay = keywords
    .map((k) => `${k.label} ${k.description ?? ""} ${(k.blueprint?.key_terms ?? []).join(" ")}`)
    .join(" ")
    .toLowerCase();
  const fcVisual =
    /\b(graph|hole|discontinuit|asymptot|end behavior|transformation|intercept|concav|increasing|decreasing|parabola|parent function|shape|sketch|plot)\b/.test(fcVisualHay);
  const fcFigureDirective = fcVisual
    ? `\n\nFIGURES — encouraged where they aid recall of THIS keyword's idea: a <FunctionGraph equation="..." rangeX="..." rangeY="..."/> (mark a removable discontinuity with holes="x,y") that illustrates the specific behavior this keyword is about. Choose an equation that fits THIS keyword — do NOT default to x^2. Emit the tag as plain text (NOT inside $...$). Do not force figures onto purely-symbolic cards.\n\n`
    : "";

  const userPrompt = opts.complete
    ? `Build the memorization deck for the target keyword below.

${completeBlock}${fcFigureDirective}${identityBlock}`
    : `Generate this keyword's math flashcard deck — only its in-scope memorizable facts (there may be just a few, or none).

${fcFigureDirective}${identityBlock}`;

  // Front-text dedup so a deck never repeats the same fact two ways.
  const dedup = (cards: GeneratedMathFlashcard[]): GeneratedMathFlashcard[] => {
    const seen = new Set<string>();
    const out: GeneratedMathFlashcard[] = [];
    for (const c of cards) {
      const norm = (c.front_latex ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (norm && seen.has(norm)) continue;
      if (norm) seen.add(norm);
      out.push(c);
    }
    return out;
  };

  // The model sets this when the keyword has nothing memorization-worthy (purely
  // conceptual) — an intentional empty deck, NOT a failed generation. We then skip
  // the retry so we don't burn a second call manufacturing filler cards.
  let skippedAsConceptual = false;
  opts.onUserPrompt?.(userPrompt);
  if (opts.previewOnly) return [];

  const runOnce = async (): Promise<GeneratedMathFlashcard[]> => {
    const parsed = await callGen(
      opts.systemPrompt ?? (await resolveSystemPrompt(promptSlot("math", "flashcards"), FLASHCARD_SYSTEM)),
      userPrompt,
      opts.model ?? (opts.complete ? GEN_MODELS.flashcard : undefined)
    );
    if (parsed.no_memorizable_facts === true) skippedAsConceptual = true;
    const items = Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
    const valid = (items.filter(isValidFlashcard) as GeneratedMathFlashcard[]).filter(
      (c) => isRecallFront(c.front_latex) && hasMemorizableMath(c.front_latex, c.back_latex)
    );
    return dedup(valid);
  };

  let deduped = await runOnce();
  // Retry once on empty ONLY if it wasn't an intentional "nothing to memorize" skip.
  if (deduped.length === 0 && !skippedAsConceptual) deduped = await runOnce();
  // Deck size is content-decided (no count target); cap only as a silent runaway guard.
  return deduped.slice(0, 60);
}

// ─── Lesson generator ─────────────────────────────────────────────────────────

/** A neighboring keyword (earlier/later in course order) used as REFERENCE context. */
export interface LessonNeighbor {
  label: string;
  relation: "earlier" | "later";
}

/** Lab/override hooks for lesson generation (used by the dev Lesson Lab). */
export interface LessonGenOptions {
  /** Override the system prompt (lab live-tuning). Defaults to MATH_LESSON_SYSTEM. */
  systemPrompt?: string;
  /** Override the model (lab model picker). Defaults to LESSON_MODEL. */
  model?: string;
  /** Neighboring keywords for light scope context ("reference, don't teach"). */
  neighbors?: LessonNeighbor[];
  /** Receives the assembled user prompt (for the lab's read-only context pane). */
  onUserPrompt?: (prompt: string) => void;
  /** Assemble the prompt and return WITHOUT calling the model (lab prompt preview). */
  previewOnly?: boolean;
}

/** Render the neighbor "reference, don't teach" block (light-B scope context). */
function buildNeighborBlock(neighbors?: LessonNeighbor[]): string {
  if (!neighbors || neighbors.length === 0) return "";
  const earlier = neighbors.filter((n) => n.relation === "earlier").map((n) => n.label);
  const later = neighbors.filter((n) => n.relation === "later").map((n) => n.label);
  const parts: string[] = [];
  if (earlier.length)
    parts.push(`Already covered (the student may know these): ${earlier.join("; ")}.`);
  if (later.length)
    parts.push(`Comes LATER (do NOT teach — you may name one in passing only to motivate today's idea): ${later.join("; ")}.`);
  return `\n\nSURROUNDING TOPICS (context only — you are NOT teaching these): ${parts.join(" ")} Teach ONLY this keyword's idea; reference a neighbor only when it makes the current idea clearer.\n`;
}

/**
 * Generate a math micro-lesson for a keyword.
 * Intuition-first, scope-disciplined, figures optional, checks optional+simple.
 * Retries once if invalid; throws MathGenError after.
 */
export async function generateMathLesson(
  keyword: {
    id: string;
    label: string;
    description: string;
    examples?: string;
    blueprint?: ConceptBlueprint | null;
    /** Keyword tier — "umbrella" triggers BRIEF overview-mode (orient + roadmap, no teaching). */
    tier?: string | null;
  },
  outlineContext?: string,
  exemplarBlock?: string,
  opts?: LessonGenOptions
): Promise<GeneratedMathLesson> {
  // Umbrella keywords are TOPICS whose sub-skills each have their own lesson. The
  // umbrella lesson is a BRIEF overview (motivate + name the roadmap), NOT a re-teach
  // of those sub-skills — otherwise the topic lesson duplicates its first child
  // (e.g. an intro "What X is" keyword). See MATH_LESSON_OVERVIEW_SYSTEM.
  const isOverview = keyword.tier === "umbrella";

  const identityBlock = await buildIdentityScopeBlock("math", [keyword]);

  const teachingTail = `Think carefully about what a student who has NEVER seen this AP math concept before would find confusing.
Lead with the INTUITION, then state the concrete rule/notation crisply (a "Key rule:" line) — that rule is the point of the lesson.
Cover EVERY in-scope concept listed above, each with its own intuition — give a distinct concept its own page; use as many pages as full coverage needs, never padding. You may MENTION another concept only to clarify a boundary, never teach it; never make an out-of-scope keyword the thing you teach.
Use example_latex ONLY where a worked example genuinely helps (leave it "" for purely conceptual/definitional pages).
Add a figure ONLY when it makes THIS page's idea clearer; most pages need none.
Checks are OPTIONAL and SIMPLE — include one only when it confirms the page's idea, and keep it a quick single-concept comprehension check (set has_check:false to omit).`;

  const overviewTail = `Write a BRIEF overview of the "${keyword.label}" topic for a student who is about to work through its sub-skills one lesson at a time.
This single short page has two jobs: (1) MOTIVATE — why this topic matters or what it lets the student do; (2) ROADMAP — name this topic's sub-skills so the student sees the path ahead.
Do NOT teach, define, derive, or work an example for any sub-skill — each has its own lesson next. No worked example, no understanding-check. Keep it short.`;

  // Figures are OPTIONAL (system prompt's MATH_LESSON_FIGURE_RULE governs them);
  // there is NO forced-graph directive — a confusing decorative graph is worse than
  // none. The model adds a figure only when it makes the page's one idea clearer.
  const userPrompt = `${identityBlock}

${isOverview ? overviewTail : teachingTail}`;

  opts?.onUserPrompt?.(userPrompt);
  if (opts?.previewOnly) return { micro_steps: [] };

  const systemPrompt =
    opts?.systemPrompt ??
    (isOverview
      ? await resolveSystemPrompt(promptSlot("math", "lesson_overview"), MATH_LESSON_OVERVIEW_SYSTEM)
      : await resolveSystemPrompt(promptSlot("math", "lesson"), MATH_LESSON_SYSTEM));
  const model = opts?.model ?? LESSON_MODEL;

  let lesson: GeneratedMathLesson | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = await callGen(systemPrompt, userPrompt, model);
    lesson = validateLesson(parsed);
    if (lesson) break;
  }

  if (!lesson) {
    throw new MathGenError(
      "Lesson generation produced no valid output after retry"
    );
  }

  // Choice placement is already randomized during assembly in validateLesson.
  // Deterministic safety net: the model sometimes writes the LITERAL characters
  // backslash-n/t/r in prose (e.g. "...1 hour.\nIts rate...") instead of a real
  // line break, which would render as raw "\n" and run words together. Convert
  // them to real whitespace at STORAGE time too (MathText also does this at
  // render). Math-safe: never touches real commands like \nu \neq \theta \text.
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

const VERIFY_SYSTEM =
  "You are a careful AP math problem checker. FIRST decide if the question is WELL-POSED. A question is NOT well-posed if ANY of these hold: (1) the stem is truncated or incomplete (ends abruptly, has a stray symbol, or poses no clear question); (2) the stem contains CONTRADICTORY PREMISES — e.g. it states a limit exists at a point AND that the function blows up at that same point; (3) the question is unanswerable from the stem + choices alone. If the stem asserts two mutually exclusive mathematical facts about the same point/expression, mark it NOT well-posed immediately — do not try to resolve the contradiction. THEN, only if well-posed, solve it independently and pick the single best answer. Return JSON {\"well_posed\": true|false, \"answer_index\": 0-3, \"reason\": \"<=1 short sentence\"}. If not well-posed, set well_posed=false and still give your best answer_index.";

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
