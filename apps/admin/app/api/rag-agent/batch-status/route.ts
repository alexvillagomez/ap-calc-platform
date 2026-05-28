import { NextResponse } from "next/server";
import OpenAI from "openai";
import { sanitizeLatexContent, parseGeneratedJson, stripProblemTrailingPeriod } from "@/lib/ragProblemParser";
import { correctFunctionGraphHoles } from "@/lib/katexUtils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

  const url = new URL(request.url);
  const batchId = url.searchParams.get("batchId");
  if (!batchId) return NextResponse.json({ error: "batchId required" }, { status: 400 });

  const openai = new OpenAI({ apiKey: openaiKey });

  const batch = await openai.batches.retrieve(batchId);

  const completedCount = batch.request_counts?.completed ?? 0;
  const totalCount = batch.request_counts?.total ?? 0;

  if (batch.status !== "completed") {
    return NextResponse.json({
      status: batch.status,
      completedCount,
      totalCount,
    });
  }

  // Batch is done — download and parse all results
  if (!batch.output_file_id) {
    return NextResponse.json({ status: "completed", completedCount, totalCount, problems: [] });
  }

  const fileContent = await openai.files.content(batch.output_file_id);
  const text = await fileContent.text();
  const resultLines = text.split("\n").filter(Boolean);

  const problems: Array<{
    customId: string;
    taskIndex: number;
    latex_content: string;
    solution_latex: string;
    choices: string[];
    correct_index: number;
    assessedDifficulty: number;
    targetDifficulty: number;
    problem_description?: string;
    wrong_answer_descriptions?: string[];
  }> = [];

  for (const line of resultLines) {
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const customId = typeof result.custom_id === "string" ? result.custom_id : "";
    const taskIndex = parseInt(customId.replace("task-", ""), 10);
    if (isNaN(taskIndex)) continue;

    // Extract content from the batch response format
    const response = result.response as Record<string, unknown> | undefined;
    if (!response || (response.status_code as number) !== 200) continue;

    const responseBody = response.body as Record<string, unknown> | undefined;
    const choices = responseBody?.choices as Array<{ message: { content: string } }> | undefined;
    const content = choices?.[0]?.message?.content;
    if (!content) continue;

    const parsed = parseGeneratedJson(content);
    if (!parsed) continue;

    parsed.latex_content = stripProblemTrailingPeriod(sanitizeLatexContent(parsed.latex_content));
    parsed.solution_latex = sanitizeLatexContent(parsed.solution_latex);
    parsed.latex_content = correctFunctionGraphHoles(parsed.latex_content);

    problems.push({
      customId,
      taskIndex,
      latex_content: parsed.latex_content,
      solution_latex: parsed.solution_latex,
      choices: parsed.choices,
      correct_index: parsed.correct_index,
      assessedDifficulty: parsed.model_difficulty ?? 3,
      targetDifficulty: parsed.model_difficulty ?? 3,
      problem_description: parsed.problem_description,
      wrong_answer_descriptions: parsed.wrong_answer_descriptions,
    });
  }

  // Sort by task index to preserve generation order
  problems.sort((a, b) => a.taskIndex - b.taskIndex);

  return NextResponse.json({ status: "completed", completedCount, totalCount, problems });
}
