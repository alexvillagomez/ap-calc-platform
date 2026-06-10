import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const deckId = searchParams.get("deck_id");
  const sessionId = searchParams.get("session_id");
  const page = parseInt(searchParams.get("page") ?? "0");
  const limit = parseInt(searchParams.get("limit") ?? "2000");

  if (!deckId || !sessionId) return NextResponse.json({ error: "deck_id and session_id required" }, { status: 400 });

  const supabase = createClient(supabaseUrl, key);

  const { data: cards, error } = await supabase
    .from("anki_cards")
    .select("id, front_html, back_html, css, plain_text, tags, mcq, learn_more, enriched_at, keyword_weights")
    .eq("deck_id", deckId)
    .range(page * limit, (page + 1) * limit - 1)
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const cardList = cards ?? [];

  // Batch fetch all attempt stats in a single query
  const cardIds = cardList.map((c) => c.id);
  const { data: attempts } = cardIds.length > 0
    ? await supabase
        .from("anki_card_attempts")
        .select("card_id, correct")
        .in("card_id", cardIds)
        .eq("session_id", sessionId)
    : { data: [] };

  // Group attempts by card_id
  const attemptMap: Record<string, { total: number; correct: number }> = {};
  for (const a of attempts ?? []) {
    if (!attemptMap[a.card_id]) attemptMap[a.card_id] = { total: 0, correct: 0 };
    attemptMap[a.card_id].total++;
    if (a.correct) attemptMap[a.card_id].correct++;
  }

  const withStats = cardList.map((card) => ({
    ...card,
    attempts: attemptMap[card.id]?.total ?? 0,
    correct_attempts: attemptMap[card.id]?.correct ?? 0,
  }));

  return NextResponse.json({ cards: withStats, page, limit });
}
