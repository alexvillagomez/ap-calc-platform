import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_SIZE = 20;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeWeights(raw: Record<string, number>): Record<string, number> {
  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  if (total === 0) return raw;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / total]));
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json({ error: "OpenAI not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const deckId = searchParams.get("deck_id");
  if (!deckId) {
    return NextResponse.json({ error: "deck_id required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  // Fetch unenriched cards for this deck
  const { data: cards, error: cardsErr } = await supabase
    .from("anki_cards")
    .select("id, plain_text, front_html, back_html")
    .eq("deck_id", deckId)
    .is("enriched_at", null)
    .limit(BATCH_SIZE);

  if (cardsErr || !cards) {
    return NextResponse.json({ error: "Failed to fetch cards" }, { status: 500 });
  }

  if (cards.length === 0) {
    return NextResponse.json({ enriched: 0, message: "All cards already enriched" });
  }

  // Fetch keyword catalog (in_depth, approved, with embeddings)
  const { data: keywords } = await supabase
    .from("learn_keywords")
    .select("id, label, embedding")
    .eq("tier", "in_depth")
    .eq("status", "approved")
    .not("embedding", "is", null);

  const keywordList = (keywords ?? []).filter((k) => k.embedding);

  // Process cards in this batch
  let enrichedCount = 0;
  for (const card of cards) {
    const text = (card.plain_text as string) ?? "";
    if (!text.trim()) continue;

    try {
      // Step A: Embed card text
      const embedRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      });
      const cardEmbedding = embedRes.data[0].embedding;

      // Step B: Keyword tagging via cosine similarity
      let keywordWeights: Record<string, number> = {};
      if (keywordList.length > 0) {
        const scored = keywordList
          .map((kw) => ({
            id: kw.id as string,
            sim: cosineSimilarity(cardEmbedding, kw.embedding as number[]),
          }))
          .sort((a, b) => b.sim - a.sim)
          .slice(0, 5)
          .filter((k) => k.sim > 0);

        const raw: Record<string, number> = {};
        scored.forEach((k) => { raw[k.id] = k.sim; });
        keywordWeights = normalizeWeights(raw);
      }

      // Step C+D: MCQ + Learn More (single LLM call)
      const front = stripHtml(card.front_html as string);
      const back = stripHtml(card.back_html as string);
      const cardContext = `Front: ${front}\nBack: ${back}`;

      const llmRes = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a study assistant. Given a flashcard, produce two things:
1. A multiple-choice question with exactly 4 choices that tests the same concept as the card.
2. A brief "learn more" explanation (2-3 short paragraphs in plain language) that helps a student understand the concept more deeply.

Return JSON with this exact shape:
{
  "mcq": {
    "question": "...",
    "choices": ["A", "B", "C", "D"],
    "correct_index": 0,
    "explanation": "..."
  },
  "learn_more": "markdown string"
}`,
          },
          { role: "user", content: cardContext },
        ],
        max_tokens: 800,
      });

      let mcq: Record<string, unknown> | null = null;
      let learnMore: string | null = null;
      try {
        const parsed = JSON.parse(llmRes.choices[0].message.content ?? "{}");
        mcq = parsed.mcq ?? null;
        learnMore = parsed.learn_more ?? null;
      } catch {
        // LLM returned invalid JSON — skip enrichment fields
      }

      await supabase
        .from("anki_cards")
        .update({
          embedding: cardEmbedding,
          keyword_weights: Object.keys(keywordWeights).length > 0 ? keywordWeights : null,
          mcq,
          learn_more: learnMore,
          enriched_at: new Date().toISOString(),
        })
        .eq("id", card.id);

      enrichedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Enrichment failed for card ${card.id}:`, msg);
      // An auth/quota failure will hit every card identically — fail fast with a
      // clear reason instead of silently returning { enriched: 0 }.
      if (/401|invalid_api_key|incorrect api key|429|quota|insufficient_quota/i.test(msg)) {
        return NextResponse.json(
          { error: "Enrichment unavailable — AI provider rejected the request", detail: msg, enriched: enrichedCount },
          { status: 502 }
        );
      }
    }
  }

  const remaining = await supabase
    .from("anki_cards")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", deckId)
    .is("enriched_at", null);

  return NextResponse.json({
    enriched: enrichedCount,
    remaining: remaining.count ?? 0,
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
