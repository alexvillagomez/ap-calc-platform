import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { normalizeWeights } from "@/lib/normalizeWeights";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnswerChoice = {
  id: string;
  text: string;
  is_correct: boolean;
  wrong_answer_description?: string;
};

export type ProblemInput = {
  question: string;
  solution: string;
  problem_description: string;
  answer_choices: AnswerChoice[];
};

type Candidate = { id: string; label: string; description: string; score: number };
type WeightedLabel = { id: string; label: string; weight: number };

export type TaggingResult = {
  retrieval_texts: {
    problem: string;
    wrong_answers: { answer_id: string; text: string }[];
  };
  retrieval: {
    problem: {
      categories: Candidate[];
      keywords: Candidate[];
      tags: Candidate[];
    };
    wrong_answers: {
      answer_id: string;
      keywords: Candidate[];
      tags: Candidate[];
    }[];
  };
  reranked: {
    problem: {
      categories: WeightedLabel[];
      keywords: WeightedLabel[];
      tags: WeightedLabel[];
    };
    wrong_answers: {
      answer_id: string;
      keywords: WeightedLabel[];
      tags: WeightedLabel[];
    }[];
  };
  raw_llm: {
    problem: string;
    wrong_answers: { answer_id: string; raw: string }[];
  };
};

// ─── Cosine similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

type DbRow = { id: string; name: string | null; label?: string | null; description: string | null; embedding: number[] };

