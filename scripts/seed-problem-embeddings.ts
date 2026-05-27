/**
 * Generates and stores embeddings for learn_practice_problems and learn_diagnostic_problems.
 * Embeds: latex_content (stripped of tags) so queries like "simplifying exponents" match content.
 *
 * Usage: npx tsx scripts/seed-problem-embeddings.ts
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Strip JSX-like viz tags so they don't confuse the embedding model
function stripTags(text: string): string {
  return text.replace(/<(FunctionGraph|SlopeField)[^/]*/\/>/g, "").trim();
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

async function embedTable(table: "learn_practice_problems" | "learn_diagnostic_problems") {
  const { data: rows, error } = await supabase
    .from(table)
    .select("id, latex_content, solution_latex")
    .is("embedding", null);

  if (error) { console.error(`[${table}] fetch error:`, error.message); return; }
  if (!rows || rows.length === 0) { console.log(`[${table}] no rows need embedding`); return; }

  console.log(`[${table}] embedding ${rows.length} rows...`);

  const BATCH = 20;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const texts = batch.map((r) => {
      const content = stripTags(r.latex_content ?? "");
      const solution = stripTags(r.solution_latex ?? "");
      return [content, solution].filter(Boolean).join(" | ");
    });

    try {
      const embeddings = await embedBatch(texts);
      for (let j = 0; j < batch.length; j++) {
        const { error: updErr } = await supabase
          .from(table)
          .update({ embedding: embeddings[j] })
          .eq("id", batch[j]!.id);
        if (updErr) console.error(`  update failed for ${batch[j]!.id}:`, updErr.message);
      }
      console.log(`  batch ${i / BATCH + 1}: ${batch.length} rows done`);
    } catch (e) {
      console.error(`  batch ${i / BATCH + 1} error:`, e);
    }
  }

  console.log(`[${table}] done`);
}

(async () => {
  await embedTable("learn_practice_problems");
  await embedTable("learn_diagnostic_problems");
  console.log("All done.");
})();
