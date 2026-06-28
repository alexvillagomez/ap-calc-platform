/**
 * Math concept blueprint: schema, prompt formatter, and generator.
 *
 * PURPOSE
 * -------
 * Question and lesson generation for a math keyword share only a keyword's
 * `label` and `description`. Without a shared scope contract they drift:
 * a keyword scoped to "apply the chain rule to composite trig functions"
 * ends up with questions that also test implicit differentiation — territory
 * that belongs to a sibling keyword.
 *
 * The `ConceptBlueprint` is that contract. It is generated ONCE per keyword
 * (stored in `math_keywords.concept_blueprint`) and injected into every
 * downstream generation call via `buildBlueprintBlock`. Both the lesson
 * generator and the question generator must stay inside the blueprint's
 * `in_scope_concepts` and must not touch anything in `out_of_scope`.
 *
 * SIBLING AWARENESS
 * -----------------
 * The generator accepts an optional list of sibling keyword label+descriptions.
 * It instructs the LLM to use them to sharpen the `out_of_scope` list so that
 * boundaries between siblings are unambiguous.
 *
 * YIELD (0–1 NUMERIC)
 * -------------------
 * `generateConceptBlueprint` returns `yield_score` (0.00–1.00, two decimal
 * places, numeric) and `yield_rationale` (one sentence) in the SAME LLM call.
 *
 * Calibration anchors (from design-spec.md):
 *   chain rule 0.95, FTC 0.90, exponent laws 0.92, sinusoidal modeling 0.90,
 *   linearization 0.55, arc length 0.35, set-builder notation 0.20,
 *   Unit 4 precalc topics ≤ 0.15.
 * Yield reflects: exam-unit weighting × topic centrality × FRQ frequency.
 * For foundation topics: frequency the skill is exercised inside downstream topics.
 * Spread the full 0–1 range; do NOT cluster at high end.
 *
 * USAGE
 * -----
 * ```ts
 * import { generateConceptBlueprint, buildBlueprintBlock } from "@/lib/mathBlueprint";
 *
 * const { blueprint, yield_score, yield_rationale } =
 *   await generateConceptBlueprint({ keyword, siblings, outlineContext });
 * // store blueprint, yield_score, yield_rationale in math_keywords ...
 *
 * // later, inside a generation prompt:
 * const scopeBlock = buildBlueprintBlock(blueprint);
 * const userPrompt = `${scopeBlock}\n\n... rest of prompt ...`;
 * ```
 */

import OpenAI from "openai";
import { MathGenError } from "./mathGenerator";
import type { ConceptBlueprint } from "./mathTypes";

export type { ConceptBlueprint };

// ─── Prompt formatter ─────────────────────────────────────────────────────────

/**
 * Format a `ConceptBlueprint` into a forceful, clearly-delimited block that
 * can be prepended to any lesson or question generation prompt.
 *
 * Returns `""` when `blueprint` is null or undefined so callers can always
 * use the return value unconditionally.
 */
export function buildBlueprintBlock(
  blueprint: ConceptBlueprint | null | undefined
): string {
  if (!blueprint) return "";

  const inScopeBullets = blueprint.in_scope_concepts
    .map((c) => `  • ${c}`)
    .join("\n");

  const formulasLine =
    blueprint.in_scope_formulas.length > 0
      ? blueprint.in_scope_formulas.join("; ")
      : "NONE — this keyword requires no formula or calculation. Do not introduce any.";

  const outOfScopeBullets = blueprint.out_of_scope
    .map((c) => `  • ${c}`)
    .join("\n");

  const keyTermsLine = blueprint.key_terms.join(", ");

  return [
    "SCOPE CONTRACT (you MUST obey this exactly):",
    `IN SCOPE — test only these concepts:\n${inScopeBullets}`,
    `FORMULAS ALLOWED: ${formulasLine}`,
    `OUT OF SCOPE — do NOT make any item PRIMARILY about these or require the student to apply them as the tested skill:\n${outOfScopeBullets}`,
    `KEY TERMS: ${keyTermsLine}`,
    `BOUNDARY: ${blueprint.boundary_statement}`,
    "Any question or lesson content whose PRIMARY tested skill or required computation is out-of-scope is INVALID. You may NAME an out-of-scope concept as incidental context, but you must NOT build the question's reasoning, its worked solution, or the justification of the correct answer on an out-of-scope skill (e.g. if ionization/pKa is out of scope, do not justify an answer by reasoning about proton loss or charge at a given pH). Stay strictly inside the in-scope concepts.",
  ].join("\n");
}

