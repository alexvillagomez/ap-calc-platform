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
import OpenAI from "openai";
import { SupabaseClient } from "@supabase/supabase-js";
import { parseModelJson } from "./parseModelJson";

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

function createGenClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new RefresherGenError("OPENAI_API_KEY not set", 500);
  return new OpenAI({ apiKey: key });
}

const FORMAT_RULES = `FORMATTING:
- Write prose as PLAIN TEXT — never use \\text{}.
- Wrap every variable, symbol, or expression in $...$ (inline) or $$...$$ (block). This applies to BOTH rule_latex and example_latex.
- Plain-text prose must contain no backslash, ^, _, or { } — anything that needs them goes inside $...$.
- Bare LaTeX outside $...$ does NOT render — it shows literal backslashes.
  ✅ CORRECT: "Factor by difference of squares: $a^2-b^2=(a-b)(a+b)$."
  ❌ WRONG (bare): "\\frac{d}{dx}(x+3)^4" or "\\begin{aligned}...\\end{aligned}" without $$...$$`;

const MATH_SYSTEM = `You are a tutor writing a SHORT refresher for a student who just forgot a precalculus/calculus skill. This is a quick rundown — a concise rule plus ONE worked example — NOT a full lesson.

Return a JSON object: { "rule_latex": string, "example_latex": string }

rule_latex: 1-2 sentences stating the rule clearly.
example_latex: one short worked example showing the key steps.

${FORMAT_RULES}

Return valid JSON only. No markdown.`;

const MCAT_SYSTEM = `You are a tutor writing a SHORT refresher for a student who just forgot an MCAT concept. This is a quick rundown — a concise rule/principle plus ONE worked example or illustration — NOT a full lesson.

Return a JSON object: { "rule_latex": string, "example_latex": string }

rule_latex: 1-2 sentences stating the core principle clearly.
example_latex: one short worked example or concrete illustration.

Write prose as PLAIN TEXT. Wrap any math in $...$ — never use \\text{}.

Return valid JSON only. No markdown.`;

type KwMeta = { id: string; label: string; description: string | null };

async function callGen(
  system: string,
  user: string
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    const client = createGenClient();
    const completion = await client.chat.completions.create({
      model: GEN_MODEL,
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
    system === "math" ? MATH_SYSTEM : MCAT_SYSTEM,
    `keyword: ${kw.id}\nLabel: ${kw.label}\nDescription: ${kw.description ?? ""}`
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
