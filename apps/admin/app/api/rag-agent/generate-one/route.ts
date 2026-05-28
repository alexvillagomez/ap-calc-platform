import { NextResponse } from "next/server";
import { createGenClient, GEN_MODEL } from "@/lib/ai/genClient";
import {
  buildApCalcMCQUserPrompt,
  buildCreateSystemPrompt,
  buildRefineSystemPrompt,
  buildRagAgentMCQUserPrompt,
  getRagVarietyHint,
  getPrecalcVarietyHint,
  AP_CALC_ASSESS_SYSTEM,
  buildAssessUserPrompt,
  buildRefinementFeedbackFromAssessment,
} from "@/lib/ai/prompts";
import {
  PROBLEM_PLANNER_SYSTEM,
  LATEX_FORMATTER_SYSTEM,
  MISCONCEPTION_GENERATOR_SYSTEM,
  WRONG_ANSWER_SYSTEM,
  buildProblemPlannerPrompt,
  buildMisconceptionGeneratorPrompt,
  buildWrongAnswerPrompt,
  buildLatexFormatterUserPrompt,
  validatePool,
  selectFromPool,
  type ProblemPlan,
  type MisconceptionEntry,
  type DistractorPool,
} from "@/lib/ai/precalcMultiPass";
import { getMcqDifficultyPhrase } from "@/lib/ai/examPrepConstants";
import { checkKatexErrors, correctFunctionGraphHoles } from "@/lib/katexUtils";
import { buildMcqSchemaJson, sanitizeLatexContent, parseGeneratedJson, stripProblemTrailingPeriod } from "@/lib/ragProblemParser";

export const runtime = "nodejs";
export const maxDuration = 90;

// Per-type expression history for batch diversity tracking (resets on server restart)
const recentExpressionsByType = new Map<string, string[]>();

// Per-type distractor usage counts for batch diversity (resets on server restart)
const distractorUsageByType = new Map<string, Map<string, number>>();

