import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

interface CardInput {
  anki_note_id: number;
  note_type: string;
  front_html: string;
  back_html: string;
  css: string;
  plain_text: string;
  tags: string[];
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { deck_id, cards } = (await request.json()) as { deck_id: string; cards: CardInput[] };
  if (!deck_id || !Array.isArray(cards) || cards.length === 0) {
    return NextResponse.json({ error: "deck_id and cards required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);
  const toInsert = cards.map((c) => ({ ...c, deck_id }));

  const { error } = await supabase.from("anki_cards").insert(toInsert);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: cards.length });
}
