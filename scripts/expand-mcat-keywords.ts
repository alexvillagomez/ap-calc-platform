/**
 * Generates granular in_depth keywords for every umbrella keyword that has no
 * children yet, using OpenAI to produce 5–8 narrow, specific keywords per
 * umbrella.  Each generated keyword targets one single fact, mechanism,
 * distinction, or common confusion so a wrong answer isolates exactly what
 * the student misunderstands.
 *
 * Usage:
 *   tsx scripts/expand-mcat-keywords.ts
 *   tsx scripts/expand-mcat-keywords.ts --dry-run
 *   tsx scripts/expand-mcat-keywords.ts --limit 5
 *   tsx scripts/expand-mcat-keywords.ts --category mcat_biology_enzymes_and_protein_function
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeywordRow {
  id: string;
  category_id: string;
  label: string;
  description: string | null;
  tier: "umbrella" | "in_depth";
  parent_keyword_id: string | null;
  order_index: number;
}

interface GeneratedKeyword {
  id: string;
  label: string;
  description: string;
  examples: [string, string, string];
}

interface LLMOutput {
  keywords: GeneratedKeyword[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function makeUniqueId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function isValidGeneratedKeyword(kw: unknown): kw is GeneratedKeyword {
  if (typeof kw !== "object" || kw === null) return false;
  const k = kw as Record<string, unknown>;
  if (typeof k.id !== "string" || k.id.trim() === "") return false;
  if (typeof k.label !== "string" || k.label.trim() === "") return false;
  if (typeof k.description !== "string" || k.description.trim() === "") return false;
  if (!Array.isArray(k.examples) || k.examples.length < 3) return false;
  if (!k.examples.every((e) => typeof e === "string")) return false;
  return true;
}

// ─── Few-shot examples (lifted verbatim from the amino acids in-depth keywords)

const FEW_SHOT_EXAMPLES = `
Example 1:
{
  "id": "side_chain_pka_and_protonation_state",
  "label": "Side-chain pKa and protonation state",
  "description": "Determine whether ionizable side chains are protonated or deprotonated at a given pH using pKa comparisons. This focuses specifically on side-chain acid-base behavior.",
  "examples": [
    "Determine whether histidine is mostly protonated at pH 6.",
    "Predict the charge of glutamate when the pH is above its side-chain pKa.",
    "Identify which side chain changes protonation state near physiological pH."
  ]
}

Example 2:
{
  "id": "peptide_bond_planarity_and_resonance",
  "label": "Peptide bond planarity and resonance",
  "description": "Explain why peptide bonds have partial double-bond character, restricted rotation, and planar geometry due to resonance. This focuses on structural rigidity of the peptide linkage.",
  "examples": [
    "Explain why rotation around a peptide bond is restricted.",
    "Identify resonance as the cause of peptide bond planarity.",
    "Predict how peptide bond rigidity affects protein backbone conformation."
  ]
}
`.trim();

// ─── LLM call ─────────────────────────────────────────────────────────────────

async function generateInDepthKeywords(
  openai: OpenAI,
  umbrella: KeywordRow
): Promise<GeneratedKeyword[]> {
  const systemPrompt = `You are an MCAT content expert generating granular in_depth keywords for a specific umbrella topic.
Your purpose: capture VERY SMALL, specific gaps in knowledge. Each keyword must target ONE narrow fact, mechanism, distinction, or common confusion — so a wrong answer isolates exactly what the student misunderstands.
Do NOT generate broad overviews. Each keyword should be so specific that a student could be right about everything else in the umbrella but still miss this one thing.

Output JSON with this exact shape:
{
  "keywords": [
    {
      "id": "snake_case_id",
      "label": "Short descriptive label",
      "description": "2–3 sentences starting with a verb like Identify/Determine/Distinguish/Recognize/Explain/Calculate/Predict. State exactly what narrow skill or fact is tested, then note what this is NOT about (to prevent over-broad thinking).",
      "examples": ["Task statement 1.", "Task statement 2.", "Task statement 3."]
    }
  ]
}

${FEW_SHOT_EXAMPLES}

Rules:
- Generate exactly 5 to 8 keywords.
- IDs must be snake_case, globally unique, and descriptive.
- Each description must start with a verb (Identify/Determine/Distinguish/Recognize/Explain/Calculate/Predict/Compare).
- Each examples array must have exactly 3 concrete task statements (not explanations, not definitions — tasks a student must perform).
- Do not repeat the umbrella label in every keyword label.`;

  const userPrompt = `Generate 5–8 in_depth keywords for this umbrella:
ID: ${umbrella.id}
Label: ${umbrella.label}
Description: ${umbrella.description ?? "(no description)"}
Category: ${umbrella.category_id}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`  [WARN] JSON parse failed for umbrella ${umbrella.id}`);
    return [];
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as LLMOutput).keywords)
  ) {
    console.warn(`  [WARN] Unexpected LLM output shape for umbrella ${umbrella.id}`);
    return [];
  }

  const valid = (parsed as LLMOutput).keywords.filter(isValidGeneratedKeyword);
  const invalid = (parsed as LLMOutput).keywords.length - valid.length;
  if (invalid > 0) {
    console.warn(`  [WARN] Dropped ${invalid} invalid keywords for umbrella ${umbrella.id}`);
  }
  return valid;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== expand-mcat-keywords ===");
  if (isDryRun) console.log("[DRY RUN] No DB writes or OpenAI calls will be made.");

  // ── Supabase client (always needed to fetch keywords list)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Fetch all keywords
  console.log("\nFetching all mcat_keywords...");
  const { data: allKeywords, error: fetchErr } = await supabase
    .from("mcat_keywords")
    .select("id, category_id, label, description, tier, parent_keyword_id, order_index")
    .order("order_index");
  if (fetchErr) {
    console.error("Fetch error:", fetchErr.message);
    process.exit(1);
  }
  const keywords = (allKeywords ?? []) as KeywordRow[];
  console.log(`  Fetched ${keywords.length} keywords total.`);

  // ── Group: umbrellas and existing children by parent_keyword_id
  const umbrellas = keywords.filter((k) => k.tier === "umbrella");
  const childrenByParent = new Map<string, KeywordRow[]>();
  for (const kw of keywords) {
    if (kw.tier === "in_depth" && kw.parent_keyword_id) {
      const list = childrenByParent.get(kw.parent_keyword_id) ?? [];
      list.push(kw);
      childrenByParent.set(kw.parent_keyword_id, list);
    }
  }

  // ── Identify umbrellas that need expansion (zero children)
  let umbrellasPending = umbrellas.filter(
    (u) => !childrenByParent.has(u.id) || childrenByParent.get(u.id)!.length === 0
  );

  // Apply --category filter
  if (categoryArg) {
    umbrellasPending = umbrellasPending.filter((u) => u.category_id === categoryArg);
    console.log(`  Filtered to category "${categoryArg}": ${umbrellasPending.length} umbrellas pending.`);
  }

  // Apply --limit filter
  if (limitArg !== null && !isNaN(limitArg)) {
    umbrellasPending = umbrellasPending.slice(0, limitArg);
    console.log(`  Limited to first ${limitArg} umbrellas.`);
  }

  if (isDryRun) {
    console.log(`\n[DRY RUN] Would process ${umbrellasPending.length} umbrella(s):\n`);
    // Group by category for output
    const byCat = new Map<string, KeywordRow[]>();
    for (const u of umbrellasPending) {
      const list = byCat.get(u.category_id) ?? [];
      list.push(u);
      byCat.set(u.category_id, list);
    }
    for (const [catId, ubs] of byCat) {
      console.log(`  [${catId}] ${ubs.length} umbrella(s):`);
      for (const u of ubs) {
        console.log(`    - ${u.id} (${u.label}) → would generate 5–8 in_depth keywords`);
      }
    }
    console.log("\n[DRY RUN] Done. No writes performed.");
    return;
  }

  if (umbrellasPending.length === 0) {
    console.log("\nAll umbrellas already have children. Nothing to do.");
    return;
  }

  // ── OpenAI client
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.error("Missing OPENAI_API_KEY");
    process.exit(1);
  }
  const openai = new OpenAI({ apiKey: openaiKey });

  // ── Collect all existing IDs for uniqueness enforcement
  const globalIdSet = new Set(keywords.map((k) => k.id));

  // ── Stats
  let totalInserted = 0;
  let totalCollisions = 0;
  let totalUmbrellasDone = 0;

  // ── Process in batches of 3
  const CONCURRENCY = 3;
  const batches = chunk(umbrellasPending, CONCURRENCY);

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (umbrella) => {
        console.log(`\n[${umbrella.category_id}] Processing "${umbrella.label}"...`);
        const generated = await generateInDepthKeywords(openai, umbrella);

        if (generated.length === 0) {
          console.log(`  → No valid keywords generated, skipping.`);
          return;
        }

        // Resolve ID uniqueness
        const rows = generated.map((kw, idx) => {
          const resolvedId = makeUniqueId(kw.id, globalIdSet);
          if (resolvedId !== kw.id) {
            totalCollisions++;
            console.log(`  [COLLISION] "${kw.id}" → renamed to "${resolvedId}"`);
          }
          globalIdSet.add(resolvedId);
          return {
            id: resolvedId,
            category_id: umbrella.category_id,
            label: kw.label,
            description: kw.description,
            tier: "in_depth" as const,
            parent_keyword_id: umbrella.id,
            examples: kw.examples,
            status: "approved",
            order_index: idx,
          };
        });

        // Upsert
        const { error: upsertErr } = await supabase
          .from("mcat_keywords")
          .upsert(rows, { onConflict: "id" });

        if (upsertErr) {
          console.error(`  [ERROR] Upsert failed for umbrella ${umbrella.id}:`, upsertErr.message);
          return;
        }

        totalInserted += rows.length;
        totalUmbrellasDone++;
        console.log(
          `  [${umbrella.category_id}] ${umbrella.label} → ${rows.length} keywords inserted`
        );
      })
    );
  }

  // ── Summary
  console.log("\n=== Summary ===");
  console.log(`  Umbrellas processed:  ${totalUmbrellasDone} / ${umbrellasPending.length}`);
  console.log(`  Keywords inserted:    ${totalInserted}`);
  console.log(`  ID collisions renamed: ${totalCollisions}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
