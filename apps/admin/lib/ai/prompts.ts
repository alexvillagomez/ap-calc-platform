/**
 * AP Calculus AB problem-generation prompts (exam-prep flow).
 *
 * MCQ: random emphasis topic from the selected pool (server); topic_weights { emphasis_id: 1 } per MCQ prompt template.
 * FRQ: random archetype 1–7 → TYPE A–G; calculator never allowed for any FRQ.
 *
 * Create calls: MCQ system only; FRQ system + CANONICAL_TOPICS_TEXT (MCQ topic comes from user message only).
 */

import { getMcqDifficultyReferenceLine } from "@/lib/ai/examPrepConstants";

export type GenerationFormat = "multiple_choice" | "free_response";

// =============================================================================
// SHARED: CANONICAL TOPIC POOL
// =============================================================================

export const CANONICAL_TOPICS_TEXT = `
1_1: Estimating Limit Values from Graphs (read a limit value directly from a graph, must include a graph, usually piecewise functions)
1_2: Estimating Limit Values from Tables (read a limit value from a numeric table)
1_3: Determining Limits Using Algebraic Properties (factor, rationalize, or substitute to evaluate a limit algebraically)
1_4: Types of Discontinuities (classify or identify removable, jump, or infinite discontinuities)
1_5: Defining Continuity at a Point and over an Interval (apply the continuity definition)
1_6: Infinite Limits and Vertical Asymptotes (evaluate a limit that goes to +/-inf as x approaches a)
1_7: Limits at Infinity and Horizontal Asymptotes (find end behavior by comparing degrees or using dominant terms)
1_8: Intermediate Value Theorem (invoke IVT to guarantee existence of a value on an interval)
1_9: Trig Limits from Squeeze Theorem (Applying sinx/x)
2_1: Average Rate of Change (compute the slope of a secant line or estimate a derivative numerically)
2_2: Defining the Derivative; Derivative Notation (use the limit definition of the derivative, must include a limit within the problem)
2_3: Differentiability (applying differentiability definition)
2_4: Power Rule (differentiate x^n)
2_5: Constant, Sum, Difference, Constant Multiple Rules (combine basic derivative rules linearly)
2_6: Derivatives of trig functions, e^x, lnx (apply standard transcendental derivative formulas)
2_7: Product Rule (differentiate a product of two functions)
2_8: Quotient Rule (differentiate a ratio of two functions)
3_1: Chain Rule (differentiate a composite function)
3_2: Implicit Differentiation (differentiate an equation in x and y implicitly to find dy/dx)
3_3: Differentiating Inverse Functions (apply the (f inverse) prime formula)
3_4: Differentiating Inverse Trig Functions (differentiate arcsin, arccos, arctan, etc.)
3_5: Higher-Order Derivatives (compute f double prime, f triple prime)
4_1: Interpreting the Derivative in Context (state units or real-world meaning of f prime in an applied scenario)
4_2: Straight-Line Motion Differentiation (relate position, velocity, and acceleration using derivatives)
4_3: Related Rates (differentiate an equation relating two changing quantities)
4_4: Local Linearity and Linearization (build or use a tangent-line approximation L(x))
4_5: L Hopital Rule (resolve a 0/0 or inf/inf indeterminate form by differentiating numerator and denominator)
5_1: Mean Value Theorem (invoke MVT to guarantee existence of c where f prime(c) equals the average rate)
5_2: Optimization (find an absolute max or min in an applied context using calculus)
5_3: EVT, Critical Points (identify critical points; apply EVT on a closed interval)
5_4: Increasing/Decreasing Intervals (use the sign of f prime to determine where f rises or falls)
5_5: First Derivative Test and Local Min/Max (classify relative extrema by the sign change of f prime at a critical point)
5_6: Candidates Test (find absolute extrema on a closed interval by comparing critical point and endpoint values)
5_7: Concavity (use the sign of f double prime to determine concave up/down; locate inflection points)
5_8: Second Derivative Test (classify a critical point as relative max/min using the sign of f double prime)
5_9: Sketching Graphs of f and f prime (connect graph features to derivative behavior)
6_1: Riemann Sum Approximations (estimate area using left, right, midpoint, or trapezoidal sums. must specify subintervals and left right midpoint)
6_2: Riemann Sums, Summation Notation, Definite Integral Notation (match definite integral to infinite limit Riemann sum notation)
6_3: FTC Part 1 Accumulation Functions (differentiate g(x) = integral from a to x of f(t) dt, using chain rule if needed)
6_4: Interpreting Accumulation Functions (describe behavior of F(x) = integral of f in terms of net area or rate)
6_5: FTC Part 2 Evaluating Definite Integrals (compute integral from a to b of f dx = F(b) minus F(a) given only the definite integral)
6_6: Antiderivatives and Indefinite Integrals (apply basic antiderivative rules; include +C)
6_7: U-Substitution (use u-substitution to evaluate an integral)
7_1: Verifying Solutions to Differential Equations (substitute a function into a DE to confirm it satisfies the equation)
7_2: Slope Fields (read or match a slope field to a differential equation)
7_3: Separation of Variables General Solution (separate dy and dx; integrate both sides; solve for y)
7_4: Separation of Variables Particular Solution (apply an initial condition after separating variables)
7_5: Exponential Growth/Decay Models (solve dy/dt = ky; interpret k and the model in context)
8_1: Average Value of a Function (compute (1/(b-a)) times integral from a to b of f dx)
8_2: Position/Velocity/Acceleration via Integrals (recover position or displacement by integrating velocity)
8_3: Accumulation in Applied Contexts (compute net change or total amount as a definite integral in a real scenario)
8_4: Area Between Curves Functions of x (integrate |f(x) - g(x)| with respect to x)
8_5: Area Between Curves Functions of y (integrate with respect to y)
8_6: Volumes with Cross-Sections (integrate A(x) or A(y) for a known cross-sectional shape)
8_7: Disk Method Around x or y Axis (integrate pi times [f(x)] squared)
8_8: Disk Method Around Other Axes (shift the radius when revolving around a non-coordinate axis)
8_9: Washer Method Around x or y Axis (integrate pi times ([f(x)] squared minus [g(x)] squared))
8_10: Washer Method Around Other Axes (adjust inner and outer radii for a non-coordinate axis)
`.trim();

