/**
 * Recomputes UMBRELLA keyword embeddings as the CENTROID (mean) of their in_depth
 * children's embeddings, for math_keywords and mcat_keywords.
 *
 * Umbrellas are containers — they should NOT be independently grounded. An
 * umbrella's embedding = the average of its child subtopic embeddings, so it
 * faithfully represents "everything under this topic" for pgvector retrieval
 * (search, bestKeyword pinpointing, practice-queue umbrella scoring).
 *
 * Writes BOTH columns:
 *   - embedding      (jsonb number[1536])  — used by JS cosine fallbacks
 *   - embedding_vec  (pgvector)            — used by the HNSW match_* RPCs
 * If embedding_vec doesn't exist on a table, that update is skipped gracefully.
 *
 * Children with no embedding are skipped; an umbrella with zero embedded children
 * is left unchanged (logged).
 *
 * Pairs with embed-math.ts / embed-mcat.ts, which now only independently embed
 * in_depth keywords — umbrellas are always centroids of their subtopics.
 *
 * Flags:
 *   --dry-run            count work, no DB writes
 *   --system math|mcat   restrict to one system (default: both)
 *
 * npm:  npm run umbrella:centroids -- [--system math] [--dry-run]
 *
 * Env: loads root .env.local first (service-role key). No OpenAI needed.
 */

import { type SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./lib/serviceClient";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const argv = process.argv.slice(2);
const isDryRun = argv.includes("--dry-run");
function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
const systemFilter = flagValue("--system");

const WRITE_SLEEP_MS = 60;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface KSystem {
  label: "math" | "mcat";
  table: string;
}
const SYSTEMS: KSystem[] = [
  { label: "math", table: "math_keywords" },
  { label: "mcat", table: "mcat_keywords" },
];

interface KwRow {
  id: string;
  tier: string;
  parent_keyword_id: string | null;
  embedding: number[] | null;
}

async function fetchAll(supabase: SupabaseClient, table: string): Promise<KwRow[]> {
  const PAGE = 1000;
  let rows: KwRow[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("id, tier, parent_keyword_id, embedding")
      .order("id")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) { console.error(`Fetch error (${table}):`, error.message); process.exit(1); }
    const batch = (data ?? []).map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: String(rec.id),
        tier: String(rec.tier ?? ""),
        parent_keyword_id: (rec.parent_keyword_id as string | null) ?? null,
        embedding: Array.isArray(rec.embedding) ? (rec.embedding as number[]) : null,
      };
    });
    rows = rows.concat(batch);
    if (batch.length < PAGE) break;
    page++;
  }
  return rows;
}

function centroid(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0]!.length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) sum[i] += v[i]!;
  }
  return sum.map((s) => s / vectors.length);
}

async function processSystem(supabase: SupabaseClient, sys: KSystem): Promise<{ updated: number; skipped: number }> {
  console.log(`\n── ${sys.label} (${sys.table}) ──`);
  const rows = await fetchAll(supabase, sys.table);
  const umbrellas = rows.filter((r) => r.tier === "umbrella");
  const inDepth = rows.filter((r) => r.tier === "in_depth");

  // Group children embeddings by parent umbrella id.
  const childrenByParent = new Map<string, number[][]>();
  for (const c of inDepth) {
    if (!c.parent_keyword_id || !c.embedding || c.embedding.length === 0) continue;
    const list = childrenByParent.get(c.parent_keyword_id) ?? [];
    list.push(c.embedding);
    childrenByParent.set(c.parent_keyword_id, list);
  }

  console.log(`  Umbrellas: ${umbrellas.length}, in_depth (embedded): ${inDepth.filter((c) => c.embedding).length}`);

  let updated = 0, skipped = 0, vecSupported = true;
  for (const u of umbrellas) {
    const childVecs = childrenByParent.get(u.id) ?? [];
    const c = centroid(childVecs);
    if (!c) { skipped++; continue; }
    if (isDryRun) { updated++; continue; }

    const payload: Record<string, unknown> = { embedding: c };
    if (vecSupported) payload.embedding_vec = `[${c.join(",")}]`;

    let { error } = await supabase.from(sys.table).update(payload).eq("id", u.id);
    if (error && /embedding_vec/.test(error.message)) {
      // Column not present — retry with jsonb embedding only, and stop trying vec.
      vecSupported = false;
      ({ error } = await supabase.from(sys.table).update({ embedding: c }).eq("id", u.id));
    }
    if (error) { console.error(`  [ERROR] update ${u.id}: ${error.message}`); skipped++; }
    else { updated++; if (updated % 25 === 0) console.log(`  Progress: ${updated} centroids written...`); }
    await sleep(WRITE_SLEEP_MS);
  }
  console.log(`  ${sys.label} done: ${updated} centroids${isDryRun ? " (dry)" : ""}, ${skipped} skipped (no embedded children).`);
  return { updated, skipped };
}

async function main() {
  console.log("=== recompute-umbrella-embeddings ===");
  if (isDryRun) console.log("[DRY RUN] No DB writes.");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }
  const supabase = createServiceClient(supabaseUrl, serviceKey);

  const systems = systemFilter ? SYSTEMS.filter((s) => s.label === systemFilter) : SYSTEMS;
  if (systems.length === 0) { console.error(`Unknown --system "${systemFilter}". Use math|mcat.`); process.exit(1); }

  let totalUpdated = 0, totalSkipped = 0;
  for (const sys of systems) {
    const { updated, skipped } = await processSystem(supabase, sys);
    totalUpdated += updated; totalSkipped += skipped;
  }
  console.log(`\n=== Summary ===\n  Centroids ${isDryRun ? "to write" : "written"}: ${totalUpdated}\n  Skipped: ${totalSkipped}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
