/**
 * Four-dimension enrichment for math_questions / mcat_questions.
 *
 * Grounds each question along FOUR dimensions, each with its own description,
 * embedding, and keyword tagging:
 *   1. PROBLEM        → problem_description (+ embedding). Content tagging already
 *                       lives in keyword_weights (content keywords).
 *   2. WRONG ANSWER   → wrong_answer_data (per distractor; see backfill-distractor-data.ts)
 *   3. ACTION         → action_description (+ embedding) tagged to *_action_keywords (action_weights)
 *   4. REPRESENTATION → representation_description (+ embedding) tagged to *_representation_keywords (representation_weights)
 *
 * Per question MISSING problem_description:
 *   1. ONE gpt-5.4-mini JSON call → { problem_description, action_description,
 *      representation_description }.
 *   2. Embed all three (text-embedding-3-small, 1536-d).
 *   3. Tag action_description → nearest *_action_keywords; representation_description
 *      → nearest *_representation_keywords (cosine; top-2 normalized so strongest ≈ 1).
 *   4. Store all six fields + action_weights + representation_weights.
 *
 * Also (step 0) embeds any action/representation DIMENSION keywords that are missing
 * an embedding, so tagging has vectors to match against.
 *
 * SAFETY: resume-safe (skips rows that already have problem_description), single-
 * threaded, throttled (~400ms/question), idempotent.
 *
 * Flags: --dry-run | --limit N | --system math|mcat | --category <id>
 * npm:   npm run questions:descriptions -- [--system math] [--limit 10]
 *
 * Env: root .env.local first; OPENAI_API_KEY overridden from apps/student/.env.local.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (studentEnv.OPENAI_API_KEY) process.env.OPENAI_API_KEY = studentEnv.OPENAI_API_KEY;
}

const argv = process.argv.slice(2);
const isDryRun = argv.includes("--dry-run");
function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
const LIMIT = flagValue("--limit") ? parseInt(flagValue("--limit")!, 10) : Infinity;
const systemFilter = flagValue("--system") ?? "math";
const categoryFilter = flagValue("--category");

const GEN_MODEL = "gpt-5.4-mini";
const EMBED_MODEL = "text-embedding-3-small";
const QUESTION_SLEEP_MS = 400;
const LOG_EVERY = 5;
const TOP_K = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface QSystem {
  label: "math" | "mcat";
  table: string;
  actionTable: string;
  reprTable: string;
  stemCol: "stem_latex" | "stem";
  solutionCol: "solution_latex" | "explanation";
  isLatex: boolean;
}
const SYSTEMS: QSystem[] = [
  { label: "math", table: "math_questions", actionTable: "math_action_keywords", reprTable: "math_representation_keywords", stemCol: "stem_latex", solutionCol: "solution_latex", isLatex: true },
  { label: "mcat", table: "mcat_questions", actionTable: "mcat_action_keywords", reprTable: "mcat_representation_keywords", stemCol: "stem", solutionCol: "explanation", isLatex: false },
];

interface QRow { id: string; stem: string; solution: string; choices: string[]; correct_index: number; }
type KwEmb = { id: string; embedding: number[] };

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// mode "sum": weights sum to 1 (action_weights + representation_weights).
function nearestWeights(emb: number[], kws: KwEmb[], mode: "max" | "sum" = "max"): Record<string, number> {
  const scored = kws.map((k) => ({ id: k.id, sim: cosine(emb, k.embedding) }))
    .filter((s) => s.sim > 0).sort((a, b) => b.sim - a.sim).slice(0, TOP_K);
  if (scored.length === 0) return {};
  const out: Record<string, number> = {};
  if (mode === "sum") {
    const total = scored.reduce((a, s) => a + s.sim, 0);
    if (total <= 0) return {};
    let acc = 0;
    for (let i = 0; i < scored.length; i++) {
      const w = i < scored.length - 1
        ? Math.round((scored[i]!.sim / total) * 100) / 100
        : Math.round((1 - acc) * 100) / 100;
      acc += i < scored.length - 1 ? w : 0;
      out[scored[i]!.id] = w;
    }
  } else {
    const max = scored[0]!.sim;
    for (const s of scored) out[s.id] = Math.round((s.sim / max) * 100) / 100;
  }
  return out;
}

async function embedTexts(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({ model: EMBED_MODEL, input: texts.map((t) => t.trim() || " ") });
  return res.data.map((d) => d.embedding);
}

// Ensure dimension keywords (action/representation) have embeddings.
async function ensureDimensionEmbeddings(supabase: SupabaseClient, openai: OpenAI | null, table: string): Promise<KwEmb[]> {
  const { data } = await supabase.from(table).select("id, label, description, embedding");
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const missing = rows.filter((r) => !Array.isArray(r.embedding) || (r.embedding as number[]).length === 0);
  if (missing.length > 0 && openai && !isDryRun) {
    const texts = missing.map((r) => `${r.label}. ${r.description ?? ""}`.trim());
    const embs = await embedTexts(openai, texts);
    for (let i = 0; i < missing.length; i++) {
      await supabase.from(table).update({ embedding: embs[i] }).eq("id", missing[i]!.id as string);
      (missing[i] as Record<string, unknown>).embedding = embs[i];
    }
    console.log(`  Embedded ${missing.length} dimension keywords in ${table}.`);
  }
  return rows
    .map((r) => ({ id: String(r.id), embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : [] }))
    .filter((r) => r.embedding.length > 0);
}

function buildSystemPrompt(sys: QSystem): string {
  const latexNote = sys.isLatex
    ? `The stem/solution are KaTeX LaTeX ($...$). Refer to math in plain natural language; keep $...$ only where clearer.`
    : `The stem/explanation are plain text (MCAT Biology). Keep all output plain prose.`;
  return `You annotate ${sys.label === "math" ? "AP math" : "MCAT Biology"} questions for a study app's data layer along three dimensions. Given a question (stem + worked solution/explanation), produce:
1. "problem_description": 1-2 sentences naming WHAT the problem asks and the concept/skill it tests (for retrieval). Do NOT reveal the answer.
2. "action_description": 1 sentence naming the cognitive ACTION the student must perform (e.g. evaluate, solve, interpret, analyze, calculate, justify, identify, compare, apply a theorem, predict, integrate concepts).
3. "representation_description": 1 sentence naming the REPRESENTATION the question uses (e.g. ${sys.label === "math" ? "symbolic/analytic, graphical, numerical/tabular, verbal/contextual" : "prose passage, figure/diagram, graph, data table, equation, experimental setup"}).
4. "prerequisite_description": the PREREQUISITE knowledge needed to solve this, in simple GENERAL terms — name the underlying concepts/skills (e.g. "factoring a difference of squares, basic limits, hole discontinuities"). No numbers or specifics from this problem.

${latexNote}

Return JSON EXACTLY: { "problem_description": "string", "action_description": "string", "representation_description": "string", "prerequisite_description": "string" }. Valid JSON only, no markdown.`;
}

interface GenResult { problem_description: string; action_description: string; representation_description: string; prerequisite_description: string; }

async function generate(openai: OpenAI, sys: QSystem, q: QRow): Promise<GenResult | null> {
  const userPrompt = `STEM:\n${q.stem}\n\nWORKED ${sys.isLatex ? "SOLUTION" : "EXPLANATION"}:\n${q.solution}`;
  let text: string;
  try {
    const c = await openai.chat.completions.create({
      model: GEN_MODEL,
      messages: [{ role: "system", content: buildSystemPrompt(sys) }, { role: "user", content: userPrompt }],
      response_format: { type: "json_object" },
    });
    text = c.choices[0]?.message?.content ?? "{}";
  } catch (e) { console.error(`    [ERROR] gen failed: ${(e as Error).message}`); return null; }
  let p: Record<string, unknown>;
  try { p = JSON.parse(text); } catch { console.error("    [ERROR] non-JSON"); return null; }
  const pd = p.problem_description, ad = p.action_description, rd = p.representation_description, qd = p.prerequisite_description;
  if (typeof pd !== "string" || !pd.trim()) { console.error("    [ERROR] missing problem_description"); return null; }
  return {
    problem_description: pd.trim(),
    action_description: typeof ad === "string" ? ad.trim() : "",
    representation_description: typeof rd === "string" ? rd.trim() : "",
    prerequisite_description: typeof qd === "string" ? qd.trim() : "",
  };
}

async function columnsExist(supabase: SupabaseClient, sys: QSystem): Promise<boolean> {
  const { error } = await supabase.from(sys.table)
    .select("problem_description, problem_description_embedding, action_description, action_weights, representation_description, representation_weights")
    .limit(1);
  return !error;
}

async function fetchMissing(supabase: SupabaseClient, sys: QSystem, remaining: number): Promise<QRow[]> {
  const PAGE = 1000;
  let rows: QRow[] = []; let page = 0;
  while (rows.length < remaining) {
    let q = supabase.from(sys.table)
      .select(`id, ${sys.stemCol}, ${sys.solutionCol}, choices, correct_index`)
      .is("problem_description", null).order("id").range(page * PAGE, (page + 1) * PAGE - 1);
    if (categoryFilter) q = q.eq("category_id", categoryFilter);
    const { data, error } = await q;
    if (error) { console.error(`Fetch error (${sys.table}):`, error.message); process.exit(1); }
    const batch = (data ?? []).map((r) => {
      const rec = r as Record<string, unknown>;
      return { id: String(rec.id), stem: String(rec[sys.stemCol] ?? ""), solution: String(rec[sys.solutionCol] ?? ""),
        choices: Array.isArray(rec.choices) ? (rec.choices as string[]) : [], correct_index: typeof rec.correct_index === "number" ? rec.correct_index : 0 };
    });
    rows = rows.concat(batch);
    if (batch.length < PAGE) break;
    page++;
  }
  return rows.slice(0, remaining);
}

async function processSystem(supabase: SupabaseClient, openai: OpenAI | null, sys: QSystem, remaining: number): Promise<number> {
  console.log(`\n── ${sys.label} (${sys.table}) ──`);
  if (!(await columnsExist(supabase, sys))) {
    console.error(`  [BLOCKED] 4-description columns not found on ${sys.table}. Apply migration 20260618000001 first.`);
    process.exit(1);
  }
  const actionKws = await ensureDimensionEmbeddings(supabase, openai, sys.actionTable);
  const reprKws = await ensureDimensionEmbeddings(supabase, openai, sys.reprTable);

  const rows = await fetchMissing(supabase, sys, remaining);
  console.log(`  Questions needing descriptions: ${rows.length}`);
  if (isDryRun || rows.length === 0 || !openai) return rows.length;

  let done = 0, failed = 0;
  for (const q of rows) {
    const gen = await generate(openai, sys, q);
    if (!gen) { failed++; await sleep(QUESTION_SLEEP_MS); continue; }
    let embs: number[][];
    try { embs = await embedTexts(openai, [gen.problem_description, gen.action_description || " ", gen.representation_description || " ", gen.prerequisite_description || " "]); }
    catch (e) { console.error(`  [ERROR] embed ${q.id}: ${(e as Error).message}`); failed++; await sleep(QUESTION_SLEEP_MS); continue; }
    const [pEmb, aEmb, rEmb, preEmb] = embs;
    const payload = {
      problem_description: gen.problem_description,
      problem_description_embedding: pEmb,
      action_description: gen.action_description || null,
      action_description_embedding: gen.action_description ? aEmb : null,
      action_weights: gen.action_description ? nearestWeights(aEmb!, actionKws, "sum") : {},
      representation_description: gen.representation_description || null,
      representation_description_embedding: gen.representation_description ? rEmb : null,
      representation_weights: gen.representation_description ? nearestWeights(rEmb!, reprKws, "sum") : {},
      // PREREQUISITE — general prereq knowledge, embedded + tagged to general topic keyword pool.
      prerequisite_description: gen.prerequisite_description || null,
      prerequisite_description_embedding: gen.prerequisite_description ? preEmb : null,
    };
    const { error } = await supabase.from(sys.table).update(payload).eq("id", q.id);
    if (error) { console.error(`  [ERROR] update ${q.id}: ${error.message}`); failed++; }
    else { done++; if (done % LOG_EVERY === 0) console.log(`  Progress: ${done} done, ${failed} failed...`); }
    await sleep(QUESTION_SLEEP_MS);
  }
  console.log(`  ${sys.label} done: ${done} written, ${failed} failed.`);
  return done;
}

async function main() {
  console.log("=== enrich-question-descriptions ===");
  if (isDryRun) console.log("[DRY RUN] No OpenAI calls or DB writes.");
  if (Number.isFinite(LIMIT)) console.log(`[LIMIT] ${LIMIT}`);
  console.log(`[SYSTEM] ${systemFilter}${categoryFilter ? ` · category ${categoryFilter}` : ""}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env"); process.exit(1); }
  const supabase = createClient(url, key);
  let openai: OpenAI | null = null;
  if (!isDryRun) {
    if (!process.env.OPENAI_API_KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  const systems = SYSTEMS.filter((s) => s.label === systemFilter);
  if (systems.length === 0) { console.error(`Unknown --system "${systemFilter}". Use math|mcat.`); process.exit(1); }

  let remaining = LIMIT, total = 0;
  for (const sys of systems) {
    if (remaining <= 0) break;
    const n = await processSystem(supabase, openai, sys, remaining);
    total += n; remaining -= n;
  }
  console.log(`\n=== Summary ===\n  ${isDryRun ? "Would process" : "Processed"}: ${total} questions.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
