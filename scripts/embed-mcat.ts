/**
 * Generates and stores vector embeddings for mcat_keywords, mcat_questions, and mcat_flashcards.
 * Phase 1: embed keywords (text = "label. description")
 * Phase 2: embed questions (text = "stem | choice[correct_index]") and
 *          retag keyword_weights via cosine similarity against in_depth keywords
 *          of the same category.
 * Phase 3: embed flashcards (text = "front | back") and retag keyword_weights
 *          via the same cosine approach as Phase 2.
 *
 * Usage:
 *   tsx scripts/embed-mcat.ts
 *   tsx scripts/embed-mcat.ts --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { createServiceClient } from "./lib/serviceClient";

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface KeywordRow {
  id: string;
  category_id: string;
  label: string;
  description: string | null;
  tier: "umbrella" | "in_depth";
  embedding: number[] | null;
}

interface QuestionRow {
  id: string;
  category_id: string;
  stem: string;
  choices: string[];
  correct_index: number;
  keyword_weights: Record<string, number> | null;
  embedding: number[] | null;
}

interface FlashcardRow {
  id: string;
  category_id: string;
  front: string;
  back: string;
  keyword_weights: Record<string, number> | null;
  embedding: number[] | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/** Standard cosine similarity (same implementation as apps/student/app/api/lookup/route.ts) */
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

async function embedBatch(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

// ─── Phase 1: Embed keywords ──────────────────────────────────────────────────

async function embedKeywords(
  supabase: ReturnType<typeof createClient>,
  openai: OpenAI,
  isDryRun: boolean
): Promise<number> {
  console.log("\n--- Phase 1: mcat_keywords embeddings ---");

  const { data, error } = await supabase
    .from("mcat_keywords")
    .select("id, category_id, label, description, tier, embedding")
    .is("embedding", null)
    // Only in_depth keywords are embedded from their own label+description.
    // Umbrellas are centroids of their children (recompute-umbrella-embeddings.ts).
    .eq("tier", "in_depth");

  if (error) {
    console.error("Fetch error:", error.message);
    return 0;
  }
  const rows = (data ?? []) as KeywordRow[];
  console.log(`  Keywords needing embedding: ${rows.length}`);

  if (isDryRun) {
    console.log("  [DRY RUN] Skipping all writes.");
    return rows.length;
  }
  if (rows.length === 0) {
    console.log("  Nothing to do.");
    return 0;
  }

  const BATCH = 100;
  let embedded = 0;

  for (const batch of chunk(rows, BATCH)) {
    const texts = batch.map(
      (kw) => `${kw.label}. ${kw.description ?? ""}`.trim()
    );

    let embeddings: number[][];
    try {
      embeddings = await embedBatch(openai, texts);
    } catch (e) {
      console.error(`  [ERROR] Embedding batch failed:`, e);
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const { error: updErr } = await supabase
        .from("mcat_keywords")
        .update({ embedding: embeddings[j] })
        .eq("id", batch[j]!.id);
      if (updErr) {
        console.error(`  [ERROR] Update failed for keyword ${batch[j]!.id}:`, updErr.message);
      } else {
        embedded++;
      }
    }
    console.log(`  Batch done: ${embedded} keywords embedded so far.`);
  }

  console.log(`  Phase 1 complete: ${embedded} keywords embedded.`);
  return embedded;
}

// ─── Shared: fetch in_depth keywords grouped by category ──────────────────────

/**
 * Fetches all in_depth mcat_keywords that have embeddings and returns them
 * grouped by category_id. Shared by Phase 2 (questions) and Phase 3 (flashcards).
 */
async function fetchKeywordsByCategory(
  supabase: ReturnType<typeof createClient>
): Promise<{ kwByCategory: Map<string, KeywordRow[]>; total: number } | null> {
  // Paginate: in_depth keywords across both sections now exceed PostgREST's
  // 1000-row cap (Biology + Psych/Soc), so an un-paginated select would
  // silently truncate the retag reference set.
  const inDepthKeywords: KeywordRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: kwData, error: kwErr } = await supabase
      .from("mcat_keywords")
      .select("id, category_id, embedding")
      .eq("tier", "in_depth")
      .not("embedding", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);

    if (kwErr) {
      console.error("  Keyword fetch error:", kwErr.message);
      return null;
    }
    const rows = (kwData ?? []) as KeywordRow[];
    inDepthKeywords.push(...rows);
    if (rows.length < PAGE) break;
  }
  const kwByCategory = new Map<string, KeywordRow[]>();
  for (const kw of inDepthKeywords) {
    const list = kwByCategory.get(kw.category_id) ?? [];
    list.push(kw);
    kwByCategory.set(kw.category_id, list);
  }
  return { kwByCategory, total: inDepthKeywords.length };
}

/**
 * Given an embedding and the in_depth keywords for a category, compute
 * cosine-similarity-based keyword_weights using the same logic as Phase 2.
 * Top 4 with sim > 0.25; fallback top 2. Normalized to sum 1.
 */
