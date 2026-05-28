import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import {
  buildRagAgentMCQUserPrompt,
  buildPrecalcRagAgentMCQUserPrompt,
  buildCreateSystemPrompt,
  getRagVarietyHint,
} from "@/lib/ai/prompts";
import { buildMcqSchemaJson } from "@/lib/ragProblemParser";

export const runtime = "nodejs";
export const maxDuration = 60;

const GENERATION_MODEL = "gemini-3.5-flash";
const RAG_SYSTEM_SUFFIX =
  "\n\nIMPORTANT: This is a gold-star RAG seed example. AP Exam authenticity, LaTeX correctness, and zero rendering issues take priority above all else.";

type Task = { pt: { name: string; description: string }; iteration: number; targetDifficulty: number };

export async function POST(request: Request): Promise<Response> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

  const body = await request.json() as { tasks: Task[]; course: "ap_calc" | "precalc" };
  const { tasks, course } = body;

  if (!tasks?.length) return NextResponse.json({ error: "No tasks provided" }, { status: 400 });

  const openai = new OpenAI({ apiKey: openaiKey });

  // Build one JSONL line per task
  const lines: string[] = tasks.map((task, i) => {
    const correctIndex = Math.floor(Math.random() * 4);
    const schemaBlock = buildMcqSchemaJson(correctIndex);
    const varietyHint = getRagVarietyHint(task.iteration);

    const userPrompt =
      course === "precalc"
        ? buildPrecalcRagAgentMCQUserPrompt({
            problemTypeName: task.pt.name,
            problemTypeDescription: task.pt.description,
            varietyHint,
            schemaBlock,
          })
        : buildRagAgentMCQUserPrompt({
            problemTypeName: task.pt.name,
            problemTypeDescription: task.pt.description,
            difficulty: task.targetDifficulty,
            schemaBlock,
            varietyHint,
          });

    const systemPrompt =
      course === "precalc"
        ? "You are a precalculus problem author. Return exactly one valid JSON object — no markdown, no prose outside JSON. In every JSON string value, every LaTeX backslash must be doubled (\\\\text{} not \\text{}, \\\\\\\\ not \\\\ for line breaks). Never write plain text paragraphs in solution_latex — always use \\\\text{} for narrative and \\\\\\\\ for line breaks."
        : buildCreateSystemPrompt("multiple_choice") + RAG_SYSTEM_SUFFIX;

    return JSON.stringify({
      custom_id: `task-${i}`,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: GENERATION_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 1.05,
      },
    });
  });

  const jsonl = lines.join("\n");

  // Upload the JSONL file to OpenAI Files
  const uploadedFile = await openai.files.create({
    file: await toFile(Buffer.from(jsonl, "utf-8"), "batch.jsonl", { type: "application/jsonl" }),
    purpose: "batch",
  });

  // Submit the batch job
  const batch = await openai.batches.create({
    input_file_id: uploadedFile.id,
    endpoint: "/v1/chat/completions",
    completion_window: "24h",
  });

  return NextResponse.json({ batchId: batch.id, taskCount: tasks.length });
}
