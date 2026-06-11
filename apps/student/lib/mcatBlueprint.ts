/**
 * MCAT concept blueprint: schema, prompt formatter, and generator.
 *
 * PURPOSE
 * -------
 * Lesson generation and question generation for an MCAT keyword are two
 * independent LLM calls that share only a keyword's `label` and `description`.
 * Without a shared scope contract they drift: a keyword scoped to "interpret
 * the sign of ΔG" ends up with questions that test the ΔG = ΔH − TΔS
 * calculation — territory that belongs to a sibling keyword.
 *
 * The `ConceptBlueprint` is that contract. It is generated ONCE per keyword
 * (stored in `mcat_keywords.concept_blueprint`) and injected into every
 * downstream generation call via `buildBlueprintBlock`. Both the lesson
 * generator and the question generator must stay inside the blueprint's
 * `in_scope_concepts` and must not touch anything in `out_of_scope`.
 *
 * SIBLING AWARENESS
 * -----------------
 * The generator accepts an optional list of sibling keyword
 * label+descriptions. It instructs the LLM to use them to sharpen the
 * `out_of_scope` list so that boundaries between siblings are unambiguous.
 *
 * VALIDATION / RETRY
 * ------------------
 * Output shape is validated strictly. If the first attempt produces an invalid
 * blueprint the call is retried once; a second failure throws McatGenError.
 *
 * USAGE
 * -----
 * ```ts
 * import { generateConceptBlueprint, buildBlueprintBlock } from "@/lib/mcatBlueprint";
 *
 * const blueprint = await generateConceptBlueprint({ keyword, siblings, outlineContext });
 * // store blueprint in mcat_keywords.concept_blueprint ...
 *
 * // later, inside a generation prompt:
 * const scopeBlock = buildBlueprintBlock(blueprint);
 * const userPrompt = `${scopeBlock}\n\n... rest of prompt ...`;
 * ```
 */

import OpenAI from "openai";
// Relative (not "@/") so this module is importable from root-level tsx scripts,
// which have no path-alias resolver. mcatGenerator.ts itself uses no "@/" imports.
import { McatGenError } from "./mcatGenerator";

// ─── Blueprint schema ─────────────────────────────────────────────────────────

export interface ConceptBlueprint {
  /** The specific concepts/skills a question or lesson for THIS keyword may test. Each a short phrase. 2–6 items. */
  in_scope_concepts: string[];
  /** Formulas/equations the student is expected to USE for this keyword. EMPTY ARRAY for purely conceptual keywords. */
  in_scope_formulas: string[];
  /** Concepts/formulas that are RELATED but belong to OTHER keywords and must NOT be tested here. Phrase each so it's unambiguous. 2–8 items. */
  out_of_scope: string[];
  /** Canonical terms/symbols in play for this keyword. */
  key_terms: string[];
  /** One imperative sentence stating the hard boundary, e.g. "Tests ONLY the meaning of the sign of ΔG; must NOT require any calculation involving enthalpy, entropy, temperature, or equilibrium constants." */
  boundary_statement: string;
}

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
    `OUT OF SCOPE — do NOT make any item PRIMARILY about these or require the student to apply them as the tested skill (they may appear only as incidental context or as the stated conclusion):\n${outOfScopeBullets}`,
    `KEY TERMS: ${keyTermsLine}`,
    `BOUNDARY: ${blueprint.boundary_statement}`,
    "Any question or lesson content whose PRIMARY tested skill or required computation is out-of-scope is INVALID. Stay strictly inside the in-scope concepts.",
  ].join("\n");
}

// ─── Generator internals ──────────────────────────────────────────────────────

const GEN_MODEL = "gpt-5.4-mini";

function createGenClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new McatGenError("OPENAI_API_KEY not set", 500);
  return new OpenAI({ apiKey: key });
}

