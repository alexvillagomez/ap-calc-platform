/**
 * Gemini 2.5 Flash vs gpt-5.4-mini — QUESTION GENERATION A/B eval.
 *
 * Tests both models on the exact system prompts used by the production generators
 * (QUESTION_SYSTEM from mathGenerator + mcatGenerator) across 4 keyword stubs:
 *   - calc: average vs instantaneous rate of change (moderate LaTeX)
 *   - calc: u-substitution (heavy LaTeX — integrals, fractions)
 *   - mcat: Km / Michaelis constant ($K_m$, $V_{max}$)
 *   - mcat: DNA replication enzymes (text-heavy, some 5'→3' notation)
 *
 * KEY UNBLOCK VERIFIED: parseModelJson (repairModelJson) already fixes the lone-
 * backslash-in-JSON Gemini quirk — `\frac` → `\\frac` before JSON.parse. Both
 * models go through the same repair path.
 *
 * Run: cd apps/student && npx tsx ../../scripts/gemini-question-ab.ts
 */

import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

// Load env — root .env.local first, then student override (has OPENAI + GEMINI keys)
const rootEnv = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
const studentEnvPath = path.resolve(__dirname, "../apps/student/.env.local");
if (fs.existsSync(studentEnvPath)) {
  const extra = dotenv.parse(fs.readFileSync(studentEnvPath, "utf-8"));
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
}

import { clientForModel } from "../apps/student/lib/genClient.js";
import { parseModelJson } from "../apps/student/lib/parseModelJson.js";
import { QUESTION_SYSTEM as MATH_Q_SYSTEM } from "../apps/student/lib/mathGenerator.js";
import { QUESTION_SYSTEM as MCAT_Q_SYSTEM } from "../apps/student/lib/mcatGenerator.js";

// ─── Models ───────────────────────────────────────────────────────────────────

const MODELS = ["gpt-5.4-mini", "gemini-2.5-flash"] as const;
type Model = (typeof MODELS)[number];

// ─── Pricing (per 1M tokens) ──────────────────────────────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.40, output: 1.60 },
  "gemini-2.5-flash": { input: 0.15, output: 0.60 },
};

// ─── Difficulty instruction (matches mathGenerator / mcatGenerator) ───────────

const MEDIUM_DIFF_MATH = `TARGET DIFFICULTY: 0.55 → MEDIUM band (0.45–0.65). Requirements: Apply a concept, perform one algebraic manipulation, or execute one short calculation. Distractors reflect common misconceptions or sign errors a typical student might make.
Set the difficulty field to a number inside that band that honestly reflects the cognitive load of your question.`;

const HARD_DIFF_MATH = `TARGET DIFFICULTY: 0.80 → HARD band (0.70–0.90). Requirements: Requires MULTI-STEP reasoning OR integrating two related concepts OR a multi-step algebraic/calculus chain. The stem must present a specific problem requiring work — NOT a bare-fact question. ALL FOUR choices must be plausible to a student who only half-understands the material; distractors must encode realistic partial-reasoning errors. Do NOT make hard questions obscure trivia — make them require reasoning.
Set the difficulty field to a number inside that band that honestly reflects the cognitive load of your question.`;

const MEDIUM_DIFF_MCAT = `TARGET DIFFICULTY: 0.55 → MEDIUM band (0.45–0.65). Requirements: Apply a concept or perform one inference or short calculation. Distractors reflect common misconceptions a typical student might hold.
Set the difficulty field to a number inside that band that honestly reflects the cognitive load of your question.`;

// ─── Test cases ───────────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  subject: "math" | "mcat";
  system: string;
  userPrompt: string;
  allowedId: string;
}

