/**
 * One-time fix: existing mcat_questions were generated before choice-shuffling
 * existed, so ~70% have correct_index = 0. This shuffles each stored question's
 * choices (Fisher–Yates) and recomputes correct_index so the answer position is
 * uniformly distributed. Idempotent-safe to run again (it just reshuffles).
 *
 * Run: npx tsx scripts/rebalance-mcat-correct-index.ts [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DRY = process.argv.includes("--dry-run");

function shuffle(choices: string[], correctIndex: number): { choices: string[]; correct_index: number } {
  if (!Array.isArray(choices) || choices.length !== 4) return { choices, correct_index: correctIndex };
  if (new Set(choices).size !== 4) return { choices, correct_index: correctIndex }; // skip dupes
  const idx = [0, 1, 2, 3];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return {
    choices: idx.map((o) => choices[o]),
    correct_index: idx.indexOf(correctIndex),
  };
}

async function main() {
  const { data: rows, error } = await supabase
    .from("mcat_questions")
    .select("id, choices, correct_index");
  if (error) throw error;
  console.log(`Fetched ${rows?.length ?? 0} mcat_questions.`);

  const before: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const after: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let updated = 0;

  for (const r of rows ?? []) {
    const ci = r.correct_index as number;
    if (ci >= 0 && ci <= 3) before[ci]++;
    const res = shuffle(r.choices as string[], ci);
    if (res.correct_index >= 0 && res.correct_index <= 3) after[res.correct_index]++;
    if (res.correct_index !== ci) {
      if (!DRY) {
        const { error: upErr } = await supabase
          .from("mcat_questions")
          .update({ choices: res.choices, correct_index: res.correct_index })
          .eq("id", r.id);
        if (upErr) console.error(`  update failed for ${r.id}:`, upErr.message);
        else updated++;
      } else {
        updated++;
      }
    }
  }

  console.log("correct_index BEFORE:", JSON.stringify(before));
  console.log("correct_index AFTER: ", JSON.stringify(after));
  console.log(`${DRY ? "[DRY] would update" : "Updated"} ${updated} rows.`);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
