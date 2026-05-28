/**
 * Generates and stores all AI content for the learn system.
 * Runs directly against OpenAI + Supabase — no HTTP server needed.
 * Run: npx tsx scripts/seed-learn-content.ts
 */
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type Keyword = { id: string; label: string; description: string | null; topic_id: string };

// ─── Prompts ──────────────────────────────────────────────────────────────────

const LESSON_SYSTEM = `You are a precalculus tutor generating micro-lessons. Each micro-lesson teaches ONE keyword skill through exactly 2 small steps.

Return one JSON object: { "micro_steps": [ MicroStep, MicroStep ] }

MicroStep shape:
{
  "step_index": number,
  "explanation_latex": string,
  "example_latex": string,
  "check_question": { "latex_content": string, "choices": [string,string,string,string], "correct_index": number, "solution_latex": string },
  "hint_latex": string
}

Rules:
- explanation_latex: 1-3 sentences. ALL English inside \\text{}. Max 60 words.
- example_latex: one worked example, steps separated by \\\\. Prose in \\text{}.
- check_question: 4 choices each in $...$. Distractors reflect real mistakes for this keyword.
- hint_latex: one sentence. Most important thing to remember. Prose in \\text{}.
- Valid KaTeX only. No markdown. Raw JSON only.`;

const REFRESHER_SYSTEM = `You are a math tutor generating a short skill refresher for a student who learned this but forgot it.

Return one JSON object: { "rule_latex": string, "example_latex": string, "check_question": { "latex_content": string, "choices": [string,string,string,string], "correct_index": number, "solution_latex": string } }

Rules:
- rule_latex: 1-2 sentences stating the rule. Prose in \\text{}.
- example_latex: one simple worked example. Steps with \\\\. Prose in \\text{}.
- check_question: 4 choices in $...$. solution_latex: 1-3 lines with \\\\.
- Valid KaTeX. No markdown. Raw JSON only.`;

const TIP_SYSTEM = `You are a math tutor. Generate a one-line tip for a student struggling with a specific skill.

Return one JSON object: { "tip_latex": string }

Rules:
- tip_latex: ONE KaTeX string, max 20 words. Target the most common mistake.
- Start with \\text{Remember: } or \\text{Tip: } or \\text{Watch out: }.
- Prose in \\text{}, math outside. No markdown. Raw JSON only.`;

const PROBLEMS_SYSTEM = `You are a precalculus problem author. Generate multiple-choice practice problems targeting ONE specific keyword at a given difficulty.

Return one JSON object: { "problems": [ PracticeProb, ... ] }

PracticeProb shape: { "latex_content": string, "choices": [string,string,string,string], "correct_index": number, "solution_latex": string, "hint_latex": string }

Difficulty: 1=single step/simple integers, 2=two steps/clean arithmetic, 3=slight variation/unfamiliar form.
Rules: choices in $...$, distractors reflect real errors, solution_latex steps with \\\\, hint_latex one sentence. Valid KaTeX. Raw JSON only.`;

const QUIZ_SYSTEM = `You are a math assessment author. Generate a mastery quiz (exactly 4 questions) for a specific keyword.

Return one JSON object: { "problems": [ QuizProb, ... ] }

QuizProb: { "latex_content": string, "choices": [string,string,string,string], "correct_index": number, "solution_latex": string, "difficulty": number }

Rules: difficulty 3 or 4. Test genuine understanding — include at least one unfamiliar presentation. choices in $...$. Valid KaTeX. Raw JSON only.`;

// ─── Generators ──────────────────────────────────────────────────────────────

async function generate(system: string, user: string): Promise<Record<string, unknown>> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });
  const text = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

async function genLesson(kw: Keyword): Promise<"generated" | "exists" | "error"> {
  const { data: ex } = await supabase.from("learn_lessons").select("id").eq("keyword_id", kw.id).maybeSingle();
  if (ex) return "exists";
  try {
    const parsed = await generate(LESSON_SYSTEM, `keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}\nTopic: ${kw.topic_id}`);
    if (!Array.isArray(parsed.micro_steps)) return "error";
    await supabase.from("learn_lessons").upsert({ keyword_id: kw.id, micro_steps: parsed.micro_steps, model: "gpt-5.4-mini" }, { onConflict: "keyword_id" });
    return "generated";
  } catch { return "error"; }
}

