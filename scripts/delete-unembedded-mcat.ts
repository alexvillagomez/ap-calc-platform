/**
 * Removes mcat_questions and mcat_flashcards that still have no embedding,
 * along with their child attempt rows, so every served row is embedded.
 *
 * Safety: requires --apply to actually delete. Without it, the script runs as
 * a dry-run and prints "[DRY] (pass --apply to delete)".
 *
 * Usage:
 *   tsx scripts/delete-unembedded-mcat.ts            # dry-run (safe default)
 *   tsx scripts/delete-unembedded-mcat.ts --apply    # actually deletes
 *   tsx scripts/delete-unembedded-mcat.ts --dry-run  # explicit dry-run
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

// Load root .env.local — Supabase keys are valid here (no OpenAI needed).
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ─── CLI flags ────────────────────────────────────────────────────────────────

const hasApply = process.argv.includes("--apply");
const hasExplicitDryRun = process.argv.includes("--dry-run");
// Dry-run unless --apply is explicitly passed.
const isDryRun = !hasApply;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== delete-unembedded-mcat ===");
  if (isDryRun) {
    console.log("[DRY] Reporting counts only — no deletes will be performed.");
    console.log("[DRY] (pass --apply to delete)\n");
  } else {
    console.log("[APPLY] Deleting unembedded rows and their attempts.\n");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Questions ──────────────────────────────────────────────────────────────

  console.log("--- mcat_questions (no embedding) ---");

  const { data: unembeddedQuestions, error: qErr } = await supabase
    .from("mcat_questions")
    .select("id")
    .is("embedding", null);

  if (qErr) {
    console.error("  Fetch error:", qErr.message);
    process.exit(1);
  }

  const questionIds = (unembeddedQuestions ?? []).map((r: { id: string }) => r.id);
  console.log(`  Questions without embedding: ${questionIds.length}`);

  let attemptQuestionsDeleted = 0;
  let questionsDeleted = 0;

  if (questionIds.length > 0) {
    if (isDryRun) {
      // Count attempts without deleting
      const { count, error: cntErr } = await supabase
        .from("mcat_question_attempts")
        .select("id", { count: "exact", head: true })
        .in("question_id", questionIds);
      if (cntErr) {
        console.warn("  [WARN] Could not count question attempts:", cntErr.message);
      } else {
        console.log(`  Question attempts that WOULD be deleted: ${count ?? 0}`);
      }
      console.log(`  Questions that WOULD be deleted: ${questionIds.length}`);
    } else {
      // Delete attempts first (FK constraint), in chunks of 100
      for (const ids of chunk(questionIds, 100)) {
        const { data: deleted, error: attErr } = await supabase
          .from("mcat_question_attempts")
          .delete()
          .in("question_id", ids)
          .select("id");
        if (attErr) {
          console.error("  [ERROR] Deleting question attempts:", attErr.message);
        } else {
          attemptQuestionsDeleted += (deleted ?? []).length;
        }
      }
      console.log(`  Question attempts deleted: ${attemptQuestionsDeleted}`);

      // Delete the questions themselves, in chunks of 100
      for (const ids of chunk(questionIds, 100)) {
        const { data: deleted, error: delErr } = await supabase
          .from("mcat_questions")
          .delete()
          .in("id", ids)
          .select("id");
        if (delErr) {
          console.error("  [ERROR] Deleting questions:", delErr.message);
        } else {
          questionsDeleted += (deleted ?? []).length;
        }
      }
      console.log(`  Questions deleted: ${questionsDeleted}`);
    }
  } else {
    console.log("  Nothing to do.");
  }

  // ── Flashcards ─────────────────────────────────────────────────────────────

  console.log("\n--- mcat_flashcards (no embedding) ---");

  let flashcardIds: string[] = [];
  try {
    const { data: unembeddedFlashcards, error: fErr } = await supabase
      .from("mcat_flashcards")
      .select("id")
      .is("embedding", null);

    if (fErr) {
      if (fErr.message?.includes("embedding") || fErr.code === "42703") {
        console.warn(
          "  [WARN] flashcard embedding column not yet migrated — skipping flashcard cleanup."
        );
        console.warn(
          "         Apply supabase/migrations/20260612000000_mcat_flashcard_embedding.sql first."
        );
      } else {
        console.error("  Fetch error:", fErr.message);
      }
      // Proceed to summary rather than exiting
      flashcardIds = [];
    } else {
      flashcardIds = (unembeddedFlashcards ?? []).map((r: { id: string }) => r.id);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("embedding")) {
      console.warn(
        "  [WARN] flashcard embedding column not yet migrated — skipping flashcard cleanup."
      );
    } else {
      throw err;
    }
  }

  console.log(`  Flashcards without embedding: ${flashcardIds.length}`);

  let attemptFlashcardsDeleted = 0;
  let flashcardsDeleted = 0;

  if (flashcardIds.length > 0) {
    if (isDryRun) {
      const { count, error: cntErr } = await supabase
        .from("mcat_flashcard_attempts")
        .select("id", { count: "exact", head: true })
        .in("flashcard_id", flashcardIds);
      if (cntErr) {
        console.warn("  [WARN] Could not count flashcard attempts:", cntErr.message);
      } else {
        console.log(`  Flashcard attempts that WOULD be deleted: ${count ?? 0}`);
      }
      console.log(`  Flashcards that WOULD be deleted: ${flashcardIds.length}`);
    } else {
      // Delete attempts first (FK constraint), in chunks of 100
      for (const ids of chunk(flashcardIds, 100)) {
        const { data: deleted, error: attErr } = await supabase
          .from("mcat_flashcard_attempts")
          .delete()
          .in("flashcard_id", ids)
          .select("id");
        if (attErr) {
          console.error("  [ERROR] Deleting flashcard attempts:", attErr.message);
        } else {
          attemptFlashcardsDeleted += (deleted ?? []).length;
        }
      }
      console.log(`  Flashcard attempts deleted: ${attemptFlashcardsDeleted}`);

      // Delete the flashcards themselves, in chunks of 100
      for (const ids of chunk(flashcardIds, 100)) {
        const { data: deleted, error: delErr } = await supabase
          .from("mcat_flashcards")
          .delete()
          .in("id", ids)
          .select("id");
        if (delErr) {
          console.error("  [ERROR] Deleting flashcards:", delErr.message);
        } else {
          flashcardsDeleted += (deleted ?? []).length;
        }
      }
      console.log(`  Flashcards deleted: ${flashcardsDeleted}`);
    }
  } else if (flashcardIds.length === 0) {
    console.log("  Nothing to do.");
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log("\n=== Summary ===");
  if (isDryRun) {
    console.log(`  Questions without embedding:  ${questionIds.length}`);
    console.log(`  Flashcards without embedding: ${flashcardIds.length}`);
    console.log("\n[DRY] Done. No writes performed. (pass --apply to delete)");
  } else {
    console.log(`  Question attempts deleted: ${attemptQuestionsDeleted}`);
    console.log(`  Questions deleted:         ${questionsDeleted}`);
    console.log(`  Flashcard attempts deleted:${attemptFlashcardsDeleted}`);
    console.log(`  Flashcards deleted:        ${flashcardsDeleted}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
