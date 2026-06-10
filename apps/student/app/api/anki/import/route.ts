import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { session_id, name, filename, card_count, deck_id } = (await request.json()) as {
    session_id: string;
    name: string;
    filename: string;
    card_count: number;
    deck_id: string;
  };

  if (!session_id || !name || !filename || !card_count || !deck_id) {
    return NextResponse.json({ error: "session_id, name, filename, card_count, deck_id required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  const { data: deck, error } = await supabase
    .from("anki_decks")
    .insert({ id: deck_id, session_id, name, filename, card_count })
    .select("id")
    .single();

  if (error || !deck) {
    return NextResponse.json({ error: error?.message ?? "Failed to create deck" }, { status: 500 });
  }

  return NextResponse.json({ deck_id: deck.id });
}
