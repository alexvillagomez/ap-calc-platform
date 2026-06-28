/**
 * LEAK-HUNT HARNESS — generate fresh content for a set of keywords through the
 * NEW universal scope-contract path, WITHOUT touching the DB cache or writing
 * anything. For each keyword it resolves the scope contract exactly as the live
 * routes now do, then generates a lesson + a question batch + flashcards, and
 * dumps everything (incl. the contract) to /tmp/leakhunt/<keyword>.json for the
 * Sonnet leak-hunters to judge.
 *
 * Run: tsx scripts/leakhunt-generate.ts            (default test set)
 *      tsx scripts/leakhunt-generate.ts <id> <id>  (specific keyword ids)
 *
 * Env: root .env.local (Supabase) + apps/student/.env.local (OPENAI_API_KEY).
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import ws from "ws";
// Node < 22 has no global WebSocket; supabase-js constructs a RealtimeClient eagerly.
if (!(globalThis as any).WebSocket) (globalThis as any).WebSocket = ws;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  for (const [k, v] of Object.entries(studentEnv)) {
    if (k === "OPENAI_API_KEY" || !process.env[k]) process.env[k] = v as string;
  }
}

import { resolveScopeContract } from "../apps/student/lib/scopeContract.js";
import {
  generateMathLesson,
  generateMathQuestions,
  generateMathFlashcards,
} from "../apps/student/lib/mathGenerator.js";
import {
  generateMcatLesson,
  generateMcatQuestions,
  generateMcatFlashcards,
} from "../apps/student/lib/mcatGenerator.js";
import { outlineContextForCategory as mathOutline } from "../apps/student/lib/mathContentOutline.js";
import { outlineContextForCategory as mcatOutline } from "../apps/student/lib/mcatContentOutline.js";

const MATH_KEYWORDS = [
  "limit_1_introducing_limits_and_notation",
  "limit_1_intuitive_meaning_of_a_limit",
  "limit_1_estimating_from_graphs",
  "limit_1_estimating_from_tables",
  "limit_1_types_of_discontinuities",
  "limit_1_algebraic_manipulation",
];
const MCAT_KEYWORDS = [
  "amino_acid_structure_and_stereochemistry",
  "what_is_an_amino_acid_overview",
  "amino_acid_classification_and_side_chain_properties",
  "amino_acid_ionization_and_isoelectric_point",
  "peptide_bonds_and_protein_primary_structure",
];

// NOCONTRACT mode reproduces the OLD behavior: pass only the RAW stored
// blueprint (null for umbrellas / intro keywords) with NO derived forward fence
// — so we can measure before/after drift.
const NOCONTRACT = process.env.LEAKHUNT_NOCONTRACT === "1";
const OUT_DIR = process.env.LEAKHUNT_OUT || (NOCONTRACT ? "/tmp/leakhunt-before" : "/tmp/leakhunt");

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, serviceKey);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const argIds = process.argv.slice(2);
  const all = argIds.length
    ? argIds.map((id) => ({ id, sys: id.startsWith("limit_") || id.startsWith("calc") ? "math" : "mcat" }))
    : [
        ...MATH_KEYWORDS.map((id) => ({ id, sys: "math" as const })),
        ...MCAT_KEYWORDS.map((id) => ({ id, sys: "mcat" as const })),
      ];

  for (const { id, sys } of all) {
    const table = sys === "math" ? "math_keywords" : "mcat_keywords";
    const { data: kw } = await supabase
      .from(table)
      .select("id, label, description, examples, tier, parent_keyword_id, category_id, concept_blueprint")
      .eq("id", id)
      .maybeSingle();
    if (!kw) {
      console.error(`SKIP ${id}: not found`);
      continue;
    }

    const contract = NOCONTRACT
      ? (kw.concept_blueprint as any) // OLD behavior: raw stored bp (null for umbrellas)
      : await resolveScopeContract(supabase, table as any, {
          id: kw.id,
          label: kw.label,
          description: kw.description ?? "",
          tier: kw.tier,
          parent_keyword_id: kw.parent_keyword_id,
          category_id: kw.category_id,
          concept_blueprint: kw.concept_blueprint,
        });

    const outline = sys === "math" ? mathOutline(kw.category_id) : mcatOutline(kw.category_id);
    const kwMeta = {
      id: kw.id,
      label: kw.label,
      description: kw.description ?? "",
      blueprint: (contract as any) ?? kw.concept_blueprint ?? null,
    };
    const examplesText = Array.isArray(kw.examples)
      ? (kw.examples as string[]).join("; ")
      : (kw.examples as string | null) ?? undefined;

    const record: any = {
      keyword_id: kw.id,
      label: kw.label,
      tier: kw.tier,
      description: kw.description,
      had_stored_blueprint: !!kw.concept_blueprint,
      resolved_contract: contract,
    };

    try {
      if (sys === "math") {
        record.lesson = await generateMathLesson(
          { ...kwMeta, examples: examplesText },
          outline
        );
      } else {
        record.lesson = await generateMcatLesson(
          { ...kwMeta, examples: examplesText },
          outline
        );
      }
      console.log(`  lesson ok: ${id}`);
    } catch (e) {
      record.lesson_error = String(e);
      console.error(`  lesson FAIL ${id}: ${e}`);
    }

    try {
      const qs =
        sys === "math"
          ? await generateMathQuestions({ keywords: [kwMeta], count: 2, outlineContext: outline })
          : await generateMcatQuestions({
              keywords: [kwMeta],
              templateCards: [],
              count: 2,
              outlineContext: outline,
            });
      record.questions = qs;
      console.log(`  questions ok: ${id} (${qs.length})`);
    } catch (e) {
      record.questions_error = String(e);
      console.error(`  questions FAIL ${id}: ${e}`);
    }

    try {
      const cards =
        sys === "math"
          ? await generateMathFlashcards({ keywords: [kwMeta], count: 6, outlineContext: outline })
          : await generateMcatFlashcards({ keywords: [kwMeta], count: 6, outlineContext: outline, templateCards: [] });
      record.flashcards = cards;
      console.log(`  flashcards ok: ${id} (${cards.length})`);
    } catch (e) {
      record.flashcards_error = String(e);
      console.error(`  flashcards FAIL ${id}: ${e}`);
    }

    fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(record, null, 2));
    console.log(`WROTE ${id}.json`);
  }
  console.log("DONE");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