function computeKeywordWeights(
  embedding: number[],
  categoryKws: KeywordRow[]
): Record<string, number> | null {
  if (categoryKws.length === 0) return null;

  const scored = categoryKws
    .map((kw) => ({
      id: kw.id,
      sim: cosineSimilarity(embedding, kw.embedding!),
    }))
    .sort((a, b) => b.sim - a.sim);

  const SIM_THRESHOLD = 0.25;
  let selected = scored.filter((s) => s.sim > SIM_THRESHOLD).slice(0, 4);
  if (selected.length === 0) {
    selected = scored.slice(0, 2);
  }

  const totalSim = selected.reduce((acc, s) => acc + s.sim, 0);
  if (totalSim === 0) return null;

  return Object.fromEntries(selected.map((s) => [s.id, s.sim / totalSim]));
}

// ─── Phase 2: Embed questions + retag keyword_weights ─────────────────────────

async function embedQuestions(
  supabase: ReturnType<typeof createClient>,
  openai: OpenAI,
  isDryRun: boolean,
  kwByCategory: Map<string, KeywordRow[]>,
  kwTotal: number
): Promise<{ questionsEmbedded: number; questionsRetagged: number }> {
  console.log("\n--- Phase 2: mcat_questions embeddings + keyword retagging ---");

  const { data: qData, error: qErr } = await supabase
    .from("mcat_questions")
    .select("id, category_id, stem, choices, correct_index, keyword_weights, embedding")
    .is("embedding", null)
    .eq("status", "active");

  if (qErr) {
    console.error("Fetch error:", qErr.message);
    return { questionsEmbedded: 0, questionsRetagged: 0 };
  }
  const questions = (qData ?? []) as QuestionRow[];
  console.log(`  Questions needing embedding: ${questions.length}`);

  if (isDryRun) {
    console.log("  [DRY RUN] Skipping all writes.");
    return { questionsEmbedded: questions.length, questionsRetagged: questions.length };
  }
  if (questions.length === 0) {
    console.log("  Nothing to do.");
    return { questionsEmbedded: 0, questionsRetagged: 0 };
  }

  console.log(
    `  Loaded ${kwTotal} in_depth keywords with embeddings across ${kwByCategory.size} categories.`
  );

  const BATCH = 100;
  let questionsEmbedded = 0;
  let questionsRetagged = 0;

  for (const batch of chunk(questions, BATCH)) {
    const texts = batch.map((q) => {
      const correctChoice =
        Array.isArray(q.choices) && q.choices[q.correct_index] != null
          ? String(q.choices[q.correct_index])
          : "";
      return `${q.stem} | ${correctChoice}`.trim();
    });

    let embeddings: number[][];
    try {
      embeddings = await embedBatch(openai, texts);
    } catch (e) {
      console.error(`  [ERROR] Embedding batch failed:`, e);
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const q = batch[j]!;
      const qEmb = embeddings[j]!;

      // Retag keyword_weights via cosine similarity (shared helper)
      const newWeights = computeKeywordWeights(qEmb, kwByCategory.get(q.category_id) ?? []);

      // Build update payload
      const updatePayload: Record<string, unknown> = { embedding: qEmb };
      if (newWeights !== null) {
        updatePayload.keyword_weights = newWeights;
      }

      const { error: updErr } = await supabase
        .from("mcat_questions")
        .update(updatePayload)
        .eq("id", q.id);

      if (updErr) {
        console.error(`  [ERROR] Update failed for question ${q.id}:`, updErr.message);
      } else {
        questionsEmbedded++;
        if (newWeights !== null) questionsRetagged++;
      }
    }
    console.log(
      `  Batch done: ${questionsEmbedded} questions embedded, ${questionsRetagged} retagged so far.`
    );
  }

  console.log(
    `  Phase 2 complete: ${questionsEmbedded} questions embedded, ${questionsRetagged} retagged.`
  );
  return { questionsEmbedded, questionsRetagged };
}

// ─── Phase 3: Embed flashcards + retag keyword_weights ────────────────────────

