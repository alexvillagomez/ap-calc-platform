import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  updateMasteryMap,
  isMastered,
  MASTERY_START,
} from "@/lib/courseEngine/adaptive";
import { nextSrsState, type FlashcardResult } from "@/lib/flashcardSrs";
import { getAuthUid } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as {
    session_id?: string;
    flashcard_id?: string;
    result?: "got_it" | "missed_it" | "dont_know";
  };

  const { session_id, flashcard_id, result } = body;

  if (!session_id || !flashcard_id || !result) {
    return NextResponse.json(
      { error: "session_id, flashcard_id, and result are required" },
      { status: 400 }
    );
  }

  const validResults = ["got_it", "missed_it", "dont_know"];
  if (!validResults.includes(result)) {
    return NextResponse.json(
      { error: "result must be one of: got_it, missed_it, dont_know" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // Load flashcard
  const { data: flashcard, error: fcError } = await supabase
    .from("mcat_flashcards")
    .select("keyword_weights, category_id")
    .eq("id", flashcard_id)
    .maybeSingle();

  if (fcError || !flashcard) {
    return NextResponse.json(
      { error: "Flashcard not found" },
      { status: 404 }
    );
  }

  const correct = result === "got_it";
  const isDontKnow = result === "dont_know";

  // Insert attempt (audit log of every review)
  await supabase.from("mcat_flashcard_attempts").insert({
    session_id,
    flashcard_id,
    result,
  });

  // ── Spaced-repetition (Leitner) update ──────────────────────────────────────
  // Load the existing SRS row, advance it, and upsert. Missing a card drops it
  // to box 1 / due-now so it recirculates this session; getting it right
  // promotes it. Fail-soft: never block the response on SRS write errors.
  // For logged-in accounts prefer user_id keying (engine v2: account-scoped SRS).
  const accountUid = await getAuthUid();

  const { data: srsPrev } = await supabase
    .from("mcat_flashcard_srs")
    .select("box, reps, lapses, learned")
    .eq("session_id", session_id)
    .eq("flashcard_id", flashcard_id)
    .maybeSingle();

  const transition = nextSrsState(
    srsPrev
      ? {
          box: (srsPrev.box as number) ?? 1,
          reps: (srsPrev.reps as number) ?? 0,
          lapses: (srsPrev.lapses as number) ?? 0,
          learned: (srsPrev.learned as boolean) ?? false,
        }
      : null,
    result as FlashcardResult
  );

  const nowIso = new Date().toISOString();
  const { error: srsError } = await supabase
    .from("mcat_flashcard_srs")
    .upsert(
      {
        session_id,
        flashcard_id,
        category_id: flashcard.category_id as string,
        // account-keyed for engine v2 cross-session SRS (null for anonymous)
        user_id: accountUid ?? null,
        box: transition.box,
        due_at: transition.due_at,
        reps: transition.reps,
        lapses: transition.lapses,
        learned: transition.learned,
        last_result: result,
        last_shown_at: nowIso,
        last_reviewed_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "session_id,flashcard_id" }
    );

  if (srsError) {
    console.error(
      "mcat/flashcard-attempt: failed to upsert SRS state",
      srsError.message
    );
  }

  const keywordWeights =
    (flashcard.keyword_weights as Record<string, number>) ?? {};
  const kwIds = Object.keys(keywordWeights);

  if (kwIds.length === 0) {
    return NextResponse.json({ keyword_states: {} });
  }

  // Validate keyword ids
  const { data: validKws } = await supabase
    .from("mcat_keywords")
    .select("id, category_id")
    .in("id", kwIds);

  const validKwSet = new Set((validKws ?? []).map((k) => k.id as string));
  const kwToCat = new Map(
    (validKws ?? []).map((k) => [k.id as string, k.category_id as string])
  );

  const filteredWeights = Object.fromEntries(
    Object.entries(keywordWeights).filter(([id]) => validKwSet.has(id))
  );

  if (Object.keys(filteredWeights).length === 0) {
    return NextResponse.json({ keyword_states: {} });
  }

  // Load current states
  const { data: existingStates } = await supabase
    .from("mcat_student_keyword_states")
    .select(
      "keyword_id, score, total_attempts, correct_attempts, consecutive_correct, dont_know_count, state, floor"
    )
    .eq("session_id", session_id)
    .in("keyword_id", Object.keys(filteredWeights));

  const existingMap = new Map(
    (existingStates ?? []).map((s) => [s.keyword_id as string, s])
  );

  const currentStrengths: Record<string, number> = Object.fromEntries(
    Object.keys(filteredWeights).map((id) => [
      id,
      (existingMap.get(id)?.score as number) ?? MASTERY_START,
    ])
  );

  // Logarithmic mastery update (lib/courseEngine/adaptive.ts). Source = flashcard
  // (worth less than a question; same universal state). got_it → correct;
  // dont_know → small downgrade; missed_it → wrong. Neutral difficulty.
  const newStrengths = updateMasteryMap(currentStrengths, filteredWeights, {
    correct,
    dontKnow: isDontKnow,
    difficulty: "medium",
    source: "flashcard",
  });

  const now = new Date().toISOString();
  const upserts = Object.keys(filteredWeights).map((kwId) => {
    const prev = existingMap.get(kwId);
    const prevTotal = (prev?.total_attempts as number) ?? 0;
    const prevCorrect = (prev?.correct_attempts as number) ?? 0;
    const prevConsecutive = (prev?.consecutive_correct as number) ?? 0;
    const prevDontKnow = (prev?.dont_know_count as number) ?? 0;
    // Pass-through the existing floor value; engine v2 will update it when implemented.
    const prevFloor = (prev?.floor as number) ?? 0.40;

    const totalAttempts = prevTotal + 1;
    const correctAttempts = prevCorrect + (correct ? 1 : 0);
    const consecutiveCorrect = correct ? prevConsecutive + 1 : 0;
    const dontKnowCount = prevDontKnow + (isDontKnow ? 1 : 0);

    const score = Math.min(1, Math.max(0, newStrengths[kwId] ?? MASTERY_START));
    // Threshold-based mastery — no consecutive-correct gate.
    const state: "mastered" | "in_progress" =
      isMastered(score) ? "mastered" : "in_progress";

    return {
      session_id,
      keyword_id: kwId,
      category_id:
        kwToCat.get(kwId) ?? (flashcard.category_id as string),
      score,
      total_attempts: totalAttempts,
      correct_attempts: correctAttempts,
      consecutive_correct: consecutiveCorrect,
      dont_know_count: dontKnowCount,
      state,
      last_practiced_at: now,
      last_review_at: now,
      floor: prevFloor,
      updated_at: now,
    };
  });

  const { error: upsertError } = await supabase
    .from("mcat_student_keyword_states")
    .upsert(upserts, { onConflict: "session_id,keyword_id" });

  if (upsertError) {
    console.error(
      "mcat/flashcard-attempt: failed to upsert keyword states",
      upsertError.message
    );
  }

  const keyword_states: Record<string, { score: number; state: string }> =
    Object.fromEntries(
      upserts.map((u) => [u.keyword_id, { score: u.score, state: u.state }])
    );

  return NextResponse.json({
    keyword_states,
    srs: {
      box: transition.box,
      due_at: transition.due_at,
      learned: transition.learned,
      lapses: transition.lapses,
    },
  });
}
