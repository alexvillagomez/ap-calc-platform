/**
 * Seeds mcat_categories and mcat_keywords from mcat-keywords.txt.
 * Run:      tsx scripts/seed-mcat-taxonomy.ts
 * Dry-run:  tsx scripts/seed-mcat-taxonomy.ts --dry-run
 *
 * mcat-keywords.txt contains TWO concatenated top-level JSON objects
 * (not valid single JSON). This script splits them at the top-level
 * boundary, parses each independently, then upserts all rows idempotently.
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config({ path: ".env.local" });

// ─── Types ────────────────────────────────────────────────────────────────────

interface UmbrellaRaw {
  id: string;
  label: string;
  description?: string;
  keywords?: InDepthRaw[];
}

interface InDepthRaw {
  id: string;
  label: string;
  description?: string;
  examples?: string[];
}

interface CategoryRaw {
  category_id: string;
  category_label: string;
  umbrellas: UmbrellaRaw[];
}

interface CatalogObject {
  catalog_id: string;
  catalog_label: string;
  categories: CategoryRaw[];
}

interface InDepthCategoryObject {
  category_id: string;
  category_label: string;
  umbrellas: UmbrellaRaw[];
  total_keywords?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Split a string containing two concatenated top-level JSON objects into two
 *  independent JSON strings.  Walks character-by-character tracking brace
 *  depth and string escape state so nested braces inside strings or arrays
 *  are handled correctly. */
function splitTwoJsonObjects(raw: string): [string, string] {
  let depth = 0;
  let inString = false;
  let escape = false;
  let firstEnd = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && firstEnd === -1) {
        firstEnd = i;
        break;
      }
    }
  }

  if (firstEnd === -1) {
    throw new Error("Could not find end of first JSON object in mcat-keywords.txt");
  }

  const first = raw.slice(0, firstEnd + 1).trim();
  const rest = raw.slice(firstEnd + 1).trim();
  return [first, rest];
}