const TEST_CASES: TestCase[] = [
  {
    name: "Math: avg vs instantaneous rate (MEDIUM)",
    subject: "math",
    system: MATH_Q_SYSTEM,
    allowedId: "calc_ab_avg_vs_instant_rate",
    userPrompt: `Generate AP math multiple-choice questions that TOGETHER cover every in-scope concept — one per concept, combining closely related concepts into one question (usually about 1).

${MEDIUM_DIFF_MATH}

TARGET KEYWORD — generate ONLY for this (use ONLY this id in keyword_weights):
  - id: "calc_ab_avg_vs_instant_rate"
    label: "Average vs. instantaneous rate of change"
    description: "Slope of the secant line over an interval (average rate) vs slope of the tangent at a point (instantaneous rate); limit connection between them"
    key terms: average rate of change; instantaneous rate of change; secant line; tangent line; difference quotient; limit; slope
    in scope — cover ONLY these: average rate of change formula (f(b)−f(a))/(b−a); secant line slope as average rate; instantaneous rate as limit of shrinking-interval averages; difference quotient (f(a+h)−f(a))/h as h→0; qualitative comparison of average vs instantaneous
    out of scope (do NOT cover): derivative rules (power/product/chain); formal epsilon-delta definition; higher-order derivatives; antiderivatives`,
  },
  {
    name: "Math: u-substitution integral (HARD — heavy LaTeX)",
    subject: "math",
    system: MATH_Q_SYSTEM,
    allowedId: "calc_ab_u_substitution",
    userPrompt: `Generate AP math multiple-choice questions that TOGETHER cover every in-scope concept — one per concept, combining closely related concepts into one question (usually about 1).

${HARD_DIFF_MATH}

TARGET KEYWORD — generate ONLY for this (use ONLY this id in keyword_weights):
  - id: "calc_ab_u_substitution"
    label: "u-substitution"
    description: "Integration technique reversing the chain rule — pick u as the inside function, compute du, rewrite the integrand entirely in u, integrate, back-substitute"
    key terms: u-substitution; inner function; du; back-substitution; change of variable; definite integral bounds; chain rule reverse
    in scope — cover ONLY these: identifying u as the inside function of a composite; computing du/dx to write du; fully rewriting the integrand in u and du; integrating in u; back-substituting to express in x; adjusting integral bounds for a definite integral under substitution
    out of scope (do NOT cover): integration by parts; partial fractions; trigonometric substitution; improper integrals; inverse trig forms
    already covered (assume known; build on, never re-derive): basic antiderivative rules (power rule, ∫xⁿ dx); chain rule for derivatives; definite integral as limit of Riemann sums`,
  },
  {
    name: "MCAT: Km / Michaelis constant (MEDIUM)",
    subject: "mcat",
    system: MCAT_Q_SYSTEM,
    allowedId: "mcat_enzyme_km",
    userPrompt: `Generate MCAT Biology multiple-choice questions that TOGETHER cover every in-scope concept — one per concept, combining closely related concepts into one question (usually about 1).

${MEDIUM_DIFF_MCAT}

TARGET KEYWORD — generate ONLY for this (use ONLY this id in keyword_weights):
  - id: "mcat_enzyme_km"
    label: "Km (Michaelis constant)"
    description: "Substrate concentration at which reaction velocity equals ½Vmax; inversely related to enzyme-substrate affinity"
    key terms: Km; Vmax; substrate concentration; enzyme-substrate affinity; half-maximal velocity; Michaelis-Menten plot
    in scope — cover ONLY these: Km definition (substrate concentration [S] at which v = ½Vmax); inverse relationship between Km and enzyme-substrate affinity (lower Km → higher affinity); comparing two enzymes by their Km; reading Km from a Michaelis-Menten v vs [S] curve
    out of scope (do NOT cover): exact numerical Km or Ki values; Hill coefficient; allosteric enzymes; derivation of the Michaelis-Menten equation; inhibitor effects on Km (competitive/noncompetitive)`,
  },
  {
    name: "MCAT: DNA replication enzymes (MEDIUM — notation-heavy)",
    subject: "mcat",
    system: MCAT_Q_SYSTEM,
    allowedId: "mcat_dna_replication_enzymes",
    userPrompt: `Generate MCAT Biology multiple-choice questions that TOGETHER cover every in-scope concept — one per concept, combining closely related concepts into one question (usually about 1).

${MEDIUM_DIFF_MCAT}

TARGET KEYWORD — generate ONLY for this (use ONLY this id in keyword_weights):
  - id: "mcat_dna_replication_enzymes"
    label: "DNA replication enzymes"
    description: "Roles of helicase, primase, DNA pol III (5'→3' only), DNA pol I, ligase, and topoisomerase at the replication fork"
    key terms: helicase; primase; DNA polymerase III; DNA polymerase I; ligase; topoisomerase; leading strand; lagging strand; Okazaki fragments; RNA primer; 5'→3' direction; replication fork
    in scope — cover ONLY these: enzyme roles at the replication fork; directionality constraint (all DNA synthesis is 5'→3'); continuous leading strand vs discontinuous lagging strand; Okazaki fragment synthesis by DNA pol III; RNA primer removal by DNA pol I; nick-sealing by ligase; fork unwinding and positive-supercoil relief by helicase and topoisomerase
    out of scope (do NOT cover): eukaryotic replication differences; telomerase; PCR technique; DNA repair mechanisms; proofreading exonuclease mechanism in detail; origin of replication details`,
  },
];