function scoreAndSort(embedding: number[], rows: DbRow[], topN: number): Candidate[] {
  return rows
    .map((r) => {
      if (!Array.isArray(r.embedding) || r.embedding.length === 0) return null;
      return {
        id: r.id,
        label: r.name ?? r.label ?? r.id,
        description: r.description ?? "",
        score: cosineSimilarity(embedding, r.embedding),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// ─── LLM reranking ────────────────────────────────────────────────────────────

const PROBLEM_SYSTEM = `You are a precise math taxonomy tagger for an AP Calculus / precalculus adaptive system.

STRICT RULES — read carefully:
1. You MUST ONLY select labels from the retrieved candidate lists provided. Do NOT add, invent, or rephrase any label.
2. Assign a weight from 0.0 to 1.0 reflecting how central the label is to THIS specific problem.
3. Omit any label where you would assign weight < 0.25.
4. Select at most: 2 categories, 10 keywords, 5 tags.
5. Return ONLY valid JSON with no extra text.

Return this exact schema:
{"categories":[{"id":"...","label":"...","weight":0.0}],"keywords":[{"id":"...","label":"...","weight":0.0}],"tags":[{"id":"...","label":"...","weight":0.0}]}`;

const WRONG_ANSWER_SYSTEM = `You are a math taxonomy tagger specializing in wrong-answer error analysis.

STRICT RULES:
1. You MUST ONLY select labels from the retrieved candidate lists. Do NOT add or invent any label.
2. Weight each label by how well it explains WHY a student would choose this specific wrong answer — focus on the conceptual error or missed step, not the overall topic.
3. Weight reflects the error pattern, so some keywords may be weighted more heavily than on the main problem.
4. Omit any label where weight < 0.25.
5. Return ONLY valid JSON with no extra text.

Return this exact schema:
{"keywords":[{"id":"...","label":"...","weight":0.0}],"tags":[{"id":"...","label":"...","weight":0.0}]}`;

function buildCandidateBlock(label: string, candidates: Candidate[], maxKeep: number): string {
  return `${label} (select up to ${maxKeep}):\n` +
    candidates.map((c, i) => `  [${i + 1}] id="${c.id}" | ${c.label} | ${c.description}`).join("\n");
}

function filterToRetrieved<T extends { id: string }>(reranked: T[], candidates: Candidate[]): T[] {
  const valid = new Set(candidates.map((c) => c.id));
  return reranked.filter((r) => valid.has(r.id));
}

async function reranKProblem(
  openai: OpenAI,
  input: ProblemInput,
  candidates: { categories: Candidate[]; keywords: Candidate[]; tags: Candidate[] }
): Promise<{ categories: WeightedLabel[]; keywords: WeightedLabel[]; tags: WeightedLabel[]; raw: string }> {
  const userMsg = `PROBLEM CONTEXT:
Question: ${input.question}
Solution: ${input.solution}
Description: ${input.problem_description}

RETRIEVED CANDIDATES (you MUST only select from these):

${buildCandidateBlock("CATEGORIES", candidates.categories, 2)}

${buildCandidateBlock("KEYWORDS", candidates.keywords, 10)}

${buildCandidateBlock("TAGS", candidates.tags, 5)}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [{ role: "system", content: PROBLEM_SYSTEM }, { role: "user", content: userMsg }],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: { categories?: WeightedLabel[]; keywords?: WeightedLabel[]; tags?: WeightedLabel[] } = {};
  try { parsed = JSON.parse(raw) as typeof parsed; } catch { /* leave empty */ }

  // Normalize each group independently so weights sum to 1 within each type
  return {
    categories: normalizeWeights(filterToRetrieved(parsed.categories ?? [], candidates.categories)),
    keywords:   normalizeWeights(filterToRetrieved(parsed.keywords   ?? [], candidates.keywords)),
    tags:       normalizeWeights(filterToRetrieved(parsed.tags        ?? [], candidates.tags)),
    raw,
  };
}

async function rerankWrongAnswer(
  openai: OpenAI,
  choice: AnswerChoice,
  input: ProblemInput,
  candidates: { keywords: Candidate[]; tags: Candidate[] }
): Promise<{ keywords: WeightedLabel[]; tags: WeightedLabel[]; raw: string }> {
  const userMsg = `FULL PROBLEM CONTEXT:
Question: ${input.question}
Solution: ${input.solution}
Description: ${input.problem_description}

WRONG ANSWER BEING TAGGED:
Choice ${choice.id}: ${choice.text}
Why a student might choose this: ${choice.wrong_answer_description ?? "(no description provided)"}

RETRIEVED CANDIDATES (you MUST only select from these):

${buildCandidateBlock("KEYWORDS", candidates.keywords, 10)}

${buildCandidateBlock("TAGS", candidates.tags, 5)}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.4-mini",
    messages: [{ role: "system", content: WRONG_ANSWER_SYSTEM }, { role: "user", content: userMsg }],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: { keywords?: WeightedLabel[]; tags?: WeightedLabel[] } = {};
  try { parsed = JSON.parse(raw) as typeof parsed; } catch { /* leave empty */ }

  return {
    keywords: normalizeWeights(filterToRetrieved(parsed.keywords ?? [], candidates.keywords)),
    tags:     normalizeWeights(filterToRetrieved(parsed.tags     ?? [], candidates.tags)),
    raw,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const input = (await request.json()) as ProblemInput;
  const wrongChoices = input.answer_choices.filter((c) => !c.is_correct);

  // ── 1. Build retrieval texts ───────────────────────────────────────────────
  const problemText = `${input.question}\n\n${input.solution}\n\n${input.problem_description}`;
  const waTexts = wrongChoices.map((c) => ({
    answer_id: c.id,
    text: c.wrong_answer_description?.trim()
      ? c.wrong_answer_description.trim()
      : `Wrong answer: ${c.text}`,  // fallback if no description
  }));

  // ── 2. Batch embed ─────────────────────────────────────────────────────────
  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  const allTexts = [problemText, ...waTexts.map((w) => w.text)];
  const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: allTexts });
  const problemEmbedding = embRes.data[0]!.embedding;
  const waEmbeddings = waTexts.map((_, i) => embRes.data[i + 1]!.embedding);

  // ── 3. Fetch all DB rows (parallel) ───────────────────────────────────────
  const [{ data: catRows }, { data: kwRows }, { data: tagRows }] = await Promise.all([
    supabase.from("learn_categories").select("id, name, description, embedding").not("embedding", "is", null),
    supabase.from("learn_keywords").select("id, name, label, description, embedding").eq("tier", "in_depth").neq("keyword_type", "umbrella").eq("status", "approved").not("embedding", "is", null),
    supabase.from("learn_keywords").select("id, name, label, description, embedding").eq("tier", "tag").neq("keyword_type", "umbrella").eq("status", "approved").not("embedding", "is", null),
  ]);

  const categories = (catRows ?? []) as DbRow[];
  const keywords   = (kwRows  ?? []) as DbRow[];
  const tags       = (tagRows ?? []) as DbRow[];

  // ── 4 & 5. Score and build candidate slates ───────────────────────────────
  const problemCandidates = {
    categories: scoreAndSort(problemEmbedding, categories, 10),
    keywords:   scoreAndSort(problemEmbedding, keywords,   25),
    tags:       scoreAndSort(problemEmbedding, tags,       12),
  };

  const waCandidates = waTexts.map((wa, i) => ({
    answer_id: wa.answer_id,
    keywords:  scoreAndSort(waEmbeddings[i]!, keywords, 20),
    tags:      scoreAndSort(waEmbeddings[i]!, tags,     10),
  }));

  // ── 6. LLM reranking (parallel) ───────────────────────────────────────────
  const [problemRerankResult, ...waRerankResults] = await Promise.all([
    reranKProblem(openai, input, problemCandidates),
    ...wrongChoices.map((choice, i) =>
      rerankWrongAnswer(openai, choice, input, waCandidates[i]!)
    ),
  ]);

  // ── 7. Assemble result ────────────────────────────────────────────────────
  const result: TaggingResult = {
    retrieval_texts: {
      problem: problemText,
      wrong_answers: waTexts,
    },
    retrieval: {
      problem: problemCandidates,
      wrong_answers: waCandidates,
    },
    reranked: {
      problem: {
        categories: problemRerankResult.categories,
        keywords:   problemRerankResult.keywords,
        tags:       problemRerankResult.tags,
      },
      wrong_answers: wrongChoices.map((choice, i) => ({
        answer_id: choice.id,
        keywords:  waRerankResults[i]!.keywords,
        tags:      waRerankResults[i]!.tags,
      })),
    },
    raw_llm: {
      problem: problemRerankResult.raw,
      wrong_answers: wrongChoices.map((choice, i) => ({
        answer_id: choice.id,
        raw: waRerankResults[i]!.raw,
      })),
    },
  };

  return NextResponse.json(result);
}
