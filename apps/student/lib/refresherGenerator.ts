/**
 * On-demand SHORT refresher generation for the math + mcat systems.
 *
 * A refresher is a quick "rundown" — a concise rule plus one worked example —
 * NOT a full lesson. It mirrors learn_refreshers but writes to math_refreshers /
 * mcat_refreshers. Uses the same OpenAI-compat setup as the math/mcat generators
 * (gpt-5.4-mini, json_object response format).
 *
 * Called by /api/{math,mcat}/refresher/[keywordId]. Generates → stores → returns.
 * Delete the cached row to force regeneration.
 */
import { SupabaseClient } from "@supabase/supabase-js";
import { clientForModel } from "./genClient";
import { parseModelJson } from "./parseModelJson";
import { resolveSystemPrompt, promptSlot } from "./promptOverrides";
import { buildIdentityScopeBlock } from "./scopeIds";

const GEN_MODEL = "gpt-5.4-mini";

/** Thrown when refresher generation fails; carries an HTTP status. */
export class RefresherGenError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "RefresherGenError";
    this.status = status;
  }
}

export const REFRESHER_MATH_SYSTEM = `You are a math tutor writing a SHORT refresher for a student who just forgot this precalc/calculus skill and is seconds from being tested on it. NOT a lesson — a fast, scannable rundown.

COVERAGE (the whole point): the bullets must TOUCH every in-scope rule, formula, and notation of THIS keyword — the same things its problems test. Name each by its actual term; combine closely related ones into one bullet. Leave nothing in-scope out; add nothing out-of-scope.

FORMAT — rule_latex is a list of BULLETS, each on its own line starting with "• ": one terse rule, formula, or fact per bullet — a phrase, not a sentence, no preamble or transitions. As few bullets as cover the in-scope content. NO worked example: return example_latex as "".

NOTATION — write prose as PLAIN TEXT and wrap EVERY variable/symbol/expression in $...$; never \\text{}, never bare LaTeX (it shows literal backslashes).

Return JSON only, no markdown: { "rule_latex": "• …\\n• …", "example_latex": "" }`;

export const REFRESHER_MCAT_SYSTEM = `You are an MCAT tutor writing a SHORT refresher for a student who just forgot this concept and is seconds from being tested on it. NOT a lesson — a fast, scannable rundown.

COVERAGE (the whole point): the bullets must TOUCH every in-scope fact and term of THIS keyword — the same things its flashcards and questions test. Use each key term by its actual name; combine closely related ones into one bullet. Leave nothing in-scope out; add nothing out-of-scope.

FORMAT — rule_latex is a list of BULLETS, each on its own line starting with "• ": one terse fact, rule, value, or direction per bullet — a phrase, not a sentence, no preamble. As few bullets as cover the in-scope content. NO illustration: return example_latex as "".

DEPTH — directions, ranges, classifications, not precise constants (no decimal $pK_a$, no exact $K_m$/$V_{max}$).

NOTATION — wrap all math/chemistry in $...$ KaTeX with real sub/superscripts ($V_{max}$, $H_2O$); flat ASCII and \\text{} are WRONG. A Greek letter naming a structure → write the word (alpha carbon), not the symbol.

Return JSON only, no markdown: { "rule_latex": "• …\\n• …", "example_latex": "" }`;

/** Minimal blueprint shape shared by math_keywords.concept_blueprint and mcat_keywords.concept_blueprint. */
type BlueprintLike = {
  key_terms?: unknown;
  in_scope_concepts?: unknown;
  out_of_scope?: unknown;
  boundary_statement?: unknown;
} | null;

type KwMeta = {
  id: string;
  label: string;
  description: string | null;
  examples?: string[] | string | null;
  blueprint?: BlueprintLike;
};

/** Normalize an examples column (text[] or text) into a single readable line. */
function examplesToLine(examples: KwMeta["examples"]): string {
  if (!examples) return "";
  if (Array.isArray(examples)) return examples.filter(Boolean).join("; ");
  return String(examples);
}