// =============================================================================
// SHARED: POST-GENERATION WEIGHT CHECK
// =============================================================================

export const AP_CALC_WEIGHT_CHECK_SYSTEM = `
You are a strict AP Calculus AB topic classifier.

You receive: a problem stem, a worked solution, the generator's topic_weights, and the topic pool.

Your job: verify and correct topic_weights.

Rules:
1. For each weighted topic: "Does the student need to actively use this specific skill to solve the problem?" If no, weight = 0.
2. For each unweighted topic: ask the same question. If yes, add it.
3. A topic is USED only if its core skill (in parentheses) is explicitly exercised. Background knowledge does not count.
4. Rebalance non-zero weights to sum to 1.
5. Return exactly one valid JSON object: { "topic_weights": { ... } }. No other text. No markdown.

`.trim();

export function buildWeightCheckUserPrompt(args: {
  latexContent: string;
  solutionLatex: string;
  currentWeights: Record<string, number>;
  topicLines: string;
}): string {
  return `Topic pool:\n${args.topicLines}\n\nProblem stem:\n${args.latexContent}\n\nWorked solution:\n${args.solutionLatex}\n\nGenerator-assigned topic_weights:\n${JSON.stringify(args.currentWeights, null, 2)}\n\nReturn the corrected JSON.`;
}

// =============================================================================
// MCQ SYSTEM PROMPT
// =============================================================================

export const AP_CALC_MCQ_SYSTEM = `
Return exactly one valid JSON object. No markdown code fences. No prose outside JSON.

Required keys: latex_content, solution_latex, choices (exactly four strings), correct_index (integer 0–3).

LaTeX: Put every English word, label, or sentence in \\\\text{...}. Only math (symbols, expressions, derivatives, fractions) may sit outside \\\\text{}. Plain prose in math mode is invalid.

If latex_content or any choice embeds <FunctionGraph /> or <SlopeField />, treat each equation= attribute as the ground truth for what is drawn. solution_latex and correct_index must match it: sample the expression at test x-values in each interval relevant to the question (e.g. midpoints between intercepts); do not claim f' > 0 where the expression is negative there (and vice versa). If the stem says the graph is f or f', keep that distinction consistent with the equation.

Follow every instruction in the user message exactly, including LaTeX formatting and topic_weights.
`.trim();

