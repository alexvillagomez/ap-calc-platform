/**
 * Generates and stores a `concept_blueprint` for every mcat_keyword that lacks
 * one (i.e. where concept_blueprint IS NULL).  Defaults to in_depth tier
 * keywords; umbrella keywords are included only when targeted explicitly with
 * --keyword.
 *
 * Usage:
 *   tsx scripts/backfill-mcat-blueprints.ts --dry-run
 *   tsx scripts/backfill-mcat-blueprints.ts --category mcat_biology_amino_acids_and_proteins
 *   tsx scripts/backfill-mcat-blueprints.ts --limit 5
 *   tsx scripts/backfill-mcat-blueprints.ts --keyword <id>
 *   tsx scripts/backfill-mcat-blueprints.ts --umbrella <umbrella_keyword_id>
 *   tsx scripts/backfill-mcat-blueprints.ts --force                             # regenerate ALL (including existing blueprints)
 *   tsx scripts/backfill-mcat-blueprints.ts --force --umbrella <umbrella_id>    # regenerate all under an umbrella
 *   tsx scripts/backfill-mcat-blueprints.ts --force --dry-run --umbrella <id>   # preview --force scope without writing
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load root .env.local first, then override OPENAI_API_KEY from apps/student/.env.local
// because the root key is stale / invalid.
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (studentEnv.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = studentEnv.OPENAI_API_KEY;
  }
}

import { generateConceptBlueprint } from "../apps/student/lib/mcatBlueprint.js";
import { outlineContextForCategory } from "../apps/student/lib/mcatContentOutline.js";

// ─── CLI flags ────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes("--dry-run");
const limitArg = (() => {
  const idx = process.argv.indexOf("--limit");
  if (idx !== -1 && process.argv[idx + 1]) return parseInt(process.argv[idx + 1]!, 10);
  return null;
})();
const categoryArg = (() => {
  const idx = process.argv.indexOf("--category");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return null;
})();
const keywordArg = (() => {
  const idx = process.argv.indexOf("--keyword");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return null;
})();
const umbrellaArg = (() => {
  const idx = process.argv.indexOf("--umbrella");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return null;
})();
/** When true, regenerate keywords that ALREADY have a blueprint (drop the IS NULL restriction). */
const isForce = process.argv.includes("--force");

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeywordRow {
  id: string;
  category_id: string;
  label: string;
  description: string | null;
  tier: "umbrella" | "in_depth";
  parent_keyword_id: string | null;
  examples: string[] | null;
  concept_blueprint: Record<string, unknown> | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== backfill-mcat-blueprints ===");
  if (isDryRun) console.log("[DRY RUN] No OpenAI calls or DB writes will be made.");
  if (isForce) console.log("[FORCE] Will regenerate keywords that already have a blueprint.");

  // ── Supabase client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Fetch all keywords (need the full set to compute siblings)
  console.log("\nFetching all mcat_keywords...");
  const { data: allKeywordsRaw, error: fetchErr } = await supabase
    .from("mcat_keywords")
    .select("id, category_id, label, description, tier, parent_keyword_id, examples, concept_blueprint")
    .order("order_index");
  if (fetchErr) {
    console.error("Fetch error:", fetchErr.message);
    process.exit(1);
  }
  const allKeywords = (allKeywordsRaw ?? []) as KeywordRow[];
  console.log(`  Fetched ${allKeywords.length} keywords total.`);

  // ── Build sibling lookup: parent_keyword_id → children[]
  const siblingsByParent = new Map<string, KeywordRow[]>();
  for (const kw of allKeywords) {
    if (kw.parent_keyword_id) {
      const list = siblingsByParent.get(kw.parent_keyword_id) ?? [];
      list.push(kw);
      siblingsByParent.set(kw.parent_keyword_id, list);
    }
  }

  // ── Determine target set: keywords with concept_blueprint IS NULL
  let targets: KeywordRow[];

  if (keywordArg) {
    // Single keyword override — allow any tier
    const found = allKeywords.find((k) => k.id === keywordArg);
    if (!found) {
      console.error(`Keyword not found: "${keywordArg}"`);
      process.exit(1);
    }
    // With --force, include even if a blueprint already exists; otherwise NULL-only
    targets = (isForce || found.concept_blueprint === null) ? [found] : [];
    if (targets.length === 0) {
      console.log(`Keyword "${keywordArg}" already has a blueprint. Use --force to regenerate.`);
      return;
    }
  } else {
    // Default: in_depth tier only; NULL-only unless --force
    targets = allKeywords.filter(
      (k) => k.tier === "in_depth" && (isForce || k.concept_blueprint === null)
    );

    // Apply --category filter
    if (categoryArg) {
      targets = targets.filter((k) => k.category_id === categoryArg);
      console.log(`  Filtered to category "${categoryArg}": ${targets.length} in_depth keyword(s) ${isForce ? "selected" : "pending"}.`);
    }

    // Apply --umbrella filter
    if (umbrellaArg) {
      targets = targets.filter((k) => k.parent_keyword_id === umbrellaArg);
      console.log(`  Filtered to umbrella "${umbrellaArg}": ${targets.length} in_depth keyword(s) ${isForce ? "selected" : "pending"}.`);
    }
  }

  // Apply --limit filter
  if (limitArg !== null && !isNaN(limitArg)) {
    targets = targets.slice(0, limitArg);
    console.log(`  Limited to first ${limitArg} keyword(s).`);
  }

  console.log(`  Target keywords (${isForce ? "force regenerate" : "need blueprint"}): ${targets.length}`);

  // ── Dry-run listing
  if (isDryRun) {
    console.log(`\n[DRY RUN] Would process ${targets.length} keyword(s):\n`);
    for (const kw of targets) {
      const siblings = (siblingsByParent.get(kw.parent_keyword_id ?? "") ?? []).filter(
        (s) => s.id !== kw.id
      );
      console.log(
        `  [${kw.category_id}] ${kw.id} ("${kw.label}") — ${siblings.length} sibling(s)`
      );
    }
    if (targets.length === 0) {
      console.log(
        isForce
          ? "  (none — no keywords found in this scope)"
          : "  (none — all keywords in this scope already have blueprints; use --force to regenerate)"
      );
    }
    console.log("\n[DRY RUN] Done. No writes performed.");
    return;
  }

  if (targets.length === 0) {
    console.log(
      isForce
        ? "\nNo keywords found in the targeted scope. Nothing to do."
        : "\nAll targeted keywords already have blueprints. Use --force to regenerate. Nothing to do."
    );
    return;
  }

  // ── Process in batches of 3
  const CONCURRENCY = 3;
  let successCount = 0;
  let failCount = 0;

  const batches = chunk(targets, CONCURRENCY);
  for (const batch of batches) {
    await Promise.all(
      batch.map(async (kw) => {
        try {
          // Build siblings list (same parent, exclude self)
          const siblings = (siblingsByParent.get(kw.parent_keyword_id ?? "") ?? [])
            .filter((s) => s.id !== kw.id)
            .map((s) => ({ label: s.label, description: s.description ?? "" }));

          // Build outlineContext
          const outlineContext = outlineContextForCategory(kw.category_id);

          // Coerce examples jsonb array to string[]
          const examples: string[] | undefined =
            Array.isArray(kw.examples) && kw.examples.length > 0
              ? (kw.examples as unknown[]).map((e) => String(e))
              : undefined;

          // Generate blueprint
          const blueprint = await generateConceptBlueprint({
            keyword: {
              id: kw.id,
              label: kw.label,
              description: kw.description ?? "",
              ...(examples ? { examples } : {}),
            },
            siblings: siblings.length > 0 ? siblings : undefined,
            outlineContext: outlineContext || undefined,
          });

          // Store in DB
          const { error: updateErr } = await supabase
            .from("mcat_keywords")
            .update({ concept_blueprint: blueprint })
            .eq("id", kw.id);

          if (updateErr) {
            console.error(
              `  [ERROR] DB update failed for "${kw.id}": ${updateErr.message}`
            );
            failCount++;
            return;
          }

          successCount++;
          console.log(
            `  [${kw.category_id}] ${kw.label} → blueprint stored` +
              ` (${blueprint.in_scope_concepts.length} in-scope,` +
              ` ${blueprint.out_of_scope.length} out-of-scope)`
          );
        } catch (err) {
          failCount++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  [ERROR] Failed for "${kw.id}": ${msg}`);
        }
      })
    );
  }

  // ── Summary
  console.log("\n=== Summary ===");
  console.log(`  Keywords attempted:  ${targets.length}`);
  console.log(`  Blueprints stored:   ${successCount}`);
  console.log(`  Failures:            ${failCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
