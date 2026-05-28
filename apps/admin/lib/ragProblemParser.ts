import { normalizeRichMathSource } from "@/lib/latexRichMathNormalize";
import { DIFFICULTY_SCALE } from "@/lib/ai/examPrepConstants";

export function buildMcqSchemaJson(correctIndex: number): string {
  const ci = Math.min(3, Math.max(0, Math.floor(correctIndex)));
  return `{
  "generation_thinking": "2-3 sentences planning the problem: what skill, what fresh angle, what difficulty.",
  "distractor_thinking": "For each wrong slot: (1) name the exact student mistake, (2) state the resulting value in terms of the ACTUAL base used in the problem (if base is sin x, wrong answer is (sin x)^n — not a number like 1/16). All 3 wrong values must differ from each other AND from the correct answer. NEVER substitute a made-up numeric base to compute distractor values.",
  "problem_description": "ONE plain-English sentence — skill category only, NO specific numbers/expressions. REQUIRED.",
  "latex_content": "",
  "solution_latex": "",
  "choices": ["choice 0", "choice 1", "choice 2", "choice 3"],
  "correct_index": ${ci},
  "wrong_answer_descriptions": [
    "Specific conceptual mistake a student makes to get choice 0 — plain English, no numbers. null if this is the correct choice.",
    "Specific conceptual mistake a student makes to get choice 1 — plain English, no numbers. null if this is the correct choice.",
    "Specific conceptual mistake a student makes to get choice 2 — plain English, no numbers. null if this is the correct choice.",
    "Specific conceptual mistake a student makes to get choice 3 — plain English, no numbers. null if this is the correct choice."
  ],
  "difficulty": 3
}
RULES:
- choices[${ci}] = correct answer. wrong_answer_descriptions[${ci}] = null (actual JSON null — NOT the string "null").
- wrong_answer_descriptions MUST have exactly 4 entries total: 3 non-null strings + 1 null at position ${ci}.
- Each non-null wrong_answer_description must name the specific mistake that causes the student to produce that choice's wrong value.
- Each wrong choice must simplify to a DIFFERENT value from the correct answer AND from each other. Mathematical equivalences: 3^{-2} = 1/9, 3^0 = 1, (3^4)^0 = 1, any a^0 = 1, 4/2 = 2.
- SYMBOLIC BASE: If the problem base is symbolic (sin x, cos x, x, f(x), etc.), wrong answer choices must be expressions in that same base (e.g. (sin x)^{-4}) — NEVER numeric constants like 1/16 computed by pretending the base is a number.
- wrong_answer_descriptions: plain English, no LaTeX, no specific numbers.
- problem_description: plain English, no LaTeX, no specific numbers. General skill only.
- DIFFICULTY SCALE:
${DIFFICULTY_SCALE}`;
}

