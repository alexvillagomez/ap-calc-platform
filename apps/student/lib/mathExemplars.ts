/**
 * Math exemplar problems for grounding generation.
 *
 * Fetches nearest rag_examples rows + existing math_questions by embedding
 * cosine similarity — the analog of MCAT's template cards (anki deck).
 *
 * rag_examples define the house style for problems:
 *   clean LaTeX stem, 4 choices in $...$, worked solution, plausible
 *   distractors keyed to specific student mistakes.
 *
 * Fail-open: if DB fetch fails or returns nothing, falls back to a small
 * static set of 2–3 hand-written exemplar problems (polynomial + calc flavor).
 *
 * Usage:
 *   const exemplars = await fetchExemplarProblems(supabase, embedding, "precalc", 4);
 *   // inject into generation prompt as house-style examples
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { cosineSimilarity } from "@/lib/mathTagging";
import type { MathCourse } from "@/lib/mathTypes";

// ─── Exemplar type ─────────────────────────────────────────────────────────────

export interface MathExemplar {
  /** KaTeX-compatible problem stem. */
  latex_content: string;
  /** Worked solution in KaTeX. */
  solution_latex: string;
  /** 4 choices, each in $...$. */
  choices: string[];
  /** Correct answer index 0–3. */
  correct_index: number;
  /** Optional: description of what each wrong choice represents. */
  wrong_answer_notes?: string;
}

// ─── Static fallback exemplars ─────────────────────────────────────────────────

/** 3 hand-written exemplars covering polynomial and calc styles. */
const STATIC_EXEMPLARS: MathExemplar[] = [
  {
    // Polynomial: factoring a difference of squares
    latex_content:
      "\\text{Factor completely: } x^2 - 25",
    solution_latex:
      "\\text{Recognize the difference of squares pattern: } a^2 - b^2 = (a-b)(a+b).\n\n" +
      "x^2 - 25 = x^2 - 5^2 = (x-5)(x+5).",
    choices: ["$(x-5)(x+5)$", "$(x-5)^2$", "$(x+5)^2$", "$(x-25)(x+1)$"],
    correct_index: 0,
    wrong_answer_notes:
      "Choice 1: squared instead of factored; Choice 2: same sign error; Choice 3: forgot difference-of-squares pattern",
  },
  {
    // Precalc: exponential function evaluation
    latex_content:
      "\\text{If } f(x) = 3 \\cdot 2^x\\text{, find } f(4).",
    solution_latex:
      "\\text{Substitute } x = 4 \\text{ into the formula.}\n\n" +
      "f(4) = 3 \\cdot 2^4 = 3 \\cdot 16 = 48.",
    choices: ["$48$", "$96$", "$12$", "$24$"],
    correct_index: 0,
    wrong_answer_notes:
      "Choice 1: multiplied 3·2 first then raised to 4; Choice 2: computed 3·4=12; Choice 3: computed 3·2^3",
  },
  {
    // Calc AB: applying the chain rule
    latex_content:
      "\\text{Find } \\dfrac{d}{dx}\\left[\\sin(3x^2)\\right].",
    solution_latex:
      "\\text{Let } u = 3x^2 \\text{ (inner function), so } \\dfrac{du}{dx} = 6x.\n\n" +
      "\\text{Chain rule: } \\dfrac{d}{dx}[\\sin(u)] = \\cos(u) \\cdot \\dfrac{du}{dx}.\n\n" +
      "\\dfrac{d}{dx}[\\sin(3x^2)] = \\cos(3x^2) \\cdot 6x = 6x\\cos(3x^2).",
    choices: [
      "$6x\\cos(3x^2)$",
      "$\\cos(3x^2)$",
      "$6x\\cos(6x)$",
      "$-6x\\cos(3x^2)$",
    ],
    correct_index: 0,
    wrong_answer_notes:
      "Choice 1: forgot to multiply by derivative of inner; Choice 2: wrong inner derivative; Choice 3: added negative sign from sin derivative confusion",
  },
];

// ─── DB fetch ──────────────────────────────────────────────────────────────────

interface RagExemplarRow {
  id: string;
  latex_content: string;
  solution_latex: string;
  choices: string[] | null;
  correct_index: number | null;
  wrong_answer_data: Array<{ description: string | null }> | null;
  keyword_weights: Record<string, number> | null;
  embedding: number[] | unknown | null;
}

interface MathQuestionRow {
  id: string;
  stem_latex: string;
  solution_latex: string;
  choices: string[] | null;
  correct_index: number | null;
  hint_latex: string | null;
  embedding: number[] | unknown | null;
}

/**
 * Fetch up to `limit` exemplar problems for grounding generation.
 *
 * Strategy:
 *   1. Attempt to pull from rag_examples (course-filtered) nearest by
 *      embedding cosine similarity over their associated keyword_weights
 *      if the embedding is available, otherwise by course filter alone.
 *   2. Attempt to pull from math_questions (if any exist) nearest by
 *      stored embedding cosine similarity.
 *   3. Merge and deduplicate; return top `limit`.
 *   4. Fail-open to STATIC_EXEMPLARS if nothing found.
 *
 * @param embedding - Text embedding of the current keyword/topic (from embedText).
 *                    Pass null to fall back to random sampling.
 * @param course    - Filter rag_examples by course column.
 * @param limit     - Max exemplars to return (default 4).
 */