// ─── Result shape ─────────────────────────────────────────────────────────────

interface QuestionResult {
  model: Model;
  caseName: string;
  subject: "math" | "mcat";
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  parseOk: boolean;
  parseError?: string;
  structureOk: boolean;
  structureErrors: string[];
  /** Raw parsed JSON (before structure validation) — null if parse failed. */
  parsed: Record<string, unknown> | null;
  /** First question if structureOk. */
  question: Record<string, unknown> | null;
  /** True = the JSON-repaired raw text had lone backslashes before repair (Gemini quirk detected). */
  hadBareLatex: boolean;
  /** Blind-solve verifier result (null = not run / timed out). */
  verifyAgrees: boolean | null;
  verifyPredicted: number | null;
}

// ─── Structure validators ─────────────────────────────────────────────────────

function validateMathQuestion(
  q: unknown,
  allowedId: string
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!q || typeof q !== "object") return { ok: false, errors: ["not an object"] };
  const o = q as Record<string, unknown>;
  if (typeof o.stem_latex !== "string" || !o.stem_latex.trim()) errors.push("missing stem_latex");
  if (typeof o.solution_latex !== "string" || !o.solution_latex.trim()) errors.push("missing solution_latex");
  if (typeof o.final_answer_latex !== "string" || !o.final_answer_latex.trim()) errors.push("missing final_answer_latex");
  if (!Array.isArray(o.distractors) || o.distractors.length < 3) {
    errors.push("need ≥3 distractors");
  } else {
    for (let i = 0; i < 3; i++) {
      const d = o.distractors[i] as Record<string, unknown>;
      if (!d || typeof d.misconception !== "string" || !d.misconception.trim()) errors.push(`distractor[${i}] missing misconception`);
      if (!d || typeof d.value_latex !== "string" || !d.value_latex.trim()) errors.push(`distractor[${i}] missing value_latex`);
    }
  }
  if (typeof o.hint_latex !== "string") errors.push("missing hint_latex");
  if (!o.keyword_weights || typeof o.keyword_weights !== "object") {
    errors.push("missing keyword_weights");
  } else {
    const kw = o.keyword_weights as Record<string, unknown>;
    const ids = Object.keys(kw);
    if (!ids.includes(allowedId)) errors.push(`keyword_weights doesn't include "${allowedId}"`);
    if (ids.some((id) => id !== allowedId)) errors.push("keyword_weights includes unexpected ids");
  }
  if (typeof o.difficulty !== "number" || o.difficulty < 0 || o.difficulty > 1) {
    errors.push("difficulty must be number in [0,1]");
  }
  return { ok: errors.length === 0, errors };
}

function validateMcatQuestion(
  q: unknown,
  allowedId: string
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!q || typeof q !== "object") return { ok: false, errors: ["not an object"] };
  const o = q as Record<string, unknown>;
  if (typeof o.stem !== "string" || !o.stem.trim()) errors.push("missing stem");
  if (typeof o.explanation !== "string" || !o.explanation.trim()) errors.push("missing explanation");
  if (typeof o.correct_answer !== "string" || !o.correct_answer.trim()) errors.push("missing correct_answer");
  if (!Array.isArray(o.distractors) || o.distractors.length < 3) {
    errors.push("need ≥3 distractors");
  } else {
    for (let i = 0; i < 3; i++) {
      const d = o.distractors[i] as Record<string, unknown>;
      if (!d || typeof d.misconception !== "string" || !d.misconception.trim()) errors.push(`distractor[${i}] missing misconception`);
      if (!d || typeof d.value !== "string" || !d.value.trim()) errors.push(`distractor[${i}] missing value`);
    }
  }
  if (!o.keyword_weights || typeof o.keyword_weights !== "object") {
    errors.push("missing keyword_weights");
  } else {
    const ids = Object.keys(o.keyword_weights as Record<string, unknown>);
    if (!ids.includes(allowedId)) errors.push(`keyword_weights doesn't include "${allowedId}"`);
  }
  if (typeof o.difficulty !== "number") errors.push("missing difficulty");
  return { ok: errors.length === 0, errors };
}