/** Pull the topic's essential vocabulary from its blueprint key_terms / in_scope_concepts. */
function keyTermsLine(blueprint: BlueprintLike): string {
  if (!blueprint) return "";
  const terms = Array.isArray(blueprint.key_terms)
    ? (blueprint.key_terms as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const concepts = Array.isArray(blueprint.in_scope_concepts)
    ? (blueprint.in_scope_concepts as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const merged = [...terms, ...concepts].map((s) => s.trim()).filter(Boolean);
  return merged.join("; ");
}

/** Pull the out-of-scope fence from the blueprint, if present. */
function outOfScopeLine(blueprint: BlueprintLike): string {
  if (!blueprint) return "";
  const items = Array.isArray(blueprint.out_of_scope)
    ? (blueprint.out_of_scope as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  return items.map((s) => s.trim()).filter(Boolean).join("; ");
}

/** Build the user prompt: label + description + examples + key terms + scope fence + a coverage instruction. */
async function buildRefresherUserPrompt(
  system: "math" | "mcat",
  kw: KwMeta
): Promise<string> {
  const identityBlock = await buildIdentityScopeBlock(system, [
    { id: kw.id, label: kw.label, description: kw.description ?? "" },
  ]);
  return `${identityBlock}

Write the refresher as bullets covering EVERY in-scope fact/term of THIS keyword — the student is about to be tested on exactly these. Combine closely related ones into one bullet. Stay STRICTLY inside this keyword's scope; touch nothing out-of-scope.`;
}

async function callGen(
  system: string,
  user: string,
  model: string = GEN_MODEL
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    const client = clientForModel(model);
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    text = completion.choices[0]?.message?.content ?? "{}";
  } catch (err) {
    if (err instanceof RefresherGenError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new RefresherGenError(`AI provider request failed: ${msg}`);
  }
  try {
    return parseModelJson<Record<string, unknown>>(text);
  } catch {
    throw new RefresherGenError("AI provider returned non-JSON output");
  }
}

/**
 * Generate a short refresher for the given keyword in the given system and store
 * it in {system}_refreshers. Returns { rule_latex, example_latex } or null when
 * the model output is unusable.
 */
export async function generateAndStoreRefresher(
  supabase: SupabaseClient,
  system: "math" | "mcat",
  kw: KwMeta
): Promise<{ rule_latex: string; example_latex: string } | null> {
  const parsed = await callGen(
    await resolveSystemPrompt(promptSlot(system, "refresher"), defaultRefresherSystem(system)),
    await buildRefresherUserPrompt(system, kw)
  );
  if (!parsed.rule_latex) return null;

  const ruleLatex = String(parsed.rule_latex);
  const exampleLatex = String(parsed.example_latex ?? "");
  const table = system === "math" ? "math_refreshers" : "mcat_refreshers";

  // Fail-soft store: if the table is missing the route still returns content.
  await supabase
    .from(table)
    .upsert(
      {
        keyword_id: kw.id,
        rule_latex: ruleLatex,
        example_latex: exampleLatex,
        model: GEN_MODEL,
      },
      { onConflict: "keyword_id" }
    );

  return { rule_latex: ruleLatex, example_latex: exampleLatex };
}

/** Default refresher system prompt for a system (dev lab). */
export function defaultRefresherSystem(system: "math" | "mcat"): string {
  return system === "math" ? REFRESHER_MATH_SYSTEM : REFRESHER_MCAT_SYSTEM;
}

/**
 * Generate a refresher FRESH for the dev lab — never stores, accepts a system-prompt
 * and model override, and reports the assembled user prompt. Mirrors the lesson lab.
 */
export async function generateRefresherPreview(
  system: "math" | "mcat",
  kw: KwMeta,
  opts?: { systemPrompt?: string; model?: string; onUserPrompt?: (p: string) => void; previewOnly?: boolean }
): Promise<{ rule_latex: string; example_latex: string } | null> {
  const userPrompt = await buildRefresherUserPrompt(system, kw);
  opts?.onUserPrompt?.(userPrompt);
  if (opts?.previewOnly) return null;
  const parsed = await callGen(
    opts?.systemPrompt ?? defaultRefresherSystem(system),
    userPrompt,
    opts?.model
  );
  if (!parsed.rule_latex) return null;
  return {
    rule_latex: String(parsed.rule_latex),
    example_latex: String(parsed.example_latex ?? ""),
  };
}
