/**
 * Seeds the MCAT Chemistry + Physics taxonomy (TWO sections: section='physics'
 * and section='chemistry') into mcat_categories and mcat_keywords from
 * content/mcat-chemphys-taxonomy/<CODE>.json.
 *
 * Run:      tsx scripts/seed-mcat-chemphys.ts
 * Dry-run:  tsx scripts/seed-mcat-chemphys.ts --dry-run
 *
 * Unlike seed-mcat-psychsoc.ts, the category metadata (section, category_code,
 * category_label, order_index) is read from each JSON file's HEADER — there is no
 * hardcoded category list. The 24 files are P1..P11 (physics) and C1..C13 (chemistry).
 *
 * Idempotent: upserts on primary key (id). Categories first, then umbrella
 * keywords, then intro + in_depth children (self-referential parent_keyword_id).
 *
 * IDs:
 *   category  = mcat_<section>_<code>_<slug(category_label)>
 *               e.g. mcat_physics_p1_kinematics_translational_motion
 *                    mcat_chemistry_c6_acids_bases
 *   keyword   = <prefix>_<code>_<slug>   (prefix: physics→ph, chemistry→ch)
 *               e.g. ph_p1_average_velocity, ch_c6_bronsted_lowry_definition
 * order_index: umbrellas 0..n in file order; intro = -1 (sorts first); in_depth 0..n.
 *              The CATEGORY order_index comes from the JSON header (per-section 0..n).
 * Inserts status='approved'; yield/blueprint/embedding left null — filled by the pipeline.
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { createServiceClient } from "./lib/serviceClient";

dotenv.config({ path: ".env.local" });

const DRY = process.argv.includes("--dry-run");
const DIR = path.join(__dirname, "..", "content", "mcat-chemphys-taxonomy");

const CODES = [
  "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13",
];

const SECTION_PREFIX: Record<string, string> = { physics: "ph", chemistry: "ch" };

interface KwNode { slug: string; label: string; description: string; examples?: string[] }
interface Umbrella extends KwNode { intro: KwNode; in_depth: KwNode[] }
interface Tree {
  section: string;
  category_code: string;
  category_label: string;
  order_index: number;
  umbrellas: Umbrella[];
}

type CategoryRow = {
  id: string;
  section: string;
  label: string;
  description: string | null;
  order_index: number;
};

type KeywordRow = {
  id: string;
  category_id: string;
  label: string;
  description: string;
  tier: "umbrella" | "in_depth";
  parent_keyword_id: string | null;
  examples: string[] | null;
  status: string;
  order_index: number;
};

/** Slugify a category label → snake_case ascii (for the category id). */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function kwId(prefix: string, code: string, slug: string): string {
  return `${prefix}_${code.toLowerCase()}_${slug}`;
}

async function main() {
  const categoryRows: CategoryRow[] = [];
  const umbrellaRows: KeywordRow[] = [];
  const childRows: KeywordRow[] = [];
  const seenKwIds = new Set<string>();
  const seenCatIds = new Set<string>();

  for (const code of CODES) {
    const file = path.join(DIR, `${code}.json`);
    const tree = JSON.parse(fs.readFileSync(file, "utf8")) as Tree;
    if (tree.category_code !== code) throw new Error(`${code}.json category_code mismatch: ${tree.category_code}`);
    const prefix = SECTION_PREFIX[tree.section];
    if (!prefix) throw new Error(`${code}.json unknown section: ${tree.section}`);

    const catId = `mcat_${tree.section}_${code.toLowerCase()}_${slugify(tree.category_label)}`;
    if (seenCatIds.has(catId)) throw new Error(`Duplicate category id ${catId}`);
    seenCatIds.add(catId);
    categoryRows.push({
      id: catId,
      section: tree.section,
      label: tree.category_label,
      description: null,
      order_index: tree.order_index,
    });

    tree.umbrellas.forEach((u, ui) => {
      const umbId = kwId(prefix, code, u.slug);
      if (seenKwIds.has(umbId)) throw new Error(`Duplicate keyword id ${umbId}`);
      seenKwIds.add(umbId);
      umbrellaRows.push({
        id: umbId,
        category_id: catId,
        label: u.label,
        description: u.description,
        tier: "umbrella",
        parent_keyword_id: null,
        examples: u.examples && u.examples.length ? u.examples : null,
        status: "approved",
        order_index: ui,
      });

      const pushChild = (n: KwNode, order: number) => {
        const id = kwId(prefix, code, n.slug);
        if (seenKwIds.has(id)) throw new Error(`Duplicate keyword id ${id}`);
        seenKwIds.add(id);
        childRows.push({
          id,
          category_id: catId,
          label: n.label,
          description: n.description,
          tier: "in_depth",
          parent_keyword_id: umbId,
          examples: n.examples && n.examples.length ? n.examples : null,
          status: "approved",
          order_index: order,
        });
      };

      pushChild(u.intro, -1);
      u.in_depth.forEach((d, di) => pushChild(d, di));
    });
  }

  console.log(`Categories: ${categoryRows.length}`);
  console.log(`  physics:   ${categoryRows.filter((c) => c.section === "physics").length}`);
  console.log(`  chemistry: ${categoryRows.filter((c) => c.section === "chemistry").length}`);
  console.log(`Umbrella keywords: ${umbrellaRows.length}`);
  console.log(`Child (intro+in_depth) keywords: ${childRows.length}`);
  console.log(`TOTAL keyword rows: ${umbrellaRows.length + childRows.length}`);

  if (DRY) {
    console.log("\n--dry-run: no writes.");
    console.log("Sample category:", categoryRows[0]);
    console.log("Sample umbrella:", umbrellaRows[0]);
    console.log("Sample child:", childRows.find((c) => c.order_index === -1));
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const supabase = createServiceClient(url, key);

  // 1. Categories
  {
    const { error } = await supabase.from("mcat_categories").upsert(categoryRows, { onConflict: "id" });
    if (error) throw new Error(`categories upsert: ${error.message}`);
    console.log(`✅ upserted ${categoryRows.length} categories`);
  }

  // 2. Umbrellas (before children — parent_keyword_id self-FK)
  await upsertKeywords(supabase, umbrellaRows, "umbrellas");
  // 3. Intro + in_depth children
  await upsertKeywords(supabase, childRows, "children");

  console.log("\n✅ Seed complete.");
}

async function upsertKeywords(
  supabase: ReturnType<typeof createServiceClient>,
  rows: KeywordRow[],
  label: string
) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("mcat_keywords").upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`${label} upsert [${i}..${i + batch.length}]: ${error.message}`);
    console.log(`  ✅ ${label}: ${i + batch.length}/${rows.length}`);
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
