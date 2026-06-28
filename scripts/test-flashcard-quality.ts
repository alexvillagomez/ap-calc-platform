/**
 * Combined flashcard-quality test: meaningful backs, mixed cloze/Q→A format,
 * ZERO cross-category leak, valid/fail-soft figures. Regenerates decks with the
 * full route inputs (siblings + categoryLabel). No DB writes.
 *
 *   tsx scripts/test-flashcard-quality.ts
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

// [keyword id, category id, note]
const TARGETS: [string, string, string][] = [
  ["side_chain_classification_overview", "mcat_biology_amino_acids_and_proteins", "previously produced 'overlap' filler"],
  ["nonpolar_aliphatic_side_chains", "mcat_biology_amino_acids_and_proteins", "expect <Molecule> structures"],
  ["glycolysis_pathway_overview_glucose_to_pyruvate", "mcat_biology_bioenergetics_and_metabolism", "metabolism — should NOT appear in amino-acids decks"],
];

// Words that = a metabolism/other-category leak inside an AMINO-ACIDS deck.
const CROSS_CAT = /\bglycolysis\b|\bkrebs\b|citric acid cycle|pyruvate|\bATP yield\b|electron transport|oxidative phosphor|gluconeogen|fermentation|\bNADH\b|\bFADH/i;
const FILLER = /^\s*(overlap\w*|relate\w*|var(y|ies)|depends?|involved|associated|affects?|changes?|differs?|important|various|several)\s*$/i;
// Self-closing Molecule, closed Mermaid, $\ce{...}$, FunctionGraph.
function figs(t: string) {
  const out: string[] = [];
  if (/<Molecule\b[^>]*\/>/.test(t)) out.push("Molecule✓");
  else if (/<Molecule\b/.test(t)) out.push("Molecule⚠RAW");
  if (/<Mermaid\b[^>]*>[\s\S]*?<\/Mermaid>/.test(t)) out.push("Mermaid✓");
  else if (/<Mermaid\b/.test(t)) out.push("Mermaid⚠RAW");
  if (/\\ce\{/.test(t)) out.push("ce");
  if (/^\s*\|.*\|/m.test(t)) out.push("table");
  return out;
}

async function main() {
  for (const [id, category, note] of TARGETS) {
    const { data: rows } = await supabase
      .from("mcat_keywords").select("id,label,description,concept_blueprint")
      .eq("category_id", category).eq("tier", "in_depth");
    const { data: cat } = await supabase.from("mcat_categories").select("label").eq("id", category).maybeSingle();
    const all = rows ?? [];
    const k = all.find((r) => r.id === id);
    if (!k) { console.log(`!! ${id} not found`); continue; }
    const kw = { id: k.id, label: k.label, description: k.description ?? "", blueprint: k.concept_blueprint };
    const siblings = all.filter((r) => r.id !== id).map((r) => ({ label: r.label, description: r.description ?? undefined }));

    console.log(`\n\n======== ${k.label}  [${cat?.label}] ========\n   ${note}`);
    const cards = await generateMcatFlashcards({
      keywords: [kw], templateCards: [], count: 30, complete: true,
      siblingKeywords: siblings, categoryLabel: cat?.label ?? category,
    });
    const isAA = category.includes("amino_acids");
    let cloze = 0, qa = 0, filler = 0, leak = 0, raw = 0, withFig = 0;
    for (const c of cards) {
      const f = figs(`${c.front} ${c.back}`);
      const isCloze = c.front.includes("_____");
      isCloze ? cloze++ : qa++;
      if (FILLER.test(c.back)) filler++;
      const leaked = isAA && CROSS_CAT.test(`${c.front} ${c.back}`);
      if (leaked) leak++;
      if (f.some((x) => x.includes("RAW"))) raw++;
      if (f.length) withFig++;
      const flags = [isCloze ? "cloze" : "Q→A", ...(f.length ? f : []), FILLER.test(c.back) ? "⚠FILLER" : "", leaked ? "⚠LEAK" : ""].filter(Boolean).join(" ");
      console.log(`  [${flags}]  ${c.front}  →  ${c.back}`);
    }
    console.log(`  ===> ${cards.length} cards | cloze ${cloze} / Q→A ${qa} | filler ${filler} | cross-cat leak ${leak} | raw-figure ${raw} | figures ${withFig}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