const BLUEPRINT_SYSTEM = `You are an MCAT Biology content architect. Your job is to define the precise, narrow testable boundary of a single MCAT keyword so that lesson and question generators stay strictly on topic and never drift into adjacent keywords' territory.

For each keyword you receive, return a JSON object with the following shape:
{
  "blueprint": {
    "in_scope_concepts": ["<short phrase>", ...],
    "in_scope_formulas": ["<formula>", ...],
    "out_of_scope": ["<concept or formula that belongs elsewhere>", ...],
    "key_terms": ["<term or symbol>", ...],
    "boundary_statement": "<one imperative sentence>"
  }
}

RULES:
- The keyword is deliberately narrow. Do not expand its scope.
- in_scope_concepts: 2–6 short phrases describing ONLY what this keyword covers. IMPORTANT: include the natural interpretation or conclusion that results from this keyword's core skill. For example, if the skill is to apply a formula that determines spontaneity, then "concluding whether a process is spontaneous or non-spontaneous" is IN scope — it is the outcome of the skill, not a separate skill.
- in_scope_formulas: the formulas a student must USE for this keyword. If the keyword is conceptual (e.g. "interpret the sign of X", "recognize that Y means Z"), this array MUST be empty. The boundary_statement must then explicitly forbid calculations.
- out_of_scope: 2–8 phrases describing concepts/formulas that represent a DIFFERENT primary skill belonging to a sibling keyword — things a question here must NOT require the student to compute or apply as the tested skill. Do NOT put shared conclusion/outcome vocabulary in out_of_scope. "Spontaneous/non-spontaneous" is a shared outcome that multiple keywords may state as a conclusion — it is NOT the exclusive territory of any one keyword. Only list in out_of_scope what would require the student to demonstrate a distinct, separately-tested skill or formula.
- key_terms: canonical terms and symbols in play.
- boundary_statement: one imperative sentence stating the hard limit.

PRIMARY-SKILL vs. SHARED-OUTCOME DISTINCTION (critical):
The PRIMARY TESTED SKILL is the cognitive operation the student must perform. Shared OUTCOME vocabulary is the conclusion that naturally follows from performing the skill — it belongs to whoever performs the skill, not exclusively to one keyword.

WORKED CONTRAST using Gibbs free energy siblings:

Keyword A: "gibbs_free_energy_sign_and_spontaneity" (skill: interpret the SIGN of ΔG)
  • IN SCOPE: reading the sign of a given ΔG value; stating spontaneous (ΔG < 0) or non-spontaneous (ΔG > 0) as a conclusion; recognizing ΔG = 0 at equilibrium.
  • in_scope_formulas: [] — EMPTY. No calculation. The student is given ΔG and interprets its sign.
  • OUT OF SCOPE: applying the formula ΔG = ΔH − TΔS (that is the primary skill of a different sibling); calculating or comparing ΔH vs TΔS; finding the crossover temperature at which spontaneity changes; computing ΔG° from equilibrium constants; ATP coupling. Stating "spontaneous or not" is NOT out of scope — it is the natural conclusion of sign interpretation.
  • boundary_statement: "Tests ONLY the meaning of the sign of ΔG; must NOT require any calculation involving enthalpy, entropy, temperature, or equilibrium constants."

Keyword B: "delta_g_relationship_to_enthalpy_entropy_and_temperature" (skill: use ΔG = ΔH − TΔS)
  • IN SCOPE: applying ΔG = ΔH − TΔS; comparing the TΔS term to ΔH across temperature regimes; finding the crossover temperature at which ΔG changes sign; CONCLUDING whether the process is spontaneous or non-spontaneous as the outcome of the calculation.
  • in_scope_formulas: ["ΔG = ΔH − TΔS"]
  • OUT OF SCOPE: computing ΔG° from equilibrium constants K (different skill/sibling); reaction quotient Q; ATP coupling; Nernst equation. Do NOT list "spontaneity interpretation" or "spontaneous/non-spontaneous" as out of scope — concluding spontaneity is the natural outcome of applying ΔG = ΔH − TΔS.
  • boundary_statement: "Tests application of ΔG = ΔH − TΔS and temperature-dependence reasoning; must NOT require ΔG°/K relationships, reaction quotient Q, or ATP coupling."

Apply this same logic to all keywords: out_of_scope is for DIFFERENT primary skills/formulas owned by siblings, not for shared conclusion vocabulary.

Return valid JSON only. No markdown.`;

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
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function parseBlueprint(parsed: Record<string, unknown>): ConceptBlueprint | null {
  const raw = parsed.blueprint;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyStringArray(obj.in_scope_concepts)) return null;
  if (!isStringArray(obj.in_scope_formulas)) return null;
  if (!isNonEmptyStringArray(obj.out_of_scope)) return null;
  if (!isStringArray(obj.key_terms)) return null;
  if (typeof obj.boundary_statement !== "string" || !obj.boundary_statement.trim()) return null;

  return {
    in_scope_concepts: (obj.in_scope_concepts as string[]).map((s) => s.trim()).filter(Boolean),
    in_scope_formulas: (obj.in_scope_formulas as string[]).map((s) => s.trim()).filter(Boolean),
    out_of_scope: (obj.out_of_scope as string[]).map((s) => s.trim()).filter(Boolean),
    key_terms: (obj.key_terms as string[]).map((s) => s.trim()).filter(Boolean),
    boundary_statement: (obj.boundary_statement as string).trim(),
  };
}

// ─── Exported generator ───────────────────────────────────────────────────────

/**
 * Generate a `ConceptBlueprint` for a single MCAT keyword.
 *
 * The blueprint defines exactly what a lesson or question for this keyword may
 * and may not test. Store it in `mcat_keywords.concept_blueprint` and pass it
 * to `buildBlueprintBlock` when building generation prompts.
 *
 * @param opts.keyword        - The keyword to scope (id, label, description, optional examples).
 * @param opts.siblings       - Sibling keywords whose coverage should be listed as out-of-scope.
 * @param opts.outlineContext - AAMC outline grounding string from `outlineContextForCategory`.
 *
 * @throws McatGenError if the LLM returns an invalid blueprint after one retry,
 *         or if OPENAI_API_KEY is absent.
 */
export async function generateConceptBlueprint(opts: {
  keyword: { id: string; label: string; description: string; examples?: string[] };
  siblings?: { label: string; description: string }[];
  outlineContext?: string;
}): Promise<ConceptBlueprint> {
  const userPrompt = buildUserPrompt(opts);

  const runOnce = async (): Promise<ConceptBlueprint | null> => {
    let text: string;
    try {
      const client = createGenClient();
      const completion = await client.chat.completions.create({
        model: GEN_MODEL,
        messages: [
          { role: "system", content: BLUEPRINT_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      });
      text = completion.choices[0]?.message?.content ?? "{}";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new McatGenError(`AI provider request failed: ${msg}`);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }

    return parseBlueprint(parsed);
  };

  let blueprint = await runOnce();

  if (!blueprint) {
    blueprint = await runOnce();
  }

  if (!blueprint) {
    throw new McatGenError(
      "Blueprint generation produced no valid output after retry"
    );
  }

  return blueprint;
}
