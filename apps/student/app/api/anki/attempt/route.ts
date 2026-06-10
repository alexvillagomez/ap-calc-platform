import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const ALPHA = 0.3;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, key);

  const body = (await request.json()) as {
    card_id: string;
    session_id: string;
    mode: "flip" | "mcq";
    correct: boolean;
  };

  const { card_id, session_id, mode, correct } = body;
  if (!card_id || !session_id || typeof correct !== "boolean") {
    return NextResponse.json({ error: "card_id, session_id, correct required" }, { status: 400 });
  }

  // Log the attempt
  await supabase.from("anki_card_attempts").insert({ card_id, session_id, mode: mode ?? "flip", correct });

  // Fetch card keyword_weights
  const { data: card } = await supabase
    .from("anki_cards")
    .select("keyword_weights")
    .eq("id", card_id)
    .single();

  const keywordWeights = (card?.keyword_weights as Record<string, number> | null) ?? {};
  const updatedKeywords: Array<{ id: string; new_score: number }> = [];

  // Update learn_student_keyword_states for each keyword
  for (const [kwId, weight] of Object.entries(keywordWeights)) {
    const { data: existing } = await supabase
      .from("learn_student_keyword_states")
      .select("in_depth_score, consecutive_correct, total_attempts, correct_attempts")
      .eq("session_id", session_id)
      .eq("keyword_id", kwId)
      .maybeSingle();

    const prev = existing ?? {
      in_depth_score: 0.5,
      consecutive_correct: 0,
      total_attempts: 0,
      correct_attempts: 0,
    };

    // EMA update weighted by the keyword's weight in this card
    const alpha = ALPHA * weight;
    const newScore = Math.min(1, Math.max(0,
      prev.in_depth_score * (1 - alpha) + (correct ? 1 : 0) * alpha
    ));
    const newConsecutive = correct ? prev.consecutive_correct + 1 : 0;

    await supabase.from("learn_student_keyword_states").upsert(
      {
        session_id,
        keyword_id: kwId,
        topic_id: kwId, // anki cards don't have a separate umbrella id — use same
        in_depth_score: newScore,
        umbrella_score: newScore,
        consecutive_correct: newConsecutive,
        total_attempts: prev.total_attempts + 1,
        correct_attempts: prev.correct_attempts + (correct ? 1 : 0),
        state: newScore >= 0.8 && newConsecutive >= 4 ? "mastered" : "in_progress",
        last_practiced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id,keyword_id" }
    );

    updatedKeywords.push({ id: kwId, new_score: newScore });
  }

  return NextResponse.json({ ok: true, updated_keywords: updatedKeywords });
}