// ─── Blind-solve verifier (math questions only) ───────────────────────────────

const VERIFY_SYS = `You are a careful AP math problem checker. Solve the question independently and pick the single best answer (0-3). Return JSON {"answer_index": 0-3, "reason": "one short sentence"}.`;

async function blindSolve(
  stem: string,
  choices: string[],
  correctIdx: number
): Promise<{ agrees: boolean; predicted: number | null }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { agrees: false, predicted: null };
  try {
    const client = clientForModel("gpt-5.4-mini");
    const choiceLines = choices.map((c, i) => `${i}: ${c}`).join("\n");
    const res = await client.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: VERIFY_SYS },
        { role: "user", content: `Question:\n${stem}\n\nChoices:\n${choiceLines}` },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 80,
    });
    const text = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const idx = typeof parsed.answer_index === "number" ? parsed.answer_index as number : null;
    return { agrees: idx === correctIdx, predicted: idx };
  } catch {
    return { agrees: false, predicted: null };
  }
}

// Assemble 4 choices (place correct at a random index)
function assembleChoices(correct: string, distractors: string[]): { choices: string[]; correctIdx: number } {
  const correctIdx = Math.floor(Math.random() * 4);
  const choices: string[] = [];
  const dists = [...distractors];
  for (let i = 0; i < 4; i++) {
    if (i === correctIdx) choices.push(correct);
    else choices.push(dists.shift()!);
  }
  return { choices, correctIdx };
}

// ─── Detect bare LaTeX (pre-repair quirk) ────────────────────────────────────

