import { NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseInstance = SupabaseClient<any>;
import {
  scoreProblemByKeyword,
  selectProblem,
  type ScoredProblem,
  getLearningPhase,
  isReviewDue,
} from "@/lib/practiceAlgorithm";
import { generateAndStoreProblems } from "@/lib/learnGenerator";

export const runtime = "nodejs";

const GEN_MODEL = "gpt-5.4-mini";

const VARIANT_SYSTEM = `You are a precalculus problem author. Given a template problem, generate a NEW problem that tests the SAME skill but uses different values, numbers, or a slightly different scenario. The structure and difficulty should match the template.

Return JSON: {
  "latex_content": string,
  "solution_latex": string,
  "choices": ["$...$", "$...$", "$...$", "$...$"],
  "correct_index": 0-3
}

Rules:
- The new problem must have a DIFFERENT correct answer from the template (different correct_index or different values)
- All 4 choices must be distinct
- Keep the same difficulty level
- Prose in \\text{}, math outside. Use $$...$$ for displayed math.
- Return valid JSON only.`;

type RagTemplateRow = {
  id: string;
  latex_content: string;
  solution_latex: string | null;
  choices: string[] | unknown;
  correct_index: number;
  difficulty: number | null;
  keyword_weights: Record<string, number> | null;
  action_weights: Record<string, number> | null;
  representation_weights: Record<string, number> | null;
  prerequisite_weights: Record<string, number> | null;
};

/**
 * Generate a variant of a rag_example and store it in `learn_practice_problems`
 * (so it is discoverable by fetchCandidatesForKeyword on future calls) and also
 * mirror a record to `problems` with is_sibling=true for admin visibility.
 * Returns a PracticeCandidate on success, null on failure.
 */
async function generateVariantFromTemplate(
  supabase: SupabaseInstance,
  template: RagTemplateRow,
  keywordId: string,
  keywordLabel: string
): Promise<PracticeCandidate | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const client = new OpenAI({ apiKey: openaiKey });

  const userMessage = `Template problem:
latex_content: ${template.latex_content}
choices: ${JSON.stringify(template.choices)}
correct_index: ${template.correct_index}
difficulty: ${template.difficulty ?? 2}/5
keyword: ${keywordLabel}

Generate a variant problem testing the same skill with different numbers/values.`;

  try {
    const completion = await client.chat.completions.create({
      model: GEN_MODEL,
      messages: [
        { role: "system", content: VARIANT_SYSTEM },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0.85,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as {
      latex_content?: unknown;
      solution_latex?: unknown;
      choices?: unknown;
      correct_index?: unknown;
    };

    if (
      typeof parsed.latex_content !== "string" ||
      typeof parsed.solution_latex !== "string" ||
      !Array.isArray(parsed.choices) ||
      (parsed.choices as unknown[]).length !== 4 ||
      typeof parsed.correct_index !== "number" ||
      parsed.correct_index < 0 ||
      parsed.correct_index > 3
    ) {
      return null;
    }

    const difficulty = template.difficulty ?? 2;

    // Store in learn_practice_problems so fetchCandidatesForKeyword can find it on
    // subsequent requests (fetchCandidatesForKeyword queries learn_practice_problems,
    // not the problems table).
    const { data: inserted, error: insertError } = await supabase
      .from("learn_practice_problems")
      .insert({
        keyword_id: keywordId,
        topic_id: keywordId, // use keyword id as topic placeholder; topic_id is informational here
        latex_content: parsed.latex_content,
        solution_latex: parsed.solution_latex,
        choices: parsed.choices,
        correct_index: parsed.correct_index,
        difficulty,
        hint_latex: null,
      })
      .select("id, latex_content, solution_latex, choices, correct_index, difficulty")
      .single();

    if (insertError || !inserted) {
      console.error("learn/practice/next: variant insert (learn_practice_problems) error:", insertError);
      return null;
    }

    // Also mirror to problems table with is_sibling=true for admin visibility.
    // Failures here are non-fatal — the variant is already stored in learn_practice_problems.
    void supabase
      .from("problems")
      .insert({
        latex_content: parsed.latex_content,
        solution_latex: parsed.solution_latex,
        choices: parsed.choices,
        correct_index: parsed.correct_index,
        difficulty,
        keyword_weights: template.keyword_weights ?? {},
        topic_weights: template.keyword_weights ?? {},
        is_sibling: true,
        status: "approved",
      })
      .then(({ error }) => {
        if (error) {
          console.warn("learn/practice/next: problems mirror insert failed (non-fatal):", error.message);
        }
      });

    type InsertedRow = { id: string; latex_content: string; solution_latex: string | null; choices: string[] | unknown; correct_index: number; difficulty: number };
    const row = inserted as InsertedRow;

    return {
      id: row.id,
      latex_content: row.latex_content,
      choices: Array.isArray(row.choices) ? row.choices as string[] : [],
      correct_index: row.correct_index,
      difficulty: row.difficulty,
      hint_latex: null,
      solution_latex: row.solution_latex,
      keyword_weights: template.keyword_weights ?? { [keywordId]: 1 },
      avg_rating: null,
      feedback_content_type: "learn_practice_problem",
    };
  } catch (err) {
    console.error("learn/practice/next: variant generation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fetch a random rag_example that covers the given keyword, then generate and store a variant.
 * Returns a PracticeCandidate or null if no template or generation fails.
 */
async function generateVariantFallback(
  supabase: SupabaseInstance,
  keywordId: string,
  keywordLabel: string
): Promise<PracticeCandidate | null> {
  const { data: ragRows } = await supabase
    .from("rag_examples")
    .select(
      "id, latex_content, solution_latex, choices, correct_index, difficulty, keyword_weights, action_weights, representation_weights, prerequisite_weights"
    )
    .eq("course", "precalc")
    .not(`keyword_weights->>'${keywordId}'`, "is", null)
    .limit(10);

  if (!ragRows || ragRows.length === 0) return null;

  // Pick a random template
  const template = ragRows[Math.floor(Math.random() * ragRows.length)] as RagTemplateRow;

  return generateVariantFromTemplate(supabase, template, keywordId, keywordLabel);
}

interface KeywordState {
  keyword_id: string;
  state: string;
  in_depth_score: number;
  umbrella_score: number;
  consecutive_correct: number;
  spaced_review_due_at: string | null;
}

interface PracticeCandidate {
  id: string;
  latex_content: string;
  choices: string[];
  correct_index: number;
  difficulty: number;
  hint_latex: string | null;
  solution_latex: string | null;
  keyword_weights?: Record<string, number>;
  avg_rating?: number | null;
  feedback_content_type?: "rag_example" | "learn_practice_problem";
}

async function fetchCandidatesForKeyword(
  supabase: SupabaseInstance,
  keyword_id: string,
  diffLow: number,
  diffHigh: number,
  excludeIds: string[]
): Promise<PracticeCandidate[]> {
  // Split excludeIds into learn_practice_problems UUIDs and rag_example raw UUIDs.
  // rag_example IDs are stored prefixed as "rag_<uuid>" on the client but the DB
  // stores them as plain UUIDs, so we strip the prefix before filtering.
  const excludeLearnIds = excludeIds.filter((id) => !id.startsWith("rag_"));
  const excludeRagUuids = excludeIds
    .filter((id) => id.startsWith("rag_"))
    .map((id) => id.slice(4)); // strip "rag_" prefix

  let query = supabase
    .from("learn_practice_problems")
    .select("id, latex_content, choices, correct_index, difficulty, hint_latex, solution_latex, avg_rating")
    .eq("keyword_id", keyword_id)
    .gte("difficulty", diffLow)
    .lte("difficulty", diffHigh);

  if (excludeLearnIds.length > 0) {
    query = query.not("id", "in", `(${excludeLearnIds.join(",")})`);
  }

  const { data: candidates } = await query.limit(20);

  // Also fetch from rag_examples (precalc), excluding already-seen ones
  let ragQuery = supabase
    .from("rag_examples")
    .select("id, latex_content, choices, correct_index, difficulty, solution_latex, keyword_weights, avg_rating")
    .eq("course", "precalc")
    .not(`keyword_weights->>'${keyword_id}'`, "is", null)
    .gte("difficulty", diffLow)
    .lte("difficulty", diffHigh);

  if (excludeRagUuids.length > 0) {
    ragQuery = ragQuery.not("id", "in", `(${excludeRagUuids.join(",")})`);
  }

  const { data: ragData } = await ragQuery.limit(20);

  type RagRow = {
    id: string;
    latex_content: string;
    choices: string[] | unknown;
    correct_index: number;
    difficulty: number | null;
    solution_latex: string | null;
    keyword_weights: Record<string, number> | null;
    avg_rating: number | null;
  };
  const ragCandidates: PracticeCandidate[] = ((ragData ?? []) as RagRow[]).map((r) => ({
    id: `rag_${r.id}`,
    latex_content: r.latex_content,
    choices: Array.isArray(r.choices) ? r.choices as string[] : (r.choices as unknown as string[]),
    correct_index: r.correct_index,
    difficulty: r.difficulty ?? 0.6,
    hint_latex: null as string | null,
    solution_latex: r.solution_latex,
    keyword_weights: r.keyword_weights as Record<string, number>,
    avg_rating: r.avg_rating,
    feedback_content_type: "rag_example",
  }));

  const learnCandidates = ((candidates ?? []) as PracticeCandidate[]).map((candidate) => ({
    ...candidate,
    feedback_content_type: "learn_practice_problem" as const,
  }));

  return [...learnCandidates, ...ragCandidates];
}

async function ensureCandidates(
  supabase: SupabaseInstance,
  keyword_id: string,
  diffLow: number,
  diffHigh: number,
  diffRound: number,
  excludeIds: string[]
): Promise<PracticeCandidate[]> {
  let all = await fetchCandidatesForKeyword(supabase, keyword_id, diffLow, diffHigh, excludeIds);

  if (all.length === 0) {
    const { data: kw } = await supabase
      .from("learn_keywords")
      .select("id, label, description, category_id")
      .eq("id", keyword_id)
      .maybeSingle();

    if (kw) {
      await generateAndStoreProblems(supabase, kw, diffRound, 3);
      all = await fetchCandidatesForKeyword(supabase, keyword_id, diffLow, diffHigh, excludeIds);

      // If generateAndStoreProblems also produced nothing, try a rag_example variant
      if (all.length === 0) {
        const variant = await generateVariantFallback(supabase, keyword_id, kw.label as string);
        if (variant) {
          all = [variant];
        }
      }
    }
  }

  return all;
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);

  const body = (await request.json()) as {
    sessionId: string;
    keyword_id: string;
    targetDifficulty?: number;
    excludeIds?: string[];
  };

  const { sessionId, keyword_id, targetDifficulty = 2, excludeIds = [] } = body;
  if (!sessionId || !keyword_id) return NextResponse.json({ error: "sessionId and keyword_id required" }, { status: 400 });

  // Load ALL keyword states for this session (for phase-based routing)
  const { data: allStates } = await supabase
    .from("learn_student_keyword_states")
    .select("keyword_id, state, in_depth_score, umbrella_score, consecutive_correct, spaced_review_due_at")
    .eq("session_id", sessionId);

  const stateMap = new Map<string, KeywordState>(
    (allStates ?? []).map((s: KeywordState) => [s.keyword_id, s])
  );

  // Load current keyword state for the requested keyword
  const kwState = stateMap.get(keyword_id) ?? null;

  const effectiveInDepth = kwState?.in_depth_score ?? 0.5;
  const effectiveUmbrella = kwState?.umbrella_score ?? 0.5;
  const consecutiveCorrect = kwState?.consecutive_correct ?? 0;
  const spacedReviewDueAt = kwState?.spaced_review_due_at ?? null;
  const kwStateStr = kwState?.state ?? "needs_practice";

  const phase = getLearningPhase(effectiveInDepth, consecutiveCorrect, spacedReviewDueAt, kwStateStr);

  const effectiveTarget = Math.min(4, Math.max(1, 1 + effectiveUmbrella * 3));
  const diffRound = Math.round(effectiveTarget);
  const diffLow = Math.max(1, diffRound - 1);
  const diffHigh = Math.min(5, diffRound + 1);

  // ── Priority 1: Spaced reviews due today ──────────────────────────────────
  // Find the most overdue review across ALL keywords for this session
  const reviewDueStates = (allStates ?? []).filter(
    (s: KeywordState) => s.keyword_id !== keyword_id && isReviewDue(s.spaced_review_due_at)
  );

  if (reviewDueStates.length > 0) {
    // Pick the most overdue one (earliest spaced_review_due_at)
    const mostOverdue = reviewDueStates.sort(
      (a: KeywordState, b: KeywordState) =>
        new Date(a.spaced_review_due_at!).getTime() - new Date(b.spaced_review_due_at!).getTime()
    )[0] as KeywordState;

    const reviewKwState = mostOverdue;
    const reviewTarget = Math.min(4, Math.max(1, 1 + (reviewKwState.umbrella_score ?? 0.5) * 3));
    const reviewDiffRound = Math.round(reviewTarget);
    const reviewDiffLow = Math.max(1, reviewDiffRound - 1);
    const reviewDiffHigh = Math.min(5, reviewDiffRound + 1);

    const reviewCandidates = await ensureCandidates(
      supabase,
      mostOverdue.keyword_id,
      reviewDiffLow,
      reviewDiffHigh,
      reviewDiffRound,
      excludeIds
    );

    if (reviewCandidates.length > 0) {
      const reviewStrengths = { [mostOverdue.keyword_id]: reviewKwState.in_depth_score ?? 0.5 };
      const reviewScored: ScoredProblem[] = reviewCandidates.map((p) => {
        const weights = p.keyword_weights ?? { [mostOverdue.keyword_id]: 1 };
        return {
          id: p.id,
          difficulty: p.difficulty,
          estimated_difficulty: null,
          keyword_weights: weights,
          avg_rating: p.avg_rating ?? null,
          score: scoreProblemByKeyword(
            { difficulty: p.difficulty, estimated_difficulty: null, keyword_weights: weights, avg_rating: p.avg_rating ?? null },
            reviewStrengths,
            reviewTarget
          ),
        };
      });

      const picked = selectProblem(reviewScored);
      if (picked) {
        const full = reviewCandidates.find((c) => c.id === picked.id)!;
        return NextResponse.json({
          problem: full,
          targetDifficulty: reviewTarget,
          servedKeywordId: mostOverdue.keyword_id,
          phase: "spaced_review",
        });
      }
    }
  }

  // ── Priority 2 & 3: Phase-based selection for the requested keyword ────────

  // Phase: blocked — serve ONLY this keyword's problems
  // Phase: interleaved — 75% this keyword, 25% a previously-practiced review keyword
  let targetKeywordId = keyword_id;
  let servedPhase: string = phase;

  if (phase === "interleaved" && Math.random() < 0.25) {
    // Pick a previously-practiced keyword (highest in_depth_score, not the current one, not mastered)
    const reviewCandidateStates = (allStates ?? []).filter(
      (s: KeywordState) =>
        s.keyword_id !== keyword_id &&
        s.state !== "mastered" &&
        (s.in_depth_score ?? 0) > 0
    );

    if (reviewCandidateStates.length > 0) {
      const reviewKw = reviewCandidateStates.sort(
        (a: KeywordState, b: KeywordState) => (b.in_depth_score ?? 0) - (a.in_depth_score ?? 0)
      )[0] as KeywordState;
      targetKeywordId = reviewKw.keyword_id;
      servedPhase = "interleaved_review";
    }
  }

  // Determine difficulty for the selected keyword
  const selectedKwState = stateMap.get(targetKeywordId) ?? null;
  const selectedUmbrella = selectedKwState?.umbrella_score ?? 0.5;
  const selectedTarget = Math.min(4, Math.max(1, 1 + selectedUmbrella * 3));
  const selectedDiffRound = Math.round(selectedTarget);
  const selectedDiffLow = Math.max(1, selectedDiffRound - 1);
  const selectedDiffHigh = Math.min(5, selectedDiffRound + 1);

  // Use the original keyword_id's difficulty params if it's a blocked/direct serve
  const finalDiffLow = targetKeywordId === keyword_id ? diffLow : selectedDiffLow;
  const finalDiffHigh = targetKeywordId === keyword_id ? diffHigh : selectedDiffHigh;
  const finalDiffRound = targetKeywordId === keyword_id ? diffRound : selectedDiffRound;
  const finalTarget = targetKeywordId === keyword_id ? effectiveTarget : selectedTarget;

  const allCandidates = await ensureCandidates(
    supabase,
    targetKeywordId,
    finalDiffLow,
    finalDiffHigh,
    finalDiffRound,
    excludeIds
  );

  if (allCandidates.length === 0) {
    // Fallback: try with the original keyword_id
    if (targetKeywordId !== keyword_id) {
      const fallbackCandidates = await ensureCandidates(
        supabase,
        keyword_id,
        diffLow,
        diffHigh,
        diffRound,
        excludeIds
      );
      if (fallbackCandidates.length === 0) {
        // Last resort: generate a rag_example variant for the original keyword_id
        const { data: kwMeta } = await supabase
          .from("learn_keywords")
          .select("label")
          .eq("id", keyword_id)
          .maybeSingle();
        const variantFallback = await generateVariantFallback(
          supabase,
          keyword_id,
          (kwMeta?.label as string) ?? keyword_id
        );
        if (!variantFallback) {
          return NextResponse.json({ error: "Generation failed — no problems available" }, { status: 500 });
        }
        return NextResponse.json({
          problem: variantFallback,
          targetDifficulty: effectiveTarget,
          servedKeywordId: keyword_id,
          phase: "blocked",
        });
      }
      const keywordStrengths = { [keyword_id]: effectiveInDepth };
      const scored: ScoredProblem[] = fallbackCandidates.map((p) => {
        const weights = p.keyword_weights ?? { [keyword_id]: 1 };
        return {
          id: p.id,
          difficulty: p.difficulty,
          estimated_difficulty: null,
          keyword_weights: weights,
          avg_rating: p.avg_rating ?? null,
          score: scoreProblemByKeyword(
            { difficulty: p.difficulty, estimated_difficulty: null, keyword_weights: weights, avg_rating: p.avg_rating ?? null },
            keywordStrengths,
            effectiveTarget
          ),
        };
      });
      const picked = selectProblem(scored);
      if (!picked) return NextResponse.json({ error: "Could not select a problem" }, { status: 500 });
      const full = fallbackCandidates.find((c) => c.id === picked.id)!;
      return NextResponse.json({ problem: full, targetDifficulty: effectiveTarget, servedKeywordId: keyword_id, phase: "blocked" });
    }
    // targetKeywordId === keyword_id and still empty — this shouldn't happen since ensureCandidates
    // already tried variant generation, but guard just in case
    return NextResponse.json({ error: "Generation failed — no problems available" }, { status: 500 });
  }

  const keywordStrengths = { [targetKeywordId]: selectedKwState?.in_depth_score ?? effectiveInDepth };

  const scored: ScoredProblem[] = allCandidates.map((p) => {
    const weights = p.keyword_weights ?? { [targetKeywordId]: 1 };
    return {
      id: p.id,
      difficulty: p.difficulty,
      estimated_difficulty: null,
      keyword_weights: weights,
      avg_rating: p.avg_rating ?? null,
      score: scoreProblemByKeyword(
        { difficulty: p.difficulty, estimated_difficulty: null, keyword_weights: weights, avg_rating: p.avg_rating ?? null },
        keywordStrengths,
        finalTarget
      ),
    };
  });

  const picked = selectProblem(scored);
  if (!picked) return NextResponse.json({ error: "Could not select a problem" }, { status: 500 });

  const full = allCandidates.find((c) => c.id === picked.id)!;
  return NextResponse.json({
    problem: full,
    targetDifficulty: finalTarget,
    servedKeywordId: targetKeywordId,
    phase: servedPhase,
  });
}
