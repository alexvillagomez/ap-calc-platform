/**
 * questionEnrichment — server-side, fire-and-forget grounding of a freshly
 * generated question along the four dimensions:
 *   1. PROBLEM        → problem_description (+ embedding); content tagging is keyword_weights
 *   2. WRONG ANSWER   → wrong_answer_data: per wrong choice {description, embedding, keyword_weights}
 *   3. ACTION         → action_description (+ embedding) + action_weights (→ *_action_keywords)
 *   4. REPRESENTATION → representation_description (+ embedding) + representation_weights (→ *_representation_keywords)
 *   5. PREREQUISITE   → prerequisite_description (+ embedding); general prereq knowledge,
 *                       embedded + tagged to the course's general (content) topic keyword pool
 *
 * ONE gpt-5.4-mini call produces all the descriptions; embeddings + nearest-keyword
 * tagging are computed locally. Designed to be called WITHOUT await right after a
 * generated question is inserted (`runtime = "nodejs"` routes), so it never adds
 * latency to the student's response and never throws into the caller.
 *
 * Mirrors scripts/enrich-question-descriptions.ts + backfill-distractor-data.ts so
 * inline (new content) and batch (backfill) paths produce identical data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import OpenAI from "openai";

const GEN_MODEL = "gpt-5.4-mini";
const EMBED_MODEL = "text-embedding-3-small";
const TOP_K = 2;

type System = "math" | "mcat";

interface SysCfg {
  table: string;
  contentKwTable: string;
  actionTable: string;
  reprTable: string;
  stemCol: "stem_latex" | "stem";
  solutionCol: "solution_latex" | "explanation";
  isLatex: boolean;
}
const CFG: Record<System, SysCfg> = {
  math: { table: "math_questions", contentKwTable: "math_keywords", actionTable: "math_action_keywords", reprTable: "math_representation_keywords", stemCol: "stem_latex", solutionCol: "solution_latex", isLatex: true },
  mcat: { table: "mcat_questions", contentKwTable: "mcat_keywords", actionTable: "mcat_action_keywords", reprTable: "mcat_representation_keywords", stemCol: "stem", solutionCol: "explanation", isLatex: false },
};

type KwEmb = { id: string; embedding: number[] };

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// mode "sum": weights normalized to sum to 1 (used for action_weights +
// representation_weights). mode "max": strongest ≈ 1.0 (used for content tagging,
// e.g. wrong-answer keyword_weights, where the top match should anchor at 1.0).
function nearestWeights(
  emb: number[] | undefined,
  kws: KwEmb[],
  topK = TOP_K,
  mode: "max" | "sum" = "max"
): Record<string, number> {
  if (!emb || kws.length === 0) return {};
  const scored = kws.map((k) => ({ id: k.id, sim: cosine(emb, k.embedding) }))
    .filter((s) => s.sim > 0).sort((a, b) => b.sim - a.sim).slice(0, topK);
  if (scored.length === 0) return {};
  const out: Record<string, number> = {};
  if (mode === "sum") {
    const total = scored.reduce((a, s) => a + s.sim, 0);
    if (total <= 0) return {};
    let acc = 0;
    for (let i = 0; i < scored.length; i++) {
      // Last entry takes the residual so the weights sum to exactly 1.
      const w = i < scored.length - 1
        ? Math.round((scored[i]!.sim / total) * 100) / 100
        : Math.round((1 - acc) * 100) / 100;
      acc += i < scored.length - 1 ? w : 0;
      out[scored[i]!.id] = w;
    }
  } else {
    const max = scored[0]!.sim;
    for (const s of scored) out[s.id] = Math.round((s.sim / max) * 100) / 100;
  }
  return out;
}

function loadKwEmb(rows: Array<Record<string, unknown>> | null): KwEmb[] {
  return (rows ?? [])
    .map((r) => ({ id: String(r.id), embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : [] }))
    .filter((r) => r.embedding.length > 0);
}

// Small in-process cache for the fixed action/representation dimension vocabularies.
const dimCache = new Map<string, KwEmb[]>();
async function dimensionKws(supabase: SupabaseClient, table: string): Promise<KwEmb[]> {
  if (dimCache.has(table)) return dimCache.get(table)!;
  const { data } = await supabase.from(table).select("id, embedding").not("embedding", "is", null);
  const kws = loadKwEmb(data as Array<Record<string, unknown>> | null);
  if (kws.length > 0) dimCache.set(table, kws);
  return kws;
}

interface QRow { id: string; category_id: string; stem: string; solution: string; choices: string[]; correct_index: number; }
interface GenOut {
  problem_description: string;
  action_description: string;
  representation_description: string;
  prerequisite_description: string;
  wrong_answer_descriptions: (string | null)[];
}

function systemPrompt(cfg: SysCfg, label: System): string {
  const latexNote = cfg.isLatex
    ? `Stem/solution are KaTeX LaTeX ($...$). Refer to math in plain language; keep $...$ only where clearer.`
    : `Stem/explanation are plain text (MCAT Biology). Plain prose only.`;
  return `Annotate a ${label === "math" ? "AP math" : "MCAT Biology"} multiple-choice question for a study app's data layer. Given the stem, worked solution/explanation, choices, and correct index, return JSON EXACTLY:
{
  "problem_description": "1-2 sentences naming WHAT the problem asks + the concept/skill it tests (no answer reveal)",
  "action_description": "1 sentence naming the cognitive ACTION required",
  "representation_description": "1 sentence naming the REPRESENTATION used (${label === "math" ? "symbolic/analytic, graphical, numerical/tabular, verbal/contextual" : "prose passage, figure/diagram, graph, data table, equation, experimental setup"})",
  "prerequisite_description": "the PREREQUISITE knowledge needed to solve this, in simple GENERAL terms — name the underlying concepts/skills (e.g. 'factoring a difference of squares, basic limits, hole discontinuities'). No numbers or specifics from this problem.",
  "wrong_answer_descriptions": ["one entry per choice, SAME ORDER: for each WRONG choice the misconception that leads to it; for the correct choice null"]
}
${latexNote}
The wrong_answer_descriptions array MUST match the choices length. Valid JSON only, no markdown.`;
}

async function generate(openai: OpenAI, cfg: SysCfg, label: System, q: QRow): Promise<GenOut | null> {
  const choiceLines = q.choices.map((c, i) => `[${i}]${i === q.correct_index ? " (correct)" : ""} ${c}`).join("\n");
  const user = `STEM:\n${q.stem}\n\nWORKED ${cfg.isLatex ? "SOLUTION" : "EXPLANATION"}:\n${q.solution}\n\nCHOICES (correct index ${q.correct_index}):\n${choiceLines}`;
  let text: string;
  try {
    const c = await openai.chat.completions.create({
      model: GEN_MODEL,
      messages: [{ role: "system", content: systemPrompt(cfg, label) }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    });
    text = c.choices[0]?.message?.content ?? "{}";
  } catch { return null; }
  let p: Record<string, unknown>;
  try { p = JSON.parse(text); } catch { return null; }
  if (typeof p.problem_description !== "string" || !p.problem_description.trim()) return null;
  const wad = Array.isArray(p.wrong_answer_descriptions) ? p.wrong_answer_descriptions : [];
  return {
    problem_description: p.problem_description.trim(),
    action_description: typeof p.action_description === "string" ? p.action_description.trim() : "",
    representation_description: typeof p.representation_description === "string" ? p.representation_description.trim() : "",
    prerequisite_description: typeof p.prerequisite_description === "string" ? p.prerequisite_description.trim() : "",
    wrong_answer_descriptions: q.choices.map((_, i) => (typeof wad[i] === "string" ? (wad[i] as string) : null)),
  };
}

async function embed(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({ model: EMBED_MODEL, input: texts.map((t) => t.trim() || " ") });
  return res.data.map((d) => d.embedding);
}

async function enrichOne(supabase: SupabaseClient, system: System, id: string): Promise<void> {
  const cfg = CFG[system];
  const key = process.env.OPENAI_API_KEY;
  if (!key) return;
  const openai = new OpenAI({ apiKey: key });

  const { data: q } = await supabase
    .from(cfg.table)
    .select(`id, category_id, ${cfg.stemCol}, ${cfg.solutionCol}, choices, correct_index, problem_description`)
    .eq("id", id)
    .maybeSingle();
  if (!q) return;
  const rec = q as Record<string, unknown>;
  if (rec.problem_description) return; // already enriched
  const row: QRow = {
    id, category_id: String(rec.category_id ?? ""),
    stem: String(rec[cfg.stemCol] ?? ""), solution: String(rec[cfg.solutionCol] ?? ""),
    choices: Array.isArray(rec.choices) ? (rec.choices as string[]) : [], correct_index: typeof rec.correct_index === "number" ? rec.correct_index : 0,
  };
  if (row.choices.length === 0) return;

  const gen = await generate(openai, cfg, system, row);
  if (!gen) return;

  // Embed problem + action + representation + prerequisite, plus each wrong-choice description.
  const wrongIdx: number[] = [];
  const texts = [gen.problem_description, gen.action_description || " ", gen.representation_description || " ", gen.prerequisite_description || " "];
  gen.wrong_answer_descriptions.forEach((d, i) => { if (i !== row.correct_index && d) { wrongIdx.push(i); texts.push(d); } });
  let embs: number[][];
  try { embs = await embed(openai, texts); } catch { return; }
  const [pEmb, aEmb, rEmb, preEmb] = embs;
  const wrongEmbByIdx = new Map<number, number[]>();
  wrongIdx.forEach((idx, j) => wrongEmbByIdx.set(idx, embs[4 + j]!));

  const [actionKws, reprKws, contentRes] = await Promise.all([
    dimensionKws(supabase, cfg.actionTable),
    dimensionKws(supabase, cfg.reprTable),
    supabase.from(cfg.contentKwTable).select("id, embedding").eq("category_id", row.category_id).eq("tier", "in_depth").not("embedding", "is", null),
  ]);
  const contentKws = loadKwEmb(contentRes.data as Array<Record<string, unknown>> | null);

  const wrongAnswerData = row.choices.map((_, i) => {
    if (i === row.correct_index) return null;
    const desc = gen.wrong_answer_descriptions[i];
    const e = wrongEmbByIdx.get(i);
    if (!desc || !e) return null;
    return { description: desc, embedding: e, keyword_weights: nearestWeights(e, contentKws) };
  });

  await supabase.from(cfg.table).update({
    problem_description: gen.problem_description,
    problem_description_embedding: pEmb,
    action_description: gen.action_description || null,
    action_description_embedding: gen.action_description ? aEmb : null,
    action_weights: gen.action_description ? nearestWeights(aEmb, actionKws, TOP_K, "sum") : {},
    representation_description: gen.representation_description || null,
    representation_description_embedding: gen.representation_description ? rEmb : null,
    representation_weights: gen.representation_description ? nearestWeights(rEmb, reprKws, TOP_K, "sum") : {},
    // PREREQUISITE — general prereq knowledge, embedded + tagged to the course's
    // general (content) topic keywords (same pool/mode as problem + wrong-answer).
    prerequisite_description: gen.prerequisite_description || null,
    prerequisite_description_embedding: gen.prerequisite_description ? preEmb : null,
    wrong_answer_data: wrongAnswerData,
  }).eq("id", id);
}

/**
 * Enrich freshly generated questions along all four dimensions AFTER the response
 * is sent. Uses Next's `after()` so the work survives on serverless (a bare
 * unawaited promise is frozen once the response streams). Never throws into the
 * caller; skips silently if OPENAI_API_KEY is missing or a row is already enriched.
 */
export function enrichQuestionsInBackground(
  supabase: SupabaseClient,
  system: System,
  questionIds: string[]
): void {
  const ids = questionIds.filter(Boolean);
  if (ids.length === 0) return;
  after(async () => {
    for (const id of ids) {
      try {
        await enrichOne(supabase, system, id);
      } catch (e) {
        console.error(`[enrichQuestion] ${system} ${id}:`, (e as Error)?.message ?? e);
      }
    }
  });
}