export const AP_CALC_MCQ_REFINEMENT_SYSTEM = `
${AP_CALC_MCQ_SYSTEM}

When refining, return one updated JSON object that still obeys the user message rules.
`.trim();

// =============================================================================
// FRQ SYSTEM PROMPT
// =============================================================================

export const AP_CALC_FRQ_SYSTEM = `
You are an AP Calculus AB free-response author. Problems should feel like authentic AP FRQs: coherent context, units where appropriate, and challenging reasoning — but **calculator is NEVER allowed** for any problem. Use exact values, hand-friendly numbers, and forms students can evaluate without a calculator.

Return exactly one valid JSON object. No markdown fences.

WORKFLOW (strict order):
1. Follow the **requested TYPE** and archetype instructions in the user message (TYPE A–G). Match part structure: (a)–(d) with 9 points total, except TYPE G uses three parts (a)–(c) with points 2+4+3.
2. Context — one shared mathematical object (function, ODE, table, graph, or region) across all parts; concrete scenario; **force units** on rates and interpretations when applicable.
3. Stem — latex_content: \\\\begin{aligned}...\\\\end{aligned} with &\\\\text{...} rows; parts \\\\text{(a)}, \\\\text{(b)}, ... Use \\\\( ... \\\\) only inside aligned rows where needed. No \\\\begin{itemize}. Close every \\\\text{ before \\\\\\\\.
4. Visuals — <SlopeField .../> and <FunctionGraph .../> only AFTER \\\\end{aligned}, on their own line. equation uses expr-eval syntax (* for multiply). Points on graphs must lie on the function.
5. solution_latex — full solution for every part; steps with \\\\text{(1)}, \\\\text{(2)}, ... per part.
6. rubric — exactly **9** points: \\\\text{P1:} … \\\\text{P9:} in one aligned env. Earlier points reward correct **application of concepts** and justification; later points reward **correct computation** and **units** where applicable. Use College Board–style wording (setup, justification, units, interpretation, eligibility, banking when helpful). **Do not** reference calculator or decimal approximations.

TYPE SUMMARY (no calculator — adapt numbers for exact work)
- TYPE A: tabular / rate / accumulation / Riemann + interpretation (typical 3+2+2+2).
- TYPE B: motion v(t) or s(t); direction, acceleration, distance/displacement (2+3+2+2).
- TYPE C: ODE + slope field + linearization / separation as appropriate (1+2+2+4).
- TYPE D: graph of f or f'; accumulation g, extrema, limits, areas (1+2+3+3 or alternate split).
- TYPE E: tables; chain rule, higher derivative, FTC composition (2+3+1+3).
- TYPE F: implicit curve; tangents; related rates (2+2+3+2).
- TYPE G: area + volume cross-sections + washer setup (2+4+3), three parts only.

LaTeX: prose in \\\\text{...}; every backslash in a JSON string value must be doubled (a single LaTeX \\ becomes \\\\ in JSON, a LaTeX line break \\\\ becomes \\\\\\\\ in JSON); rubric and solution use \\\\\\\\ for row breaks in JSON strings.

Required keys: latex_content, solution_latex, rubric
`.trim();

export const AP_CALC_FRQ_REFINEMENT_SYSTEM = `
${AP_CALC_FRQ_SYSTEM}

When refining: (1) revise context and latex_content, (2) revise solution_latex, (3) revise rubric, (4) recompute topic_weights last. Return one updated JSON object. Keep all type, context, and formatting rules unchanged.
`.trim();

// =============================================================================
// SYSTEM PROMPTS PER FORMAT (create / refine + canonical topics)
// =============================================================================

export function buildCreateSystemPrompt(format: GenerationFormat): string {
  const body =
    format === "multiple_choice" ? AP_CALC_MCQ_SYSTEM : AP_CALC_FRQ_SYSTEM;
  if (format === "multiple_choice") {
    return body;
  }
  return `${body}\n\nCanonical topic ids, names, and skill descriptions (for topic_weights keys):\n${CANONICAL_TOPICS_TEXT}`;
}

