/**
 * Generates and stores vector embeddings for every math_keywords row missing
 * an embedding. Text = "label. description".
 *
 * Model: text-embedding-3-small (1536 dims)
 * Batch size: 100 texts per OpenAI request (API allows up to 2048 inputs).
 * Resume-safe: skips rows where embedding IS NOT NULL.
 * Progress log every 25 items.
 *
 * Usage:
 *   tsx scripts/embed-math.ts            (live run)
 *   tsx scripts/embed-math.ts --dry-run  (count rows, no API calls)
 *
 * npm:  npm run math:embed
 *
 * Env: loads root .env.local first; overrides OPENAI_API_KEY from
 * apps/student/.env.local (root key is invalid — never use it).
 * Supabase: nnkpvezsyumryhnulyvt (service-role key)
 */

import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { createServiceClient } from "./lib/serviceClient";

// ─── Env loading ──────────────────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (studentEnv.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = studentEnv.OPENAI_API_KEY;
  }
}

// ─── CLI flags ────────────────────────────────────────────────────────────────
const isDryRun = process.argv.includes("--dry-run");

// ─── Types ────────────────────────────────────────────────────────────────────
interface KeywordRow {
  id: string;
  label: string;
  description: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function embedBatch(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== embed-math ===");
  if (isDryRun) console.log("[DRY RUN] No OpenAI calls or DB writes.");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createServiceClient(supabaseUrl, serviceKey);

  // Fetch all math_keywords missing an embedding (paginated)
  console.log("\nFetching math_keywords with NULL embedding...");
  const PAGE = 1000;
  let rows: KeywordRow[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from("math_keywords")
      .select("id, label, description")
      .is("embedding", null)
      // Only in_depth keywords are embedded from their own label+description.
      // Umbrellas are containers — their embedding is the CENTROID of their
      // children (see scripts/recompute-umbrella-embeddings.ts), never independent.
      .eq("tier", "in_depth")
      .order("id")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) { console.error("Fetch error:", error.message); process.exit(1); }
    const batch = (data ?? []) as KeywordRow[];
    rows = rows.concat(batch);
    if (batch.length < PAGE) break;
    page++;
  }
  console.log(`  Keywords needing embedding: ${rows.length}`);

  if (isDryRun) {
    const tokens = rows.reduce(
      (acc, r) => acc + `${r.label}. ${r.description ?? ""}`.trim().length / 4,
      0
    );
    const estimatedCostUSD = (tokens / 1_000_000) * 0.02; // $0.02 / 1M tokens
    console.log(`  Estimated tokens: ~${Math.round(tokens).toLocaleString()}`);
    console.log(`  Estimated cost: ~$${estimatedCostUSD.toFixed(4)}`);
    console.log("\n[DRY RUN] Done. No writes.");
    return;
  }

  if (rows.length === 0) {
    console.log("  Nothing to do — all keywords already have embeddings.");
    return;
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }
  const openai = new OpenAI({ apiKey: openaiKey });

  const BATCH = 100;
  const LOG_EVERY = 25;
  let embedded = 0;
  let failed = 0;
  let totalTokens = 0;

  for (const batch of chunk(rows, BATCH)) {
    const texts = batch.map(
      (kw) => `${kw.label}. ${kw.description ?? ""}`.trim()
    );

    // Rough token count for spend estimate
    totalTokens += texts.reduce((acc, t) => acc + t.length / 4, 0);

    let embeddings: number[][];
    try {
      embeddings = await embedBatch(openai, texts);
    } catch (e) {
      console.error(`  [ERROR] Embedding batch failed:`, (e as Error).message);
      failed += batch.length;
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const { error: updErr } = await supabase
        .from("math_keywords")
        .update({ embedding: embeddings[j] })
        .eq("id", batch[j]!.id);

      if (updErr) {
        console.error(`  [ERROR] Update failed for ${batch[j]!.id}: ${updErr.message}`);
        failed++;
      } else {
        embedded++;
        if (embedded % LOG_EVERY === 0) {
          console.log(`  Progress: ${embedded} embedded, ${failed} failed...`);
        }
      }
    }
  }

  const estimatedCostUSD = (totalTokens / 1_000_000) * 0.02;
  console.log("\n=== Summary ===");
  console.log(`  Keywords embedded:     ${embedded}`);
  console.log(`  Failures:              ${failed}`);
  console.log(`  Estimated tokens:      ~${Math.round(totalTokens).toLocaleString()}`);
  console.log(`  Estimated spend:       ~$${estimatedCostUSD.toFixed(4)} USD`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
