/**
 * Backfills `wrong_answer_data` on math_questions / mcat_questions — per-distractor
 * misconception metadata that powers wrong-answer-driven weight updates.
 *
 * For each question MISSING `wrong_answer_data`:
 *   1. ONE gpt-5.4-mini JSON call produces, for each WRONG choice, a 1-sentence
 *      description of the MISCONCEPTION that leads a student to pick it (correct
 *      choice → null).
 *   2. Each wrong description is embedded (text-embedding-3-small, 1536-d).
 *   3. keyword_weights are derived WITHOUT extra LLM calls: cosine-match the
 *      misconception embedding against the question category's in_depth keyword
 *      embeddings; the top-2 nearest become the misconception's keyword_weights
 *      (normalized so the strongest ≈ 1.0).
 *   4. Store wrong_answer_data = array aligned 1:1 to `choices`
 *      ({description, embedding, keyword_weights} for wrong; null for correct).
 *
 * The attempt routes then shift the student's mastery on those keyword_weights
 * toward the misconception (~20%) when that distractor is chosen.
 *
 * SAFETY (Nano instance): resume-safe (skips rows that already have the column
 * populated), single-threaded, throttled (~400ms between questions), idempotent.
 *
 * Flags:
 *   --dry-run            count work, no OpenAI calls or DB writes
 *   --limit N            process at most N questions (across selected systems)
 *   --system math|mcat   restrict to one system (default: math)
 *   --category <id>      restrict to one category id
 *
 * npm:  npm run questions:distractors -- [--system math] [--category <id>] [--limit 10]
 *
 * Env: loads root .env.local first; overrides OPENAI_API_KEY from
 * apps/student/.env.local (root key is invalid). Mirrors scripts/embed-math.ts.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// ─── Env loading ────────────────────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (studentEnv.OPENAI_API_KEY) process.env.OPENAI_API_KEY = studentEnv.OPENAI_API_KEY;
}

// ─── CLI flags ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const isDryRun = argv.includes("--dry-run");
function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
const limitRaw = flagValue("--limit");
const LIMIT = limitRaw ? parseInt(limitRaw, 10) : Infinity;
const systemFilter = flagValue("--system") ?? "math";
const categoryFilter = flagValue("--category");

// ─── Config ───────────────────────────────────────────────────────────────────
const GEN_MODEL = "gpt-5.4-mini";
const EMBED_MODEL = "text-embedding-3-small";
const QUESTION_SLEEP_MS = 400;
const LOG_EVERY = 5;
const TOP_K_KEYWORDS = 2; // nearest in_depth keywords per misconception

interface QSystem {
  label: "math" | "mcat";
  table: string;
  kwTable: string;
  stemCol: "stem_latex" | "stem";
  solutionCol: "solution_latex" | "explanation";
  isLatex: boolean;
}

const SYSTEMS: QSystem[] = [
  { label: "math", table: "math_questions", kwTable: "math_keywords", stemCol: "stem_latex", solutionCol: "solution_latex", isLatex: true },
  { label: "mcat", table: "mcat_questions", kwTable: "mcat_keywords", stemCol: "stem", solutionCol: "explanation", isLatex: false },
];

interface QRow {
  id: string;
  category_id: string;
  stem: string;
  solution: string;
  choices: string[];
  correct_index: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ─── Per-category in_depth keyword embedding cache ──────────────────────────────
type KwEmb = { id: string; embedding: number[] };
const kwCache = new Map<string, KwEmb[]>();

async function categoryKeywords(supabase: SupabaseClient, sys: QSystem, categoryId: string): Promise<KwEmb[]> {
  const cacheKey = `${sys.label}:${categoryId}`;
  if (kwCache.has(cacheKey)) return kwCache.get(cacheKey)!;
  const { data } = await supabase
    .from(sys.kwTable)
    .select("id, embedding")
    .eq("category_id", categoryId)
    .eq("tier", "in_depth")
    .not("embedding", "is", null);
  const rows: KwEmb[] = ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({ id: String(r.id), embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : [] }))
    .filter((r) => r.embedding.length > 0);
  kwCache.set(cacheKey, rows);
  return rows;
}

function nearestKeywordWeights(descEmbedding: number[], kws: KwEmb[]): Record<string, number> {
  if (kws.length === 0) return {};
  const scored = kws
    .map((k) => ({ id: k.id, sim: cosine(descEmbedding, k.embedding) }))
    .filter((s) => s.sim > 0)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, TOP_K_KEYWORDS);
  if (scored.length === 0) return {};
  // Normalize so the strongest match ≈ 1.0 (relative weighting among the top-K).
  const max = scored[0]!.sim;
  const out: Record<string, number> = {};
  for (const s of scored) out[s.id] = Math.round((s.sim / max) * 100) / 100;
  return out;
}

// ─── Generation: misconception description per wrong choice ─────────────────────
function buildSystemPrompt(sys: QSystem): string {
  const latexNote = sys.isLatex
    ? `The stem and solution are KaTeX LaTeX ($...$). Keep descriptions concise plain prose; wrap math in $...$ when needed.`
    : `The stem and explanation are plain text (MCAT Biology). Keep all output plain prose.`;
  return `You annotate ${sys.label === "math" ? "AP math" : "MCAT Biology"} multiple-choice DISTRACTORS for a study app's data layer.

Given a question (stem, worked solution/explanation, the choices, and the correct 0-based index), produce "misconceptions": an array with EXACTLY ONE entry per choice, in the SAME ORDER as the choices.
- For each WRONG choice: a 1-sentence description of the MISCONCEPTION or specific error that leads a student to pick it (name the faulty idea/skill plainly — this is used for retrieval, so be concrete about WHAT concept is misunderstood).
- For the correct choice: null.

${latexNote}

Return JSON EXACTLY: { "misconceptions": ["string-or-null", ...] }
The array MUST have the same length as the choices array. Valid JSON only, no markdown.`;
}

async function generateMisconceptions(openai: OpenAI, sys: QSystem, q: QRow): Promise<(string | null)[] | null> {
  const choiceLines = q.choices.map((c, i) => `[${i}]${i === q.correct_index ? " (correct)" : ""} ${c}`).join("\n");
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
  try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { console.error("    [ERROR] non-JSON output"); return null; }
  const arr = parsed.misconceptions;
  if (!Array.isArray(arr)) { console.error("    [ERROR] misconceptions not an array"); return null; }
  return q.choices.map((_, i) => {
    const v = arr[i];
    if (v === null || v === undefined) return null;
    return typeof v === "string" ? v : String(v);
  });
}

async function embedTexts(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({ model: EMBED_MODEL, input: texts.map((t) => t.trim() || " ") });
  return res.data.map((d) => d.embedding);
}

async function columnExists(supabase: SupabaseClient, sys: QSystem): Promise<boolean> {
  const { error } = await supabase.from(sys.table).select("wrong_answer_data").limit(1);
  return !error;
}

async function fetchMissing(supabase: SupabaseClient, sys: QSystem, remaining: number): Promise<QRow[]> {
  const PAGE = 1000;
  let rows: QRow[] = [];
  let page = 0;
  while (rows.length < remaining) {
    let query = supabase
      .from(sys.table)
      .select(`id, category_id, ${sys.stemCol}, ${sys.solutionCol}, choices, correct_index`)
      .is("wrong_answer_data", null)
      .order("id")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (categoryFilter) query = query.eq("category_id", categoryFilter);
    const { data, error } = await query;
    if (error) { console.error(`Fetch error (${sys.table}):`, error.message); process.exit(1); }
    const batch = (data ?? []).map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: String(rec.id),
        category_id: String(rec.category_id ?? ""),
        stem: String(rec[sys.stemCol] ?? ""),
        solution: String(rec[sys.solutionCol] ?? ""),
        choices: Array.isArray(rec.choices) ? (rec.choices as string[]) : [],
        correct_index: typeof rec.correct_index === "number" ? rec.correct_index : 0,
      };
    });
    rows = rows.concat(batch);
    if (batch.length < PAGE) break;
    page++;
  }
  return rows.slice(0, remaining);
}

async function processSystem(supabase: SupabaseClient, openai: OpenAI | null, sys: QSystem, remaining: number): Promise<number> {
  console.log(`\n── ${sys.label} (${sys.table}) ──`);
  if (!(await columnExists(supabase, sys))) {
    console.error(`  [BLOCKED] ${sys.table}.wrong_answer_data not found. Apply migration 20260618000000 first.`);
    process.exit(1);
  }
  const rows = await fetchMissing(supabase, sys, remaining);
  console.log(`  Questions needing distractor data: ${rows.length}`);
  if (isDryRun || rows.length === 0 || !openai) return rows.length;

  let done = 0, failed = 0;
  for (const q of rows) {
    if (q.choices.length === 0 || !q.category_id) { failed++; await sleep(QUESTION_SLEEP_MS); continue; }

    const misconceptions = await generateMisconceptions(openai, sys, q);
    if (!misconceptions) { failed++; await sleep(QUESTION_SLEEP_MS); continue; }

    // Embed the wrong-choice descriptions (skip nulls / correct choice).
    const wrongIdx: number[] = [];
    const wrongTexts: string[] = [];
    misconceptions.forEach((m, i) => { if (i !== q.correct_index && m) { wrongIdx.push(i); wrongTexts.push(m); } });

    let embeddings: number[][] = [];
    if (wrongTexts.length > 0) {
      try { embeddings = await embedTexts(openai, wrongTexts); }
      catch (e) { console.error(`  [ERROR] embed failed for ${q.id}: ${(e as Error).message}`); failed++; await sleep(QUESTION_SLEEP_MS); continue; }
    }

    const kws = await categoryKeywords(supabase, sys, q.category_id);

    // Assemble wrong_answer_data aligned to choices.
    const embByIdx = new Map<number, number[]>();
    wrongIdx.forEach((idx, j) => embByIdx.set(idx, embeddings[j]!));
    const wrongAnswerData = q.choices.map((_, i) => {
      if (i === q.correct_index) return null;
      const desc = misconceptions[i];
      const emb = embByIdx.get(i);
      if (!desc || !emb) return null;
      return { description: desc, embedding: emb, keyword_weights: nearestKeywordWeights(emb, kws) };
    });

    const { error: updErr } = await supabase.from(sys.table).update({ wrong_answer_data: wrongAnswerData }).eq("id", q.id);
    if (updErr) { console.error(`  [ERROR] update failed for ${q.id}: ${updErr.message}`); failed++; }
    else { done++; if (done % LOG_EVERY === 0) console.log(`  Progress: ${done} done, ${failed} failed...`); }
    await sleep(QUESTION_SLEEP_MS);
  }
  console.log(`  ${sys.label} done: ${done} written, ${failed} failed.`);
  return done;
}

async function main() {
  console.log("=== backfill-distractor-data ===");
  if (isDryRun) console.log("[DRY RUN] No OpenAI calls or DB writes.");
  if (Number.isFinite(LIMIT)) console.log(`[LIMIT] ${LIMIT} questions max.`);
  console.log(`[SYSTEM] ${systemFilter}${categoryFilter ? ` · category ${categoryFilter}` : ""}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
  const supabase = createClient(supabaseUrl, serviceKey);

  let openai: OpenAI | null = null;
  if (!isDryRun) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }
    openai = new OpenAI({ apiKey: openaiKey });
  }

  const systems = SYSTEMS.filter((s) => s.label === systemFilter);
  if (systems.length === 0) { console.error(`Unknown --system "${systemFilter}". Use math|mcat.`); process.exit(1); }

  let remaining = LIMIT;
  let total = 0;
  for (const sys of systems) {
    if (remaining <= 0) break;
    const n = await processSystem(supabase, openai, sys, remaining);
    total += n;
    remaining -= n;
  }
  console.log(`\n=== Summary ===\n  ${isDryRun ? "Would process" : "Processed"}: ${total} questions.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
