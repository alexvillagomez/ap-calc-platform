/**
 * Scope smoke test for MECE-across-keywords flashcard generation.
 * Regenerates per-keyword decks passing the sibling list, then flags any card
 * that leaks a sibling keyword's content. Does NOT write to the DB.
 *
 *   tsx scripts/test-scope-samples.ts
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

const CATEGORY = "mcat_biology_amino_acids_and_proteins";
// Keywords to regenerate and scope-check.
const TARGETS = [
  "what_is_an_amino_acid_overview",
  "amino_acids_as_zwitterions",
  "side_chain_classification_overview",
];

// Per-target out-of-scope leak detectors (terms that belong to a SIBLING keyword).
const LEAKS: Record<string, RegExp[]> = {
  what_is_an_amino_acid_overview: [
    /zwitterion/i,                       // amino_acids_as_zwitterions
    /\bL[- ]config|\bD[- ]config|stereochem|chiral/i, // chirality keyword
    /\babsolute config|\bR\/S\b|\((R|S)\)\b/i,        // R/S keyword
    /three[- ]letter|one[- ]letter|\bcode\b/i,        // abbreviations keyword
    /nonpolar|hydrophobic|polar uncharged|acidic amino|basic amino|aromatic amino|classif/i, // classification
    /\bp\s*I\b|isoelectric/i,             // isoelectric point keyword
    /disulfide|helix breaker|buffers? near/i,         // special-case sibling keywords
  ],
  amino_acids_as_zwitterions: [
    /three[- ]letter|one[- ]letter\b/i,
    /nonpolar|hydrophobic|aromatic amino|branched-chain/i,
    /\babsolute config|\bR\/S\b/i,
  ],
  side_chain_classification_overview: [
    /three[- ]letter|one[- ]letter\b/i,
    /zwitterion/i,
    /\babsolute config|L[- ]config/i,
  ],
};

async function main() {
  const { data: rows, error } = await supabase
    .from("mcat_keywords")
    .select("id,label,description,concept_blueprint")
    .eq("category_id", CATEGORY)
    .eq("tier", "in_depth");
  if (error) throw error;
  const all = rows!;

  for (const id of TARGETS) {
    const k = all.find((r) => r.id === id);
    if (!k) { console.log(`!! ${id} not found`); continue; }
    const kw = { id: k.id, label: k.label, description: k.description ?? "", blueprint: k.concept_blueprint };
    const siblings = all.filter((r) => r.id !== id).map((r) => ({ label: r.label, description: r.description ?? undefined }));

    console.log(`\n\n======== ${k.label} (${id}) ========`);
    console.log(`   blueprint: ${k.concept_blueprint ? "present" : "MISSING"} | ${siblings.length} siblings passed`);
    const cards = await generateMcatFlashcards({
      keywords: [kw],
      templateCards: [],
      count: 30,
      complete: true,
      siblingKeywords: siblings,
    });
    const detectors = LEAKS[id] ?? [];
    let leaks = 0;
    for (const c of cards) {
      const text = `${c.front} ${c.back}`;
      const hit = detectors.filter((re) => re.test(text)).map((re) => re.source);
      if (hit.length) leaks++;
      console.log(`  ${hit.length ? "⚠️ LEAK" : "  ok  "}  ${c.front}  →  ${c.back}${hit.length ? `   [${hit.join(" , ")}]` : ""}`);
    }
    console.log(`  ===> ${cards.length} cards, ${leaks} out-of-scope`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
