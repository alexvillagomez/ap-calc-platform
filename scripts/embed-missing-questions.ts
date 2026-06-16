/**
 * Fills the missing `embedding` (JSONB 1536-d, text-embedding-3-small) on
 * math_questions AND mcat_questions, derived from each question's stem text.
 *
 *   math_questions: text = stem_latex
 *   mcat_questions: text = stem
 *
 * Model: text-embedding-3-small (1536 dims)
 * Batch: ≤100 texts per OpenAI embeddings request.
 * Resume-safe: only rows where `embedding` IS NULL.
 * Throttled: single-threaded; small sleep between DB writes + between batches to
 *            protect the Nano instance's disk-IO burst budget.
 * Progress log every 10 items.
 *
 * Usage:
 *   tsx scripts/embed-missing-questions.ts            (live run)
 *   tsx scripts/embed-missing-questions.ts --dry-run  (count rows, no API/DB writes)
 *
 * npm:  npm run questions:embed
 *
 * Env: loads root .env.local first; overrides OPENAI_API_KEY from
 * apps/student/.env.local (root key is invalid — never use it).
 * Mirrors scripts/embed-math.ts.
 */

import { createClient } from "@supabase/supabase-js";
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
const isDryRun = process.argv.includes("--dry-run");

// ─── Config ───────────────────────────────────────────────────────────────────
const BATCH = 100; // OpenAI inputs per embeddings call
const LOG_EVERY = 10;
const WRITE_SLEEP_MS = 120; // pause between single-row DB writes (IO protection)
const BATCH_SLEEP_MS = 400; // pause between OpenAI batches

interface QSystem {
  label: "math" | "mcat";
  table: string;
  stemCol: "stem_latex" | "stem";
}

const SYSTEMS: QSystem[] = [
  { label: "math", table: "math_questions", stemCol: "stem_latex" },
  { label: "mcat", table: "mcat_questions", stemCol: "stem" },
];

interface QRow {
  id: string;
  stem: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function embedBatch(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

// ─── Fetch (paginated) rows missing embedding for one table ─────────────────────
async function fetchMissing(
  supabase: ReturnType<typeof createClient>,
  sys: QSystem
): Promise<QRow[]> {
  const PAGE = 1000;
  let rows: QRow[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from(sys.table)
      .select(`id, ${sys.stemCol}`)
      .is("embedding", null)
      .order("id")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) {
      console.error(`Fetch error (${sys.table}):`, error.message);
      process.exit(1);
    }
    const batch = (data ?? []).map((r) => {
      const rec = r as Record<string, unknown>;
      return { id: String(rec.id), stem: String(rec[sys.stemCol] ?? "") };
    });
    rows = rows.concat(batch);
    if (batch.length < PAGE) break;
    page++;
  }
  return rows;
}

// ─── Process one system ─────────────────────────────────────────────────────────
async function processSystem(
  supabase: ReturnType<typeof createClient>,
  openai: OpenAI | null,
  sys: QSystem
): Promise<{ embedded: number; failed: number }> {
  console.log(`\n── ${sys.label} (${sys.table}) ──`);
  const rows = await fetchMissing(supabase, sys);
  console.log(`  Questions needing embedding: ${rows.length}`);

  if (isDryRun || rows.length === 0 || !openai) {
    return { embedded: 0, failed: 0 };
  }

  let embedded = 0;
  let failed = 0;

  for (const batch of chunk(rows, BATCH)) {
    // Stem could be empty in edge cases — embeddings API rejects empty strings,
    // so substitute a single space to keep the batch aligned 1:1.
    const texts = batch.map((q) => (q.stem.trim() ? q.stem : " "));

    let embeddings: number[][];
    try {
      embeddings = await embedBatch(openai, texts);
    } catch (e) {
      console.error(`  [ERROR] Embedding batch failed:`, (e as Error).message);
      failed += batch.length;
      await sleep(BATCH_SLEEP_MS);
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const { error: updErr } = await supabase
        .from(sys.table)
        .update({ embedding: embeddings[j] })
        .eq("id", batch[j]!.id);

      if (updErr) {
        console.error(
          `  [ERROR] Update failed for ${batch[j]!.id}: ${updErr.message}`
        );
        failed++;
      } else {
        embedded++;
        if (embedded % LOG_EVERY === 0) {
          console.log(`  Progress: ${embedded} embedded, ${failed} failed...`);
        }
      }
      await sleep(WRITE_SLEEP_MS);
    }
    await sleep(BATCH_SLEEP_MS);
  }

  console.log(`  ${sys.label} done: ${embedded} embedded, ${failed} failed.`);
  return { embedded, failed };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== embed-missing-questions ===");
  if (isDryRun) console.log("[DRY RUN] No OpenAI calls or DB writes.");

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

  let totalEmbedded = 0;
  let totalFailed = 0;
  for (const sys of SYSTEMS) {
    const { embedded, failed } = await processSystem(supabase, openai, sys);
    totalEmbedded += embedded;
    totalFailed += failed;
  }

  if (isDryRun) {
    console.log("\n[DRY RUN] Done. No writes.");
    return;
  }

  console.log("\n=== Summary ===");
  console.log(`  Questions embedded:  ${totalEmbedded}`);
  console.log(`  Failures:            ${totalFailed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