async function genRefresher(kw: Keyword): Promise<"generated" | "exists" | "error"> {
  const { data: ex } = await supabase.from("learn_refreshers").select("id").eq("keyword_id", kw.id).maybeSingle();
  if (ex) return "exists";
  try {
    const parsed = await generate(REFRESHER_SYSTEM, `keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}`);
    if (!parsed.rule_latex || !parsed.check_question) return "error";
    await supabase.from("learn_refreshers").upsert({ keyword_id: kw.id, rule_latex: parsed.rule_latex, example_latex: parsed.example_latex ?? "", check_question: parsed.check_question, model: "gpt-5.4-mini" }, { onConflict: "keyword_id" });
    return "generated";
  } catch { return "error"; }
}

async function genTip(kw: Keyword): Promise<"generated" | "exists" | "error"> {
  const { data: ex } = await supabase.from("learn_tips").select("id").eq("keyword_id", kw.id).maybeSingle();
  if (ex) return "exists";
  try {
    const parsed = await generate(TIP_SYSTEM, `keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}`);
    if (!parsed.tip_latex) return "error";
    await supabase.from("learn_tips").upsert({ keyword_id: kw.id, tip_latex: parsed.tip_latex, model: "gpt-5.4-mini" }, { onConflict: "keyword_id" });
    return "generated";
  } catch { return "error"; }
}

async function genProblems(kw: Keyword, difficulty: number): Promise<"generated" | "exists" | "error"> {
  const { count } = await supabase.from("learn_practice_problems").select("id", { count: "exact", head: true }).eq("keyword_id", kw.id).eq("difficulty", difficulty);
  if ((count ?? 0) >= 3) return "exists";
  try {
    const parsed = await generate(PROBLEMS_SYSTEM, `Keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}\nDifficulty: ${difficulty}/5\nGenerate 3 problems.`);
    if (!Array.isArray(parsed.problems)) return "error";
    const rows = (parsed.problems as Record<string, unknown>[]).map((p) => ({
      keyword_id: kw.id, topic_id: kw.topic_id,
      latex_content: p.latex_content, solution_latex: p.solution_latex ?? "",
      choices: p.choices, correct_index: p.correct_index, difficulty,
      hint_latex: p.hint_latex ?? null,
    }));
    await supabase.from("learn_practice_problems").insert(rows);
    return "generated";
  } catch { return "error"; }
}

async function genMasteryQuiz(kw: Keyword): Promise<"generated" | "exists" | "error"> {
  const { count } = await supabase.from("learn_mastery_quiz_problems").select("id", { count: "exact", head: true }).eq("keyword_id", kw.id);
  if ((count ?? 0) >= 4) return "exists";
  try {
    const parsed = await generate(QUIZ_SYSTEM, `Keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}`);
    if (!Array.isArray(parsed.problems)) return "error";
    const rows = (parsed.problems as Record<string, unknown>[]).map((p) => ({
      keyword_id: kw.id,
      latex_content: p.latex_content, choices: p.choices,
      correct_index: p.correct_index, solution_latex: p.solution_latex ?? "",
      difficulty: p.difficulty ?? 3,
    }));
    await supabase.from("learn_mastery_quiz_problems").insert(rows);
    return "generated";
  } catch { return "error"; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { data: keywords, error } = await supabase
    .from("learn_keywords")
    .select("id, label, description, topic_id")
    .eq("tier", "in_depth")
    .eq("topic_id", "exponent_rules")
    .order("order_index");

  if (error || !keywords || keywords.length === 0) {
    console.error("No keywords found. Run seed-learn-keywords.ts first.");
    process.exit(1);
  }

  console.log(`Generating content for ${keywords.length} keywords...\n`);
  const counts = { generated: 0, exists: 0, error: 0 };

  for (const kw of keywords as Keyword[]) {
    process.stdout.write(`  ${kw.id} ... `);

    const [lesson, refresher, tip, p1, p2, p3, quiz] = await Promise.all([
      genLesson(kw),
      genRefresher(kw),
      genTip(kw),
      genProblems(kw, 1),
      genProblems(kw, 2),
      genProblems(kw, 3),
      genMasteryQuiz(kw),
    ]);

    const results = [lesson, refresher, tip, p1, p2, p3, quiz];
    results.forEach((r) => counts[r]++);

    const gen = results.filter((r) => r === "generated").length;
    const ex = results.filter((r) => r === "exists").length;
    const err = results.filter((r) => r === "error").length;
    console.log(`${gen} generated, ${ex} existed, ${err} errors`);
  }

  console.log(`\nDone.`);
  console.log(`  Total generated : ${counts.generated}`);
  console.log(`  Already existed : ${counts.exists}`);
  console.log(`  Errors          : ${counts.error}`);
}

main().catch(console.error);