export function buildRefineSystemPrompt(format: GenerationFormat): string {
  const body =
    format === "multiple_choice"
      ? AP_CALC_MCQ_REFINEMENT_SYSTEM
      : AP_CALC_FRQ_REFINEMENT_SYSTEM;
  if (format === "multiple_choice") {
    return body;
  }
  return `${body}\n\nCanonical topic ids, names, and skill descriptions (for topic_weights keys):\n${CANONICAL_TOPICS_TEXT}`;
}

/** @deprecated Prefer buildCreateSystemPrompt(format) — this bundles both formats. */
export const AP_CALC_GENERATION_SYSTEM = [
  AP_CALC_MCQ_SYSTEM,
  AP_CALC_FRQ_SYSTEM,
  "Canonical topic ids, names, and skill descriptions (for topic_weights keys):",
  CANONICAL_TOPICS_TEXT,
].join("\n\n");

/** @deprecated Prefer buildRefineSystemPrompt(format). */
export const AP_CALC_REFINEMENT_SYSTEM = [
  AP_CALC_MCQ_REFINEMENT_SYSTEM,
  AP_CALC_FRQ_REFINEMENT_SYSTEM,
].join("\n\n");

// =============================================================================
// TOPIC BLOCK (shared)
// =============================================================================

function buildTopicBlock(args: { topicLines: string; singleTopicId: string | null }): string {
  if (args.singleTopicId) {
    return `Topic constraint:\n- Emphasize ONLY topic id "${args.singleTopicId}" — the problem must directly exercise that skill.`;
  }

  return `Topic pool (id: topic name — skill in parentheses):\n${args.topicLines}\n\nTopic constraint:\n- Choose the problem focus from this pool; the problem must directly exercise the skills listed.`;
}

const MCQ_API_OUTPUT_NOTE = `API requirement: Your response must be exactly one raw JSON object (no markdown code fence, no text before or after) so it parses as JSON.`;