// ─── Generator internals ──────────────────────────────────────────────────────

const GEN_MODEL = "gpt-5.4-mini";

function createGenClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new MathGenError("OPENAI_API_KEY not set", 500);
  return new OpenAI({ apiKey: key });
}

// ─── Transient-retry helpers ──────────────────────────────────────────────────

function isTransientError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === undefined) return true; // network/connection/timeout
  return [408, 409, 425, 429, 431, 500, 502, 503, 504].includes(status);
}

async function withTransientRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 4
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransientError(err)) break;
      const base = 600 * Math.pow(2.2, attempt - 1);
      const delay = base + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new MathGenError(
    `AI provider request failed after retries (${label}): ${msg}`
  );
}

// ─── Yield guidance ───────────────────────────────────────────────────────────

const YIELD_GUIDANCE = `YIELD SCORE GUIDANCE:
yield_score is a number from 0.00 to 1.00 (two decimal places) estimating how heavily
this specific math keyword is tested on the AP exam (or, for foundation keywords, how
load-bearing the skill is for downstream AP content).

Calibration anchors (use these to anchor your scale):
  0.95 — chain rule (embedded in nearly 100% of FRQs)
  0.92 — integer exponent laws (ubiquitous in every unit involving exponents)
  0.90 — FTC Part 1/2, u-substitution, sinusoidal modeling, sin/cos/e^x/ln(x) derivatives
  0.88 — quadratic factoring, rational exponent structure, log manipulation rules
  0.85 — power rule, product rule, 1st/2nd derivative tests, concavity, Riemann sums, transformations
  0.80 — particle motion, MVT, EVT, critical points, area between curves
  0.75 — L'Hôpital, related rates, IVT, function composition, inverse functions
  0.55 — linearization, semi-log plots, arc length → lower-frequency specific topics
  0.35 — arc length formula, less-common cross-section types
  0.20 — set-builder notation, conceptual intro topics (1.1)
  ≤0.15 — ALL Unit 4 AP Precalc topics (NOT on exam)

Spread the full 0–1 range. Do NOT rate everything 0.80+.
yield_rationale: one sentence citing WHY (e.g., "appears in nearly every FRQ as a sub-step" or
"Unit 4 topic not assessed on AP Precalc exam").`;

// ─── System prompt ────────────────────────────────────────────────────────────

const BLUEPRINT_SYSTEM = `You are a math content architect for an AP Precalculus / AP Calculus AB adaptive learning platform. Your job is to define the precise, narrow testable boundary of a single math keyword so that lesson and question generators stay strictly on topic and never drift into adjacent keywords' territory.

For each keyword you receive, return a JSON object with the following shape:
{
  "blueprint": {
    "in_scope_concepts": ["<short phrase>", ...],
    "in_scope_formulas": ["<formula in LaTeX>", ...],
    "out_of_scope": ["<concept or formula that belongs elsewhere>", ...],
    "key_terms": ["<term or symbol>", ...],
    "boundary_statement": "<one imperative sentence>"
  },
  "yield_score": 0.00-1.00,
  "yield_rationale": "<one sentence explaining WHY this yield score was assigned>"
}

${YIELD_GUIDANCE}

RULES:
- The keyword is deliberately narrow. Do not expand its scope.
- in_scope_concepts: 2–6 short phrases describing ONLY what this keyword covers. Include the natural conclusion/outcome that results from applying this keyword's core skill (e.g., if the skill is to apply the chain rule, then "identifying that the derivative requires the chain rule" is IN scope).
- in_scope_formulas: the LaTeX formulas a student must USE. If the keyword is conceptual, this array MUST be empty. Use $...$ LaTeX for display inside the string values.
- out_of_scope: 2–8 phrases describing concepts/formulas that are a DIFFERENT primary skill belonging to a sibling keyword. Do NOT put shared conclusion vocabulary here (e.g., if a keyword tests computing a derivative, concluding "the function is increasing at x=a" is a natural outcome — NOT out of scope).
- key_terms: canonical terms and symbols in play.
- boundary_statement: one imperative sentence starting with "Tests ONLY..." or "Assesses ONLY..." stating the hard limit.

WORKED CONTRAST (use this reasoning pattern):

Keyword A: "chain_rule_with_composite_trig" (skill: apply chain rule to trig(g(x)))
  • IN SCOPE: identifying the outer/inner function structure; applying f'(g(x))·g'(x); derivatives of sin, cos, tan at the outer layer; derivative of the inner function at the inner layer.
  • in_scope_formulas: ["$\\frac{d}{dx}[f(g(x))] = f'(g(x)) \\cdot g'(x)$"]
  • OUT OF SCOPE: implicit differentiation (different primary skill); product rule (tested separately); quotient rule; second derivatives of composite functions (higher-order is a different keyword).

Keyword B: "implicit_differentiation_of_polynomial_curves" (skill: apply implicit diff to find dy/dx)
  • IN SCOPE: differentiating both sides of an equation in x and y; applying chain rule to y terms (as a mechanical step, not a separate skill); solving for dy/dx; evaluating dy/dx at a point.
  • in_scope_formulas: ["Implicit: $\\frac{d}{dx}[y^n] = n y^{n-1} \\frac{dy}{dx}$"]
  • OUT OF SCOPE: chain rule derivation (assumed prerequisite); finding second derivative via implicit diff (separate keyword); related rates (different application of the technique).

Apply this same logic to all math keywords. out_of_scope lists DIFFERENT primary skills, not shared outcomes.

Return valid JSON only. No markdown. Use clean LaTeX syntax in formulas (backslash-escaped).`;

