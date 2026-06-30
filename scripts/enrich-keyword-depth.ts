/**
 * Depth-enrichment script: assigns `depth_level` (L1–L4) and enumerates
 * `must_state_facts` + `common_trap` for every approved in_depth mcat_keyword.
 *
 * FILL-MISSING mode (default): skips keywords that already have BOTH
 *   • depth_level IS NOT NULL
 *   • concept_blueprint->'must_state_facts' is a non-empty array
 * Use --force to re-run everything in scope regardless.
 *
 * Usage:
 *   npm run mcat:enrich-depth                    # fill-missing, all sections
 *   npm run mcat:enrich-depth -- --dry-run
 *   npm run mcat:enrich-depth -- --section biology
 *   npm run mcat:enrich-depth -- --section psychsoc
 *   npm run mcat:enrich-depth -- --section chem
 *   npm run mcat:enrich-depth -- --section phys
 *   npm run mcat:enrich-depth -- --category mcat_biology_enzymes_and_protein_function
 *   npm run mcat:enrich-depth -- --keyword water_soluble_vs_fat_soluble_vitamins
 *   npm run mcat:enrich-depth -- --limit 5
 *   npm run mcat:enrich-depth -- --resume               # skip already-done (same as default fill-missing)
 *   npm run mcat:enrich-depth -- --force                # regenerate even if complete
 *   npm run mcat:enrich-depth -- --force --limit 10     # re-run first 10 in scope
 *
 * Full-run command (all ~2,351 in_depth keywords):
 *   npm run mcat:enrich-depth
 *
 * Resume after interruption:
 *   npm run mcat:enrich-depth        (fill-missing skips already-done automatically)
 *
 * Progress log: /tmp/enrich-keyword-depth-progress.jsonl
 *   Each line is a JSON record: { ts, id, label, depth_level, facts_count, ok, error? }
 */

import { createServiceClient } from "./lib/serviceClient";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// ─── Env ──────────────────────────────────────────────────────────────────────

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (studentEnv.OPENAI_API_KEY) process.env.OPENAI_API_KEY = studentEnv.OPENAI_API_KEY;
}

// ─── CLI flags ────────────────────────────────────────────────────────────────

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1]! : null;
}

const isDryRun  = process.argv.includes("--dry-run");
const isForce   = process.argv.includes("--force");
// --resume is an alias for the default fill-missing behaviour; listed for UX clarity
// const isResume  = process.argv.includes("--resume");

const limitArg    = getArg("--limit")    ? parseInt(getArg("--limit")!,    10) : null;
const sectionArg  = getArg("--section");  // "biology" | "psychsoc" | "chem" | "phys"
const categoryArg = getArg("--category");
const keywordArg  = getArg("--keyword");

// ─── Progress log ─────────────────────────────────────────────────────────────

const LOG_PATH = "/tmp/enrich-keyword-depth-progress.jsonl";