/** MCQ user message — verbatim wording (LaTeX shown with double backslashes as required in JSON). */
const MCQ_FORMAT_FOR_ALL_PARTS = `Format for ALL parts:

CRITICAL JSON ESCAPING RULE: This output is a JSON string. Every LaTeX backslash MUST be doubled.
- \\\\text{} in JSON  →  renders as \\text{} in LaTeX  (CORRECT)
- \\text{} in JSON   →  invalid JSON / broken LaTeX    (WRONG)
- Never use a single backslash anywhere in the JSON string values.

Wrap ALL NARRATIVE (text that is not math) in \\\\text{...} with exactly TWO backslashes and include spaces within text{}
Leave all math fragments outside of text{}
Use \\\\ for line breaks
Integrals written as \\\\int_a^b\\\\!\\\\!
Slope Fields written as:
<SlopeField equation="f(x,y)" rangeX="a,b" rangeY="c,d" />
exactly as it is subsituting the equation and ranges
Graphs written as:
<FunctionGraph equation="f(x)" rangeX="a,b" rangeY="c,d" points="(0,1,(0,1));(1,-1,(2,1))" />
FunctionGraph / SlopeField formatting rules:

- <FunctionGraph ... /> and <SlopeField ... /> must use normal double quotes " in the actual tag. If the output is inside JSON, those quotes will appear escaped as \". That is correct.
- equation must be expr-eval only: an expression in x, such as x^2-4, x^3-3*x, sin(x), exp(x), or sqrt(x+1).
- Do NOT include f(x)=, y=, f'(x)=, dy/dx=, or any equals sign inside equation.
- Do NOT use LaTeX inside equation.
- Use * for multiplication.
- Allowed syntax: numbers, x, +, -, *, /, ^, parentheses, sin, cos, tan, sqrt, exp, ln.
- points must be formatted exactly as (x,y,label);(x,y,label);...
- The label must be short text only, with no commas and no parentheses. Good labels: A, B, max, min, root1.
- Every listed point must lie on the graphed expression.
- If graphing the derivative, indicate that only in the surrounding narrative, not inside equation. Example: \\\\text{The graph shown is } f'(x). Then use <FunctionGraph equation="x^2-4" ... />

FunctionGraph points rules (STRICT):

- points is OPTIONAL. Do NOT include points unless they are explicitly useful (e.g., extrema or intercepts that are clearly intended to be shown).

- If points are included, they must be EXACT and VERIFIED:
  • Every point (x,y,label) must satisfy the equation numerically.
  • The y-value must match the equation evaluated at x.

- Allowed point types ONLY:
  • local minimum → label "min"
  • local maximum → label "max"
  • x-intercept → label "root"

- DO NOT use labels like "root1", "root2", "(0,0)", or anything with numbers, commas, or parentheses.
  Only use: min, max, or root.

- DO NOT include approximate or guessed points.
  If exact values are not simple integers, DO NOT include points at all.

- If unsure whether a point is correct → DO NOT include it.

- Never include decorative or redundant points.

Point validation requirement (MANDATORY):

Before outputting <FunctionGraph>, you MUST verify each point:

- Plug the x-value into the equation
- Compute the exact y-value
- Only include the point if it EXACTLY matches

If any point fails this check → REMOVE ALL points
Slope field and function should always be a function of x after the entire question
Examples:
\\\\text{Example } y=x.


latex_content:
Prefer one line, no line breaks; keep the stem short.
Simple solving stems often look like:
\\\\int\\\\!\\\\!x\\\\ dx=
\\\\frac{\\\\ d}{dx}(x^3)=
Slope field and function should always be a function of x and on their own line

solution_latex:
Start with a sentence overview of how problem should be solved. Then create a solution for correct answer with steps separated by double line breaks (4 backslashes)


choices: Every choice MUST be wrapped in $...$ (e.g. $12x^3 - 10x^2 + 7$). Never use raw caret/underscore outside $...$; they will not render. Do not wrap in \\\\text{}. correct_index must be the only choice consistent with the stem and solution_latex; other choices close but incorrect.

latex_content math rule: Every math expression inside prose MUST be wrapped in $...$ (inline) or $$...$$ (display). Never write bare LaTeX like x^2 or \\\\frac outside delimiters — it will render as plain text.

Leave correct_index as is`;

/** Bold label for "Create a problem on the topic …" — prefers short topic name. */
function mcqTopicBoldLine(
  emphasisTopicId: string | null,
  emphasisTopicName: string | undefined,
  emphasisTopicSkillDescription: string | undefined
): string {
  const name = (emphasisTopicName ?? "").trim();
  if (name) return `**${name}**`;
  const skill = (emphasisTopicSkillDescription ?? "").trim();
  if (skill) return `**${skill}**`;
  if (emphasisTopicId) return `**${emphasisTopicId}**`;
  return "**(topic)**";
}

/** Explicit topic id, name, and skill description for the OpenAI user message. */
function mcqChosenTopicApiBlock(
  emphasisTopicId: string | null,
  catalogName: string | undefined,
  catalogSkillDescription: string | undefined
): string {
  if (!emphasisTopicId) {
    return `Chosen topic for this request:
- topic_id: (unspecified)
- topic_name: (unspecified)
- topic_description: (unspecified)`;
  }
  const name = (catalogName ?? "").trim() || "(none)";
  const desc = (catalogSkillDescription ?? "").trim() || "(none)";
  return `Chosen topic for this request:
- topic_id: ${emphasisTopicId}
- topic_name: ${name}
- topic_description: ${desc}`;
}

// =============================================================================
// MCQ USER PROMPT BUILDER
// =============================================================================

