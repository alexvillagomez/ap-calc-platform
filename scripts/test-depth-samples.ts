/**
 * Depth-correction smoke test. Regenerates sample MCAT flashcards, questions,
 * and a lesson for a few keywords under the corrected prompts, prints them, and
 * flags any over-precise content (decimal pKa for side chains, exact Km/Vmax/Ki).
 * Does NOT write to the DB.
 *
 *   tsx scripts/test-depth-samples.ts
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (studentEnv.OPENAI_API_KEY) process.env.OPENAI_API_KEY = studentEnv.OPENAI_API_KEY;
  if (studentEnv.NEXT_PUBLIC_SUPABASE_URL) process.env.NEXT_PUBLIC_SUPABASE_URL = studentEnv.NEXT_PUBLIC_SUPABASE_URL;
  if (studentEnv.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = studentEnv.SUPABASE_SERVICE_ROLE_KEY;
}

import {
  generateMcatFlashcards,
  generateMcatQuestions,
  generateMcatLesson,
} from "../apps/student/lib/mcatGenerator.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { realtime: { transport: ws as never } }
);

const KEYWORD_IDS = [
  "side_chain_pka_and_protonation_state", // canonical amino-acid pKa case
  "competitive_inhibition_kinetic_effects", // enzyme kinetics — qualitative direction
  "pfk1_allosteric_regulation_by_energy_charge", // metabolism / rate-limiting enzyme
];

// Over-precision detector: decimal pKa for a side chain, or exact Km/Vmax/Ki number.
function flagOverPrecise(text: string): string[] {
  const flags: string[] = [];
  if (/pK_?a[^0-9]{0,12}[0-9]+\.[0-9]/i.test(text) && !/given|provided|suppose|=\s*[0-9]+\.[0-9]\$?\s*and/i.test(text))
    flags.push("decimal pKa");
  if (/\bK_?i\b\s*=?\s*[0-9]/i.test(text)) flags.push("Ki value");
  if (/(K_?m|V_?max)\b[^0-9]{0,8}=?\s*[0-9]+\.?[0-9]*\s*(mM|µM|uM|M\b|mol)/i.test(text))
    flags.push("exact Km/Vmax");
  return flags;
}

async function main() {
  const { data: rows, error } = await supabase
    .from("mcat_keywords")
    .select("id,label,description,concept_blueprint")
    .in("id", KEYWORD_IDS);
  if (error) throw error;

  for (const id of KEYWORD_IDS) {
    const k = rows!.find((r) => r.id === id)!;
    const kw = { id: k.id, label: k.label, description: k.description ?? "", blueprint: k.concept_blueprint };
    console.log("\n\n========================================================");
    console.log(`KEYWORD: ${k.label}  (${k.id})`);
    console.log("========================================================");

    // ── Flashcards (complete deck) ──
    console.log("\n--- FLASHCARDS (complete mode) ---");
    const cards = await generateMcatFlashcards({
      keywords: [kw],
      templateCards: [],
      count: 20,
      complete: true,
    });
    for (const c of cards) {
      const flags = flagOverPrecise(`${c.front} ${c.back}`);
      console.log(`  Q: ${c.front}\n  A: ${c.back}${flags.length ? `   ⚠️ ${flags.join(", ")}` : ""}`);
    }
    console.log(`  [${cards.length} cards; ${cards.filter((c) => flagOverPrecise(`${c.front} ${c.back}`).length).length} over-precise]`);

    // ── Questions ──
    console.log("\n--- QUESTIONS (target 0.55) ---");
    const qs = await generateMcatQuestions({
      keywords: [kw],
      templateCards: [],
      count: 2,
      targetDifficulty: 0.55,
    });
    for (const q of qs) {
      const flags = flagOverPrecise(`${q.stem} ${q.explanation}`);
      console.log(`  STEM: ${q.stem}`);
      console.log(`  CHOICES: ${q.choices.join(" | ")}`);
      console.log(`  CORRECT: ${q.choices[q.correct_index]}${flags.length ? `   ⚠️ ${flags.join(", ")}` : ""}\n`);
    }
  }

  // ── One lesson (amino-acid pKa keyword) ──
  const lk = rows!.find((r) => r.id === KEYWORD_IDS[0])!;
  console.log("\n\n--- LESSON: " + lk.label + " ---");
  const lesson = await generateMcatLesson({
    id: lk.id,
    label: lk.label,
    description: lk.description ?? "",
    blueprint: lk.concept_blueprint,
  });
  for (const s of lesson.micro_steps) {
    const flags = flagOverPrecise(s.explanation_latex + " " + s.example_latex);
    console.log(`  STEP ${s.step_index}: ${s.explanation_latex}${flags.length ? `   ⚠️ ${flags.join(", ")}` : ""}`);
    console.log(`     ex: ${s.example_latex.replace(/\n/g, " ")}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