function logProgress(record: object) {
  fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n");
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeywordRow {
  id: string;
  label: string;
  description: string | null;
  tier: "umbrella" | "in_depth";
  category_id: string;
  parent_keyword_id: string | null;
  examples: string[] | null;
  depth_level: string | null;
  concept_blueprint: Record<string, unknown> | null;
}

interface DepthEnrichmentResult {
  depth_level: "L1" | "L2" | "L3" | "L4";
  depth_rationale: string;
  must_state_facts: string[];
  common_trap: string;
}

// ─── Section → category_id prefix mapping ────────────────────────────────────

const SECTION_PREFIX: Record<string, string> = {
  biology:   "mcat_biology_",
  psychsoc:  "mcat_psychsoc_",
  chem:      "mcat_chem_",
  phys:      "mcat_phys_",
};

// ─── Depth standard (read from docs file; fallback if absent) ─────────────────

const CALIBRATION_DOC_PATH = path.resolve(__dirname, "../docs/mcat-depth-standard-calibration.md");

function loadDepthStandard(): string {
  if (fs.existsSync(CALIBRATION_DOC_PATH)) {
    return fs.readFileSync(CALIBRATION_DOC_PATH, "utf-8");
  }

  // PLACEHOLDER STANDARD — used only when docs/mcat-depth-standard-calibration.md is absent.
  // Replace this file with the real doc before the full ~2,351-keyword run.
  console.warn(
    "[WARN] docs/mcat-depth-standard-calibration.md not found — using PLACEHOLDER depth standard."
  );
  return `
# MCAT Depth Standard — PLACEHOLDER (docs/mcat-depth-standard-calibration.md was not found)

## L1–L4 Rubric
- L1 RECOGNITION: Recall isolated facts, names, definitions, classifications. No mechanism needed.
- L2 DIRECTIONAL: Understand relationships and directions ("X increases Y", "low Km = high affinity").
  Apply classification rules to the full set (enumerate all members when topic-type = classification).
- L3 MECHANISM/WHY: Explain step-by-step logic: why a process works, intermediates, causal chain.
- L4 INTEGRATED: Apply L1–L3 across a multi-system or novel passage scenario.

## Topic-type → Level rules
| Topic Type                       | Default Level |
|----------------------------------|--------------|
| Classification/Taxonomy          | L2           |
| Named Regulatory Mechanism       | L3           |
| Quantitative Relationship        | L2–L3        |
| Multi-System Feedback            | L4           |
| Reaction Mechanism               | L2–L3        |
| Passage-Dependent Applied Reasoning | L4        |
| Memorizable Atomic Fact          | L1           |

## Completeness criterion
A keyword at level N is fully covered iff its must_state_facts include every atomic fact needed
to answer ALL in-scope questions up to level N for every case the keyword spans.
Under-enumeration is the canonical bug — always enumerate the FULL set (e.g., for vitamin solubility:
list ALL fat-soluble vitamins AND all water-soluble vitamins, not just one example).
`.trim();
}

// ─── OpenAI client ────────────────────────────────────────────────────────────

function createOpenAIClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey: key });
}

// ─── Transient retry ──────────────────────────────────────────────────────────

function isTransientError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === undefined) return true; // network/timeout
  return [408, 409, 425, 429, 431, 500, 502, 503, 504].includes(status);
}

