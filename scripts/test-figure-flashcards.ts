/**
 * Figure smoke test for flashcard generation. For each target keyword, regenerate
 * a complete deck (sibling-aware) and report which cards carry a figure tag
 * (<Molecule>, <Mermaid>, <FunctionGraph>, \ce{...}, or a markdown table). Confirms
 * visual subtopics get diagrams and non-visual ones stay pure cloze. No DB writes.
 *
 *   tsx scripts/test-figure-flashcards.ts
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const e = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (e.OPENAI_API_KEY) process.env.OPENAI_API_KEY = e.OPENAI_API_KEY;
  if (e.NEXT_PUBLIC_SUPABASE_URL) process.env.NEXT_PUBLIC_SUPABASE_URL = e.NEXT_PUBLIC_SUPABASE_URL;
  if (e.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = e.SUPABASE_SERVICE_ROLE_KEY;
}

import { generateMcatFlashcards } from "../apps/student/lib/mcatGenerator.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { realtime: { transport: ws as never } }
);

// [keyword id, category id, expectation note]
const TARGETS: [string, string, string][] = [
  ["nonpolar_aliphatic_side_chains", "mcat_biology_amino_acids_and_proteins", "expect <Molecule> structures"],
  ["glycine_achiral_exception", "mcat_biology_amino_acids_and_proteins", "expect <Molecule>"],
  ["glycolysis_pathway_overview_glucose_to_pyruvate", "mcat_biology_bioenergetics_and_metabolism", "expect <Mermaid> pathway"],
  ["carbonic_anhydrase_and_bicarbonate_buffering", "mcat_biology_organ_systems_and_homeostasis", "expect \\ce{...} reaction"],
  ["competitive_inhibition_kinetic_effects", "mcat_biology_enzymes_and_protein_function", "CONTROL — expect text-only"],
];

function figuresIn(text: string): string[] {
  const f: string[] = [];
  if (/<Molecule\b/.test(text)) f.push("Molecule");
  if (/<Mermaid\b/.test(text)) f.push("Mermaid");
  if (/<FunctionGraph\b/.test(text)) f.push("FunctionGraph");
  if (/\\ce\{/.test(text)) f.push("ce");
  if (/^\s*\|.*\|/m.test(text)) f.push("table");
  return f;
}

async function main() {
  for (const [id, category, note] of TARGETS) {
    const { data: rows } = await supabase
      .from("mcat_keywords")
      .select("id,label,description,concept_blueprint")
      .eq("category_id", category)
      .eq("tier", "in_depth");
    const all = rows ?? [];
    const k = all.find((r) => r.id === id);
    if (!k) { console.log(`!! ${id} not found in ${category}`); continue; }
    const kw = { id: k.id, label: k.label, description: k.description ?? "", blueprint: k.concept_blueprint };
    const siblings = all.filter((r) => r.id !== id).map((r) => ({ label: r.label, description: r.description ?? undefined }));

    console.log(`\n\n======== ${k.label} ========\n   ${note} | ${siblings.length} siblings`);
    const cards = await generateMcatFlashcards({ keywords: [kw], templateCards: [], count: 30, complete: true, siblingKeywords: siblings });
    let withFig = 0;
    for (const c of cards) {
      const figs = figuresIn(`${c.front} ${c.back}`);
      if (figs.length) withFig++;
      console.log(`  ${figs.length ? "🖼 " + figs.join("+") : "   —    "}  ${c.front}  →  ${c.back}`);
    }
    console.log(`  ===> ${cards.length} cards, ${withFig} with a figure`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