export function buildApCalcMCQUserPrompt(args: {
  mode: "create" | "refine";
  /** Phrase after "that is **…**" (no numeric label). */
  difficultyPhrase: string;
  difficultyLevel: number;
  schemaExampleBlock: string;
  emphasisTopicId: string | null;
  /** Short topic title (from catalog `name`); used for bold line and API topic_name. */
  emphasisTopicName?: string;
  /** Skill line (from catalog `description`); API topic_description and refine fallback. */
  emphasisTopicSkillDescription?: string;
  previousProblemJson?: string;
  feedback?: string;
}): string {
  const topicLine = mcqTopicBoldLine(
    args.emphasisTopicId,
    args.emphasisTopicName,
    args.emphasisTopicSkillDescription
  );
  const topicApiBlock = mcqChosenTopicApiBlock(
    args.emphasisTopicId,
    args.emphasisTopicName,
    args.emphasisTopicSkillDescription
  );
  const difficultyRefLine = getMcqDifficultyReferenceLine(args.difficultyLevel);

  if (args.mode === "refine") {
    const topicRef =
      (args.emphasisTopicName ?? "").trim() ||
      (args.emphasisTopicSkillDescription ?? "").trim() ||
      args.emphasisTopicId ||
      "the emphasis topic for this problem";

    return `${difficultyRefLine}

${topicApiBlock}

Prompt:
"Refine the multiple-choice problem using the feedback. The problem is on topic **${topicRef}** at difficulty level **${args.difficultyLevel}** (${args.difficultyPhrase}); keep these unless the feedback explicitly asks to change them.

Previous JSON:
${args.previousProblemJson ?? "{}"}

Feedback:
${args.feedback ?? ""}


${MCQ_FORMAT_FOR_ALL_PARTS}

${MCQ_API_OUTPUT_NOTE}"`;
  }

  return `${difficultyRefLine}

${topicApiBlock}

Prompt:
"You are taking the role of a create AP Calculus AB question creator who creates problems that effectively prepare students for the AP Exam.

Create a problem on the topic ${topicLine} that is **${args.difficultyPhrase}**

Generate a copyable JSON file in a code block with no other text in this format only:

${args.schemaExampleBlock}


${MCQ_FORMAT_FOR_ALL_PARTS}

${MCQ_API_OUTPUT_NOTE}"`;
}

// =============================================================================
// FRQ USER PROMPT BUILDER
// =============================================================================

export function buildApCalcFRQUserPrompt(args: {
  mode: "create" | "refine";
  difficultyNarrative: string;
  topicLines: string;
  singleTopicId: string | null;
  schemaExampleBlock: string;
  /** Always false for this product — still passed for prompt clarity. */
  calculatorAllowed: boolean;
  frqType: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  /** Create: archetype instruction paragraph. */
  archetypeInstruction?: string;
  archetypeLabel?: string;
  previousProblemJson?: string;
  feedback?: string;
}): string {
  const calcNote =
    "Calculator: NOT ALLOWED for any part. Exact answers only; all numbers and integrals must be hand-computable.";

  const typeNote = `Required problem type: TYPE ${args.frqType} (see TYPE SUMMARY in system prompt for part/point structure).`;

  const archetypeBlock =
    args.mode === "create" && args.archetypeInstruction
      ? `Archetype focus (${args.archetypeLabel ?? "selected"}):\n${args.archetypeInstruction}\n\n`
      : "";

  const createLead =
    args.mode === "create"
      ? `You are taking the role of an AP Calculus AB question creator to prepare students for the AP Exam.

${archetypeBlock}Create one FRQ that forces **units** when appropriate for rates and interpretations. Include 3–4 parts labeled (a), (b), (c), and (d) when using four-part types; TYPE G uses (a)–(c) only.

Challenge students creatively: require solid conceptual use of course content, careful computation, and depth where appropriate.

Solution: full worked solution for all parts with clear steps.

Rubric: exactly 9 points (P1–P9): earlier points for correct application of concepts and justification; later points for correct computation and units where relevant.

`
      : "";

  const topicBlock = buildTopicBlock({
    topicLines: args.topicLines,
    singleTopicId: args.singleTopicId,
  });

  const core = `${createLead}Task: ${args.mode === "create" ? "Generate" : "Refine"} one AP Calculus AB free-response problem (JSON).\n\n${args.difficultyNarrative}\n\n${calcNote}\n${typeNote}\n\n${topicBlock}\n\nExample JSON shape:\n${args.schemaExampleBlock}`;

  if (args.mode === "refine") {
    return `${core}\n\nRefinement — update the previous JSON from the feedback. Keep the same FRQ TYPE ${args.frqType} and no-calculator rule.\n\nPrevious JSON:\n${args.previousProblemJson ?? "{}"}\n\nFeedback:\n${args.feedback ?? ""}`;
  }
  return core;
}

