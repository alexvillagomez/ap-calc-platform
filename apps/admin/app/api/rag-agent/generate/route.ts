import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  buildApCalcMCQUserPrompt,
  buildCreateSystemPrompt,
  buildRefineSystemPrompt,
  buildRagAgentMCQUserPrompt,
  getRagVarietyHint,
  AP_CALC_ASSESS_SYSTEM,
  buildAssessUserPrompt,
  buildRefinementFeedbackFromAssessment,
} from "@/lib/ai/prompts";
import { getMcqDifficultyPhrase } from "@/lib/ai/examPrepConstants";
import { checkKatexErrors, correctFunctionGraphHoles } from "@/lib/katexUtils";
import { autoTagKeywords } from "@/lib/ai/keywordTagger";
import { normalizeRichMathSource } from "@/lib/latexRichMathNormalize";

export const runtime = "nodejs";
export const maxDuration = 600;

const GENERATION_MODEL = "gpt-5.4-mini";
const RAG_SYSTEM_SUFFIX =
  "\n\nIMPORTANT: This is a gold-star RAG seed example. AP Exam authenticity, LaTeX correctness, and zero rendering issues take priority above all else.";

type ProblemTypeInput = { name: string; description: string };

function buildMcqSchemaJson(correctIndex: number): string {
  const ci = Math.min(3, Math.max(0, Math.floor(correctIndex)));
  return `{
  "latex_content": "",
  "solution_latex": "",
  "choices": [
    "A choice",
    "B choice",
    "C choice",
    "D choice"
  ],
  "correct_index": ${ci}
}
PLACEMENT RULE: choices[${ci}] must be the correct answer — this is a hard requirement. Arrange all four choices so the correct answer sits at exactly that 0-based position. Do NOT default to putting the correct answer first.`;
}

