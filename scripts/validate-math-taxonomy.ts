/**
 * Validates every content/math-taxonomy/<category_id>.json against the design spec format.
 *
 * Checks:
 *  - Required fields on category, umbrellas, and in_depth keywords
 *  - Globally unique keyword ids across ALL files
 *  - Unique category ids
 *  - yield_score in [0, 1]
 *  - tier integrity: umbrellas reference no parent; in_depth is nested under umbrellas
 *  - courses ∈ {precalc, calc_ab}
 *  - role ∈ {core, foundation}
 *  - section ∈ {foundations, ap_precalc, calc_ab}
 *  - in_depth count per umbrella: warn <4 or >8, error if 0
 *  - parent links implicit by nesting (in_depth.parent = umbrella.id)
 *
 * Exits non-zero on any errors; exits 0 on success (warnings are printed but do not fail).
 * Exits 0 cleanly if no files found.
 *
 * Usage:  tsx scripts/validate-math-taxonomy.ts
 * npm:    npm run math:validate
 */
import * as fs from "fs";
import * as path from "path";

// ─── Types matching design-spec §Taxonomy authoring format ───────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ErrorLevel = "ERROR" | "WARN";

interface Diagnostic {
  level: ErrorLevel;
  file: string;
  msg: string;
}

const VALID_COURSES = new Set(["precalc", "calc_ab"]);
const VALID_ROLES = new Set(["core", "foundation"]);
const VALID_SECTIONS = new Set(["foundations", "ap_precalc", "calc_ab"]);

function inRange(n: unknown): boolean {
  return typeof n === "number" && n >= 0 && n <= 1;
}

// ─── Per-file validation ─────────────────────────────────────────────────────