// Repair single backslashes that are invalid JSON escapes (but skip valid JSON escapes).
export function repairJsonEscaping(raw: string): string {
  return raw.replace(/\\(?!["\\\/bfnrtu])/g, "\\\\");
}

function fixTextSpacing(latex: string): string {
  return latex.replace(/\\text\{([^}]*)([^}\s])\}(\s*\\text\{)/g, (_, before, lastChar, next) => {
    return `\\text{${before}${lastChar} }${next}`;
  });
}

export function sanitizeLatexContent(str: string): string {
  let out = normalizeRichMathSource(str);
  out = fixTextSpacing(out);
  // Repair JSON \t-escape corruption — two variants:
  // 1. Model wrote \\\\\\text{ (6 backslashes in JSON) → JSON.parse: \\TABext{
  //    Fix: replace \\ + TAB + ext{ with \\ \text{
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\\\\\text\{/g, "\\\\ \\text{");
  // 2. Model wrote \text{ (single backslash in JSON) → JSON.parse: TABext{
  //    Fix: replace TAB + ext{ with \text{
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\text\{/g, "\\text{");
  // Normalize not-equal variants to \neq (some render as boxes in KaTeX).
  out = out.replace(/\\not\s*\\equiv/g, "\\neq");   // \not\equiv and \not \equiv
  out = out.replace(/\\nequiv\b/g, "\\neq");
  out = out.replace(/\\not\s*\\=/g, "\\neq");
  out = out.replace(/\\not\s*=/g, "\\neq");
  out = out.replace(/≠/g, "\\neq");                  // Unicode ≠ (U+2260)
  out = out.replace(/≢/g, "\\neq");                  // Unicode ≢ (U+2262, NOT IDENTICAL TO — wrong symbol for ≠)
  // ── Period and comma spacing (comprehensive) ─────────────────────────────────
  // Applies the same rule to both: punctuation must be followed by a space before
  // any next character (letter, backslash, brace, newline).

  // 1. Period/comma before closing \text{} brace with no space
  //    \text{Step 1.} → \text{Step 1. }   \text{x, y,} → \text{x, y, }
  out = out.replace(/(\\text\{[^}]*[.,])(\})/g, "$1 $2");
  // 2. Period/comma mid-text before a letter (no space)
  //    \text{word.Next} → \text{word. Next}   \text{x,then} → \text{x, then}
  out = out.replace(/(\\text\{[^}]*[.,])([A-Za-z])/g, "$1 $2");
  // 3. Period/comma outside \text{} directly before \text{ with no space.
  //    Space goes INSIDE \text{} so splitRawLatexByText's .trim() on the math chunk doesn't eat it.
  //    expr.\text{Then} → expr.\text{ Then}   2x,\text{where} → 2x,\text{ where}
  //    Only fires when the char immediately after \text{ is not already a space.
  out = out.replace(/([.,])(\s*\\text\{)([^ \n])/g, "$1$2 $3");
  // 4. Period/comma directly before a newline/step-separator with no space
  out = out.replace(/([.,])(\n)/g, "$1 $2");
  // 5. \text{} block not ending with space before closing brace (any non-space char)
  //    Run after the above to avoid double-spacing
  out = out.replace(/(\\text\{[^}]+[^ }])(\}(?:\s*\\n|\s*$|\s*\\\\))/g, "$1 $2");
  // Clean up redundant "for if" / "for \text{if}" from piecewise prose
  out = out.replace(/\\text\{\s*for\s*\}\s*\\text\{\s*if\s*\}/g, "\\text{ if }");
  out = out.replace(/\\text\{\s*for\s+if\s*\}/g, "\\text{ if }");
  // Convert \begin{cases}...\end{cases} in latex_content to prose form (cases doesn't render inline).
  // Only applies here; solution_latex is handled separately and can use \begin{cases} in display mode.
  out = out.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body) => {
    // Convert lines like "expr & \text{if } cond \\\\" to "\text{expr for cond; }"
    const lines = body.split(/\\\\/).map((l: string) => l.trim()).filter(Boolean);
    return lines.map((line: string) => {
      const parts = line.split(/&/).map((p: string) => p.trim());
      return parts.join(" \\text{ for } ");
    }).join(" \\text{, and } ");
  });
  // Strip trailing \text{.} — model adds it after math expressions in problem statements.
  out = out.replace(/\\text\{\s*\.\s*\}\s*$/, "");
  // Strip $...$ and $$...$$ delimiters from raw LaTeX content fields.
  // These fields must be delimiter-free raw LaTeX; dollar signs break the Preview renderer.
  // Run twice to catch nested/adjacent occurrences.
  out = out.replace(/\$\$([^$]*?)\$\$/gs, "$1");
  out = out.replace(/\$\$([^$]*?)\$\$/gs, "$1");
  out = out.replace(/(?<!\\)\$([^$\n]*?)(?<!\\)\$/g, "$1");
  out = out.replace(/(?<!\\)\$([^$\n]*?)(?<!\\)\$/g, "$1");
  // Catch any remaining lone dollar signs that aren't escaped
  out = out.replace(/(?<!\\)\$/g, "");
  // \n followed by a letter that can NEVER start a real LaTeX \n* command → replace with space
  // (keeps the content on the same line/step instead of creating a bare unformatted paragraph)
  // Real \n* LaTeX commands use: a(nabla) e(neg/neq/nearrow) o(not) u(nu) r(nrightarrow)
  //   l(nleftarrow) m(nmid) p(nparallel) s(nsubseteq/nsupseteq) i(ni) w(nwarrow)
  // Safe to collapse to space: b c d f g h j k q t v x y z
  out = out.replace(/\\n([bcdfghjkqtvxyz])/gi, " $1");
  // Replace remaining \n not followed by any letter (general case)
  out = out.replace(/\\n(?![a-zA-Z])/g, "\n");
  out = out.replace(/\\newline\b/g, "\\\\");
  out = out.replace(/^\s*\\\[\s*[0-9.]+\s*em\s*\]\s*$/gm, "");
  out = out.replace(/^\s*\\\\\[\s*[0-9.]+\s*em\s*\]\s*$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  // If solution has no step breaks at all, inject one after the first sentence ending in a period
  if (!out.includes("\n")) {
    out = out.replace(/(\\text\{[^}]*\.\s*\})\s*(\\\\text\{|[^\\])/g, "$1\n\n$2");
  }
  out = out.replace(/(\\\\)\s*\n\s*\\\[\s*([0-9.]+\s*em)\s*\]/g, "$1[$2]");
  out = out.replace(/\\\[\s*([0-9.]+\s*em)\s*\]/g, "\\\\[$1]");
  out = out.replace(/\bfunction\s+HH\b/gi, "function H");
  out = out.replace(/\bat which HH\b/gi, "at which H");
  const placeholders: string[] = [];
  out = out.replace(/<(SlopeField|FunctionGraph)\s+[^>]*\/>/gi, (m) => {
    const idx = placeholders.push(m) - 1;
    return `@@VISUAL_${idx}@@`;
  });
  out = out.replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  out = out.replace(/<\s*iframe\b[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, "");
  out = out.replace(/@@VISUAL_(\d+)@@/g, (_m, n) => placeholders[Number(n)] ?? "");
  // Catch-all: period or comma directly followed by a letter → insert space
  out = out.replace(/([.,])([A-Za-z])/g, "$1 $2");
  return out;
}

// Strip any trailing period from a problem statement (latex_content only — not solution).
// Catches: \text{.}, \text{ .}, or a bare period at end of string.
export function stripProblemTrailingPeriod(s: string): string {
  return s
    .replace(/\\text\{\s*\.\s*\}\s*$/, "")  // \text{.} at end
    .replace(/\.\s*\}\s*$/, "}")             // period inside trailing \text{...words.}
    .replace(/\.\s*$/, "");                  // bare trailing period
}