function sanitizeLatexContent(str: string): string {
  let out = normalizeRichMathSource(str);
  out = out.replace(/\\n(?![a-zA-Z])/g, "\n");
  out = out.replace(/\\newline\b/g, "\\\\");
  out = out.replace(/^\s*\\\[\s*[0-9.]+\s*em\s*\]\s*$/gm, "");
  out = out.replace(/^\s*\\\\\[\s*[0-9.]+\s*em\s*\]\s*$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/(\\\\)\s*\n\s*\\\[\s*([0-9.]+\s*em)\s*\]/g, "$1[$2]");
  out = out.replace(/\\\[\s*([0-9.]+\s*em)\s*\]/g, "\\\\[$1]");
  out = out.replace(/\bfunction\s+HH\b/gi, "function H");
  out = out.replace(/\bat which HH\b/gi, "at which H");
  const placeholders: string[] = [];
  out = out.replace(/<(SlopeField|FunctionGraph)\s+[^>]*\/>/gi, (m) => {
    const idx = placeholders.push(m) - 1;
    return `@@VISUAL_${idx}@@`;
  });
  out = out.replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  out = out.replace(/<\s*iframe\b[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, "");
  out = out.replace(/@@VISUAL_(\d+)@@/g, (_m, n) => placeholders[Number(n)] ?? "");
  return out;
}

function parseGeneratedJson(content: string): {
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
} | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const latex_content = typeof raw.latex_content === "string" ? raw.latex_content : null;
  const solution_latex = typeof raw.solution_latex === "string" ? raw.solution_latex : null;
  const choices = Array.isArray(raw.choices) && raw.choices.length === 4 ? (raw.choices as string[]) : null;
  const correct_index = typeof raw.correct_index === "number" ? Math.min(3, Math.max(0, raw.correct_index)) : 0;
  if (!latex_content || !solution_latex || !choices) return null;
  return { latex_content, solution_latex, choices, correct_index };
}

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), { status: 500 });
  }
  if (!openaiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), { status: 500 });
  }

  let body: { problemTypes?: ProblemTypeInput[]; countPerType?: number };
  try {
    body = await request.json() as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const problemTypes = body.problemTypes ?? [];
  const countPerType = Math.min(10, Math.max(1, Math.round(body.countPerType ?? 5)));

  if (problemTypes.length === 0) {
    return new Response(JSON.stringify({ error: "No problem types provided" }), { status: 400 });
  }

  const baseDifficulties = [1, 2, 3, 4, 5];
  const difficulties = baseDifficulties.slice(0, countPerType);

  type Task = { pt: ProblemTypeInput; iteration: number; targetDifficulty: number };
  const allTasks: Task[] = problemTypes.flatMap((pt) =>
    difficulties.map((d, i) => ({ pt, iteration: i, targetDifficulty: d }))
  );
  const total = allTasks.length;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const openai = new OpenAI({ apiKey: openaiKey });
      let inserted = 0;
      let taskIndex = 0;

      function send(payload: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }

      async function generateOneProblem(task: Task): Promise<void> {
        const { pt, iteration, targetDifficulty } = task;
        const index = ++taskIndex;
        const correctIndex = Math.floor(Math.random() * 4);
        const schemaBlock = buildMcqSchemaJson(correctIndex);
        const varietyHint = getRagVarietyHint(iteration);
        const difficultyPhrase = getMcqDifficultyPhrase(targetDifficulty);

        const genCompletion = await openai.chat.completions.create({
          model: GENERATION_MODEL,
          messages: [
            { role: "system", content: buildCreateSystemPrompt("multiple_choice") + RAG_SYSTEM_SUFFIX },
            {
              role: "user",
              content: buildRagAgentMCQUserPrompt({
                problemTypeName: pt.name,
                problemTypeDescription: pt.description,
                difficulty: targetDifficulty,
                schemaBlock,
                varietyHint,
              }),
            },
          ],
          response_format: { type: "json_object" },
          temperature: 1.05,
        });

        let parsed = parseGeneratedJson(genCompletion.choices[0]?.message?.content ?? "");
        if (!parsed) {
          send({ type: "progress", problemType: pt.name, index, total, status: "failed", reason: "invalid_generation_json" });
          return;
        }

        parsed.latex_content = sanitizeLatexContent(parsed.latex_content);
        parsed.solution_latex = sanitizeLatexContent(parsed.solution_latex);

        const katexErrors = [
          ...checkKatexErrors(parsed.latex_content),
          ...checkKatexErrors(parsed.solution_latex),
        ];

        const assessCompletion = await openai.chat.completions.create({
          model: GENERATION_MODEL,
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
            ? Math.min(5, Math.max(1, Math.round(assessment.difficulty))) : targetDifficulty;

        const rendering_issues =
          typeof assessment.rendering_issues === "string" && assessment.rendering_issues.trim() &&
          assessment.rendering_issues.trim().toLowerCase() !== "null"
            ? assessment.rendering_issues.trim() : null;
        const content_issues =
          typeof assessment.content_issues === "string" && assessment.content_issues.trim() &&
          assessment.content_issues.trim().toLowerCase() !== "null"
            ? assessment.content_issues.trim() : null;

        if (rendering_issues || content_issues) {
          const refinementFeedback = buildRefinementFeedbackFromAssessment({ content_issues, rendering_issues });
          if (refinementFeedback) {
            const refineCompletion = await openai.chat.completions.create({
              model: GENERATION_MODEL,
              messages: [
                { role: "system", content: buildRefineSystemPrompt("multiple_choice") + RAG_SYSTEM_SUFFIX },
                {
                  role: "user",
                  content: buildApCalcMCQUserPrompt({
                    mode: "refine",
                    difficultyPhrase,
                    difficultyLevel: targetDifficulty,
                    schemaExampleBlock: schemaBlock,
                    emphasisTopicId: null,
                    emphasisTopicName: pt.name,
                    emphasisTopicSkillDescription: pt.description,
                    previousProblemJson: JSON.stringify(parsed),
                    feedback: refinementFeedback,
                  }),
                },
              ],
              response_format: { type: "json_object" },
            });
            const refined = parseGeneratedJson(refineCompletion.choices[0]?.message?.content ?? "");
            if (refined) {
              refined.latex_content = sanitizeLatexContent(refined.latex_content);
              refined.solution_latex = sanitizeLatexContent(refined.solution_latex);
              parsed = refined;
            }
          }
        }

        parsed.latex_content = correctFunctionGraphHoles(parsed.latex_content);

        const { data: insertedRow, error: insertError } = await supabase
          .from("rag_examples")
          .insert({
            keyword_weights: {},
            latex_content: parsed.latex_content,
            solution_latex: parsed.solution_latex,
            choices: parsed.choices,
            correct_index: parsed.correct_index,
            difficulty: assessedDifficulty,
            notes: `RAG Agent — ${pt.name} (D${targetDifficulty})`,
          })
          .select("id")
          .single();

        if (insertError || !insertedRow) {
          send({ type: "progress", problemType: pt.name, index, total, status: "failed", reason: insertError?.message ?? "insert_failed" });
          return;
        }

        const ragId = (insertedRow as { id: string }).id;
        autoTagKeywords(openai, parsed.latex_content, parsed.solution_latex)
          .then((keyword_weights) => {
            if (Object.keys(keyword_weights).length > 0) {
              return supabase.from("rag_examples").update({ keyword_weights }).eq("id", ragId);
            }
          })
          .catch((err: unknown) => console.error("rag-agent: keyword tagging failed", err));

        inserted++;
        send({ type: "progress", problemType: pt.name, index, total, status: "ok", ragId, difficulty: assessedDifficulty, targetDifficulty });
      }

      const BATCH = 5;
      for (let i = 0; i < allTasks.length; i += BATCH) {
        const batch = allTasks.slice(i, i + BATCH);
        await Promise.all(
          batch.map((task) =>
            generateOneProblem(task).catch((err: unknown) => {
              taskIndex++;
              send({ type: "progress", problemType: task.pt.name, index: taskIndex, total, status: "failed", reason: err instanceof Error ? err.message : String(err) });
            })
          )
        );
      }

      send({ type: "complete", inserted, total });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
