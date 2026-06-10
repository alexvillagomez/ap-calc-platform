import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

  const supabase = createClient(supabaseUrl, key);

  const { data, error } = await supabase
    .from("anki_decks")
    .select("id, name, filename, card_count, imported_at")
    .eq("session_id", sessionId)
    .order("imported_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach enrichment progress for each deck
  const enriched = await Promise.all(
    (data ?? []).map(async (deck) => {
      const { count: enrichedCount } = await supabase
        .from("anki_cards")
        .select("id", { count: "exact", head: true })
        .eq("deck_id", deck.id)
        .not("enriched_at", "is", null);
      return { ...deck, enriched_count: enrichedCount ?? 0 };
    })
  );

  return NextResponse.json({ decks: enriched });
}
