/**
 * Writes yield_score + yield_rationale back to learn_keywords for every
 * math_keyword that has a source_learn_keyword_id.
 *
 * Rules:
 *  - ONLY updates learn_keywords.yield_score and learn_keywords.yield_rationale.
 *  - ONLY writes rows where those two columns are currently NULL.
 *  - NEVER deletes or modifies any other column on any source table.
 *  - The 3 unmapped IDs are hardcoded below with yields copied from their
 *    merged successors in math_keywords:
 *      independent_linear_systems    ← consistent_independent_system_classification  (0.40)
 *      dependent_linear_systems      ← inconsistent_or_dependent_system_classification (0.45)
 *      rational_exponent_radical_equivalence ← rational_exponent_meaning_and_conversion (0.88)
 *
 * Resume-safe: skips rows where yield_score IS NOT NULL.
 * Progress log every 25 items.
 * --dry-run: reports what would be written, no DB writes.
 *
 * Usage:
 *   tsx scripts/writeback-learn-yield.ts
 *   tsx scripts/writeback-learn-yield.ts --dry-run
 *
 * npm: npm run math:yield-writeback
 *
 * Env: root .env.local (Supabase keys).
 * Supabase: nnkpvezsyumryhnulyvt (service-role)
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

// ─── Env loading ──────────────────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ─── CLI flags ────────────────────────────────────────────────────────────────
const isDryRun = process.argv.includes("--dry-run");

// ─── Hardcoded mappings for 3 unmapped learn IDs ─────────────────────────────
// These learn_keywords IDs were split/merged into math_keywords; no
// source_learn_keyword_id points back at them. We copy yields from successors.
const HARDCODED_YIELDS: { id: string; yield_score: number; yield_rationale: string }[] = [
  {
    id: "independent_linear_systems",
    yield_score: 0.40,
    yield_rationale:
      "Merged into consistent_independent_system_classification (math_keywords). " +
      "Yield copied from successor (0.40): most standard system problems produce an independent system.",
  },
  {
    id: "dependent_linear_systems",
    yield_score: 0.45,
    yield_rationale:
      "Merged into inconsistent_or_dependent_system_classification (math_keywords). " +
      "Yield copied from successor (0.45): detecting dependence is a paired classification task.",
  },
  {
    id: "rational_exponent_radical_equivalence",
    yield_score: 0.88,
    yield_rationale:
      "Closest successor: rational_exponent_meaning_and_conversion (math_keywords, yield 0.88). " +
      "Rational exponents / radical equivalence is a spec anchor (0.88) tested in FRQ 4.",
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface MathKeywordRow {
  source_learn_keyword_id: string;
  yield_score: number | null;
  yield_rationale: string | null;
}

interface LearnKeywordRow {
  id: string;
  yield_score: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== writeback-learn-yield ===");
  if (isDryRun) console.log("[DRY RUN] No DB writes.");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Load math_keywords that have a source_learn_keyword_id and a yield_score
  console.log("\nFetching math_keywords with source_learn_keyword_id...");
  const { data: mkRaw, error: mkErr } = await supabase
    .from("math_keywords")
    .select("source_learn_keyword_id, yield_score, yield_rationale")
    .not("source_learn_keyword_id", "is", null);
  if (mkErr) { console.error("math_keywords fetch error:", mkErr.message); process.exit(1); }

  const mathKeywords = (mkRaw ?? []) as MathKeywordRow[];
  console.log(`  math_keywords with source_learn_keyword_id: ${mathKeywords.length}`);

  // Build a map: learn_id → { yield_score, yield_rationale }
  const yieldByLearnId = new Map<string, { score: number; rationale: string }>();
  for (const mk of mathKeywords) {
    if (mk.yield_score !== null && mk.source_learn_keyword_id) {
      yieldByLearnId.set(mk.source_learn_keyword_id, {
        score:     mk.yield_score,
        rationale: mk.yield_rationale ?? "",
      });
    }
  }

  // Add the 3 hardcoded mappings
  for (const hc of HARDCODED_YIELDS) {
    yieldByLearnId.set(hc.id, { score: hc.yield_score, rationale: hc.yield_rationale });
  }
  console.log(`  Total learn_id → yield mappings (incl. 3 hardcoded): ${yieldByLearnId.size}`);

  // ── Fetch learn_keywords that currently have NULL yield_score
  console.log("\nFetching learn_keywords with NULL yield_score...");
  const { data: lkRaw, error: lkErr } = await supabase
    .from("learn_keywords")
    .select("id, yield_score")
    .is("yield_score", null);
  if (lkErr) { console.error("learn_keywords fetch error:", lkErr.message); process.exit(1); }

  const learnKeywords = (lkRaw ?? []) as LearnKeywordRow[];
  console.log(`  learn_keywords with NULL yield_score: ${learnKeywords.length}`);

  // Filter to those we have yield data for
  const toUpdate = learnKeywords.filter((lk) => yieldByLearnId.has(lk.id));
  console.log(`  Of those, we have yield data for: ${toUpdate.length}`);

  if (toUpdate.length === 0) {
    console.log("  Nothing to update.");
    return;
  }

  let updated = 0;
  let failed  = 0;
  const LOG_EVERY = 25;

  for (const lk of toUpdate) {
    const yieldData = yieldByLearnId.get(lk.id)!;

    if (isDryRun) {
      updated++;
      if (updated % LOG_EVERY === 0) {
        console.log(`  [DRY RUN] Would update ${updated} so far...`);
      }
      continue;
    }

    const { error: updErr } = await supabase
      .from("learn_keywords")
      .update({
        yield_score:     yieldData.score,
        yield_rationale: yieldData.rationale,
      })
      .eq("id", lk.id)
      .is("yield_score", null); // extra safety guard — only update if still null

    if (updErr) {
      console.error(`  [ERROR] Update failed for learn_keyword ${lk.id}: ${updErr.message}`);
      failed++;
    } else {
      updated++;
      if (updated % LOG_EVERY === 0) {
        console.log(`  Progress: ${updated} updated, ${failed} failed`);
      }
    }
  }

  console.log("\n=== Summary ===");
  if (isDryRun) {
    console.log(`  [DRY RUN] Would update: ${updated} learn_keywords rows`);
  } else {
    console.log(`  learn_keywords updated:  ${updated}`);
    console.log(`  Failures:                ${failed}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