export interface ParsedProblem {
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
  problem_description?: string;
  wrong_answer_descriptions?: string[];
  model_difficulty?: number;
  generation_thinking?: string;
  distractor_thinking?: string;
}

export function parseGeneratedJson(content: string): ParsedProblem | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    try {
      raw = JSON.parse(repairJsonEscaping(content)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const latex_content = typeof raw.latex_content === "string" ? raw.latex_content : null;
  const solution_latex = typeof raw.solution_latex === "string" ? raw.solution_latex : null;
  const choices = Array.isArray(raw.choices) && raw.choices.length === 4 ? (raw.choices as string[]) : null;
  if (!latex_content || !solution_latex || !choices) return null;

  const problem_description =
    typeof raw.problem_description === "string" && raw.problem_description.trim().length > 5
      ? raw.problem_description
      : undefined;
  const wrong_answer_descriptions = Array.isArray(raw.wrong_answer_descriptions)
    ? (raw.wrong_answer_descriptions as unknown[])
    : undefined;
  const model_difficulty =
    typeof raw.difficulty === "number" && raw.difficulty >= 1 && raw.difficulty <= 5
      ? (Math.round(raw.difficulty) as 1 | 2 | 3 | 4 | 5)
      : undefined;

  let correct_index = 0;
  if (typeof raw.correct_index === "number") {
    correct_index = Math.min(3, Math.max(0, raw.correct_index));
  } else if (wrong_answer_descriptions) {
    const nullIdx = wrong_answer_descriptions.findIndex((d) => d === null);
    if (nullIdx !== -1) correct_index = nullIdx;
  }

  // Force null to be exactly at correct_index; replace any misplaced null with a fallback.
  const wad_normalized = wrong_answer_descriptions
    ? wrong_answer_descriptions.map((d, i) => {
        if (i === correct_index) return null;
        if (d === null) return "Selecting the incorrect choice due to a conceptual error in applying the rule.";
        return d;
      })
    : undefined;

  const wad_strings = wad_normalized
    ? wad_normalized.map((d) => (d === null ? "null" : String(d)))
    : undefined;

  const generation_thinking =
    typeof raw.generation_thinking === "string" && raw.generation_thinking.trim().length > 5
      ? raw.generation_thinking
      : undefined;
  const distractor_thinking =
    typeof raw.distractor_thinking === "string" && raw.distractor_thinking.trim().length > 5
      ? raw.distractor_thinking
      : undefined;

  return { latex_content, solution_latex, choices, correct_index, problem_description, wrong_answer_descriptions: wad_strings, model_difficulty, generation_thinking, distractor_thinking };
}