async function embedFlashcards(
  supabase: ReturnType<typeof createClient>,
  openai: OpenAI,
  isDryRun: boolean,
  kwByCategory: Map<string, KeywordRow[]>,
  kwTotal: number
): Promise<{ flashcardsEmbedded: number; flashcardsRetagged: number }> {
  console.log("\n--- Phase 3: mcat_flashcards embeddings + keyword retagging ---");

  let flashcards: FlashcardRow[] = [];
  try {
    const { data: fData, error: fErr } = await supabase
      .from("mcat_flashcards")
      .select("id, category_id, front, back, keyword_weights, embedding")
      .is("embedding", null)
      .eq("status", "active");

    if (fErr) {
      // Guard against the column not existing yet (migration not applied)
      if (fErr.message?.includes("embedding") || fErr.code === "42703") {
        console.warn(
          "  [WARN] flashcard embedding column not yet migrated — skipping Phase 3."
        );
        console.warn("         Apply supabase/migrations/20260612000000_mcat_flashcard_embedding.sql first.");
        return { flashcardsEmbedded: 0, flashcardsRetagged: 0 };
      }
      console.error("  Fetch error:", fErr.message);
      return { flashcardsEmbedded: 0, flashcardsRetagged: 0 };
    }
    flashcards = (fData ?? []) as FlashcardRow[];
  } catch (err: unknown) {
    // Catch unexpected errors from the column not existing
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("embedding")) {
      console.warn(
        "  [WARN] flashcard embedding column not yet migrated — skipping Phase 3."
      );
      return { flashcardsEmbedded: 0, flashcardsRetagged: 0 };
    }
    throw err;
  }

  console.log(`  Flashcards needing embedding: ${flashcards.length}`);

  if (isDryRun) {
    console.log("  [DRY RUN] Skipping all writes.");
    return { flashcardsEmbedded: flashcards.length, flashcardsRetagged: flashcards.length };
  }
  if (flashcards.length === 0) {
    console.log("  Nothing to do.");
    return { flashcardsEmbedded: 0, flashcardsRetagged: 0 };
  }

  console.log(
    `  Using ${kwTotal} in_depth keywords across ${kwByCategory.size} categories for retagging.`
  );

  const BATCH = 100;
  let flashcardsEmbedded = 0;
  let flashcardsRetagged = 0;

  for (const batch of chunk(flashcards, BATCH)) {
    const texts = batch.map((fc) => {
      // Concatenate front and back; truncate to ~8000 chars to stay within token limits
      const raw = `${fc.front} | ${fc.back}`;
      return raw.length > 8000 ? raw.slice(0, 8000) : raw;
    });

    let embeddings: number[][];
    try {
      embeddings = await embedBatch(openai, texts);
    } catch (e) {
      console.error(`  [ERROR] Embedding batch failed:`, e);
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const fc = batch[j]!;
      const fcEmb = embeddings[j]!;

      // Retag keyword_weights via cosine similarity — same approach as Phase 2
      const newWeights = computeKeywordWeights(fcEmb, kwByCategory.get(fc.category_id) ?? []);

      const updatePayload: Record<string, unknown> = { embedding: fcEmb };
      if (newWeights !== null) {
        updatePayload.keyword_weights = newWeights;
      }

      const { error: updErr } = await supabase
        .from("mcat_flashcards")
        .update(updatePayload)
        .eq("id", fc.id);

      if (updErr) {
        console.error(`  [ERROR] Update failed for flashcard ${fc.id}:`, updErr.message);
      } else {
        flashcardsEmbedded++;
        if (newWeights !== null) flashcardsRetagged++;
      }
    }
    console.log(
      `  Batch done: ${flashcardsEmbedded} flashcards embedded, ${flashcardsRetagged} retagged so far.`
    );
  }

  console.log(
    `  Phase 3 complete: ${flashcardsEmbedded} flashcards embedded, ${flashcardsRetagged} retagged.`
  );
  return { flashcardsEmbedded, flashcardsRetagged };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== embed-mcat ===");
  if (isDryRun) console.log("[DRY RUN] Reporting counts only — no writes or OpenAI calls.");

  // ── Supabase client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createServiceClient(supabaseUrl, serviceKey);

  // ── OpenAI client (only needed for live runs)
  let openai!: OpenAI;
  if (!isDryRun) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.error("Missing OPENAI_API_KEY");
      process.exit(1);
    }
    openai = new OpenAI({ apiKey: openaiKey });
  } else {
    // Instantiate a dummy for type safety; it won't be called in dry-run
    openai = {} as OpenAI;
  }

  const keywordsEmbedded = await embedKeywords(supabase, openai, isDryRun);

  // Fetch in_depth keywords once and share between Phase 2 and Phase 3.
  // In dry-run mode we still fetch so we can show accurate retag estimates.
  let kwByCategory = new Map<string, KeywordRow[]>();
  let kwTotal = 0;
  if (!isDryRun) {
    const kwResult = await fetchKeywordsByCategory(supabase);
    if (kwResult) {
      kwByCategory = kwResult.kwByCategory;
      kwTotal = kwResult.total;
    }
  }

  const { questionsEmbedded, questionsRetagged } = await embedQuestions(
    supabase,
    openai,
    isDryRun,
    kwByCategory,
    kwTotal
  );

  const { flashcardsEmbedded, flashcardsRetagged } = await embedFlashcards(
    supabase,
    openai,
    isDryRun,
    kwByCategory,
    kwTotal
  );

  console.log("\n=== Summary ===");
  if (isDryRun) {
    console.log(`  Keywords that need embedding:     ${keywordsEmbedded}`);
    console.log(`  Questions that need embedding:    ${questionsEmbedded}`);
    console.log(`  Questions that would be retagged: ${questionsRetagged}`);
    console.log(`  Flashcards that need embedding:   ${flashcardsEmbedded}`);
    console.log(`  Flashcards that would be retagged:${flashcardsRetagged}`);
    console.log("\n[DRY RUN] Done. No writes performed.");
  } else {
    console.log(`  Keywords embedded:     ${keywordsEmbedded}`);
    console.log(`  Questions embedded:    ${questionsEmbedded}`);
    console.log(`  Questions retagged:    ${questionsRetagged}`);
    console.log(`  Flashcards embedded:   ${flashcardsEmbedded}`);
    console.log(`  Flashcards retagged:   ${flashcardsRetagged}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
