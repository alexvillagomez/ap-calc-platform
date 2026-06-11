/**
 * VERIFICATION HARNESS for the concept-blueprint durable fix.
 *
 * Proves the core claim: injecting a per-keyword ConceptBlueprint into question
 * generation stops scope drift. Tests the real failure case —
 * `gibbs_free_energy_sign_and_spontaneity`, a keyword scoped to ONLY the
 * meaning of the sign of ΔG, which was getting questions that test the
 * out-of-scope ΔG = ΔH − TΔS crossover-temperature formula.
 *
 * Read-only on the DB. NO writes. Only spends on OpenAI (generation calls).
 *
 * Usage:
 *   npx tsx scripts/test-blueprint-scope.ts [--keyword <id>] [--count N]
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Env: root .env.local, then OVERRIDE OPENAI_API_KEY from apps/student/.env.local
// (root OpenAI key is invalid; valid key lives in the student env).
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const studentEnv = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  if (studentEnv.OPENAI_API_KEY) process.env.OPENAI_API_KEY = studentEnv.OPENAI_API_KEY;
}

import { generateMcatQuestions } from "../apps/student/lib/mcatGenerator.js";
import { generateConceptBlueprint } from "../apps/student/lib/mcatBlueprint.js";
import { outlineContextForCategory } from "../apps/student/lib/mcatContentOutline.js";
import { fetchTemplateCards } from "../apps/student/lib/mcatTemplateCards.js";

const keywordIdArg = (() => {
  const i = process.argv.indexOf("--keyword");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : "gibbs_free_energy_sign_and_spontaneity";
})();
const countArg = (() => {
  const i = process.argv.indexOf("--count");
  return i !== -1 && process.argv[i + 1] ? parseInt(process.argv[i + 1]!, 10) : 6;
})();
const roundsArg = (() => {
  const i = process.argv.indexOf("--rounds");
  return i !== -1 && process.argv[i + 1] ? parseInt(process.argv[i + 1]!, 10) : 3;
})();

/**
 * The precise out-of-scope leak for the sign keyword: any question that pulls in
 * ΔH / ΔS / the temperature-dependence of spontaneity (the ΔG = ΔH − TΔS family).
 * Note: a bare ΔG value in kJ/mol IS in scope (sign interpretation), so we do NOT
 * flag kJ/mol alone — only enthalpy/entropy/crossover-temperature signals.
 */
function leaksFormula(text: string): boolean {
  return /(ΔH|Δ?H\b.*entropy|ΔS|TΔS|ΔH\s*[-−]\s*T|enthalp|entrop|J\/\(?mol[·*\s]?K|spontaneous.*temperature|temperature.*spontaneous|crossover)/i.test(
    text
  );
}

function analyze(label: string, qs: { stem: string; choices: string[]; explanation: string }[]) {
  console.log(`\n──────── ${label} (${qs.length} questions) ────────`);
  let leaks = 0;
  qs.forEach((q, i) => {
    const blob = `${q.stem} ${q.choices.join(" ")}`;
    const leak = leaksFormula(blob);
    if (leak) leaks++;
    console.log(`${leak ? "⚠️ OUT-OF-SCOPE" : "✓ in-scope    "} | ${q.stem.slice(0, 95)}`);
  });
  console.log(`→ ${leaks}/${qs.length} questions drifted out of scope (ΔH/ΔS/temperature formula).`);
  return leaks;
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Load target keyword + siblings (read-only)
  const { data: target } = await supabase
    .from("mcat_keywords")
    .select("id, label, description, category_id, parent_keyword_id, examples")
    .eq("id", keywordIdArg)
    .single();
  if (!target) throw new Error(`Keyword not found: ${keywordIdArg}`);

  const { data: sibRows } = await supabase
    .from("mcat_keywords")
    .select("label, description")
    .eq("parent_keyword_id", target.parent_keyword_id as string)
    .neq("id", target.id as string);
  const siblings = (sibRows ?? []).map((s) => ({
    label: s.label as string,
    description: (s.description as string) ?? "",
  }));

  const outline = outlineContextForCategory(target.category_id as string);
  const examples = Array.isArray(target.examples) ? (target.examples as string[]) : undefined;

  console.log(`=== Blueprint scope test: ${target.label} (${target.id}) ===`);
  console.log(`Siblings used to sharpen boundary: ${siblings.length}`);

  // 1. Generate the blueprint
  const blueprint = await generateConceptBlueprint({
    keyword: {
      id: target.id as string,
      label: target.label as string,
      description: (target.description as string) ?? "",
      examples,
    },
    siblings,
    outlineContext: outline,
  });
  console.log("\n─── Generated ConceptBlueprint ───");
  console.log(JSON.stringify(blueprint, null, 2));

  const kwMeta = {
    id: target.id as string,
    label: target.label as string,
    description: (target.description as string) ?? "",
  };

  // Reproduce production conditions: pull the SAME template cards the route would
  // inject (the anki deck facts that include ΔG = ΔH − TΔS — a real drift driver).
  const templateCards = await fetchTemplateCards(supabase, target.category_id as string, [
    target.label as string,
  ]);
  console.log(`Template cards injected (production-faithful drift driver): ${templateCards.length}`);

  // Run `rounds` independent generations each way (MEDIUM band — the band that
  // triggered the original bug) and aggregate the drift rate.
  let baseTotal = 0, baseLeak = 0, bpTotal = 0, bpLeak = 0;

  for (let r = 1; r <= roundsArg; r++) {
    const baseline = await generateMcatQuestions({
      keywords: [kwMeta],
      templateCards,
      count: countArg,
      difficultyTier: "medium",
      outlineContext: outline,
    });
    const withBp = await generateMcatQuestions({
      keywords: [{ ...kwMeta, blueprint }],
      templateCards,
      count: countArg,
      difficultyTier: "medium",
      outlineContext: outline,
    });
    baseLeak += analyze(`ROUND ${r} · BASELINE (no blueprint)`, baseline);
    baseTotal += baseline.length;
    bpLeak += analyze(`ROUND ${r} · WITH blueprint`, withBp);
    bpTotal += withBp.length;
  }

  const pct = (n: number, d: number) => (d === 0 ? "0" : ((100 * n) / d).toFixed(0));
  console.log("\n════════ AGGREGATE RESULT ════════");
  console.log(`Baseline drift:       ${baseLeak}/${baseTotal} (${pct(baseLeak, baseTotal)}%)`);
  console.log(`With-blueprint drift: ${bpLeak}/${bpTotal} (${pct(bpLeak, bpTotal)}%)`);
  const verdict =
    bpLeak === 0 && baseLeak > 0
      ? "✅ PASS — blueprint eliminated the out-of-scope drift."
      : baseLeak > 0 && bpLeak / Math.max(1, bpTotal) < baseLeak / Math.max(1, baseTotal) / 2
      ? `🟡 STRONG REDUCTION — drift cut from ${pct(baseLeak, baseTotal)}% to ${pct(bpLeak, bpTotal)}%.`
      : baseLeak === 0
      ? "⚪ INCONCLUSIVE — baseline produced no drift; raise --count/--rounds."
      : "❌ FAIL — blueprint did not meaningfully reduce drift.";
  console.log(verdict);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
