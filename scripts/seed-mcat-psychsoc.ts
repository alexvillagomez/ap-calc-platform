/**
 * Seeds the MCAT Psych/Soc (section = 'psych_soc') taxonomy into mcat_categories
 * and mcat_keywords from content/mcat-psychsoc-taxonomy/<CODE>.json.
 *
 * Run:      tsx scripts/seed-mcat-psychsoc.ts
 * Dry-run:  tsx scripts/seed-mcat-psychsoc.ts --dry-run
 *
 * Idempotent: upserts on primary key (id). Categories first, then umbrella
 * keywords, then intro + in_depth children (so the self-referential
 * parent_keyword_id always resolves).
 *
 * IDs:
 *   category  = mcat_psychsoc_<code>_<slug>   (e.g. mcat_psychsoc_6a_sensing_the_environment)
 *   keyword   = ps_<code>_<slug>              (e.g. ps_6a_absolute_threshold)  ← namespaced to
 *               guarantee zero collision with the existing Biology keyword ids.
 * order_index: umbrellas 0..n in file order; intro = -1 (sorts first); in_depth 0..n.
 * Inserts status='approved' (the app filters status='approved'); yield/blueprint/
 * embedding left null — filled by `npm run mcat:embed` + `npm run mcat:blueprints`.
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { createServiceClient } from "./lib/serviceClient";

dotenv.config({ path: ".env.local" });

const DRY = process.argv.includes("--dry-run");
const DIR = path.join(__dirname, "..", "content", "mcat-psychsoc-taxonomy");
const SECTION = "psych_soc";

// code -> { id, label, order }
const CATEGORIES: Array<{ code: string; id: string; label: string }> = [
  { code: "6A", id: "mcat_psychsoc_6a_sensing_the_environment", label: "6A · Sensing the Environment" },
  { code: "6B", id: "mcat_psychsoc_6b_making_sense_of_the_environment", label: "6B · Making Sense of the Environment" },
  { code: "6C", id: "mcat_psychsoc_6c_responding_to_the_world", label: "6C · Responding to the World" },
  { code: "7A", id: "mcat_psychsoc_7a_individual_influences_on_behavior", label: "7A · Individual Influences on Behavior" },
  { code: "7B", id: "mcat_psychsoc_7b_social_processes_and_behavior", label: "7B · Social Processes That Influence Behavior" },
  { code: "7C", id: "mcat_psychsoc_7c_attitude_and_behavior_change", label: "7C · Attitude and Behavior Change" },
  { code: "8A", id: "mcat_psychsoc_8a_self_identity", label: "8A · Self-Identity" },
  { code: "8B", id: "mcat_psychsoc_8b_social_thinking", label: "8B · Social Thinking" },
  { code: "8C", id: "mcat_psychsoc_8c_social_interactions", label: "8C · Social Interactions" },
  { code: "9A", id: "mcat_psychsoc_9a_understanding_social_structure", label: "9A · Understanding Social Structure" },
  { code: "9B", id: "mcat_psychsoc_9b_demographic_characteristics", label: "9B · Demographic Characteristics and Processes" },
  { code: "10A", id: "mcat_psychsoc_10a_social_inequality", label: "10A · Social Inequality" },
];

interface KwNode { slug: string; label: string; description: string; examples?: string[] }
interface Umbrella extends KwNode { intro: KwNode; in_depth: KwNode[] }
interface Tree { category_code: string; umbrellas: Umbrella[] }

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

function kwId(code: string, slug: string): string {
  return `ps_${code.toLowerCase()}_${slug}`;
}

async function main() {
  const categoryRows = CATEGORIES.map((c, i) => ({
    id: c.id,
    section: SECTION,
    label: c.label,
    description: null as string | null,
    order_index: i,
  }));

  const umbrellaRows: KeywordRow[] = [];
  const childRows: KeywordRow[] = [];
  const seenIds = new Set<string>();

  for (const cat of CATEGORIES) {
    const file = path.join(DIR, `${cat.code}.json`);
    const tree = JSON.parse(fs.readFileSync(file, "utf8")) as Tree;
    if (tree.category_code !== cat.code) throw new Error(`${cat.code}.json category_code mismatch: ${tree.category_code}`);

    tree.umbrellas.forEach((u, ui) => {
      const umbId = kwId(cat.code, u.slug);
      if (seenIds.has(umbId)) throw new Error(`Duplicate keyword id ${umbId}`);
      seenIds.add(umbId);
      umbrellaRows.push({
        id: umbId,
        category_id: cat.id,
        label: u.label,
        description: u.description,
        tier: "umbrella",
        parent_keyword_id: null,
        examples: u.examples && u.examples.length ? u.examples : null,
        status: "approved",
        order_index: ui,
      });

      const pushChild = (n: KwNode, order: number) => {
        const id = kwId(cat.code, n.slug);
        if (seenIds.has(id)) throw new Error(`Duplicate keyword id ${id}`);
        seenIds.add(id);
        childRows.push({
          id,
          category_id: cat.id,
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
  console.log(`Umbrella keywords: ${umbrellaRows.length}`);
  console.log(`Child (intro+in_depth) keywords: ${childRows.length}`);
  console.log(`TOTAL keyword rows: ${umbrellaRows.length + childRows.length}`);

  if (DRY) {
    console.log("\n--dry-run: no writes. Sample category:", categoryRows[0]);
    console.log("Sample umbrella:", umbrellaRows[0]);
    console.log("Sample child:", childRows[0]);
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
