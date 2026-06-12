/**
 * Seeds math_categories, math_course_categories, math_keywords, and math_prereq_edges
 * from content/math-taxonomy/*.json and content/math-taxonomy/_prereq_edges.json.
 *
 * Validates taxonomy files first (reusing validate-math-taxonomy logic).
 * Upserts are idempotent: on conflict update labels/descriptions/yields — never delete.
 * Operation order: categories → course memberships → umbrella keywords → in_depth keywords.
 *
 * Usage:
 *   tsx scripts/seed-math-taxonomy.ts            (live run)
 *   tsx scripts/seed-math-taxonomy.ts --dry-run  (print counts, no DB writes)
 *
 * npm:   npm run math:seed
 *
 * Env keys: loaded from .env.local (root); the valid SUPABASE keys live there.
 * The OPENAI key is NOT needed by this script.
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ─── Types ────────────────────────────────────────────────────────────────────

interface CourseEntry {
  course: string;
  role: string;
  order_index?: number;
}

interface CategorySpec {
  id: string;
  label: string;
  description?: string;
  section: string;
  ced_unit?: string;
  courses: CourseEntry[];
  yield_score?: number;
  yield_rationale?: string;
}

interface InDepthSpec {
  id: string;
  label: string;
  description?: string;
  yield_score?: number;
  yield_rationale?: string;
  source_learn_keyword_id?: string | null;
}

interface UmbrellaSpec {
  id: string;
  label: string;
  description?: string;
  ced_topics?: string[];
  yield_score?: number;
  yield_rationale?: string;
  source_learn_keyword_id?: string | null;
  in_depth: InDepthSpec[];
}

interface TaxonomyFile {
  category: CategorySpec;
  umbrellas: UmbrellaSpec[];
}

interface PrereqEdge {
  from_category_id: string;
  to_category_id: string;
  strength: number;
  note?: string;
}

// ─── Validation (inline subset — full version in validate-math-taxonomy.ts) ──

type ErrLevel = "ERROR" | "WARN";
interface Diag {
  level: ErrLevel;
  file: string;
  msg: string;
}

function inRange(n: unknown): boolean {
  return typeof n === "number" && n >= 0 && n <= 1;
}

const VALID_COURSES = new Set(["precalc", "calc_ab"]);
const VALID_ROLES = new Set(["core", "foundation"]);
const VALID_SECTIONS = new Set(["foundations", "ap_precalc", "calc_ab"]);

function validateFile(
  filePath: string,
  globalKeywordIds: Map<string, string>,
  globalCategoryIds: Set<string>,
  diags: Diag[]
): void {
  const rel = path.relative(process.cwd(), filePath);
  let data: Partial<TaxonomyFile>;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<TaxonomyFile>;
  } catch (e) {
    diags.push({ level: "ERROR", file: rel, msg: `JSON parse error: ${(e as Error).message}` });
    return;
  }

  if (!data.category) {
    diags.push({ level: "ERROR", file: rel, msg: "Missing 'category' field" });
    return;
  }
  const cat = data.category;

  for (const f of ["id", "label", "section", "courses"] as const) {
    if (!cat[f]) diags.push({ level: "ERROR", file: rel, msg: `category.${f} missing` });
  }

  if (cat.id) {
    if (globalCategoryIds.has(cat.id)) {
      diags.push({ level: "ERROR", file: rel, msg: `Duplicate category id: ${cat.id}` });
    } else {
      globalCategoryIds.add(cat.id);
    }
  }

  if (cat.section && !VALID_SECTIONS.has(cat.section)) {
    diags.push({ level: "ERROR", file: rel, msg: `category.section '${cat.section}' invalid` });
  }
  if (Array.isArray(cat.courses)) {
    for (const c of cat.courses) {
      if (!VALID_COURSES.has(c.course))
        diags.push({ level: "ERROR", file: rel, msg: `courses[].course '${c.course}' invalid` });
      if (!VALID_ROLES.has(c.role))
        diags.push({ level: "ERROR", file: rel, msg: `courses[].role '${c.role}' invalid` });
    }
  }
  if (cat.yield_score !== undefined && !inRange(cat.yield_score)) {
    diags.push({ level: "ERROR", file: rel, msg: `category.yield_score ${cat.yield_score} out of [0,1]` });
  }

  if (!Array.isArray(data.umbrellas)) {
    diags.push({ level: "ERROR", file: rel, msg: "'umbrellas' must be an array" });
    return;
  }

  for (let ui = 0; ui < data.umbrellas.length; ui++) {
    const umb = data.umbrellas[ui];
    const umbCtx = `umbrellas[${ui}](${umb.id ?? "?"})`;

    for (const f of ["id", "label"] as const) {
      if (!umb[f]) diags.push({ level: "ERROR", file: rel, msg: `${umbCtx}.${f} missing` });
    }
    if (umb.id) {
      if (globalKeywordIds.has(umb.id)) {
        diags.push({ level: "ERROR", file: rel, msg: `Duplicate keyword id '${umb.id}' (first in ${globalKeywordIds.get(umb.id)})` });
      } else {
        globalKeywordIds.set(umb.id, rel);
      }
    }
    if (umb.yield_score !== undefined && !inRange(umb.yield_score)) {
      diags.push({ level: "ERROR", file: rel, msg: `${umbCtx}.yield_score out of [0,1]` });
    }

    if (!Array.isArray(umb.in_depth)) {
      diags.push({ level: "ERROR", file: rel, msg: `${umbCtx}: in_depth must be an array` });
      continue;
    }
    if (umb.in_depth.length === 0) {
      diags.push({ level: "ERROR", file: rel, msg: `${umbCtx}: in_depth count is 0` });
    } else if (umb.in_depth.length < 4) {
      diags.push({ level: "WARN", file: rel, msg: `${umbCtx}: in_depth count ${umb.in_depth.length} < 4` });
    } else if (umb.in_depth.length > 8) {
      diags.push({ level: "WARN", file: rel, msg: `${umbCtx}: in_depth count ${umb.in_depth.length} > 8` });
    }

    for (let di = 0; di < umb.in_depth.length; di++) {
      const kw = umb.in_depth[di];
      const kwCtx = `${umbCtx}.in_depth[${di}](${kw.id ?? "?"})`;
      for (const f of ["id", "label"] as const) {
        if (!kw[f]) diags.push({ level: "ERROR", file: rel, msg: `${kwCtx}.${f} missing` });
      }
      if (kw.id) {
        if (globalKeywordIds.has(kw.id)) {
          diags.push({ level: "ERROR", file: rel, msg: `Duplicate keyword id '${kw.id}' (first in ${globalKeywordIds.get(kw.id)})` });
        } else {
          globalKeywordIds.set(kw.id, rel);
        }
      }
      if (kw.yield_score !== undefined && !inRange(kw.yield_score)) {
        diags.push({ level: "ERROR", file: rel, msg: `${kwCtx}.yield_score out of [0,1]` });
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Loading / parsing ────────────────────────────────────────────────────────

function loadFiles(taxonomyDir: string): { files: string[]; parsed: TaxonomyFile[] } {
  if (!fs.existsSync(taxonomyDir)) return { files: [], parsed: [] };

  const files = fs
    .readdirSync(taxonomyDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => path.join(taxonomyDir, f));

  const parsed: TaxonomyFile[] = [];
  for (const f of files) {
    parsed.push(JSON.parse(fs.readFileSync(f, "utf-8")) as TaxonomyFile);
  }
  return { files, parsed };
}

function loadPrereqEdges(taxonomyDir: string): PrereqEdge[] {
  const edgesPath = path.join(taxonomyDir, "_prereq_edges.json");
  if (!fs.existsSync(edgesPath)) return [];
  const raw = JSON.parse(fs.readFileSync(edgesPath, "utf-8")) as { edges: PrereqEdge[] };
  return raw.edges ?? [];
}

// ─── Build DB row arrays ───────────────────────────────────────────────────────

function buildRows(parsed: TaxonomyFile[]): {
  categories: object[];
  courseCategories: object[];
  umbrellas: object[];
  inDepths: object[];
} {
  const categories: object[] = [];
  const courseCategories: object[] = [];
  const umbrellas: object[] = [];
  const inDepths: object[] = [];

  for (const tf of parsed) {
    const cat = tf.category;

    categories.push({
      id: cat.id,
      label: cat.label,
      description: cat.description ?? null,
      section: cat.section,
      ced_unit: cat.ced_unit ?? null,
      yield_score: cat.yield_score ?? null,
      yield_rationale: cat.yield_rationale ?? null,
    });

    for (const ce of cat.courses) {
      courseCategories.push({
        course: ce.course,
        category_id: cat.id,
        role: ce.role,
        order_index: ce.order_index ?? 0,
      });
    }

    for (let ui = 0; ui < tf.umbrellas.length; ui++) {
      const umb = tf.umbrellas[ui];
      umbrellas.push({
        id: umb.id,
        category_id: cat.id,
        parent_keyword_id: null,
        tier: "umbrella",
        label: umb.label,
        description: umb.description ?? null,
        ced_topics: umb.ced_topics ? JSON.stringify(umb.ced_topics) : null,
        yield_score: umb.yield_score ?? null,
        yield_rationale: umb.yield_rationale ?? null,
        source_learn_keyword_id: umb.source_learn_keyword_id ?? null,
        order_index: ui,
        status: "approved",
      });

      for (let di = 0; di < umb.in_depth.length; di++) {
        const kw = umb.in_depth[di];
        inDepths.push({
          id: kw.id,
          category_id: cat.id,
          parent_keyword_id: umb.id,
          tier: "in_depth",
          label: kw.label,
          description: kw.description ?? null,
          ced_topics: null,
          yield_score: kw.yield_score ?? null,
          yield_rationale: kw.yield_rationale ?? null,
          source_learn_keyword_id: kw.source_learn_keyword_id ?? null,
          order_index: di,
          status: "approved",
        });
      }
    }
  }

  return { categories, courseCategories, umbrellas, inDepths };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const taxonomyDir = path.resolve(__dirname, "../content/math-taxonomy");

  const { files, parsed } = loadFiles(taxonomyDir);

  if (files.length === 0) {
    console.log("No taxonomy files found in content/math-taxonomy/ — nothing to seed.");
    process.exit(0);
  }

  console.log(`Found ${files.length} taxonomy file(s). Running validation...`);

  // ── Validate first
  const diags: Diag[] = [];
  const globalKeywordIds = new Map<string, string>();
  const globalCategoryIds = new Set<string>();
  for (const f of files) {
    validateFile(f, globalKeywordIds, globalCategoryIds, diags);
  }

  const errors = diags.filter((d) => d.level === "ERROR");
  const warnings = diags.filter((d) => d.level === "WARN");

  if (warnings.length) {
    console.log(`\n  Warnings (${warnings.length}):`);
    for (const w of warnings) console.log(`    [WARN] ${w.file}: ${w.msg}`);
  }
  if (errors.length) {
    console.log(`\n  Errors (${errors.length}):`);
    for (const e of errors) console.log(`    [ERROR] ${e.file}: ${e.msg}`);
    console.log(`\nValidation failed — aborting seed.`);
    process.exit(1);
  }
  console.log(`  Validation passed: 0 errors, ${warnings.length} warning(s).`);

  // ── Build rows
  const { categories, courseCategories, umbrellas, inDepths } = buildRows(parsed);
  const prereqEdges = loadPrereqEdges(taxonomyDir);

  console.log(`\nRows to upsert:`);
  console.log(`  math_categories:        ${categories.length}`);
  console.log(`  math_course_categories: ${courseCategories.length}`);
  console.log(`  math_keywords (umbrella): ${umbrellas.length}`);
  console.log(`  math_keywords (in_depth): ${inDepths.length}`);
  console.log(`  math_prereq_edges:        ${prereqEdges.length}`);

  if (isDryRun) {
    console.log(`\n[DRY RUN] Skipping all database writes.`);
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
      .from("math_categories")
      .upsert(batch, { onConflict: "id" });
    if (error) { console.error("math_categories upsert error:", error.message); process.exit(1); }
  }
  console.log(`  ✓ ${categories.length} math_categories`);

  // 2. Upsert course memberships
  console.log(`\nUpserting ${courseCategories.length} course memberships...`);
  for (const batch of chunk(courseCategories, BATCH)) {
    const { error } = await supabase
      .from("math_course_categories")
      .upsert(batch, { onConflict: "course,category_id" });
    if (error) { console.error("math_course_categories upsert error:", error.message); process.exit(1); }
  }
  console.log(`  ✓ ${courseCategories.length} math_course_categories`);

  // 3. Upsert umbrella keywords (no FK parent dependency)
  console.log(`\nUpserting ${umbrellas.length} umbrella keywords...`);
  for (const batch of chunk(umbrellas, BATCH)) {
    const { error } = await supabase
      .from("math_keywords")
      .upsert(batch, { onConflict: "id" });
    if (error) { console.error("math_keywords (umbrella) upsert error:", error.message); process.exit(1); }
  }
  console.log(`  ✓ ${umbrellas.length} umbrella keywords`);

  // 4. Upsert in_depth keywords (after umbrellas so FK resolves)
  console.log(`\nUpserting ${inDepths.length} in_depth keywords...`);
  for (const batch of chunk(inDepths, BATCH)) {
    const { error } = await supabase
      .from("math_keywords")
      .upsert(batch, { onConflict: "id" });
    if (error) { console.error("math_keywords (in_depth) upsert error:", error.message); process.exit(1); }
  }
  console.log(`  ✓ ${inDepths.length} in_depth keywords`);

  // 5. Upsert prereq edges
  if (prereqEdges.length > 0) {
    console.log(`\nUpserting ${prereqEdges.length} prereq edges...`);
    for (const batch of chunk(prereqEdges, BATCH)) {
      const { error } = await supabase
        .from("math_prereq_edges")
        .upsert(batch, { onConflict: "from_category_id,to_category_id" });
      if (error) { console.error("math_prereq_edges upsert error:", error.message); process.exit(1); }
    }
    console.log(`  ✓ ${prereqEdges.length} math_prereq_edges`);
  }

  console.log(`\nDone.`);
  console.log(`  math_categories:          ${categories.length}`);
  console.log(`  math_course_categories:   ${courseCategories.length}`);
  console.log(`  math_keywords (umbrella): ${umbrellas.length}`);
  console.log(`  math_keywords (in_depth): ${inDepths.length}`);
  console.log(`  math_prereq_edges:        ${prereqEdges.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
