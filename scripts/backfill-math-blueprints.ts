/**
 * Generates and stores `concept_blueprint` + `yield_score` + `yield_rationale`
 * for every math_keywords row where concept_blueprint IS NULL.
 *
 * - Sibling-grounded: siblings within the same umbrella (parent_keyword_id) are
 *   passed to generateConceptBlueprint so out_of_scope boundaries are sharp.
 * - Category outline context is injected via outlineContextForCategory.
 * - Yield is ONLY written when currently NULL — never overwrites an existing
 *   non-null yield_score.
 * - Concurrency ~8, exponential backoff on 429/5xx via built-in retry in
 *   mathBlueprint.ts (withTransientRetry, max 4 attempts).
 * - Resume-safe: skips rows already filled.
 * - Progress log every 25 items.
 * - After the main pass, failed rows are retried once.
 *
 * Usage:
 *   tsx scripts/backfill-math-blueprints.ts             (live run)
 *   tsx scripts/backfill-math-blueprints.ts --dry-run   (list targets, no calls)
 *   tsx scripts/backfill-math-blueprints.ts --limit 10  (first N only)
 *   tsx scripts/backfill-math-blueprints.ts --category polynomial_and_rational_functions
 *   tsx scripts/backfill-math-blueprints.ts --force     (regenerate ALL, including existing)
 *
 * npm: npm run math:blueprints
 *
 * Env: root .env.local (Supabase) + apps/student/.env.local (OPENAI_API_KEY).
 * Model: gpt-5.4-mini via generateConceptBlueprint in apps/student/lib/mathBlueprint.ts
 * Supabase: nnkpvezsyumryhnulyvt (service-role)
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// ─── Env loading ──────────────────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (studentEnv.OPENAI_API_KEY) process.env.OPENAI_API_KEY = studentEnv.OPENAI_API_KEY;
}

import { generateConceptBlueprint } from "../apps/student/lib/mathBlueprint.js";
import { outlineContextForCategory } from "../apps/student/lib/mathContentOutline.js";

// ─── CLI flags ────────────────────────────────────────────────────────────────
const isDryRun  = process.argv.includes("--dry-run");
const isForce   = process.argv.includes("--force");

const limitArg = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx !== -1 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1]!, 10) : null;
})();
const categoryArg = (() => {
  const idx = process.argv.indexOf("--category");
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1]! : null;
})();

// ─── Types ────────────────────────────────────────────────────────────────────
interface KeywordRow {
  id: string;
  category_id: string;
  label: string;
  description: string | null;
  tier: "umbrella" | "in_depth";
  parent_keyword_id: string | null;
  examples: unknown[] | null;
  concept_blueprint: Record<string, unknown> | null;
  yield_score: number | null;
  yield_rationale: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Supabase/PostgreSQL's json parser rejects bare \uXXXX-looking sequences that
 * aren't valid Unicode escapes (e.g. LaTeX "\underbrace", "\underline",
 * "\upsilon" etc. where \u followed by letters is NOT a valid \uNNNN sequence).
 * Fix: round-trip through JSON.parse/JSON.stringify so all backslashes are
 * properly escaped as \\ in the stored JSON, then parse back to object.
 */
