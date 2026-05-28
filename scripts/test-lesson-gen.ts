/**
 * Generate a lesson for a keyword and print raw output WITHOUT saving to DB.
 * Usage:
 *   npx tsx scripts/test-lesson-gen.ts <keyword_id> [--save]
 *
 * --save  Write the result to learn_lessons in Supabase.
 * --delete-first  Delete existing lesson before saving (forces fresh).
 */

import "dotenv/config";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { generateAndStoreLesson } from "../apps/student/lib/learnGenerator.js";

const kwId = process.argv[2];
const doSave = process.argv.includes("--save");
const doDeleteFirst = process.argv.includes("--delete-first");

if (!kwId) {
  console.error("Usage: npx tsx scripts/test-lesson-gen.ts <keyword_id> [--save] [--delete-first]");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const openaiKey = process.env.OPENAI_API_KEY!;

if (!supabaseUrl || !supabaseKey) { console.error("Missing Supabase env vars"); process.exit(1); }
if (!openaiKey) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: openaiKey });

// Fetch keyword metadata
const { data: kw, error } = await supabase
  .from("learn_keywords")
  .select("id, label, description, topic_id")
  .eq("id", kwId)
  .single();

if (error || !kw) {
  console.error("Keyword not found:", kwId, error?.message);
  process.exit(1);
}

console.log(`\n=== Generating lesson for: ${kw.label} (${kw.id}) ===\n`);
console.log(`Description: ${kw.description ?? "(none)"}\n`);

if (doDeleteFirst) {
  await supabase.from("learn_lessons").delete().eq("keyword_id", kwId);
  console.log("Deleted existing lesson.\n");
}

// Call generation (always saves when using generateAndStoreLesson)
// For preview-only, we duplicate the call inline without saving:
if (!doSave) {
  // Inline generation preview (no DB write)
  const OpenAIClient = new OpenAI({ apiKey: openaiKey });
  const completion = await OpenAIClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: `keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}\nTopic: ${kw.topic_id}` },
    ],
    response_format: { type: "json_object" },
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { micro_steps?: unknown[] };

  console.log("=== RAW JSON ===");
  console.log(JSON.stringify(parsed, null, 2));

  if (Array.isArray(parsed.micro_steps)) {
    for (const [i, step] of parsed.micro_steps.entries()) {
      const s = step as Record<string, unknown>;
      console.log(`\n--- Step ${i + 1} ---`);
      console.log("EXPLANATION:\n", s.explanation_latex);
      console.log("\nEXAMPLE:\n", s.example_latex);
      console.log("\nHINT:\n", s.hint_latex);
      const cq = s.check_question as Record<string, unknown> | undefined;
      if (cq) {
        console.log("\nCHECK QUESTION:\n", cq.latex_content);
        console.log("Choices:", cq.choices);
        console.log("Correct:", cq.correct_index);
        console.log("Solution:\n", cq.solution_latex);
      }
    }
  }
  console.log("\n=== NOT SAVED (run with --save to persist) ===");
} else {
  const result = await generateAndStoreLesson(supabase, openai, kw);
  if (!result) {
    console.error("Generation returned null.");
    process.exit(1);
  }
  console.log("=== SAVED TO DB ===");
  console.log(JSON.stringify(result, null, 2));
}

function buildSystemPrompt(): string {
  // Inline the same system prompt from learnGenerator for preview consistency
  const EXAMPLE_FORMAT_RULES = `
FORMAT FOR example_latex — READ CAREFULLY:

Structure: [optional setup prose] + blank line + \\begin{aligned} math block + blank line + [optional conclusion prose]
Use \\n\\n (two escaped newlines in the JSON string) to create blank-line paragraph breaks.

CRITICAL RULE: \\begin{aligned}...\\end{aligned} contains ONLY math expressions — NO English words, NO sentences, NO "Since", NO "Therefore", NO bare text.
All prose MUST be in \\text{...} OUTSIDE the aligned block.

Bad (prose inside aligned — KaTeX will error):
  \\begin{aligned} f(1) &= 3 \\\\ since 3 < f(2) & = 5 \\end{aligned}

Good (prose outside, math inside):
  \\text{Evaluate at } x = 1 \\text{ and } x = 2.\\n\\n\\begin{aligned} f(1) &= 2(1)+1 = 3 \\\\ f(2) &= 2(2)+1 = 5 \\end{aligned}\\n\\n\\text{Since } f(1) < f(2), \\text{ the function is increasing.}

GRAPH RULE: When the skill benefits from a visual (intervals, transformations, graphs of functions), embed a graph on its own line using:
  <FunctionGraph equation="expr" rangeX="-3,3" rangeY="-4,6" />
  Optional: equation2, pieces, holes, dots, label, shade="true"
  Equation syntax: * for multiply, ^ for power, no implicit multiplication.
  Place the tag after a \\n\\n break, on its own paragraph.

ALIGNED BLOCK RULES:
- Each step ends with \\\\ except the last line.
- Use &= to align equality signs.
- Never write x = y = z on one line.
`;

  return `You are a precalculus tutor generating micro-lessons. Each micro-lesson teaches ONE keyword skill through exactly 2 small steps.

Return one JSON object: { "micro_steps": [ MicroStep, MicroStep ] }

MicroStep shape:
{
  "step_index": number,
  "explanation_latex": string,
  "example_latex": string,
  "check_question": {
    "latex_content": string,
    "choices": ["$...$", "$...$", "$...$", "$...$"],
    "correct_index": number,
    "solution_latex": string
  },
  "hint_latex": string
}

explanation_latex: 1-3 sentences. Prose in \\text{...}. Max 60 words.
example_latex: ${EXAMPLE_FORMAT_RULES}
hint_latex: one sentence max 15 words. Prose in \\text{}.
check_question choices: exactly 4 strings each in $...$. Distractors reflect real mistakes.
check_question solution_latex: \\begin{aligned}...\\end{aligned} with &= and \\\\ between steps. Prose in \\text{} OUTSIDE the aligned block.

GLOBAL RULES: NEVER write bare English inside \\begin{aligned}. NEVER chain equalities on one line. Return raw JSON only.`;
}
