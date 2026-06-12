/**
 * Imports existing problems into math_questions from three source tables:
 *   1. rag_examples      (399 rows, course=precalc) → source 'imported_rag'
 *   2. learn_practice_problems (24 rows)            → source 'imported_practice'
 *   3. learn_mastery_quiz_problems (8 rows)         → source 'imported_practice'
 *
 * Mapping logic:
 *   - keyword_weights: the keys are OLD learn_keywords ids. Map each key to a
 *     NEW math_keywords id via source_learn_keyword_id. Keys that still don't
 *     map after the forward lookup are embedded against math_keywords to find
 *     the best match (tagByEmbedding fallback).
 *   - difficulty: rag_examples and practice tables use integer 1–5 scale.
 *     Map: 1→0.25, 2→0.40, 3→0.55, 4→0.70, 5→0.85.
 *     If estimated_difficulty is already present and in [0.2, 0.9] use it directly.
 *   - stem_latex: rag_examples.latex_content, practice.latex_content
 *   - solution_latex: row.solution_latex
 *   - choices: row.choices (already 4-element array)
 *   - correct_index: row.correct_index
 *   - category_id: derived from the first keyword weight mapped to a math_keyword
 *   - embedding: copy if present, otherwise NULL
 *   - Idempotent on source_id: skip rows already imported.
 *   - NEVER modifies source tables.
 *
 * Resume-safe: checks existing math_questions.source_id before inserting.
 * Progress log every 25 items.
 * --dry-run: prints what would be imported, no DB writes.
 *
 * Usage:
 *   tsx scripts/import-math-problems.ts
 *   tsx scripts/import-math-problems.ts --dry-run
 *
 * npm: npm run math:import
 *
 * Env: root .env.local (Supabase) + apps/student/.env.local (OPENAI_API_KEY).
 * Supabase: nnkpvezsyumryhnulyvt (service-role)
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
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

// ─── CLI flags ────────────────────────────────────────────────────────────────
const isDryRun = process.argv.includes("--dry-run");

// ─── Difficulty map (1–5 → 0.2–0.9) ─────────────────────────────────────────
const DIFF_MAP: Record<number, number> = {
  1: 0.25,
  2: 0.40,
  3: 0.55,
  4: 0.70,
  5: 0.85,
};

function mapDifficulty(raw: unknown): number {
  if (typeof raw === "number" && raw >= 0.2 && raw <= 0.9) return raw;
  if (typeof raw === "number" && DIFF_MAP[raw] !== undefined) return DIFF_MAP[raw]!;
  return 0.55; // default medium
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function tagByEmbedding(
  embedding: number[],
  keywords: { id: string; category_id: string; embedding: unknown }[]
): { weights: Record<string, number>; categoryId: string | null } {
  const withEmbed = keywords.filter(
    (k) => Array.isArray(k.embedding) && (k.embedding as unknown[]).length > 0
  );
  if (withEmbed.length === 0) return { weights: {}, categoryId: null };

  const scored = withEmbed
    .map((kw) => ({
      id: kw.id,
      catId: kw.category_id,
      sim: cosineSimilarity(embedding, kw.embedding as number[]),
    }))
    .sort((a, b) => b.sim - a.sim);

  let top = scored.slice(0, 4).filter((k) => k.sim > 0.25);
  if (top.length === 0) top = scored.slice(0, 2);
  if (top.length === 0) return { weights: {}, categoryId: null };

  const total = top.reduce((acc, k) => acc + k.sim, 0);
  if (total === 0) return { weights: {}, categoryId: null };

  const weights = Object.fromEntries(top.map((k) => [k.id, k.sim / total]));
  return { weights, categoryId: top[0]!.catId };
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface RagRow {
  id: string;
  latex_content: string;
  solution_latex: string | null;
  choices: string[];
  correct_index: number;
  difficulty: number | null;
  keyword_weights: Record<string, number> | null;
  embedding: number[] | null;
}

interface PracticeRow {
  id: string;
  latex_content: string;
  solution_latex: string | null;
  choices: string[];
  correct_index: number;
  difficulty: number | null;
  hint_latex: string | null;
  keyword_id: string | null;  // single keyword ref in practice/mastery
  embedding: number[] | null;
}

interface MathKeywordRef {
  id: string;
  category_id: string;
  embedding: unknown;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== import-math-problems ===");
  if (isDryRun) console.log("[DRY RUN] No DB writes.");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Load math_keywords (paginated — 1732 rows exceeds Supabase default 1000 limit)
  console.log("\nLoading math_keywords for mapping...");
  const MK_PAGE = 1000;
  let mathKeywords: (MathKeywordRef & { source_learn_keyword_id: string | null; tier: string })[] = [];
  let mkPage = 0;
  while (true) {
    const { data: mkPage1, error: mkErr } = await supabase
      .from("math_keywords")
      .select("id, category_id, source_learn_keyword_id, embedding, tier")
      .range(mkPage * MK_PAGE, (mkPage + 1) * MK_PAGE - 1);
    if (mkErr) { console.error("math_keywords fetch error:", mkErr.message); process.exit(1); }
    const batch = (mkPage1 ?? []) as (MathKeywordRef & { source_learn_keyword_id: string | null; tier: string })[];
    mathKeywords = mathKeywords.concat(batch);
    if (batch.length < MK_PAGE) break;
    mkPage++;
  }

  // Build: learn_keyword_id → math_keyword_id (and category_id)
  const learnToMath = new Map<string, { mathId: string; catId: string }>();
  for (const mk of mathKeywords) {
    if (mk.source_learn_keyword_id) {
      learnToMath.set(mk.source_learn_keyword_id, {
        mathId: mk.id,
        catId: mk.category_id,
      });
    }
  }
  console.log(`  learn→math map: ${learnToMath.size} entries`);

  // ── OpenAI client (for fallback embedding)
  let openai: OpenAI | null = null;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) openai = new OpenAI({ apiKey: openaiKey });

  // Helper: embed a text string for fallback tagging
  const embedText = async (text: string): Promise<number[] | null> => {
    if (!openai) return null;
    try {
      const res = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      });
      return res.data[0]!.embedding;
    } catch { return null; }
  };

  // ── Load existing math_questions source_ids to skip already-imported rows
  console.log("\nLoading existing math_questions source_ids...");
  const { data: existingRaw, error: exErr } = await supabase
    .from("math_questions")
    .select("source_id, source");
  if (exErr) { console.error("Existing questions fetch error:", exErr.message); process.exit(1); }
  const existingSourceIds = new Set(
    (existingRaw ?? []).map((r: { source_id: string }) => r.source_id)
  );
  console.log(`  Already imported: ${existingSourceIds.size} rows`);

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: remap keyword_weights from learn IDs to math IDs
  // Returns { newWeights, categoryId }
  // Falls back to embedding-based tagging if direct mapping fails.
  // ─────────────────────────────────────────────────────────────────────────
  const remapWeights = async (
    oldWeights: Record<string, number> | null,
    stemForFallback: string,
    sourceEmbedding: number[] | null
  ): Promise<{ newWeights: Record<string, number>; categoryId: string | null }> => {
    if (!oldWeights || Object.keys(oldWeights).length === 0) {
      // No weights: use embedding fallback
      const emb = sourceEmbedding ?? await embedText(stemForFallback);
      if (!emb) return { newWeights: {}, categoryId: null };
      const fb = tagByEmbedding(emb, mathKeywords);
      return { newWeights: fb.weights, categoryId: fb.categoryId };
    }

    const newWeights: Record<string, number> = {};
    let totalWeight = 0;
    let firstCatId: string | null = null;
    let anyMapped = false;

    for (const [oldId, weight] of Object.entries(oldWeights)) {
      const mapped = learnToMath.get(oldId);
      if (mapped) {
        newWeights[mapped.mathId] = weight;
        totalWeight += weight;
        if (!firstCatId) firstCatId = mapped.catId;
        anyMapped = true;
      }
      // unmapped keys are dropped silently (they don't exist in math_keywords)
    }

    if (!anyMapped) {
      // Complete miss — use embedding fallback
      const emb = sourceEmbedding ?? await embedText(stemForFallback);
      if (!emb) return { newWeights: {}, categoryId: null };
      const fb = tagByEmbedding(emb, mathKeywords);
      return { newWeights: fb.weights, categoryId: fb.categoryId };
    }

    // Normalize weights to sum to ~1
    if (totalWeight > 0) {
      for (const k in newWeights) newWeights[k] = newWeights[k]! / totalWeight;
    }

    return { newWeights, categoryId: firstCatId };
  };

  let importedCount = 0;
  let skippedCount  = 0;
  let failedCount   = 0;
  const LOG_EVERY   = 25;

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1: rag_examples → math_questions
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Phase 1: rag_examples (course=precalc) ---");

  const { data: ragRows, error: ragErr } = await supabase
    .from("rag_examples")
    .select("id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights, embedding")
    .order("created_at");
  if (ragErr) { console.error("rag_examples fetch error:", ragErr.message); process.exit(1); }
  const ragAll = (ragRows ?? []) as RagRow[];
  console.log(`  rag_examples rows: ${ragAll.length}`);

  for (const row of ragAll) {
    const sourceId = row.id;
    if (existingSourceIds.has(sourceId)) {
      skippedCount++;
      continue;
    }

    const { newWeights, categoryId } = await remapWeights(
      row.keyword_weights,
      row.latex_content,
      row.embedding
    );

    if (!categoryId) {
      // Cannot determine category — skip this row
      console.warn(`  [WARN] Could not determine category for rag row ${sourceId}, skipping.`);
      failedCount++;
      continue;
    }

    const record = {
      category_id:    categoryId,
      stem_latex:     row.latex_content,
      solution_latex: row.solution_latex ?? "",
      choices:        row.choices,
      correct_index:  row.correct_index,
      difficulty:     mapDifficulty(row.difficulty),
      keyword_weights: newWeights,
      source:         "imported_rag",
      source_id:      sourceId,
      embedding:      row.embedding ?? null,
      status:         "active",
    };

    if (isDryRun) {
      importedCount++;
      if (importedCount % LOG_EVERY === 0) {
        console.log(`  [DRY RUN] Would import ${importedCount} so far...`);
      }
      continue;
    }

    const { error: insErr } = await supabase.from("math_questions").insert(record);
    if (insErr) {
      console.error(`  [ERROR] Insert failed for rag row ${sourceId}: ${insErr.message}`);
      failedCount++;
    } else {
      importedCount++;
      existingSourceIds.add(sourceId);
      if (importedCount % LOG_EVERY === 0) {
        console.log(`  Progress: ${importedCount} imported, ${skippedCount} skipped, ${failedCount} failed`);
      }
    }
  }
  console.log(`  Phase 1 done: ${importedCount} rag rows imported`);

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2: learn_practice_problems + learn_mastery_quiz_problems
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n--- Phase 2: learn_practice_problems + learn_mastery_quiz_problems ---");

  const { data: practiceRows, error: practErr } = await supabase
    .from("learn_practice_problems")
    .select("id, latex_content, solution_latex, choices, correct_index, difficulty, hint_latex, embedding")
    .order("created_at");
  if (practErr) { console.error("learn_practice_problems fetch error:", practErr.message); process.exit(1); }

  const { data: masteryRows, error: mastErr } = await supabase
    .from("learn_mastery_quiz_problems")
    .select("id, latex_content, solution_latex, choices, correct_index, difficulty")
    .order("created_at");
  if (mastErr) { console.error("learn_mastery_quiz_problems fetch error:", mastErr.message); process.exit(1); }

  // Also load keyword_id from practice table (separate select to avoid type issues)
  const { data: practiceKwRows } = await supabase
    .from("learn_practice_problems")
    .select("id, keyword_id")
    .order("created_at");
  const practiceKwMap = new Map(
    (practiceKwRows ?? []).map((r: { id: string; keyword_id: string | null }) => [r.id, r.keyword_id])
  );

  const combinedPractice: (PracticeRow & { tableName: string })[] = [
    ...(practiceRows ?? []).map((r) => ({
      ...r as PracticeRow,
      hint_latex: (r as { hint_latex?: string | null }).hint_latex ?? null,
      tableName: "learn_practice_problems",
    })),
    ...(masteryRows ?? []).map((r) => ({
      ...r as PracticeRow,
      hint_latex: null,
      keyword_id: null,
      tableName: "learn_mastery_quiz_problems",
    })),
  ];

  console.log(`  Combined practice rows: ${combinedPractice.length}`);
  let practiceImported = 0;

  for (const row of combinedPractice) {
    const sourceId = row.id;
    if (existingSourceIds.has(sourceId)) {
      skippedCount++;
      continue;
    }

    // For practice rows, keyword_id is a single learn_keyword id
    const kwId = practiceKwMap.get(row.id) ?? null;
    let categoryId: string | null = null;
    let newWeights: Record<string, number> = {};

    if (kwId) {
      const mapped = learnToMath.get(kwId);
      if (mapped) {
        newWeights = { [mapped.mathId]: 1.0 };
        categoryId = mapped.catId;
      }
    }

    if (!categoryId) {
      // Fallback: embed the stem
      const emb = row.embedding ?? await embedText(row.latex_content);
      if (emb) {
        const result = tagByEmbedding(emb, mathKeywords);
        newWeights = result.weights;
        categoryId = result.categoryId;
      }
    }

    if (!categoryId) {
      console.warn(`  [WARN] Could not determine category for practice row ${sourceId}, skipping.`);
      failedCount++;
      continue;
    }

    const record = {
      category_id:    categoryId,
      stem_latex:     row.latex_content,
      solution_latex: row.solution_latex ?? "",
      choices:        row.choices,
      correct_index:  row.correct_index,
      difficulty:     mapDifficulty(row.difficulty),
      hint_latex:     row.hint_latex ?? null,
      keyword_weights: newWeights,
      source:         "imported_practice",
      source_id:      sourceId,
      embedding:      row.embedding ?? null,
      status:         "active",
    };

    if (isDryRun) {
      practiceImported++;
      continue;
    }

    const { error: insErr } = await supabase.from("math_questions").insert(record);
    if (insErr) {
      console.error(`  [ERROR] Insert failed for practice row ${sourceId}: ${insErr.message}`);
      failedCount++;
    } else {
      practiceImported++;
      existingSourceIds.add(sourceId);
    }
  }

  importedCount += practiceImported;
  console.log(`  Phase 2 done: ${practiceImported} practice rows imported`);

  // ── Final counts
  console.log("\n=== Summary ===");
  if (isDryRun) {
    console.log(`  [DRY RUN] Would import: ${importedCount}`);
    console.log(`  Would skip (already imported): ${skippedCount}`);
    console.log(`  Would fail (no category): ${failedCount}`);
  } else {
    console.log(`  Imported: ${importedCount}`);
    console.log(`  Skipped (already existed): ${skippedCount}`);
    console.log(`  Failed (no category): ${failedCount}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