function validateFile(
  filePath: string,
  globalKeywordIds: Map<string, string>,
  globalCategoryIds: Set<string>,
  diags: Diagnostic[]
): void {
  const rel = path.relative(process.cwd(), filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    diags.push({ level: "ERROR", file: rel, msg: `JSON parse error: ${(e as Error).message}` });
    return;
  }

  const data = parsed as Partial<TaxonomyFile>;

  // ── category block
  if (!data.category) {
    diags.push({ level: "ERROR", file: rel, msg: "Missing top-level 'category' field" });
    return;
  }
  const cat = data.category;

  const reqCatFields: Array<keyof CategorySpec> = ["id", "label", "section", "courses"];
  for (const f of reqCatFields) {
    if (!cat[f]) {
      diags.push({ level: "ERROR", file: rel, msg: `category.${f} is missing or empty` });
    }
  }

  if (cat.id) {
    if (globalCategoryIds.has(cat.id)) {
      diags.push({ level: "ERROR", file: rel, msg: `Duplicate category id: ${cat.id}` });
    } else {
      globalCategoryIds.add(cat.id);
    }
  }

  if (cat.section && !VALID_SECTIONS.has(cat.section)) {
    diags.push({ level: "ERROR", file: rel, msg: `category.section '${cat.section}' invalid; must be one of: ${[...VALID_SECTIONS].join(", ")}` });
  }

  if (cat.courses) {
    if (!Array.isArray(cat.courses) || cat.courses.length === 0) {
      diags.push({ level: "ERROR", file: rel, msg: "category.courses must be a non-empty array" });
    } else {
      for (const c of cat.courses) {
        if (!VALID_COURSES.has(c.course)) {
          diags.push({ level: "ERROR", file: rel, msg: `category.courses[].course '${c.course}' invalid; must be precalc or calc_ab` });
        }
        if (!VALID_ROLES.has(c.role)) {
          diags.push({ level: "ERROR", file: rel, msg: `category.courses[].role '${c.role}' invalid; must be core or foundation` });
        }
      }
    }
  }

  if (cat.yield_score !== undefined && !inRange(cat.yield_score)) {
    diags.push({ level: "ERROR", file: rel, msg: `category.yield_score ${cat.yield_score} out of [0,1]` });
  }

  // ── umbrellas
  if (!data.umbrellas) {
    diags.push({ level: "ERROR", file: rel, msg: "Missing top-level 'umbrellas' field" });
    return;
  }
  if (!Array.isArray(data.umbrellas)) {
    diags.push({ level: "ERROR", file: rel, msg: "'umbrellas' must be an array" });
    return;
  }

  for (let ui = 0; ui < data.umbrellas.length; ui++) {
    const umb = data.umbrellas[ui];
    const umbCtx = `umbrellas[${ui}] (id=${umb.id ?? "?"})`;

    const reqUmbFields: Array<keyof UmbrellaSpec> = ["id", "label"];
    for (const f of reqUmbFields) {
      if (!umb[f]) {
        diags.push({ level: "ERROR", file: rel, msg: `${umbCtx}.${f} missing or empty` });
      }
    }

    if (umb.id) {
      if (globalKeywordIds.has(umb.id)) {
        diags.push({ level: "ERROR", file: rel, msg: `Duplicate keyword id '${umb.id}' (first seen in ${globalKeywordIds.get(umb.id)})` });
      } else {
        globalKeywordIds.set(umb.id, rel);
      }
    }

    if (umb.yield_score !== undefined && !inRange(umb.yield_score)) {
      diags.push({ level: "ERROR", file: rel, msg: `${umbCtx}.yield_score ${umb.yield_score} out of [0,1]` });
    }

    // ── in_depth
    if (!umb.in_depth || !Array.isArray(umb.in_depth)) {
      diags.push({ level: "ERROR", file: rel, msg: `${umbCtx}: 'in_depth' must be an array` });
      continue;
    }

    const inDepthCount = umb.in_depth.length;
    if (inDepthCount === 0) {
      diags.push({ level: "ERROR", file: rel, msg: `${umbCtx}: in_depth count is 0 — at least 1 required` });
    } else if (inDepthCount < 4) {
      diags.push({ level: "WARN", file: rel, msg: `${umbCtx}: in_depth count ${inDepthCount} < 4 (spec recommends 4–8)` });
    } else if (inDepthCount > 8) {
      diags.push({ level: "WARN", file: rel, msg: `${umbCtx}: in_depth count ${inDepthCount} > 8 (spec recommends 4–8)` });
    }

    for (let di = 0; di < umb.in_depth.length; di++) {
      const kw = umb.in_depth[di];
      const kwCtx = `${umbCtx}.in_depth[${di}] (id=${kw.id ?? "?"})`;

      const reqKwFields: Array<keyof InDepthSpec> = ["id", "label"];
      for (const f of reqKwFields) {
        if (!kw[f]) {
          diags.push({ level: "ERROR", file: rel, msg: `${kwCtx}.${f} missing or empty` });
        }
      }

      if (kw.id) {
        if (globalKeywordIds.has(kw.id)) {
          diags.push({ level: "ERROR", file: rel, msg: `Duplicate keyword id '${kw.id}' (first seen in ${globalKeywordIds.get(kw.id)})` });
        } else {
          globalKeywordIds.set(kw.id, rel);
        }
      }

      if (kw.yield_score !== undefined && !inRange(kw.yield_score)) {
        diags.push({ level: "ERROR", file: rel, msg: `${kwCtx}.yield_score ${kw.yield_score} out of [0,1]` });
      }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const taxonomyDir = path.resolve(process.cwd(), "content/math-taxonomy");

  if (!fs.existsSync(taxonomyDir)) {
    console.log("No content/math-taxonomy directory found — nothing to validate.");
    process.exit(0);
  }

  const files: string[] = fs
    .readdirSync(taxonomyDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => path.join(taxonomyDir, f));

  if (files.length === 0) {
    console.log("No taxonomy files found in content/math-taxonomy/ — nothing to validate.");
    process.exit(0);
  }

  console.log(`Validating ${files.length} taxonomy file(s)...`);

  const diags: Diagnostic[] = [];
  const globalKeywordIds = new Map<string, string>(); // id → first-seen file
  const globalCategoryIds = new Set<string>();

  for (const f of files) {
    validateFile(f, globalKeywordIds, globalCategoryIds, diags);
  }

  const errors = diags.filter((d) => d.level === "ERROR");
  const warnings = diags.filter((d) => d.level === "WARN");

  if (warnings.length > 0) {
    console.log(`\n⚠  Warnings (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`   [WARN] ${w.file}: ${w.msg}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n✗  Errors (${errors.length}):`);
    for (const e of errors) {
      console.log(`   [ERROR] ${e.file}: ${e.msg}`);
    }
    console.log(`\nValidation FAILED: ${errors.length} error(s), ${warnings.length} warning(s).`);
    process.exit(1);
  }

  console.log(`\n✓  Validation passed: ${files.length} file(s), 0 errors, ${warnings.length} warning(s).`);
  console.log(`   Total keywords validated: ${globalKeywordIds.size} (across all umbrellas + in_depth)`);
  console.log(`   Total categories validated: ${globalCategoryIds.size}`);
}

main();