/** Chunk an array into arrays of at most `size` elements. */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function parseMcatKeywordsFile(filePath: string): {
  categories: Array<{
    id: string;
    section: string;
    label: string;
    description: string | null;
    order_index: number;
  }>;
  umbrellaKeywords: Array<{
    id: string;
    category_id: string;
    label: string;
    description: string | null;
    tier: "umbrella";
    parent_keyword_id: null;
    examples: null;
    status: string;
    order_index: number;
  }>;
  inDepthKeywords: Array<{
    id: string;
    category_id: string;
    label: string;
    description: string | null;
    tier: "in_depth";
    parent_keyword_id: string;
    examples: string[] | null;
    status: string;
    order_index: number;
  }>;
} {
  const raw = fs.readFileSync(filePath, "utf-8");
  const [firstJson, secondJson] = splitTwoJsonObjects(raw);

  const catalog: CatalogObject = JSON.parse(firstJson);
  const inDepthCat: InDepthCategoryObject = JSON.parse(secondJson);

  // ── Categories
  const categories = catalog.categories.map((cat, idx) => ({
    id: cat.category_id,
    section: "biology",
    label: cat.category_label,
    description: null as string | null,
    order_index: idx,
  }));

  // ── Umbrella keywords (from object 1)
  const umbrellaKeywords: ReturnType<typeof parseMcatKeywordsFile>["umbrellaKeywords"] = [];
  for (const cat of catalog.categories) {
    cat.umbrellas.forEach((umb, idx) => {
      umbrellaKeywords.push({
        id: umb.id,
        category_id: cat.category_id,
        label: umb.label,
        description: umb.description ?? null,
        tier: "umbrella",
        parent_keyword_id: null,
        examples: null,
        status: "approved",
        order_index: idx,
      });
    });
  }

  // ── In-depth keywords (from object 2)
  const inDepthKeywords: ReturnType<typeof parseMcatKeywordsFile>["inDepthKeywords"] = [];
  for (const umb of inDepthCat.umbrellas) {
    if (!umb.keywords) continue;
    umb.keywords.forEach((kw, idx) => {
      inDepthKeywords.push({
        id: kw.id,
        category_id: inDepthCat.category_id,
        label: kw.label,
        description: kw.description ?? null,
        tier: "in_depth",
        parent_keyword_id: umb.id,
        examples: kw.examples ?? null,
        status: "approved",
        order_index: idx,
      });
    });
  }

  return { categories, umbrellaKeywords, inDepthKeywords };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.argv.includes("--dry-run");

  const keywordsFilePath = path.resolve(
    process.cwd(),
    "mcat-keywords.txt"
  );

  if (!fs.existsSync(keywordsFilePath)) {
    console.error(`File not found: ${keywordsFilePath}`);
    process.exit(1);
  }

  console.log(`Parsing ${keywordsFilePath}...`);
  const { categories, umbrellaKeywords, inDepthKeywords } =
    parseMcatKeywordsFile(keywordsFilePath);

  // ── Duplicate-id detection across the full keyword set
  const allKeywords = [...umbrellaKeywords, ...inDepthKeywords];
  const seenIds = new Map<string, number>(); // id -> first seen index
  const duplicateIds: string[] = [];
  for (const kw of allKeywords) {
    if (seenIds.has(kw.id)) {
      duplicateIds.push(kw.id);
    } else {
      seenIds.set(kw.id, 1);
    }
  }
  if (duplicateIds.length > 0) {
    console.warn(`WARNING: Duplicate keyword ids detected (first wins):`, duplicateIds);
  }

  // De-dupe: first occurrence wins
  const dedupeKeywords = <T extends { id: string }>(arr: T[]): T[] => {
    const seen = new Set<string>();
    return arr.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };
  const dedupedUmbrella = dedupeKeywords(umbrellaKeywords);
  const dedupedInDepth = dedupeKeywords(inDepthKeywords);

  console.log(`\nParsed:`);
  console.log(`  Categories:         ${categories.length}`);
  console.log(`  Umbrella keywords:  ${dedupedUmbrella.length}`);
  console.log(`  In-depth keywords:  ${dedupedInDepth.length}`);
  console.log(`  Total keywords:     ${dedupedUmbrella.length + dedupedInDepth.length}`);

  if (isDryRun) {
    console.log(`\n[DRY RUN] Skipping all database writes.`);
    console.log(`\nSummary (dry-run):`);
    console.log(`  Categories to upsert:         ${categories.length}`);
    console.log(`  Umbrella keywords to upsert:  ${dedupedUmbrella.length}`);
    console.log(`  In-depth keywords to upsert:  ${dedupedInDepth.length}`);
    return;
  }

  // ── Supabase client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const BATCH = 100;

  // 1. Upsert categories
  console.log(`\nUpserting ${categories.length} categories...`);
  for (const batch of chunk(categories, BATCH)) {
    const { error } = await supabase
      .from("mcat_categories")
      .upsert(batch, { onConflict: "id" });
    if (error) {
      console.error("mcat_categories upsert error:", error.message);
      process.exit(1);
    }
  }
  console.log(`  ✓ ${categories.length} categories upserted`);

  // 2. Upsert umbrella keywords (parent_keyword_id is null so no ordering dependency)
  console.log(`\nUpserting ${dedupedUmbrella.length} umbrella keywords...`);
  for (const batch of chunk(dedupedUmbrella, BATCH)) {
    const { error } = await supabase
      .from("mcat_keywords")
      .upsert(batch, { onConflict: "id" });
    if (error) {
      console.error("mcat_keywords (umbrella) upsert error:", error.message);
      process.exit(1);
    }
  }
  console.log(`  ✓ ${dedupedUmbrella.length} umbrella keywords upserted`);

  // 3. Upsert in-depth keywords (after umbrellas so FK parent_keyword_id resolves)
  console.log(`\nUpserting ${dedupedInDepth.length} in-depth keywords...`);
  for (const batch of chunk(dedupedInDepth, BATCH)) {
    const { error } = await supabase
      .from("mcat_keywords")
      .upsert(batch, { onConflict: "id" });
    if (error) {
      console.error("mcat_keywords (in_depth) upsert error:", error.message);
      process.exit(1);
    }
  }
  console.log(`  ✓ ${dedupedInDepth.length} in-depth keywords upserted`);

  // ── Summary
  console.log(`\nDone.`);
  console.log(`  Categories upserted:         ${categories.length}`);
  console.log(`  Umbrella keywords upserted:  ${dedupedUmbrella.length}`);
  console.log(`  In-depth keywords upserted:  ${dedupedInDepth.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