export async function fetchExemplarProblems(
  supabase: SupabaseClient,
  embedding: number[] | null,
  course: MathCourse = "precalc",
  limit = 4
): Promise<MathExemplar[]> {
  const results: MathExemplar[] = [];

  try {
    // ── 1. rag_examples (house style ground truth) ─────────────────────────
    const { data: ragRows, error: ragError } = await supabase
      .from("rag_examples")
      .select(
        "id, latex_content, solution_latex, choices, correct_index, wrong_answer_data, keyword_weights, embedding"
      )
      .eq("course", course)
      .not("latex_content", "is", null)
      .not("solution_latex", "is", null)
      .limit(80);

    if (!ragError && ragRows && ragRows.length > 0) {
      const typed = ragRows as RagExemplarRow[];

      // Rank by cosine similarity against the caller's keyword embedding when both
      // sides have one; rows without embeddings (or no caller embedding) fall back
      // to a keyword_weights key-count heuristic, scaled below cosine range.
      const scored = typed
        .filter(
          (r) =>
            r.latex_content?.trim() &&
            r.solution_latex?.trim() &&
            Array.isArray(r.choices) &&
            r.choices.length === 4 &&
            r.correct_index != null
        )
        .map((r) => {
          const rowEmb = Array.isArray(r.embedding) ? (r.embedding as number[]) : null;
          const score =
            embedding && rowEmb && rowEmb.length > 0
              ? cosineSimilarity(embedding, rowEmb)
              : Object.keys(r.keyword_weights ?? {}).length / 100 - 1;
          return { row: r, score };
        })
        .sort((a, b) => b.score - a.score);

      const topRag = scored.slice(0, Math.ceil(limit * 0.6));

      for (const { row } of topRag) {
        const wrongNotes = (row.wrong_answer_data ?? [])
          .filter((w) => w?.description)
          .map((w) => w.description)
          .join("; ");

        results.push({
          latex_content: row.latex_content,
          solution_latex: row.solution_latex,
          choices: (row.choices as string[]).slice(0, 4),
          correct_index: row.correct_index as number,
          wrong_answer_notes: wrongNotes || undefined,
        });
      }
    }
  } catch {
    // fail-open — proceed to static fallback
  }

  try {
    // ── 2. math_questions (nearest by embedding) ───────────────────────────
    if (embedding && results.length < limit) {
      const needed = limit - results.length;

      const { data: mqRows, error: mqError } = await supabase
        .from("math_questions")
        .select("id, stem_latex, solution_latex, choices, correct_index, hint_latex, embedding")
        .eq("status", "active")
        .not("embedding", "is", null)
        .not("stem_latex", "is", null)
        .limit(100);

      if (!mqError && mqRows && mqRows.length > 0) {
        const typed = mqRows as MathQuestionRow[];

        const scored = typed
          .filter(
            (r) =>
              r.stem_latex?.trim() &&
              r.solution_latex?.trim() &&
              Array.isArray(r.choices) &&
              r.choices.length === 4 &&
              r.correct_index != null &&
              Array.isArray(r.embedding) &&
              (r.embedding as number[]).length > 0
          )
          .map((r) => ({
            row: r,
            sim: cosineSimilarity(embedding, r.embedding as number[]),
          }))
          .sort((a, b) => b.sim - a.sim)
          .slice(0, needed);

        for (const { row } of scored) {
          results.push({
            latex_content: row.stem_latex,
            solution_latex: row.solution_latex,
            choices: (row.choices as string[]).slice(0, 4),
            correct_index: row.correct_index as number,
          });
        }
      }
    }
  } catch {
    // fail-open
  }

  // ── 3. Static fallback ───────────────────────────────────────────────────
  if (results.length === 0) {
    return STATIC_EXEMPLARS.slice(0, limit);
  }

  // Pad with static exemplars if we have fewer than requested
  if (results.length < limit) {
    const needed = limit - results.length;
    results.push(...STATIC_EXEMPLARS.slice(0, needed));
  }

  return results.slice(0, limit);
}

/**
 * Format a list of exemplars into a prompt block.
 * The block instructs the model to match the house style.
 */
export function buildExemplarBlock(exemplars: MathExemplar[]): string {
  if (exemplars.length === 0) return "";

  const lines: string[] = [
    "EXEMPLAR PROBLEMS (match this house style exactly — clean KaTeX stem, 4 choices in $...$, worked solution showing each step, distractors that embody specific predictable student errors):",
  ];

  for (let i = 0; i < exemplars.length; i++) {
    const ex = exemplars[i];
    lines.push(`\n[Exemplar ${i + 1}]`);
    lines.push(`  Stem: ${ex.latex_content}`);
    lines.push(
      `  Choices: ${ex.choices.map((c, idx) => `(${idx}) ${c}`).join("  ")}`
    );
    lines.push(`  Correct: index ${ex.correct_index}`);
    lines.push(
      `  Solution: ${ex.solution_latex.replace(/\n\n/g, " → ")}`
    );
    if (ex.wrong_answer_notes) {
      lines.push(`  Distractors represent: ${ex.wrong_answer_notes}`);
    }
  }

  return lines.join("\n");
}