const GPT_MODEL = GEN_MODEL;
const RAG_SYSTEM_SUFFIX =
  "\n\nIMPORTANT: This is a gold-star RAG seed example. AP Exam authenticity, LaTeX correctness, and zero rendering issues take priority above all else.";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handlePost(request);
  } catch (err) {
    console.error("generate-one unhandled error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePost(request: Request): Promise<Response> {
  const body = await request.json() as {
    problemTypeName: string;
    problemTypeDescription: string;
    targetDifficulty?: number;
    iteration: number;
    previousProblemJson?: string;
    feedback?: string;
    course?: "ap_calc" | "precalc";
    trackDiversity?: boolean;
  };
  const course = body.course === "precalc" ? "precalc" : "ap_calc";

  const { problemTypeName, problemTypeDescription, targetDifficulty, iteration } = body;
  const isRefine = Boolean(body.previousProblemJson && body.feedback?.trim());

  const openai = createGenClient();
  const genClient = openai;
  const genModel = GPT_MODEL;
  const correctIndex = Math.floor(Math.random() * 4);
  const schemaBlock = buildMcqSchemaJson(correctIndex);
  const varietyHint = course === "precalc" ? getPrecalcVarietyHint(iteration) : getRagVarietyHint(iteration);
  // targetDifficulty is optional — if absent, the model chooses based on the difficulty scale in the schema
  const difficultyPhrase = targetDifficulty != null ? getMcqDifficultyPhrase(targetDifficulty) : "the difficulty that best fits this problem type (choose from the scale in the schema)";

  // --- Generate or Refine ---
  let genContent: string;
  let mathPlanResult: unknown = null;

  if (isRefine) {
    const refineCompletion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: "system", content: buildRefineSystemPrompt("multiple_choice") + RAG_SYSTEM_SUFFIX },
        {
          role: "user",
          content: buildApCalcMCQUserPrompt({
            mode: "refine",
            difficultyPhrase,
            difficultyLevel: targetDifficulty ?? 3,
            schemaExampleBlock: schemaBlock,
            emphasisTopicId: null,
            emphasisTopicName: problemTypeName,
            emphasisTopicSkillDescription: problemTypeDescription,
            previousProblemJson: body.previousProblemJson,
            feedback: body.feedback,
          }),
        },
      ],
      response_format: { type: "json_object" },
    });
    genContent = refineCompletion.choices[0]?.message?.content ?? "";
  } else if (course === "precalc") {
    // ── Precalc: new three-pass generation ──────────────────────────────────────
    const recentExprs = body.trackDiversity
      ? (recentExpressionsByType.get(problemTypeName) ?? [])
      : [];

    // Pass 1: Problem Planner — problem + correct answer only, no distractors
    const pass1Completion = await genClient.chat.completions.create({
      model: genModel,
      messages: [
        { role: "system", content: PROBLEM_PLANNER_SYSTEM },
        {
          role: "user",
          content: buildProblemPlannerPrompt({
            problemTypeName,
            problemTypeDescription,
            varietyHint,
            targetDifficulty: targetDifficulty ?? 3,
            previousExpressions: recentExprs,
          }),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.9,
    });

    let problemPlan: ProblemPlan;
    try {
      problemPlan = JSON.parse(pass1Completion.choices[0]?.message?.content ?? "{}") as ProblemPlan;
      if (!problemPlan.expression_plain || !problemPlan.correct_answer_plain) {
        return NextResponse.json({ error: "Problem planner returned incomplete plan" }, { status: 500 });
      }
    } catch {
      return NextResponse.json({ error: "Problem planner returned invalid JSON" }, { status: 500 });
    }

    // Track expression diversity
    if (body.trackDiversity && problemPlan.expression_plain) {
      recentExpressionsByType.set(
        problemTypeName,
        [...recentExprs, problemPlan.expression_plain].slice(-4)
      );
    }

    // Pass 2: Misconception Generator — 6 misconception descriptions
    const pass2Completion = await genClient.chat.completions.create({
      model: genModel,
      messages: [
        { role: "system", content: MISCONCEPTION_GENERATOR_SYSTEM },
        {
          role: "user",
          content: buildMisconceptionGeneratorPrompt({
            expression: problemPlan.expression_plain,
            correctAnswer: problemPlan.correct_answer_plain,
            problemTypeName,
          }),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    let misconceptions: string[] = [];
    try {
      const pass2Raw = JSON.parse(pass2Completion.choices[0]?.message?.content ?? "{}") as { misconceptions?: string[] };
      misconceptions = Array.isArray(pass2Raw.misconceptions) ? pass2Raw.misconceptions.slice(0, 6) : [];
    } catch {
      misconceptions = [];
    }
    if (misconceptions.length < 3) {
      return NextResponse.json({ error: "Misconception generator returned too few misconceptions" }, { status: 500 });
    }

    // Pass 2b: Wrong Answer Deriver — one parallel call per misconception
    const wrongAnswerPromises = misconceptions.map((m, i) =>
      genClient.chat.completions.create({
        model: genModel,
        messages: [
          { role: "system", content: WRONG_ANSWER_SYSTEM },
          {
            role: "user",
            content: buildWrongAnswerPrompt({
              expression: problemPlan.expression_plain,
              correctAnswer: problemPlan.correct_answer_plain,
              misconception: m,
            }),
          },
        ],
        temperature: 0.2,
        max_tokens: 60,
      }).then((c) => ({
        id: `m${i}`,
        misconception: m,
        wrong_answer_plain: (c.choices[0]?.message?.content ?? "").trim(),
      } as MisconceptionEntry))
    );

    const rawPool: DistractorPool = await Promise.all(wrongAnswerPromises);

    // Validate pool: strip entries that equal the correct answer or duplicate each other
    const validPool = validatePool(rawPool, problemPlan.correct_answer_plain);
    if (validPool.length < 3) {
      return NextResponse.json({ error: "Could not generate enough distinct distractors" }, { status: 500 });
    }

    // Usage-weighted selection of 3 from the pool
    const typeUsage = distractorUsageByType.get(problemTypeName) ?? new Map<string, number>();
    const selected = selectFromPool(validPool, typeUsage, 3);

    // Update usage counts
    for (const entry of selected) {
      typeUsage.set(entry.id, (typeUsage.get(entry.id) ?? 0) + 1);
    }
    distractorUsageByType.set(problemTypeName, typeUsage);

    // Pass 3: LaTeX Formatter — formats locked values into MCQ JSON
    const pass3Completion = await genClient.chat.completions.create({
      model: genModel,
      messages: [
        { role: "system", content: LATEX_FORMATTER_SYSTEM },
        {
          role: "user",
          content: buildLatexFormatterUserPrompt({
            problemTypeName,
            plan: problemPlan,
            selectedDistractors: selected,
            correctIndex,
            schemaBlock,
          }),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    genContent = pass3Completion.choices[0]?.message?.content ?? "";

    // Store plan and full distractor pool for post-processing overrides
    mathPlanResult = {
      problem_description: problemPlan.problem_description,
      expression_plain: problemPlan.expression_plain,
      correct_answer_plain: problemPlan.correct_answer_plain,
      correct_working: problemPlan.correct_working,
      selected_distractors: selected,
      full_pool: validPool,
    } as unknown as typeof mathPlanResult;
  } else {
    const userPrompt = buildRagAgentMCQUserPrompt({ problemTypeName, problemTypeDescription, difficulty: targetDifficulty ?? 3, schemaBlock, varietyHint });
    const systemPrompt = buildCreateSystemPrompt("multiple_choice") + RAG_SYSTEM_SUFFIX;

    const createCompletion = await genClient.chat.completions.create({
      model: genModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 1.0,
    });
    genContent = createCompletion.choices[0]?.message?.content ?? "";
  }

  let parsed = parseGeneratedJson(genContent);
  if (!parsed) {
    return NextResponse.json({ error: "Model returned invalid JSON" }, { status: 500 });
  }

  parsed.latex_content = stripProblemTrailingPeriod(sanitizeLatexContent(parsed.latex_content));
  parsed.solution_latex = sanitizeLatexContent(parsed.solution_latex);
  parsed.choices = parsed.choices.map((c) => sanitizeLatexContent(c));

  // For precalc: override plain-English fields from the plan + selected distractors
  if (mathPlanResult) {
    const plan = mathPlanResult as unknown as {
      problem_description: string;
      expression_plain: string;
      correct_answer_plain: string;
      correct_working: string[];
      selected_distractors: MisconceptionEntry[];
      full_pool: DistractorPool;
    };

    // Strip any accidental LaTeX from the plain-English description
    parsed.problem_description = plan.problem_description
      .replace(/^\\text\{([\s\S]*)\}\s*$/, "$1")
      .replace(/\\text\{([^}]*)\}/g, "$1")
      .trim();

    // Build wrong_answer_descriptions from selected distractor misconceptions.
    // Slot at correctIndex is null; wrong slots get the misconception description.
    const wrongSlotDistractors: (MisconceptionEntry | null)[] = [];
    let dIdx = 0;
    for (let i = 0; i < 4; i++) {
      if (i === correctIndex) { wrongSlotDistractors.push(null); }
      else { wrongSlotDistractors.push(plan.selected_distractors[dIdx++] ?? null); }
    }
    parsed.wrong_answer_descriptions = wrongSlotDistractors.map((d) =>
      d === null ? "null" : (d.misconception?.trim() || "Incorrect application of the rule.")
    );

    // Build distractor_thinking from selected distractors
    const wrongSlotIndices = [0, 1, 2, 3].filter((i) => i !== correctIndex);
    parsed.distractor_thinking = plan.selected_distractors.slice(0, 3).map((d, i) => {
      const slot = wrongSlotIndices[i] ?? i;
      return `Wrong slot ${slot}:\nMisconception: ${d.misconception}\nWrong answer: ${d.wrong_answer_plain}`;
    }).join("\n\n");
  }

  // --- Duplicate-choice fix (up to 1 retry) ---
  const hasDuplicateChoices = (choices: string[], correctIdx: number): boolean => {
    const correct = choices[correctIdx]?.trim() ?? "";
    for (let i = 0; i < choices.length; i++) {
      if (i === correctIdx) continue;
      if ((choices[i]?.trim() ?? "") === correct) return true;
      for (let j = i + 1; j < choices.length; j++) {
        if (j === correctIdx) continue;
        if ((choices[i]?.trim() ?? "") === (choices[j]?.trim() ?? "")) return true;
      }
    }
    return false;
  };

  if (hasDuplicateChoices(parsed.choices, parsed.correct_index)) {
    const fixCompletion = await genClient.chat.completions.create({
      model: genModel,
      messages: [
        {
          role: "system",
          content: `You are fixing a math MCQ with duplicate or mathematically equivalent answer choices. Return JSON with a 'choices' array of exactly 4 strings. Rules: (1) All 4 choices must simplify to DIFFERENT values — fully simplify before checking (e.g. 3^{-2} and 1/9 are the SAME). (2) choices[${parsed.correct_index}] must stay unchanged as the correct answer. (3) Each wrong choice must come from a distinct student mistake. (4) SYMBOLIC BASE: if the problem uses a symbolic base (sin x, cos x, f(x), x), wrong answers must be in terms of that same symbolic base — NEVER substitute a number like 2 or 3 for the base when computing distractor values.`,
        },
        {
          role: "user",
          content: `Problem: ${parsed.latex_content}\n\nDistractor thinking: ${parsed.distractor_thinking ?? "(none)"}\n\nCurrent broken choices: ${JSON.stringify(parsed.choices)}\n\nCorrect answer (index ${parsed.correct_index}): ${parsed.choices[parsed.correct_index]}\n\nReplace duplicates/equivalent wrong choices. Each replacement must test a different mistake AND simplify to a different value than the correct answer and each other.`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
    });
    try {
      const fixRaw = JSON.parse(fixCompletion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
      const fixChoices = Array.isArray(fixRaw.choices) ? (fixRaw.choices as string[]) : null;
      if (fixChoices && fixChoices.length === 4 && !hasDuplicateChoices(fixChoices, parsed.correct_index)) {
        parsed.choices = fixChoices;
      }
    } catch { /* keep original */ }
  }

  // --- Assess ---
  const katexErrors = [
    ...checkKatexErrors(parsed.latex_content),
    ...checkKatexErrors(parsed.solution_latex),
  ];

  const assessCompletion = await openai.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: "system", content: AP_CALC_ASSESS_SYSTEM },
      {
        role: "user",
        content: buildAssessUserPrompt({
          type: "multiple_choice",
          latexContent: parsed.latex_content,
          solutionLatex: parsed.solution_latex,
          choices: parsed.choices,
          katexErrors: katexErrors.length > 0 ? katexErrors : undefined,
        }),
      },
    ],
    response_format: { type: "json_object" },
  });

  const assessContent = assessCompletion.choices[0]?.message?.content ?? "{}";
  let assessment: Record<string, unknown>;
  try { assessment = JSON.parse(assessContent) as Record<string, unknown>; }
  catch { assessment = {}; }

  const assessedDifficulty =
    typeof assessment.difficulty === "number" && Number.isFinite(assessment.difficulty)
      ? Math.min(5, Math.max(1, Math.round(assessment.difficulty)))
      : targetDifficulty;

  const rendering_issues =
    typeof assessment.rendering_issues === "string" &&
    assessment.rendering_issues.trim() &&
    assessment.rendering_issues.trim().toLowerCase() !== "null"
      ? assessment.rendering_issues.trim() : null;
  const content_issues =
    typeof assessment.content_issues === "string" &&
    assessment.content_issues.trim() &&
    assessment.content_issues.trim().toLowerCase() !== "null"
      ? assessment.content_issues.trim() : null;

  // Auto-refine once if assess found issues (only on fresh create, not on user-directed refine)
  if (!isRefine && (rendering_issues || content_issues)) {
    const autoFeedback = buildRefinementFeedbackFromAssessment({ content_issues, rendering_issues });
    if (autoFeedback) {
      const autoRefineCompletion = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [
          { role: "system", content: buildRefineSystemPrompt("multiple_choice") + RAG_SYSTEM_SUFFIX },
          {
            role: "user",
            content: buildApCalcMCQUserPrompt({
              mode: "refine",
              difficultyPhrase,
              difficultyLevel: targetDifficulty ?? 3,
              schemaExampleBlock: schemaBlock,
              emphasisTopicId: null,
              emphasisTopicName: problemTypeName,
              emphasisTopicSkillDescription: problemTypeDescription,
              previousProblemJson: JSON.stringify(parsed),
              feedback: autoFeedback,
            }),
          },
        ],
        response_format: { type: "json_object" },
      });
      const refined = parseGeneratedJson(autoRefineCompletion.choices[0]?.message?.content ?? "");
      if (refined) {
        refined.latex_content = stripProblemTrailingPeriod(sanitizeLatexContent(refined.latex_content));
        refined.solution_latex = sanitizeLatexContent(refined.solution_latex);
        // Preserve metadata from original if the refine model didn't regenerate them
        if (!refined.problem_description && parsed.problem_description)
          refined.problem_description = parsed.problem_description;
        if (!refined.wrong_answer_descriptions?.length && parsed.wrong_answer_descriptions?.length)
          refined.wrong_answer_descriptions = parsed.wrong_answer_descriptions;
        if (!refined.generation_thinking && parsed.generation_thinking)
          refined.generation_thinking = parsed.generation_thinking;
        if (!refined.distractor_thinking && parsed.distractor_thinking)
          refined.distractor_thinking = parsed.distractor_thinking;
        parsed = refined;
      }
    }
  }

  parsed.latex_content = correctFunctionGraphHoles(parsed.latex_content);

  // Use model's chosen difficulty as a tie-breaker hint when assessment is uncertain
  const finalDifficulty = assessedDifficulty ?? parsed.model_difficulty ?? targetDifficulty ?? 3;

  return NextResponse.json({
    latex_content: parsed.latex_content,
    solution_latex: parsed.solution_latex,
    choices: parsed.choices,
    correct_index: parsed.correct_index,
    assessedDifficulty: finalDifficulty,
    model_difficulty: parsed.model_difficulty,
    problem_description: parsed.problem_description,
    wrong_answer_descriptions: parsed.wrong_answer_descriptions,
    generation_thinking: parsed.generation_thinking,
    distractor_thinking: parsed.distractor_thinking,
    // Pass 1 plan (precalc only) — for inspection
    math_plan: mathPlanResult ?? undefined,
    distractor_pool: mathPlanResult ? (mathPlanResult as unknown as { full_pool: DistractorPool }).full_pool : undefined,
  });
}
