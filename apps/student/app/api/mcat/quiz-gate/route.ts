/**
 * POST /api/mcat/quiz-gate
 *
 * Memorize-before-quiz gating. Reports whether a scope's quiz is unlocked,
 * based on how many of its flashcards the student has memorized (Leitner
 * box ≥ MEMORIZED_BOX). The quiz stays locked until the core cards are
 * memorized; only then does the student move on to applying the knowledge.
 *
 * Body: { session_id, category_id, keyword_id?, keyword_ids? }
 * Returns: { unlocked, memorized, active, remaining, required }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  MEMORIZED_BOX,
  quizUnlocked,
  quizGateRemaining,
  QUIZ_GATE_CORE_TARGET,
  QUIZ_GATE_MIN,
} from "@/lib/flashcardSrs";

export const runtime = "nodejs";

type FcRow = { id: string; keyword_weights: Record<string, number> };
type SrsRow = { flashcard_id: string; box: number };

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await request.json()) as {
    session_id?: string;
    category_id?: string;
    keyword_id?: string;
    keyword_ids?: string[];
  };

  const { session_id, category_id, keyword_id } = body;
  if (!session_id || !category_id) {
    return NextResponse.json(
      { error: "session_id and category_id are required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  const [fcRes, srsRes] = await Promise.all([
    supabase
      .from("mcat_flashcards")
      .select("id, keyword_weights")
      .eq("category_id", category_id)
      .eq("status", "active"),
    supabase
      .from("mcat_flashcard_srs")
      .select("flashcard_id, box")
      .eq("session_id", session_id)
      .eq("category_id", category_id),
  ]);

  const rawKeywordIds = Array.isArray(body.keyword_ids) ? body.keyword_ids : [];
  const scopedKeywordIds: Set<string> | null = keyword_id
    ? new Set([keyword_id])
    : rawKeywordIds.length > 0
    ? new Set(rawKeywordIds)
    : null;

  const inScope = (fc: FcRow): boolean => {
    if (!scopedKeywordIds) return true;
    const kw = (fc.keyword_weights as Record<string, number>) ?? {};
    return Object.keys(kw).some((id) => scopedKeywordIds.has(id));
  };

  const scopedCards = ((fcRes.data ?? []) as FcRow[]).filter(inScope);
  const scopedCardIds = new Set(scopedCards.map((c) => c.id));

  const memorizedCount = ((srsRes.data ?? []) as SrsRow[]).filter(
    (r) => scopedCardIds.has(r.flashcard_id) && (r.box ?? 1) >= MEMORIZED_BOX
  ).length;

  const activeCardCount = scopedCards.length;
  const unlocked = quizUnlocked(memorizedCount, activeCardCount);
  const remaining = quizGateRemaining(memorizedCount, activeCardCount);
  const required = Math.max(
    QUIZ_GATE_MIN,
    Math.min(QUIZ_GATE_CORE_TARGET, activeCardCount || QUIZ_GATE_CORE_TARGET)
  );

  return NextResponse.json({
    unlocked,
    memorized: memorizedCount,
    active: activeCardCount,
    remaining,
    required,
  });
}