async function withTransientRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransientError(err)) break;
      const base = 800 * Math.pow(2, attempt - 1);
      const delay = base + Math.floor(Math.random() * 400);
      console.warn(`  [RETRY ${attempt}/${maxAttempts}] ${label} — waiting ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`API call failed after ${maxAttempts} attempts (${label}): ${msg}`);
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(depthStandard: string): string {
  return `You are an MCAT content expert assigning DEPTH LEVEL and enumerating the COMPLETE COVERAGE CONTRACT for a single MCAT keyword.

The keyword already has a concept blueprint defining its in-scope / out-of-scope boundary. Your job is to enrich it with:
1. depth_level — one of L1 / L2 / L3 / L4
2. depth_rationale — one sentence explaining WHY this level, citing the topic type
3. must_state_facts — the COMPLETE enumerated set of atomic facts a student must state to fully cover this keyword at its target depth level. THIS IS THE CORE OUTPUT. The fatal bug this fixes: a keyword like "vitamin solubility" was previously summarized as "vitamin C is water-soluble" (one example) instead of listing ALL facts: fat-soluble = A, D, E, K (stored in fat, toxic in excess); water-soluble = all B vitamins + C (excreted in urine, not stored). EVERY case must be covered, none dropped.
4. common_trap — one sentence: the single most common wrong-answer pattern for this keyword on the MCAT (what students confuse or get backwards)

OUTPUT FORMAT (return valid JSON, no markdown):
{
  "depth_level": "L1" | "L2" | "L3" | "L4",
  "depth_rationale": "<one sentence citing topic type and why this level>",
  "must_state_facts": [
    "<atomic fact 1>",
    "<atomic fact 2>",
    ...
  ],
  "common_trap": "<the single most common wrong-answer pattern>"
}

RULES:
- Respect the keyword's existing in_scope / out_of_scope. must_state_facts MUST NOT drift outside the blueprint boundary.
- must_state_facts count is CONTENT-DECIDED — enumerate every atomic fact needed, no artificial cap. A classification keyword covering 13 vitamins needs ~13+ facts. A mechanism keyword needs every causal step.
- Each fact is ONE atomic, testable statement (e.g. "Vitamin A is fat-soluble and stored in adipose tissue / liver"), not a vague category.
- Apply MCAT depth bar: directional / qualitative rules, named entities and their roles, approximate ranges. Do NOT require decimal biochemical constants (pKa, Km, Ki) unless a universal constant (e.g. pH 7.4 for physiological).
- common_trap must be specific ("students confuse X for Y" or "students apply rule A when rule B is correct"), not generic.
- Assign depth_level per the TOPIC-TYPE RULES in the standard below. Classification/taxonomy → L2. Named regulatory mechanism → L3. Multi-system feedback → L4. Memorizable atomic fact → L1.

${depthStandard}
`;
}

// ─── User prompt ──────────────────────────────────────────────────────────────

function buildUserPrompt(kw: KeywordRow): string {
  const blueprint = kw.concept_blueprint ?? {};
  const inScope: string[] = Array.isArray(blueprint.in_scope_concepts)
    ? (blueprint.in_scope_concepts as string[])
    : [];
  const outScope: string[] = Array.isArray(blueprint.out_of_scope)
    ? (blueprint.out_of_scope as string[])
    : [];
  const keyTerms: string[] = Array.isArray(blueprint.key_terms)
    ? (blueprint.key_terms as string[])
    : [];
  const boundary = typeof blueprint.boundary_statement === "string"
    ? blueprint.boundary_statement
    : "";
  const examples = Array.isArray(kw.examples) ? (kw.examples as string[]) : [];

  const parts: string[] = [];
  parts.push(`KEYWORD: "${kw.label}"`);
  parts.push(`  id: ${kw.id}`);
  parts.push(`  category: ${kw.category_id}`);
  if (kw.description) parts.push(`  description: ${kw.description}`);
  if (examples.length > 0) parts.push(`  examples: ${examples.join("; ")}`);

  parts.push("\nEXISTING BLUEPRINT (respect these boundaries):");
  if (inScope.length > 0) {
    parts.push(`  IN SCOPE: ${inScope.join(" | ")}`);
  }
  if (outScope.length > 0) {
    parts.push(`  OUT OF SCOPE: ${outScope.join(" | ")}`);
  }
  if (keyTerms.length > 0) {
    parts.push(`  KEY TERMS: ${keyTerms.join(", ")}`);
  }
  if (boundary) {
    parts.push(`  BOUNDARY: ${boundary}`);
  }

  parts.push(
    "\nNow assign depth_level, enumerate must_state_facts (COMPLETE — every case, no omissions), and identify the common_trap."
  );

  return parts.join("\n");
}

// ─── LLM call ────────────────────────────────────────────────────────────────

const GEN_MODEL = "gpt-5.4-mini";

async function enrichKeywordDepth(
  client: OpenAI,
  kw: KeywordRow,
  systemPrompt: string
): Promise<DepthEnrichmentResult> {
  const userPrompt = buildUserPrompt(kw);

  const runOnce = async (): Promise<DepthEnrichmentResult | null> => {
    const completion = await withTransientRetry(
      () => client.chat.completions.create({
        model: GEN_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2, // low temperature for consistency
      }),
      `depth-enrich:${kw.id}`
    );

    const text = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }

    // Validate required fields
    const rawLevel = parsed.depth_level;
    if (!["L1", "L2", "L3", "L4"].includes(rawLevel as string)) return null;

    const rawFacts = parsed.must_state_facts;
    if (!Array.isArray(rawFacts) || rawFacts.length === 0) return null;

    const rawTrap = parsed.common_trap;
    if (typeof rawTrap !== "string" || !rawTrap.trim()) return null;

    return {
      depth_level: rawLevel as "L1" | "L2" | "L3" | "L4",
      depth_rationale:
        typeof parsed.depth_rationale === "string" ? parsed.depth_rationale.trim() : "",
      must_state_facts: (rawFacts as unknown[]).map((f) => String(f).trim()).filter(Boolean),
      common_trap: rawTrap.trim(),
    };
  };

  // Two attempts before throwing
  let result = await runOnce();
  if (!result) result = await runOnce();
  if (!result) {
    throw new Error(`Failed to produce valid enrichment output after 2 attempts for "${kw.id}"`);
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** True when a keyword is already fully enriched (skip in fill-missing mode). */
function isComplete(kw: KeywordRow): boolean {
  if (kw.depth_level === null) return false;
  const bp = kw.concept_blueprint;
  if (!bp) return false;
  const facts = bp.must_state_facts;
  return Array.isArray(facts) && (facts as unknown[]).length > 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== enrich-keyword-depth ===");
  if (isDryRun) console.log("[DRY RUN] No OpenAI calls or DB writes will be made.");
  if (isForce)  console.log("[FORCE] Will re-enrich keywords that are already complete.");

  // ── Supabase client
  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createServiceClient(supabaseUrl, serviceKey);

  // ── OpenAI client (fail-fast on missing key in non-dry-run)
  if (!isDryRun && !process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY (check apps/student/.env.local)");
    process.exit(1);
  }
  const openai = isDryRun ? null : createOpenAIClient();

  // ── Load depth standard doc
  const depthStandard = loadDepthStandard();
  const systemPrompt  = buildSystemPrompt(depthStandard);
  console.log(
    fs.existsSync(CALIBRATION_DOC_PATH)
      ? `  Loaded depth standard from ${path.relative(process.cwd(), CALIBRATION_DOC_PATH)}`
      : "  [WARN] Using placeholder depth standard"
  );

  // ── Fetch all keywords (paginated — PostgREST caps at 1000 rows silently)
  console.log("\nFetching mcat_keywords...");
  const PAGE = 1000;
  const allKeywords: KeywordRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await supabase
      .from("mcat_keywords")
      .select(
        "id, label, description, tier, category_id, parent_keyword_id, examples, depth_level, concept_blueprint"
      )
      .eq("status", "approved")
      .order("category_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) { console.error("Fetch error:", error.message); process.exit(1); }
    const page = (rows ?? []) as KeywordRow[];
    allKeywords.push(...page);
    if (page.length < PAGE) break;
  }
  console.log(`  Fetched ${allKeywords.length} approved keywords total.`);

  // ── Determine target set
  let targets: KeywordRow[];

  if (keywordArg) {
    // Single keyword override — any tier
    const found = allKeywords.find((k) => k.id === keywordArg);
    if (!found) { console.error(`Keyword not found: "${keywordArg}"`); process.exit(1); }
    targets = (isForce || !isComplete(found)) ? [found] : [];
    if (targets.length === 0) {
      console.log(`"${keywordArg}" is already complete. Use --force to re-enrich.`);
      return;
    }
  } else {
    // Default: in_depth tier only
    targets = allKeywords.filter(
      (k) => k.tier === "in_depth" && (isForce || !isComplete(k))
    );

    // Section filter
    if (sectionArg) {
      const prefix = SECTION_PREFIX[sectionArg.toLowerCase()];
      if (!prefix) {
        console.error(
          `Unknown --section "${sectionArg}". Valid values: ${Object.keys(SECTION_PREFIX).join(", ")}`
        );
        process.exit(1);
      }
      targets = targets.filter((k) => k.category_id.startsWith(prefix));
      console.log(`  Filtered to section "${sectionArg}": ${targets.length} keyword(s).`);
    }

    // Category filter
    if (categoryArg) {
      targets = targets.filter((k) => k.category_id === categoryArg);
      console.log(`  Filtered to category "${categoryArg}": ${targets.length} keyword(s).`);
    }
  }

  // Limit
  if (limitArg !== null && !isNaN(limitArg)) {
    targets = targets.slice(0, limitArg);
    console.log(`  Limited to first ${limitArg} keyword(s).`);
  }

  console.log(
    `  Target keywords (${isForce ? "force-regenerate all" : "fill-missing"}): ${targets.length}`
  );

  // ── Dry-run listing
  if (isDryRun) {
    console.log(`\n[DRY RUN] Would process ${targets.length} keyword(s):\n`);
    for (const kw of targets) {
      const complete = isComplete(kw);
      console.log(
        `  [${kw.category_id}] ${kw.id} ("${kw.label}") — depth_level=${kw.depth_level ?? "null"}, ` +
        `has_facts=${Array.isArray(kw.concept_blueprint?.must_state_facts) && (kw.concept_blueprint!.must_state_facts as unknown[]).length > 0} — ` +
        `action=${isForce ? "force" : complete ? "SKIP (complete)" : "enrich"}`
      );
    }
    if (targets.length === 0) {
      console.log("  (none — all keywords in scope are already complete; use --force to re-enrich)");
    }
    console.log("\n[DRY RUN] Done. No writes performed.");
    return;
  }

  if (targets.length === 0) {
    console.log(
      isForce
        ? "\nNo keywords found in scope. Nothing to do."
        : "\nAll targeted keywords already have depth_level + must_state_facts. Use --force to regenerate."
    );
    return;
  }

  // ── Process in parallel batches
  // 6–8 concurrent calls: small JSON calls, well within gpt-5.4-mini rate limits.
  const CONCURRENCY = 6;
  let successCount = 0;
  let skipCount    = 0;
  let failCount    = 0;

  const batches = chunk(targets, CONCURRENCY);
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi]!;
    console.log(`\n[Batch ${bi + 1}/${batches.length}] Processing ${batch.length} keyword(s)...`);

    await Promise.all(
      batch.map(async (kw) => {
        try {
          // Enrich
          const result = await enrichKeywordDepth(openai!, kw, systemPrompt);

          // Merge into existing concept_blueprint (preserve all existing fields)
          const existingBlueprint = kw.concept_blueprint ?? {};
          const updatedBlueprint = {
            ...existingBlueprint,
            must_state_facts: result.must_state_facts,
            common_trap: result.common_trap,
          };

          // Upsert: set depth_level on the column + merge must_state_facts/common_trap into blueprint
          const { error: updateErr } = await supabase
            .from("mcat_keywords")
            .update({
              depth_level: result.depth_level,
              concept_blueprint: updatedBlueprint,
            })
            .eq("id", kw.id);

          if (updateErr) {
            console.error(`  [ERROR] DB update failed for "${kw.id}": ${updateErr.message}`);
            failCount++;
            logProgress({
              id: kw.id, label: kw.label, ok: false,
              error: `DB: ${updateErr.message}`,
            });
            return;
          }

          successCount++;
          console.log(
            `  [OK] ${kw.label.padEnd(50)} depth=${result.depth_level} ` +
            `facts=${result.must_state_facts.length}`
          );
          logProgress({
            id: kw.id, label: kw.label, depth_level: result.depth_level,
            facts_count: result.must_state_facts.length, ok: true,
          });
        } catch (err) {
          failCount++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  [ERROR] "${kw.id}": ${msg}`);
          logProgress({ id: kw.id, label: kw.label, ok: false, error: msg });

          // Rate / usage limit: stop the whole run so the caller can decide.
          // 429 = rate limit; 402 / 429 / 503 all indicate exhausted capacity.
          const status = (err as { status?: number } | null)?.status;
          if (status === 429 || status === 402 || msg.includes("rate limit") || msg.includes("quota")) {
            console.error(
              "\n[STOP] Rate or usage limit hit. Progress saved to " + LOG_PATH +
              "\nRe-run the same command to resume — fill-missing skips already-completed keywords."
            );
            process.exit(2); // exit code 2 = clean stop, not a crash
          }
        }
      })
    );
  }

  // ── Summary
  console.log("\n=== Summary ===");
  console.log(`  Keywords attempted : ${targets.length}`);
  console.log(`  Enriched OK        : ${successCount}`);
  console.log(`  Skipped            : ${skipCount}`);
  console.log(`  Failures           : ${failCount}`);
  console.log(`  Progress log       : ${LOG_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
