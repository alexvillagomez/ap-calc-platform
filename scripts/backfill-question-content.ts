/**
 * Backfills per-question CONTENT fields (added by migration
 * 20260616000001_question_content.sql) on math_questions AND mcat_questions:
 *
 *   description               — 1–2 sentence natural-language description of what
 *                               the problem asks/tests (for retrieval + keyword
 *                               pinpointing).
 *   description_embedding     — 1536-d (text-embedding-3-small) embedding of the
 *                               description.
 *   wrong_answer_explanations — JSONB array ALIGNED to choices: for each choice a
 *                               short rationale. Wrong choices get the
 *                               misconception; the correct choice gets a brief
 *                               "correct because…".
 *
 * For each question MISSING `description` OR `wrong_answer_explanations`, ONE
 * gpt-5.4-mini JSON call produces BOTH the description and the per-choice
 * explanations; then the description is embedded and all three fields are stored.
 *
 * Reuses the mathGenerator / mcatGenerator conventions:
 *   - model gpt-5.4-mini, response_format json_object
 *   - math stems are KaTeX LaTeX (stem_latex/solution_latex); mcat are plain.
 *
 * SAFETY (Nano instance — limited disk-IO burst budget):
 *   - Resume-safe: skips rows that already have BOTH fields populated.
 *   - Single-threaded, NO concurrency.
 *   - Throttled: ~400ms sleep between questions.
 *   - Idempotent: re-running only fills what's still missing.
 *
 * Flags:
 *   --dry-run            count work, no OpenAI calls or DB writes
 *   --limit N            process at most N questions (across selected systems)
 *   --system math|mcat   restrict to one system (default: both)
 *
 * npm:  npm run questions:content -- [--system math] [--limit 10] [--dry-run]
 *
 * NOTE: Do NOT run this until migration 20260616000001 is applied. If the new
 * columns are missing the script prints a clear message and exits.
 *
 * Env: loads root .env.local first; overrides OPENAI_API_KEY from
 * apps/student/.env.local (root key is invalid). Mirrors scripts/embed-math.ts.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// ─── Env loading (mirror embed-math.ts) ─────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (studentEnv.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = studentEnv.OPENAI_API_KEY;
  }
}

// ─── CLI flags ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const isDryRun = argv.includes("--dry-run");

function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return undefined;
}

const limitRaw = flagValue("--limit");
const LIMIT = limitRaw ? parseInt(limitRaw, 10) : Infinity;
const systemFilter = flagValue("--system"); // "math" | "mcat" | undefined

// ─── Config ───────────────────────────────────────────────────────────────────
const GEN_MODEL = "gpt-5.4-mini";
const EMBED_MODEL = "text-embedding-3-small";
const QUESTION_SLEEP_MS = 400; // throttle between questions (IO protection)
const LOG_EVERY = 5;

interface QSystem {
  label: "math" | "mcat";
  table: string;
  stemCol: "stem_latex" | "stem";
  solutionCol: "solution_latex" | "explanation";
  isLatex: boolean;
}

const SYSTEMS: QSystem[] = [
  {
    label: "math",
    table: "math_questions",
    stemCol: "stem_latex",
    solutionCol: "solution_latex",
    isLatex: true,
  },
  {
    label: "mcat",
    table: "mcat_questions",
    stemCol: "stem",
    solutionCol: "explanation",
    isLatex: false,
  },
];

interface QRow {
  id: string;
  stem: string;
  solution: string;
  choices: string[];
  correct_index: number;
  description: string | null;
  wrong_answer_explanations: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Generation: one JSON call → description + per-choice explanations ───────────
function buildSystemPrompt(sys: QSystem): string {
  const latexNote = sys.isLatex
    ? `The stem and solution are in KaTeX LaTeX ($...$ inline). In your description, refer to math in plain natural language (you may keep short $...$ where clearer). Keep explanations concise plain prose; wrap math in $...$ when needed.`
    : `The stem and explanation are plain text (MCAT Biology). Keep all output plain prose.`;

  return `You annotate ${sys.label === "math" ? "AP math" : "MCAT Biology"} multiple-choice questions for a study app's data layer.

Given a question (stem, worked solution/explanation, the choices, and which 0-based index is correct), produce:
1. "description": a 1-2 sentence natural-language description of WHAT the problem asks and what concept/skill it tests. Written for retrieval and keyword matching — name the concept plainly. Do NOT reveal the answer.
2. "wrong_answer_explanations": an array with EXACTLY ONE entry per choice, in the SAME ORDER as the choices array. For each NON-correct choice, give a short (1 sentence) rationale of why it is wrong / the misconception that produces it. For the correct choice, give a brief "Correct: ..." (one short clause) — or null.

${latexNote}

Return a JSON object EXACTLY:
{
  "description": "string",
  "wrong_answer_explanations": ["string-or-null", ...]
}
The wrong_answer_explanations array MUST have the same length as the choices array. Return valid JSON only. No markdown.`;
}

interface GenResult {
  description: string;
  wrong_answer_explanations: (string | null)[];
}

async function generateContent(
  openai: OpenAI,
  sys: QSystem,
  q: QRow
): Promise<GenResult | null> {
  const choiceLines = q.choices
    .map((c, i) => `[${i}]${i === q.correct_index ? " (correct)" : ""} ${c}`)
    .join("\n");

  const userPrompt = `STEM:\n${q.stem}\n\nWORKED ${sys.isLatex ? "SOLUTION" : "EXPLANATION"}:\n${q.solution}\n\nCHOICES (${q.choices.length}, correct index = ${q.correct_index}):\n${choiceLines}`;

  let text: string;
  try {
    const completion = await openai.chat.completions.create({
      model: GEN_MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt(sys) },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });
    text = completion.choices[0]?.message?.content ?? "{}";
  } catch (e) {
    console.error(`    [ERROR] generation failed: ${(e as Error).message}`);
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error("    [ERROR] non-JSON output");
    return null;
  }

  const description = parsed.description;
  const wae = parsed.wrong_answer_explanations;
  if (typeof description !== "string" || !description.trim()) {
    console.error("    [ERROR] missing/invalid description");
    return null;
  }
  if (!Array.isArray(wae)) {
    console.error("    [ERROR] wrong_answer_explanations not an array");
    return null;
  }

  // Normalize to exactly choices.length entries (pad with null / truncate).
  const aligned: (string | null)[] = q.choices.map((_, i) => {
    const v = wae[i];
    if (v === null || v === undefined) return null;
    return typeof v === "string" ? v : String(v);
  });

  return { description: description.trim(), wrong_answer_explanations: aligned };
}

async function embedText(openai: OpenAI, textInput: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: textInput.trim() || " ",
  });
  return res.data[0]!.embedding;
}

// ─── Column existence check (migration gate) ────────────────────────────────────
async function columnsExist(
  supabase: SupabaseClient,
  sys: QSystem
): Promise<boolean> {
  const { error } = await supabase
    .from(sys.table)
    .select("description, description_embedding, wrong_answer_explanations")
    .limit(1);
  return !error;
}

// ─── Fetch rows missing content for one system ──────────────────────────────────
async function fetchMissing(
  supabase: SupabaseClient,
  sys: QSystem,
  remaining: number
): Promise<QRow[]> {
  const PAGE = 1000;
  let rows: QRow[] = [];
  let page = 0;
  while (rows.length < remaining) {
    // Need description OR wrong_answer_explanations to be null.
    const { data, error } = await supabase
      .from(sys.table)
      .select(
        `id, ${sys.stemCol}, ${sys.solutionCol}, choices, correct_index, description, wrong_answer_explanations`
      )
      .or("description.is.null,wrong_answer_explanations.is.null")
      .order("id")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) {
      console.error(`Fetch error (${sys.table}):`, error.message);
      process.exit(1);
    }
    const batch = (data ?? []).map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: String(rec.id),
        stem: String(rec[sys.stemCol] ?? ""),
        solution: String(rec[sys.solutionCol] ?? ""),
        choices: Array.isArray(rec.choices) ? (rec.choices as string[]) : [],
        correct_index:
          typeof rec.correct_index === "number" ? rec.correct_index : 0,
        description: (rec.description as string | null) ?? null,
        wrong_answer_explanations: rec.wrong_answer_explanations ?? null,
      };
    });
    rows = rows.concat(batch);
    if (batch.length < PAGE) break;
    page++;
  }
  return rows.slice(0, remaining);
}

// ─── Process one system ─────────────────────────────────────────────────────────
async function processSystem(
  supabase: SupabaseClient,
  openai: OpenAI | null,
  sys: QSystem,
  remaining: number
): Promise<number> {
  console.log(`\n── ${sys.label} (${sys.table}) ──`);

  if (!(await columnsExist(supabase, sys))) {
    console.error(
      `  [BLOCKED] Columns description/description_embedding/wrong_answer_explanations not found on ${sys.table}.\n` +
        `  Apply migration 20260616000001 first (Supabase SQL editor):\n` +
        `    supabase/migrations/20260616000001_question_content.sql`
    );
    process.exit(1);
  }

  const rows = await fetchMissing(supabase, sys, remaining);
  console.log(`  Questions needing content: ${rows.length}`);

  if (isDryRun || rows.length === 0 || !openai) {
    return rows.length;
  }

  let done = 0;
  let failed = 0;

  for (const q of rows) {
    if (q.choices.length === 0) {
      console.warn(`  [skip] ${q.id}: no choices`);
      failed++;
      await sleep(QUESTION_SLEEP_MS);
      continue;
    }

    const gen = await generateContent(openai, sys, q);
    if (!gen) {
      failed++;
      await sleep(QUESTION_SLEEP_MS);
      continue;
    }

    let descEmbedding: number[];
    try {
      descEmbedding = await embedText(openai, gen.description);
    } catch (e) {
      console.error(`  [ERROR] embed failed for ${q.id}: ${(e as Error).message}`);
      failed++;
      await sleep(QUESTION_SLEEP_MS);
      continue;
    }

    const { error: updErr } = await supabase
      .from(sys.table)
      .update({
        description: gen.description,
        description_embedding: descEmbedding,
        wrong_answer_explanations: gen.wrong_answer_explanations,
      })
      .eq("id", q.id);

    if (updErr) {
      console.error(`  [ERROR] update failed for ${q.id}: ${updErr.message}`);
      failed++;
    } else {
      done++;
      if (done % LOG_EVERY === 0) {
        console.log(`  Progress: ${done} done, ${failed} failed...`);
      }
    }

    await sleep(QUESTION_SLEEP_MS);
  }

  console.log(`  ${sys.label} done: ${done} written, ${failed} failed.`);
  return done;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== backfill-question-content ===");
  if (isDryRun) console.log("[DRY RUN] No OpenAI calls or DB writes.");
  if (Number.isFinite(LIMIT)) console.log(`[LIMIT] ${LIMIT} questions max.`);
  if (systemFilter) console.log(`[SYSTEM] ${systemFilter} only.`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let openai: OpenAI | null = null;
  if (!isDryRun) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.error("Missing OPENAI_API_KEY");
      process.exit(1);
    }
    openai = new OpenAI({ apiKey: openaiKey });
  }

  const systems = systemFilter
    ? SYSTEMS.filter((s) => s.label === systemFilter)
    : SYSTEMS;

  if (systems.length === 0) {
    console.error(`Unknown --system "${systemFilter}". Use math|mcat.`);
    process.exit(1);
  }

  let remaining = LIMIT;
  let total = 0;
  for (const sys of systems) {
    if (remaining <= 0) break;
    const n = await processSystem(supabase, openai, sys, remaining);
    total += n;
    remaining -= n;
  }

  console.log("\n=== Summary ===");
  console.log(`  ${isDryRun ? "Would process" : "Processed"}: ${total} questions.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