// ─── User prompt builder ──────────────────────────────────────────────────────

function buildUserPrompt(opts: {
  keyword: { id: string; label: string; description: string; examples?: string[] };
  siblings?: { label: string; description: string }[];
  outlineContext?: string;
}): string {
  const { keyword, siblings, outlineContext } = opts;

  const parts: string[] = [];

  if (outlineContext) {
    parts.push(outlineContext);
    parts.push("");
  }

  parts.push("KEYWORD TO SCOPE:");
  parts.push(`  id: "${keyword.id}"`);
  parts.push(`  label: "${keyword.label}"`);
  parts.push(`  description: "${keyword.description}"`);
  if (keyword.examples && keyword.examples.length > 0) {
    parts.push(`  examples: ${keyword.examples.join("; ")}`);
  }

  if (siblings && siblings.length > 0) {
    parts.push("");
    parts.push(
      "SIBLING KEYWORDS (their territory is OUT OF SCOPE for this keyword):"
    );
    for (const s of siblings) {
      parts.push(`  • ${s.label}: ${s.description}`);
    }
  }

  return parts.join("\n");
}

// ─── Validation ───────────────────────────────────────────────────────────────

function isNonEmptyStringArray(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => typeof x === "string")
  );
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function parseBlueprint(
  parsed: Record<string, unknown>
): ConceptBlueprint | null {
  const raw = parsed.blueprint;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyStringArray(obj.in_scope_concepts)) return null;
  if (!isStringArray(obj.in_scope_formulas)) return null;
  if (!isNonEmptyStringArray(obj.out_of_scope)) return null;
  if (!isStringArray(obj.key_terms)) return null;
  if (
    typeof obj.boundary_statement !== "string" ||
    !obj.boundary_statement.trim()
  )
    return null;

  return {
    in_scope_concepts: (obj.in_scope_concepts as string[])
      .map((s) => s.trim())
      .filter(Boolean),
    in_scope_formulas: (obj.in_scope_formulas as string[])
      .map((s) => s.trim())
      .filter(Boolean),
    out_of_scope: (obj.out_of_scope as string[])
      .map((s) => s.trim())
      .filter(Boolean),
    key_terms: (obj.key_terms as string[]).map((s) => s.trim()).filter(Boolean),
    boundary_statement: (obj.boundary_statement as string).trim(),
  };
}

function parseYield(parsed: Record<string, unknown>): {
  yield_score: number;
  yield_rationale: string;
} {
  const rawScore = parsed.yield_score;
  let yield_score = 0.5; // coerce-with-default

  if (typeof rawScore === "number" && isFinite(rawScore)) {
    // Clamp to [0, 1] and round to two decimal places
    yield_score = Math.round(Math.min(1, Math.max(0, rawScore)) * 100) / 100;
  }

  const rawRationale = parsed.yield_rationale;
  const yield_rationale =
    typeof rawRationale === "string" ? rawRationale.trim() : "";

  return { yield_score, yield_rationale };
}