/** True if the raw string had unescaped `\command` patterns (Gemini's typical output). */
function hadBareLatexBackslashes(raw: string): boolean {
  // Look for single `\` followed by a LaTeX letter sequence not preceded by another `\`
  return /(?<!\\)\\[a-zA-Z]/.test(raw);
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function runOne(tc: TestCase, model: Model): Promise<QuestionResult> {
  const pricing = PRICING[model] ?? { input: 0, output: 0 };

  let raw = "";
  let inputTokens = 0;
  let outputTokens = 0;
  const t0 = Date.now();

  try {
    const client = clientForModel(model);
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: tc.system },
        { role: "user", content: tc.userPrompt },
      ],
      response_format: { type: "json_object" },
    });
    raw = completion.choices[0]?.message?.content ?? "{}";
    inputTokens = completion.usage?.prompt_tokens ?? 0;
    outputTokens = completion.usage?.completion_tokens ?? 0;
  } catch (err) {
    const latencyMs = Date.now() - t0;
    return {
      model, caseName: tc.name, subject: tc.subject, latencyMs,
      inputTokens: 0, outputTokens: 0, costUsd: 0,
      parseOk: false, parseError: String(err),
      structureOk: false, structureErrors: ["API call failed"],
      parsed: null, question: null, hadBareLatex: false,
      verifyAgrees: null, verifyPredicted: null,
    };
  }

  const latencyMs = Date.now() - t0;
  const costUsd = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output;
  const bare = hadBareLatexBackslashes(raw);

  // Parse with repair
  let parsed: Record<string, unknown> | null = null;
  let parseError: string | undefined;
  try {
    parsed = parseModelJson<Record<string, unknown>>(raw);
  } catch (e) {
    parseError = String(e);
  }

  if (!parsed) {
    return {
      model, caseName: tc.name, subject: tc.subject, latencyMs,
      inputTokens, outputTokens, costUsd,
      parseOk: false, parseError,
      structureOk: false, structureErrors: ["JSON parse failed after repair"],
      parsed: null, question: null, hadBareLatex: bare,
      verifyAgrees: null, verifyPredicted: null,
    };
  }

  // Validate structure
  const items = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (items.length === 0) {
    return {
      model, caseName: tc.name, subject: tc.subject, latencyMs,
      inputTokens, outputTokens, costUsd,
      parseOk: true, structureOk: false, structureErrors: ["questions array empty"],
      parsed, question: null, hadBareLatex: bare,
      verifyAgrees: null, verifyPredicted: null,
    };
  }

  const q = items[0] as Record<string, unknown>;
  const validation =
    tc.subject === "math"
      ? validateMathQuestion(q, tc.allowedId)
      : validateMcatQuestion(q, tc.allowedId);

  // Blind-solve for math only
  let verifyAgrees: boolean | null = null;
  let verifyPredicted: number | null = null;

  if (tc.subject === "math" && validation.ok) {
    const stem = String(q.stem_latex ?? "");
    const answer = String(q.final_answer_latex ?? "");
    const distractorValues = (q.distractors as Record<string, unknown>[])
      .slice(0, 3)
      .map((d) => String(d.value_latex ?? ""));
    const { choices, correctIdx } = assembleChoices(answer, distractorValues);
    const r = await blindSolve(stem, choices, correctIdx);
    verifyAgrees = r.agrees;
    verifyPredicted = r.predicted;
  }

  return {
    model, caseName: tc.name, subject: tc.subject, latencyMs,
    inputTokens, outputTokens, costUsd,
    parseOk: true,
    structureOk: validation.ok, structureErrors: validation.errors,
    parsed, question: q, hadBareLatex: bare,
    verifyAgrees, verifyPredicted,
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtMs(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }
function fmtCost(usd: number): string { return `$${usd.toFixed(5)}`; }

function fmtCheck(ok: boolean | null): string {
  if (ok === null) return "—";
  return ok ? "✅" : "❌";
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// ─── Report writer ────────────────────────────────────────────────────────────

function buildReport(results: QuestionResult[]): string {
  const lines: string[] = [];

  lines.push("# Gemini 2.5 Flash vs gpt-5.4-mini — Question Generation A/B Eval");
  lines.push("");
  lines.push(`> Evaluation date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("> JSON repair status: `parseModelJson` (`repairModelJson`) is already wired in both generators.");
  lines.push("> Config toggle: `GEN_MODELS.question` in `apps/student/lib/courseEngine/config.ts` — set `QUESTION_MODEL=gemini-2.5-flash` in `apps/student/.env.local` to flip.");
  lines.push("");

  // Summary table
  lines.push("## Summary table");
  lines.push("");
  lines.push("| Test case | Model | Latency | Tokens (in/out) | Cost | Parse | Structure | Bare LaTeX? | Blind-solve |");
  lines.push("|-----------|-------|---------|-----------------|------|-------|-----------|-------------|-------------|");

  for (const r of results) {
    const shortCase = r.caseName.replace(/^(Math|MCAT): /, "");
    lines.push(
      `| ${truncate(shortCase, 38)} | ${r.model} | ${fmtMs(r.latencyMs)} | ${r.inputTokens}/${r.outputTokens} | ${fmtCost(r.costUsd)} | ${fmtCheck(r.parseOk)} | ${fmtCheck(r.structureOk)} | ${r.hadBareLatex ? "⚠️ yes (repaired)" : "✅ no"} | ${r.subject === "math" ? fmtCheck(r.verifyAgrees) : "N/A"} |`
    );
  }

  lines.push("");

  // Cost comparison
  lines.push("## Cost comparison (gpt-5.4-mini = 1.0×)");
  lines.push("");
  const miniCostByCase: Record<string, number> = {};
  for (const r of results.filter((r) => r.model === "gpt-5.4-mini")) {
    miniCostByCase[r.caseName] = r.costUsd;
  }
  lines.push("| Test case | gpt-5.4-mini | gemini-2.5-flash | Ratio |");
  lines.push("|-----------|-------------|-----------------|-------|");
  for (const tc of TEST_CASES) {
    const mini = results.find((r) => r.model === "gpt-5.4-mini" && r.caseName === tc.name);
    const gemini = results.find((r) => r.model === "gemini-2.5-flash" && r.caseName === tc.name);
    if (!mini || !gemini) continue;
    const ratio = mini.costUsd > 0 ? (gemini.costUsd / mini.costUsd).toFixed(2) : "—";
    lines.push(`| ${truncate(tc.name, 40)} | ${fmtCost(mini.costUsd)} | ${fmtCost(gemini.costUsd)} | ${ratio}× |`);
  }

  lines.push("");

  // Per-case side-by-side samples
  lines.push("## Side-by-side question samples");
  lines.push("");

  for (const tc of TEST_CASES) {
    lines.push(`### ${tc.name}`);
    lines.push("");

    for (const model of MODELS) {
      const r = results.find((x) => x.model === model && x.caseName === tc.name);
      if (!r) continue;

      lines.push(`<details><summary><strong>${model}</strong> — ${fmtMs(r.latencyMs)}, ${r.outputTokens} output tokens</summary>`);
      lines.push("");

      if (!r.parseOk) {
        lines.push(`❌ **JSON parse failed** (even after repairModelJson): ${r.parseError}`);
      } else if (!r.structureOk) {
        lines.push(`❌ **Structure errors:** ${r.structureErrors.join("; ")}`);
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(r.parsed, null, 2).slice(0, 800));
        lines.push("```");
      } else {
        if (r.hadBareLatex) {
          lines.push("⚠️ **Raw output had bare LaTeX backslashes — repaired successfully by repairModelJson.**");
          lines.push("");
        }
        if (r.subject === "math") {
          lines.push(`**Blind-solve:** ${r.verifyAgrees === true ? "✅ verifier agrees" : r.verifyAgrees === false ? "❌ verifier disagrees" : "— (not run)"}`);
          lines.push("");
        }
        lines.push("```json");
        lines.push(JSON.stringify(r.question, null, 2));
        lines.push("```");
      }

      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  // Latency comparison
  lines.push("## Latency summary");
  lines.push("");
  lines.push("| Test case | gpt-5.4-mini | gemini-2.5-flash |");
  lines.push("|-----------|-------------|-----------------|");
  for (const tc of TEST_CASES) {
    const mini = results.find((r) => r.model === "gpt-5.4-mini" && r.caseName === tc.name);
    const gemini = results.find((r) => r.model === "gemini-2.5-flash" && r.caseName === tc.name);
    lines.push(`| ${truncate(tc.name, 40)} | ${mini ? fmtMs(mini.latencyMs) : "—"} | ${gemini ? fmtMs(gemini.latencyMs) : "—"} |`);
  }
  lines.push("");

  // Qualitative analysis
  lines.push("## Qualitative analysis");
  lines.push("");

  const geminiAllParse = results.filter((r) => r.model === "gemini-2.5-flash").every((r) => r.parseOk);
  const geminiAllStruct = results.filter((r) => r.model === "gemini-2.5-flash").every((r) => r.structureOk);
  const miniAllStruct = results.filter((r) => r.model === "gpt-5.4-mini").every((r) => r.structureOk);
  const geminiHadBare = results.filter((r) => r.model === "gemini-2.5-flash" && r.hadBareLatex).length;

  lines.push(`**JSON repair fix status:** ${geminiAllParse ? "✅ All Gemini outputs parsed after repairModelJson" : "❌ Some Gemini outputs still fail to parse — see errors above"}`);
  lines.push("");
  lines.push(`**Bare-LaTeX detections (Gemini):** ${geminiHadBare}/${TEST_CASES.length} outputs had lone backslashes → all repaired by repairModelJson.`);
  lines.push("");
  lines.push(`**Structure pass rate:** gpt-5.4-mini ${miniAllStruct ? "4/4" : results.filter((r) => r.model === "gpt-5.4-mini" && r.structureOk).length + "/4"} | gemini-2.5-flash ${geminiAllStruct ? "4/4" : results.filter((r) => r.model === "gemini-2.5-flash" && r.structureOk).length + "/4"}`);

  const mathBlindMini = results.filter((r) => r.model === "gpt-5.4-mini" && r.subject === "math" && r.verifyAgrees !== null);
  const mathBlindGemini = results.filter((r) => r.model === "gemini-2.5-flash" && r.subject === "math" && r.verifyAgrees !== null);
  const miniBlindOk = mathBlindMini.filter((r) => r.verifyAgrees).length;
  const geminiBlindOk = mathBlindGemini.filter((r) => r.verifyAgrees).length;
  lines.push("");
  lines.push(`**Blind-solve accuracy (math):** gpt-5.4-mini ${miniBlindOk}/${mathBlindMini.length} | gemini-2.5-flash ${geminiBlindOk}/${mathBlindGemini.length}`);

  const totalMini = results.filter((r) => r.model === "gpt-5.4-mini").reduce((s, r) => s + r.costUsd, 0);
  const totalGemini = results.filter((r) => r.model === "gemini-2.5-flash").reduce((s, r) => s + r.costUsd, 0);
  const avgRatio = totalMini > 0 ? (totalGemini / totalMini).toFixed(2) : "—";
  lines.push("");
  lines.push(`**Total eval cost:** gpt-5.4-mini ${fmtCost(totalMini)} | gemini-2.5-flash ${fmtCost(totalGemini)} (avg ratio: ${avgRatio}×)`);

  lines.push("");
  lines.push("## Recommendation");
  lines.push("");
  lines.push("*(Fill in after reviewing samples above — the automated checks cover structure/parse/accuracy; distractor quality and scope adherence require human review.)*");
  lines.push("");
  lines.push("Key questions for human review:");
  lines.push("1. Are Gemini's distractors grounded in specific student misconceptions (not just plausible wrong values)?");
  lines.push("2. Does Gemini respect the keyword scope contract (no out-of-scope content)?");
  lines.push("3. Is LaTeX rendering clean in MathText after repair (no residual broken backslashes)?");
  lines.push("4. Is the cost delta worth the switch given quality parity?");
  lines.push("");
  lines.push("**Config toggle:** `GEN_MODELS.question` in [`apps/student/lib/courseEngine/config.ts:43`](../apps/student/lib/courseEngine/config.ts)");
  lines.push("Set `QUESTION_MODEL=gemini-2.5-flash` in `apps/student/.env.local` to flip question generation to Gemini Flash. No code change needed.");

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Gemini 2.5 Flash vs gpt-5.4-mini — Question Generation A/B ===\n");

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not set");
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.warn("⚠️  GEMINI_API_KEY not set — Gemini calls will fail");
  }

  const results: QuestionResult[] = [];

  for (const tc of TEST_CASES) {
    console.log(`\n─── ${tc.name} ───`);
    for (const model of MODELS) {
      process.stdout.write(`  ${model}... `);
      const r = await runOne(tc, model);
      results.push(r);

      const status = r.parseOk
        ? r.structureOk
          ? `✅ ${fmtMs(r.latencyMs)} ${r.outputTokens}tok ${fmtCost(r.costUsd)}${r.hadBareLatex ? " (bare LaTeX repaired)" : ""}`
          : `⚠️  parse OK but structure: ${r.structureErrors.join("; ")}`
        : `❌ parse FAILED: ${r.parseError?.slice(0, 80)}`;

      console.log(status);
      if (r.subject === "math" && r.verifyAgrees !== null) {
        console.log(`     blind-solve: ${r.verifyAgrees ? "✅ agrees" : "❌ disagrees"} (predicted ${r.verifyPredicted})`);
      }
    }
  }

  // Write report
  const report = buildReport(results);
  const reportPath = path.resolve(__dirname, "../docs/gemini-flash-question-eval.md");
  fs.writeFileSync(reportPath, report, "utf-8");
  console.log(`\n📄 Report written to docs/gemini-flash-question-eval.md`);

  // Print summary
  console.log("\n=== Summary ===");
  const byModel = (m: Model) => results.filter((r) => r.model === m);
  for (const m of MODELS) {
    const rs = byModel(m);
    const ok = rs.filter((r) => r.structureOk).length;
    const cost = rs.reduce((s, r) => s + r.costUsd, 0);
    const avgLat = rs.reduce((s, r) => s + r.latencyMs, 0) / rs.length;
    console.log(`  ${m}: ${ok}/${rs.length} valid | avg ${fmtMs(avgLat)} | total ${fmtCost(cost)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