// =============================================================================
// ASSESSMENT SYSTEM PROMPT + USER PROMPT BUILDER
// =============================================================================

export const AP_CALC_ASSESS_SYSTEM = `
You are a strict AP Calculus AB problem assessor.

Given a problem stem, worked solution, and a topic pool, you must return exactly two things:

1. difficulty — an integer from 1 to 5.
   1: Single-step recall or direct formula application; no traps.
   2: Two or three mechanical steps; straightforward procedure.
   3: Standard AP exam level; moderate chaining of concepts.
   4: Challenging; requires insight, careful setup, or chaining three or more concepts.
   5: Very hard; non-obvious reasoning, dense multi-step, or atypical application.

2. topic_weights — a sparse map of topic ids to non-negative weights that sum to 1.
   Include a topic ONLY if its core skill (listed in parentheses in the pool) is explicitly and actively exercised when solving the problem. Background knowledge or context does not count.

Return exactly one valid JSON object: { "difficulty": <integer 1–5>, "topic_weights": { "<id>": <weight>, ... } }. No other text. No markdown.
`.trim();

export function buildAssessUserPrompt(args: {
  type: "multiple_choice" | "free_response";
  latexContent: string;
  solutionLatex: string;
  choices?: string[];
  rubric?: string;
  topicLines: string;
}): string {
  const choicesBlock =
    args.type === "multiple_choice" && Array.isArray(args.choices) && args.choices.length > 0
      ? `\n\nAnswer choices:\n${args.choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join("\n")}`
      : "";
  const rubricBlock = args.rubric ? `\n\nRubric:\n${args.rubric}` : "";
  return `Topic pool:\n${args.topicLines}\n\nProblem stem:\n${args.latexContent}${choicesBlock}\n\nWorked solution:\n${args.solutionLatex}${rubricBlock}\n\nAssign difficulty and topic_weights. Return the JSON.`;
}

// =============================================================================
// UNIFIED BUILDER (tests / callers that still branch on format)
// =============================================================================

export function buildApCalcUserPrompt(args: {
  mode: "create" | "refine";
  format: GenerationFormat;
  difficultyNarrative: string;
  topicLines: string;
  singleTopicId: string | null;
  schemaExampleBlock: string;
  calculatorAllowed?: boolean;
  frqType?: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  emphasisTopicId?: string;
  emphasisTopicName?: string;
  emphasisTopicSkillDescription?: string;
  archetypeInstruction?: string;
  archetypeLabel?: string;
  previousProblemJson?: string;
  feedback?: string;
  /** MCQ: 1–5; defaults to 3 */
  difficultyLevel?: number;
  /** MCQ: phrase after "that is **…**"; defaults to difficultyNarrative */
  mcqDifficultyPhrase?: string;
}): string {
  if (args.format === "multiple_choice") {
    return buildApCalcMCQUserPrompt({
      mode: args.mode,
      difficultyPhrase: args.mcqDifficultyPhrase ?? args.difficultyNarrative,
      difficultyLevel: args.difficultyLevel ?? 3,
      schemaExampleBlock: args.schemaExampleBlock,
      emphasisTopicId: args.emphasisTopicId ?? args.singleTopicId ?? null,
      emphasisTopicName: args.emphasisTopicName,
      emphasisTopicSkillDescription: args.emphasisTopicSkillDescription,
      previousProblemJson: args.previousProblemJson,
      feedback: args.feedback,
    });
  }
  return buildApCalcFRQUserPrompt({
    mode: args.mode,
    difficultyNarrative: args.difficultyNarrative,
    topicLines: args.topicLines,
    singleTopicId: args.singleTopicId,
    schemaExampleBlock: args.schemaExampleBlock,
    calculatorAllowed: args.calculatorAllowed ?? false,
    frqType: args.frqType ?? "D",
    archetypeInstruction: args.archetypeInstruction,
    archetypeLabel: args.archetypeLabel,
    previousProblemJson: args.previousProblemJson,
    feedback: args.feedback,
  });
}
