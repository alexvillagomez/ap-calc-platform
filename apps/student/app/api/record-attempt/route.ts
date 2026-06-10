import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateStrengths, computeStudentSkill, mergeWrongAnswerWeights, normalizeDifficulty } from "@/lib/practiceAlgorithm";

// Small fixed nudge applied to a prerequisite keyword's topic_strength when the
// student answers correctly — prerequisites never get penalized on a wrong answer.
const PREREQ_LEARNING_RATE = 0.04;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await request.json()) as {
    sessionId?: string;
    problemId?: string;
    selectedIndex?: number;
    correct?: boolean;
    topicWeights?: Record<string, number>;
    keywordWeights?: Record<string, number>;
    actionWeights?: Record<string, number>;
    representationWeights?: Record<string, number>;
    prerequisiteWeights?: Record<string, number>;
    wrongAnswerKeywords?: Record<string, number>;
    rating?: number | null;
  };

  const {
    sessionId, problemId, selectedIndex, correct,
    topicWeights, keywordWeights, actionWeights, representationWeights, prerequisiteWeights,
    wrongAnswerKeywords, rating,
  } = body;

  if (!sessionId || !problemId || typeof selectedIndex !== "number" || typeof correct !== "boolean") {
    return NextResponse.json({ error: "sessionId, problemId, selectedIndex, correct are required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Record the attempt (ignore conflict — could be a retry)
  const { error: attemptError } = await supabase
    .from("student_problem_attempts")
    .upsert(
      { session_id: sessionId, problem_id: problemId, selected_index: selectedIndex, correct, rating: rating ?? null },
      { onConflict: "session_id,problem_id" }
    );

  if (attemptError) {
    // FK violation = rag_example served before promotion — non-fatal, still update strengths
    if ((attemptError as { code?: string }).code !== "23503") {
      console.error("record-attempt: upsert error", attemptError.message);
      return NextResponse.json({ error: attemptError.message }, { status: 500 });
    }
    console.warn("record-attempt: skipping attempt log (problem not yet in problems table)");
  }

  // Topic dimension is unified across both subsystems: AP-Calc's topic_weights and
  // precalc's keyword_weights both represent "what topic/skill does this problem test" —
  // they're merged into a single topic_strengths dict keyed by whichever ids each system uses.
  const topicDimWeights = { ...(topicWeights ?? {}), ...(keywordWeights ?? {}) };
  const hasTopicDim = Object.keys(topicDimWeights).length > 0;
  const hasActionDim = !!actionWeights && Object.keys(actionWeights).length > 0;
  const hasReprDim = !!representationWeights && Object.keys(representationWeights).length > 0;
  const hasPrereqDim = !!prerequisiteWeights && Object.keys(prerequisiteWeights).length > 0;

  let responseTopicStrengths: Record<string, number> | null = null;
  let responseActionStrengths: Record<string, number> | null = null;
  let responseRepresentationStrengths: Record<string, number> | null = null;

  if (hasTopicDim || hasActionDim || hasReprDim || hasPrereqDim) {
    const [sessionRes, problemRes] = await Promise.all([
      supabase
        .from("student_sessions")
        .select("topic_strengths, action_strengths, representation_strengths")
        .eq("id", sessionId)
        .maybeSingle(),
      topicWeights
        ? supabase
            .from("problems")
            .select("difficulty, estimated_difficulty, attempt_count, success_count")
            .eq("id", problemId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const currentTopic = (sessionRes.data?.topic_strengths ?? {}) as Record<string, number>;
    const currentAction = (sessionRes.data?.action_strengths ?? {}) as Record<string, number>;
    const currentRepr = (sessionRes.data?.representation_strengths ?? {}) as Record<string, number>;

    const effectiveTopicWeights = (!correct && wrongAnswerKeywords && Object.keys(wrongAnswerKeywords).length > 0)
      ? mergeWrongAnswerWeights(topicDimWeights, wrongAnswerKeywords)
      : topicDimWeights;

    let newTopic = hasTopicDim ? updateStrengths(currentTopic, effectiveTopicWeights, correct) : currentTopic;
    // Prerequisites only ever boost — a correct answer nudges each prerequisite keyword's
    // topic_strength up slightly; a wrong answer leaves them untouched.
    if (hasPrereqDim && correct) {
      newTopic = updateStrengths(newTopic, prerequisiteWeights!, true, PREREQ_LEARNING_RATE);
    }
    const newAction = hasActionDim ? updateStrengths(currentAction, actionWeights!, correct) : currentAction;
    const newRepr = hasReprDim ? updateStrengths(currentRepr, representationWeights!, correct) : currentRepr;

    responseTopicStrengths = newTopic;
    responseActionStrengths = newAction;
    responseRepresentationStrengths = newRepr;

    // Calibrate estimated_difficulty using student skill at time of attempt (pre-update strengths).
    // Only the AP-Calc flow (topicWeights present) drives this — precalc problems calibrate via
    // the keyword-mastery subsystem instead.
    const prob = problemRes.data as {
      difficulty: number;
      estimated_difficulty: number | null;
      attempt_count: number;
      success_count: number;
    } | null;

    const calibrationPromise = (topicWeights && prob)
      ? (async () => {
          const skillDifficulty = computeStudentSkill(currentTopic, topicWeights);
          // Target: correct → assume problem is a bit below student skill; wrong → a bit above.
          // ±0.05 nudge (tighter than the old ±0.1) for slower, more accurate convergence.
          const target = correct ? skillDifficulty - 0.05 : skillDifficulty + 0.05;
          const seed = prob.estimated_difficulty ?? normalizeDifficulty(prob.difficulty);
          const newEstimated = Math.max(0, Math.min(1, seed + 0.15 * (target - seed)));
          // Update both problems (authoritative record) and rag_examples (source of truth for demo/precalc).
          await supabase
            .from("problems")
            .update({
              attempt_count: prob.attempt_count + 1,
              success_count: correct ? prob.success_count + 1 : prob.success_count,
              estimated_difficulty: newEstimated,
            })
            .eq("id", problemId);
          // Mirror the calibrated value to rag_examples if this problem originated there.
          // We use update+eq rather than upsert so we never create a phantom rag_example row.
          await supabase
            .from("rag_examples")
            .update({ estimated_difficulty: newEstimated })
            .eq("id", problemId);
        })()
      : Promise.resolve();

    await Promise.all([
      supabase
        .from("student_sessions")
        .update({ topic_strengths: newTopic, action_strengths: newAction, representation_strengths: newRepr })
        .eq("id", sessionId),
      calibrationPromise,
    ]);
  }

  // Update learn_student_keyword_states (rich per-keyword mastery tracking for /progress)
  // when keywordWeights provided (e.g. from problem lookup / free practice)
  if (keywordWeights && typeof keywordWeights === "object") {
    const kwKeys = Object.keys(keywordWeights);
    if (kwKeys.length === 0) {
      // Problem has empty keyword_weights — not yet tagged. Skip strength update.
      console.warn("record-attempt: keywordWeights is empty {} for problem", problemId, "— problem needs tagging");
    } else {
      const { data: validKeywords, error: keywordFetchError } = await supabase
        .from("learn_keywords")
        .select("id, category_id")
        .in("id", kwKeys)
        .eq("status", "approved");

      if (keywordFetchError) {
        console.error("record-attempt: failed to validate learn_keywords", keywordFetchError.message);
      }

      const validKeywordIds = new Set((validKeywords ?? []).map((kw: { id: string }) => kw.id));
      const keywordToCategory = new Map(
        (validKeywords ?? []).map((kw: { id: string; category_id: string }) => [kw.id, kw.category_id])
      );

      const learnKeywordWeights = Object.fromEntries(
        Object.entries(keywordWeights).filter(([keywordId]) => validKeywordIds.has(keywordId))
      ) as Record<string, number>;

      if (Object.keys(learnKeywordWeights).length === 0) {
        console.warn("record-attempt: no approved learn_keywords found in keywordWeights for problem", problemId);
      } else {
        const effectiveKwWeights = (!correct && wrongAnswerKeywords && Object.keys(wrongAnswerKeywords).length > 0)
          ? mergeWrongAnswerWeights(learnKeywordWeights, wrongAnswerKeywords)
          : learnKeywordWeights;

        // Read current scores from learn_student_keyword_states
        const { data: existingStates } = await supabase
          .from("learn_student_keyword_states")
          .select("keyword_id, in_depth_score, total_attempts, correct_attempts, consecutive_correct, state")
          .eq("session_id", sessionId)
          .in("keyword_id", Object.keys(learnKeywordWeights));

        const existingMap = new Map((existingStates ?? []).map((r) => [r.keyword_id as string, r]));
        const currentKwStrengths = Object.fromEntries(
          Object.keys(learnKeywordWeights).map((id) => [id, (existingMap.get(id)?.in_depth_score as number) ?? 0.5])
        );

        const newKwStrengths = updateStrengths(currentKwStrengths, effectiveKwWeights, correct);

        const upserts = Object.keys(learnKeywordWeights).map((keyword_id) => {
          const prev = existingMap.get(keyword_id);
          const totalAttempts = ((prev?.total_attempts as number) ?? 0) + 1;
          const correctAttempts = ((prev?.correct_attempts as number) ?? 0) + (correct ? 1 : 0);
          const consecutiveCorrect = correct ? ((prev?.consecutive_correct as number) ?? 0) + 1 : 0;
          const strength = Math.min(1, Math.max(0, newKwStrengths[keyword_id] ?? 0.5));
          let state = (prev?.state as string) ?? "needs_practice";
          if (strength >= 0.8 && consecutiveCorrect >= 4) state = "mastered";
          else if (strength >= 0.6) state = "in_progress";
          else if (strength < 0.35 && totalAttempts >= 3) state = "needs_lesson";
          else if (state === "needs_practice") state = "in_progress";
          return {
            session_id: sessionId,
            keyword_id,
            topic_id: keywordToCategory.get(keyword_id) ?? "precalc",
            in_depth_score: strength,
            umbrella_score: strength,
            total_attempts: totalAttempts,
            correct_attempts: correctAttempts,
            consecutive_correct: consecutiveCorrect,
            state,
            last_practiced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        });

        const { error: updateError } = await supabase
          .from("learn_student_keyword_states")
          .upsert(upserts, { onConflict: "session_id,keyword_id" });

        if (updateError) {
          console.error("record-attempt: failed to upsert learn_student_keyword_states for session", sessionId, updateError.message);
        }
      }
    }
  }

  return NextResponse.json({
    topic_strengths: responseTopicStrengths,
    action_strengths: responseActionStrengths,
    representation_strengths: responseRepresentationStrengths,
  });
}