function sanitizeBlueprintForDb(blueprint: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(blueprint)) as Record<string, unknown>;
  } catch {
    return blueprint;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== backfill-math-blueprints ===");
  if (isDryRun) console.log("[DRY RUN] No OpenAI calls or DB writes.");
  if (isForce)  console.log("[FORCE] Regenerating all keywords (even those with existing blueprints).");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Fetch all math_keywords (need full set for sibling look-up)
  // Paginate to avoid Supabase default 1000-row limit.
  console.log("\nFetching all math_keywords...");
  const PAGE = 1000;
  let allKeywords: KeywordRow[] = [];
  let page = 0;
  while (true) {
    const { data: pageRaw, error: fetchErr } = await supabase
      .from("math_keywords")
      .select(
        "id, category_id, label, description, tier, parent_keyword_id, examples, concept_blueprint, yield_score, yield_rationale"
      )
      .order("category_id")
      .order("order_index")
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (fetchErr) { console.error("Fetch error:", fetchErr.message); process.exit(1); }
    const rows = (pageRaw ?? []) as KeywordRow[];
    allKeywords = allKeywords.concat(rows);
    if (rows.length < PAGE) break;
    page++;
  }
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

  // ── Determine target set
  let targets: KeywordRow[] = allKeywords.filter((k) => {
    if (k.tier !== "in_depth") return false;
    if (isForce) return true;
    return k.concept_blueprint === null;
  });

  if (categoryArg) {
    targets = targets.filter((k) => k.category_id === categoryArg);
    console.log(`  Filtered to category "${categoryArg}": ${targets.length} targets.`);
  }
  if (limitArg !== null && !isNaN(limitArg)) {
    targets = targets.slice(0, limitArg);
    console.log(`  Limited to first ${limitArg}.`);
  }

  console.log(`  Target keywords (${isForce ? "force" : "need blueprint"}): ${targets.length}`);

  if (isDryRun) {
    console.log(`\n[DRY RUN] Would process ${targets.length} keyword(s):`);
    for (const kw of targets.slice(0, 20)) {
      const siblings = (siblingsByParent.get(kw.parent_keyword_id ?? "") ?? [])
        .filter((s) => s.id !== kw.id);
      console.log(`  [${kw.category_id}] ${kw.id} — ${siblings.length} siblings`);
    }
    if (targets.length > 20) console.log(`  ... and ${targets.length - 20} more.`);
    console.log("\n[DRY RUN] Done.");
    return;
  }

  if (targets.length === 0) {
    console.log("\nAll targeted keywords already have blueprints. Use --force to regenerate.");
    return;
  }

  const CONCURRENCY = 8;
  const LOG_EVERY = 25;
  let successCount = 0;
  let failCount = 0;
  const failedIds: string[] = [];

  const processKeyword = async (kw: KeywordRow): Promise<boolean> => {
    try {
      const outlineContext = outlineContextForCategory(kw.category_id);

      const siblings = (siblingsByParent.get(kw.parent_keyword_id ?? "") ?? [])
        .filter((s) => s.id !== kw.id)
        .map((s) => ({ label: s.label, description: s.description ?? "" }));

      const examples: string[] | undefined =
        Array.isArray(kw.examples) && kw.examples.length > 0
          ? (kw.examples as unknown[]).map((e) => String(e))
          : undefined;

      const { blueprint, yield_score, yield_rationale } = await generateConceptBlueprint({
        keyword: {
          id: kw.id,
          label: kw.label,
          description: kw.description ?? "",
          ...(examples ? { examples } : {}),
        },
        siblings: siblings.length > 0 ? siblings : undefined,
        outlineContext: outlineContext || undefined,
      });

      // Build the update payload. NEVER overwrite a non-null yield_score.
      const updatePayload: Record<string, unknown> = { concept_blueprint: blueprint };
      if (kw.yield_score === null || kw.yield_score === undefined) {
        updatePayload.yield_score = yield_score;
        updatePayload.yield_rationale = yield_rationale;
      }

      const { error: updErr } = await supabase
        .from("math_keywords")
        .update(updatePayload)
        .eq("id", kw.id);

      if (updErr) {
        console.error(`  [ERROR] DB update failed for "${kw.id}": ${updErr.message}`);
        return false;
      }

      const yieldNote = kw.yield_score !== null
        ? `(yield preserved=${kw.yield_score})`
        : `(yield=${yield_score.toFixed(2)})`;
      console.log(`  ✓ [${kw.category_id}] ${kw.label} ${yieldNote} (${blueprint.in_scope_concepts.length} in-scope)`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [ERROR] Failed for "${kw.id}": ${msg}`);
      return false;
    }
  };

  // ── Main pass: process in batches of CONCURRENCY
  const batches = chunk(targets, CONCURRENCY);
  for (const batch of batches) {
    const results = await Promise.all(batch.map(processKeyword));
    for (let i = 0; i < results.length; i++) {
      if (results[i]) {
        successCount++;
      } else {
        failCount++;
        failedIds.push(batch[i]!.id);
      }
      if ((successCount + failCount) % LOG_EVERY === 0) {
        console.log(`  Progress: ${successCount + failCount}/${targets.length} (${successCount} ok, ${failCount} failed)`);
      }
    }
  }

  // ── Retry pass: attempt failed keywords once more
  if (failedIds.length > 0) {
    console.log(`\n--- Retry pass: ${failedIds.length} failed keyword(s) ---`);
    const retryTargets = allKeywords.filter((k) => failedIds.includes(k.id));
    for (const kw of retryTargets) {
      const ok = await processKeyword(kw);
      if (ok) {
        successCount++;
        failCount--;
      } else {
        console.error(`  [FINAL FAILURE] ${kw.id}`);
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  Keywords attempted:  ${targets.length}`);
  console.log(`  Blueprints stored:   ${successCount}`);
  console.log(`  Final failures:      ${failCount}`);
  if (failCount > 0) {
    console.log(`  Failed ids:         ${failedIds.slice(0, 10).join(", ")}${failedIds.length > 10 ? " ..." : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
