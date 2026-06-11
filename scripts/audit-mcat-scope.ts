/**
 * Measures (and optionally remediates) scope drift: are stored questions
 * actually within the scope of the keyword they're tagged to?
 *
 * By default this is a read-only audit report. Pass --apply to quarantine
 * violating questions by setting their status to 'out_of_scope'.
 *
 * Usage:
 *   tsx scripts/audit-mcat-scope.ts
 *   tsx scripts/audit-mcat-scope.ts --category mcat_biology_amino_acids_and_proteins
 *   tsx scripts/audit-mcat-scope.ts --keyword <id>
 *   tsx scripts/audit-mcat-scope.ts --umbrella <umbrella_keyword_id>
 *   tsx scripts/audit-mcat-scope.ts --apply
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

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

const doApply = process.argv.includes("--apply");
const categoryArg = (() => {
  const idx = process.argv.indexOf("--category");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return null;
})();
const keywordArg = (() => {
  const idx = process.argv.indexOf("--keyword");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return null;
})();
const umbrellaArg = (() => {
  const idx = process.argv.indexOf("--umbrella");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  return null;
})();

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConceptBlueprint {
  in_scope_concepts: string[];
  in_scope_formulas: string[];
  out_of_scope: string[];
  key_terms: string[];
  boundary_statement: string;
}

interface KeywordRow {
  id: string;
  category_id: string;
  label: string;
  description: string | null;
  concept_blueprint: ConceptBlueprint | null;
}

interface Choice {
  text: string;
}

interface QuestionRow {
  id: string;
  stem: string;
  choices: Choice[] | string[] | null;
  correct_index: number | null;
  explanation: string | null;
  keyword_weights: Record<string, number> | null;
  status: string | null;
  category_id: string;
}

interface AuditResult {
  in_scope: boolean;
  violations: string[];
  reason: string;
}

interface ViolationReport {
  questionId: string;
  primaryKeywordId: string;
  primaryKeywordLabel: string;
  violations: string[];
  reason: string;
  stemTruncated: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + "…";
}

function renderBlueprint(bp: ConceptBlueprint): string {
  const lines: string[] = [];
  lines.push("SCOPE CONTRACT:");
  lines.push("IN SCOPE:");
  for (const c of bp.in_scope_concepts) lines.push(`  • ${c}`);
  if (bp.in_scope_formulas.length > 0) {
    lines.push(`FORMULAS ALLOWED: ${bp.in_scope_formulas.join("; ")}`);
  } else {
    lines.push("FORMULAS ALLOWED: NONE — no formula or calculation required.");
  }
  lines.push("OUT OF SCOPE:");
  for (const c of bp.out_of_scope) lines.push(`  • ${c}`);
  lines.push(`KEY TERMS: ${bp.key_terms.join(", ")}`);
  lines.push(`BOUNDARY: ${bp.boundary_statement}`);
  return lines.join("\n");
}

function renderChoices(choices: Choice[] | string[] | null): string {
  if (!choices || choices.length === 0) return "(no choices)";
  return choices
    .map((c, i) => {
      const letter = String.fromCharCode(65 + i); // A, B, C, D
      const text = typeof c === "string" ? c : (c as Choice).text ?? JSON.stringify(c);
      return `  ${letter}. ${text}`;
    })
    .join("\n");
}

// ─── Scope audit LLM call ─────────────────────────────────────────────────────

async function auditQuestion(
  openai: OpenAI,
  question: QuestionRow,
  keyword: KeywordRow
): Promise<AuditResult> {
  const systemPrompt = `You are an MCAT content auditor. You evaluate whether a question stays within the defined scope contract of its tagged keyword.

## Your task
Given a SCOPE CONTRACT and a QUESTION, identify the PRIMARY SKILL the question tests — that is, what the student must actually know or do to select the correct answer — then decide whether that primary skill is in scope.

## Decision rules
- Mark IN SCOPE if the primary tested skill is listed among the in-scope concepts AND any formula needed is listed as allowed, even if the question stem mentions or is set in the context of an out-of-scope term.
- Mark OUT OF SCOPE only if:
  (a) the student must APPLY or COMPUTE an out-of-scope concept to reach the answer, OR
  (b) the student must use a formula that is NOT listed as allowed, OR
  (c) the primary tested skill is itself an out-of-scope concept.
- A bare mention, a given numeric condition, an experimental setup detail, or background framing involving an out-of-scope term is NOT a violation. The student does not have to engage with it to answer correctly.

## Calibration examples
1. IN SCOPE — SDS-PAGE / molecular weight keyword. Stem: "A researcher adds SDS and a reducing agent to a protein sample, then runs gel electrophoresis. What determines how far each protein migrates?" Answer: molecular weight. "Reducing agent" appears as experimental setup; the student does not need to apply reducing-agent chemistry to answer. The primary skill (SDS-PAGE separates by MW) is in scope. → in_scope: true.

2. IN SCOPE — amino acids as zwitterions keyword. Stem: "At pH = pI, what is the predominant form of a free amino acid?" Answer: zwitterion. "pI" is a stated condition (given), not something the student must calculate. The primary skill (recognizing zwitterion form at the isoelectric point) is in scope. → in_scope: true.

3. OUT OF SCOPE — sign interpretation keyword (no thermodynamic calculations listed). Stem: "Given ΔH = −80 kJ/mol and T = 298 K, calculate ΔG if ΔS = +120 J/mol·K." Answer requires applying ΔG = ΔH − TΔS and performing arithmetic. The primary skill is a thermodynamic calculation using a formula not listed as allowed. → in_scope: false, violation: "Answer requires applying ΔG = ΔH − TΔS, a formula not in the allowed list."

## Output
Return valid JSON only (no markdown):
{
  "in_scope": true | false,
  "violations": ["<description of violation>", ...],
  "reason": "<one-sentence explanation>"
}

If the question is in scope, "violations" must be an empty array.`;

  const userPrompt = [
    renderBlueprint(keyword.concept_blueprint!),
    "",
    "QUESTION:",
    `Stem: ${question.stem}`,
    "Choices:",
    renderChoices(question.choices),
  ].join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Parse failure → treat as unauditable, return in_scope=true with a note
    return { in_scope: true, violations: [], reason: "[parse error — audit skipped]" };
  }

  const obj = parsed as Record<string, unknown>;
  const in_scope =
    typeof obj.in_scope === "boolean" ? obj.in_scope : true;
  const violations =
    Array.isArray(obj.violations) && obj.violations.every((v) => typeof v === "string")
      ? (obj.violations as string[])
      : [];
  const reason =
    typeof obj.reason === "string" ? obj.reason : "";

  return { in_scope, violations, reason };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== audit-mcat-scope ===");
  if (doApply) {
    console.log("[APPLY MODE] Violating questions will be set to status='out_of_scope'.");
  } else {
    console.log("[REPORT ONLY] Pass --apply to quarantine violating questions.");
  }

  // ── Supabase client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── OpenAI client
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.error("Missing OPENAI_API_KEY");
    process.exit(1);
  }
  const openai = new OpenAI({ apiKey: openaiKey });

  // ── Fetch targeted keywords (must have a concept_blueprint)
  console.log("\nFetching targeted keywords...");
  let kwQuery = supabase
    .from("mcat_keywords")
    .select("id, category_id, label, description, concept_blueprint")
    .not("concept_blueprint", "is", null);

  if (keywordArg) {
    kwQuery = kwQuery.eq("id", keywordArg);
  } else if (umbrellaArg) {
    // Restrict to in_depth children of the given umbrella keyword
    kwQuery = kwQuery.eq("parent_keyword_id", umbrellaArg).eq("tier", "in_depth");
    console.log(`  Scoping to in_depth children of umbrella "${umbrellaArg}".`);
  } else if (categoryArg) {
    kwQuery = kwQuery.eq("category_id", categoryArg);
  }

  const { data: kwRaw, error: kwErr } = await kwQuery;
  if (kwErr) {
    console.error("Keyword fetch error:", kwErr.message);
    process.exit(1);
  }
  const keywords = (kwRaw ?? []) as KeywordRow[];
  console.log(`  ${keywords.length} keyword(s) with blueprints in scope.`);

  if (keywords.length === 0) {
    console.log("No keywords with blueprints found in the target scope. Nothing to audit.");
    return;
  }

  const keywordMap = new Map<string, KeywordRow>(keywords.map((k) => [k.id, k]));
  const targetKeywordIds = new Set(keywordMap.keys());

  // ── Fetch questions whose keyword_weights overlap the targeted keywords
  // We fetch all questions and filter client-side (keyword_weights is jsonb).
  console.log("\nFetching mcat_questions...");
  let qQuery = supabase
    .from("mcat_questions")
    .select("id, stem, choices, correct_index, explanation, keyword_weights, status, category_id");

  if (categoryArg) {
    qQuery = qQuery.eq("category_id", categoryArg);
  }

  const { data: qRaw, error: qErr } = await qQuery;
  if (qErr) {
    console.error("Question fetch error:", qErr.message);
    process.exit(1);
  }
  const allQuestions = (qRaw ?? []) as QuestionRow[];
  console.log(`  Fetched ${allQuestions.length} question(s) total.`);

  // ── Filter questions that reference at least one targeted keyword
  const targetedQuestions = allQuestions.filter((q) => {
    if (!q.keyword_weights || typeof q.keyword_weights !== "object") return false;
    return Object.keys(q.keyword_weights).some((kwId) => targetKeywordIds.has(kwId));
  });
  console.log(
    `  ${targetedQuestions.length} question(s) reference at least one targeted keyword.`
  );

  if (targetedQuestions.length === 0) {
    console.log("No questions to audit.");
    return;
  }

  // ── For each question, pick primary keyword = highest-weight targeted keyword WITH blueprint
  let unscoped = 0;
  const auditPairs: Array<{ question: QuestionRow; keyword: KeywordRow }> = [];

  for (const q of targetedQuestions) {
    const weights = q.keyword_weights ?? {};
    let bestId: string | null = null;
    let bestWeight = -Infinity;
    for (const [kwId, w] of Object.entries(weights)) {
      const numW = typeof w === "number" ? w : 0;
      if (targetKeywordIds.has(kwId) && numW > bestWeight) {
        bestWeight = numW;
        bestId = kwId;
      }
    }
    if (!bestId || !keywordMap.has(bestId)) {
      unscoped++;
      continue;
    }
    auditPairs.push({ question: q, keyword: keywordMap.get(bestId)! });
  }

  console.log(`  ${auditPairs.length} question(s) will be audited; ${unscoped} skipped (no qualifying keyword with blueprint).`);

  // ── Audit in batches of 5
  const CONCURRENCY = 5;
  const batches = chunk(auditPairs, CONCURRENCY);
  const violations: ViolationReport[] = [];
  let inScopeCount = 0;
  let errorCount = 0;

  console.log("\nAuditing questions...");
  for (const batch of batches) {
    await Promise.all(
      batch.map(async ({ question, keyword }) => {
        try {
          const result = await auditQuestion(openai, question, keyword);
          if (result.in_scope) {
            inScopeCount++;
          } else {
            violations.push({
              questionId: question.id,
              primaryKeywordId: keyword.id,
              primaryKeywordLabel: keyword.label,
              violations: result.violations,
              reason: result.reason,
              stemTruncated: truncate(question.stem, 90),
            });
          }
        } catch (err) {
          errorCount++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  [ERROR] Audit failed for question "${question.id}": ${msg}`);
        }
      })
    );
  }

  // ── Print report
  console.log("\n=== Audit Report ===");
  console.log(`  Total audited:     ${auditPairs.length}`);
  console.log(`  In scope:          ${inScopeCount}`);
  console.log(`  Violations:        ${violations.length}`);
  console.log(`  Audit errors:      ${errorCount}`);
  console.log(`  Unscoped (skipped): ${unscoped}`);

  if (violations.length > 0) {
    console.log("\n--- Violations ---");
    for (const v of violations) {
      console.log(`\n  Question: ${v.questionId}`);
      console.log(`  Keyword:  ${v.primaryKeywordId} ("${v.primaryKeywordLabel}")`);
      console.log(`  Stem:     "${v.stemTruncated}"`);
      console.log(`  Reason:   ${v.reason}`);
      if (v.violations.length > 0) {
        console.log("  Specific violations:");
        for (const viol of v.violations) {
          console.log(`    • ${viol}`);
        }
      }
    }
  }

  // ── Apply: quarantine violating questions
  if (doApply && violations.length > 0) {
    console.log(`\n[APPLY] Setting ${violations.length} question(s) to status='out_of_scope'...`);
    let quarantined = 0;
    let applyErrors = 0;

    for (const v of violations) {
      const { error: updateErr } = await supabase
        .from("mcat_questions")
        .update({ status: "out_of_scope" })
        .eq("id", v.questionId);

      if (updateErr) {
        applyErrors++;
        console.error(`  [ERROR] Could not quarantine question "${v.questionId}": ${updateErr.message}`);
      } else {
        quarantined++;
      }
    }

    console.log(`  Quarantined: ${quarantined} / ${violations.length}`);
    if (applyErrors > 0) {
      console.log(`  Apply errors: ${applyErrors}`);
    }
  } else if (!doApply && violations.length > 0) {
    console.log(
      `\n[DRY] ${violations.length} question(s) WOULD be quarantined. Pass --apply to write.`
    );
  } else {
    console.log("\nNo questions to quarantine.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