// ─── Exported blueprint generator ────────────────────────────────────────────

/**
 * Generate a `ConceptBlueprint` for a single math keyword.
 *
 * The blueprint defines exactly what a lesson or question for this keyword may
 * and may not test. Store it in `math_keywords.concept_blueprint` and pass it
 * to `buildBlueprintBlock` when building generation prompts.
 *
 * @param opts.keyword        - The keyword to scope (id, label, description, optional examples).
 * @param opts.siblings       - Sibling keywords whose coverage should be listed as out-of-scope.
 * @param opts.outlineContext - Outline grounding string from `outlineContextForCategory`.
 *
 * @throws MathGenError if the LLM returns an invalid blueprint after one retry,
 *         or if OPENAI_API_KEY is absent.
 */
export async function generateConceptBlueprint(opts: {
  keyword: { id: string; label: string; description: string; examples?: string[] };
  siblings?: { label: string; description: string }[];
  outlineContext?: string;
}): Promise<{
  blueprint: ConceptBlueprint;
  yield_score: number;
  yield_rationale: string;
}> {
  const userPrompt = buildUserPrompt(opts);

  let capturedYield: { yield_score: number; yield_rationale: string } = {
    yield_score: 0.5,
    yield_rationale: "",
  };

  const runOnce = async (): Promise<ConceptBlueprint | null> => {
    const client = createGenClient();
    const completion = await withTransientRetry(
      () =>
        client.chat.completions.create({
          model: GEN_MODEL,
          messages: [
            { role: "system", content: BLUEPRINT_SYSTEM },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        }),
      `blueprint:${opts.keyword.id}`
    );
    const text = completion.choices[0]?.message?.content ?? "{}";

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }

    // Always capture yield (coerce-with-default; never blocks retry)
    capturedYield = parseYield(parsed);

    return parseBlueprint(parsed);
  };

  let blueprint = await runOnce();

  if (!blueprint) {
    blueprint = await runOnce();
  }

  if (!blueprint) {
    throw new MathGenError(
      "Blueprint generation produced no valid output after retry"
    );
  }

  return { blueprint, ...capturedYield };
}

// ─── Yield-only generator ─────────────────────────────────────────────────────

const YIELD_ONLY_SYSTEM = `You are a math content expert rating how heavily the real AP exam tests a specific keyword, or how load-bearing the skill is for downstream AP content (for foundation topics).

Return a JSON object with exactly this shape:
{
  "yield_score": 0.00-1.00,
  "yield_rationale": "<one sentence explaining WHY this yield score was assigned>"
}

${YIELD_GUIDANCE}

Return valid JSON only. No markdown.`;

/**
 * Lightweight yield-only generator for keywords that already have a blueprint
 * but are missing `yield_score` / `yield_rationale`.
 *
 * Never throws on a bad yield response — coerces to defaults instead.
 * Only throws `MathGenError` if the API call itself fails.
 */
export async function generateKeywordYield(opts: {
  keyword: { id: string; label: string; description: string };
  inScopeConcepts?: string[];
  outlineContext?: string;
}): Promise<{ yield_score: number; yield_rationale: string }> {
  const { keyword, inScopeConcepts, outlineContext } = opts;

  const parts: string[] = [];

  if (outlineContext) {
    parts.push(outlineContext);
    parts.push("");
  }

  parts.push("KEYWORD TO RATE:");
  parts.push(`  id: "${keyword.id}"`);
  parts.push(`  label: "${keyword.label}"`);
  parts.push(`  description: "${keyword.description}"`);

  if (inScopeConcepts && inScopeConcepts.length > 0) {
    parts.push("");
    parts.push(`What this keyword tests: ${inScopeConcepts.join("; ")}`);
  }

  const userPrompt = parts.join("\n");

  const client = createGenClient();
  const completion = await withTransientRetry(
    () =>
      client.chat.completions.create({
        model: GEN_MODEL,
        messages: [
          { role: "system", content: YIELD_ONLY_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    `yield:${keyword.id}`
  );
  const text = completion.choices[0]?.message?.content ?? "{}";

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { yield_score: 0.5, yield_rationale: "" };
  }

  return parseYield(parsed);
}
