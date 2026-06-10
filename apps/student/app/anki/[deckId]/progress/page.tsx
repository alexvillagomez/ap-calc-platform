"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

interface KeywordScore {
  id: string;
  label: string;
  score: number;
  total_attempts: number;
  correct_attempts: number;
}

interface DeckStats {
  total: number;
  studied: number;
  correct: number;
}

function ScoreBar({ score, label, attempts }: { score: number; label: string; attempts: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="py-2">
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-sm text-gray-800">{label}</span>
        <div className="flex items-center gap-2">
          {attempts < 5 && (
            <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
              low sample (n={attempts})
            </span>
          )}
          <span className="text-sm font-medium text-gray-700">{pct}%</span>
        </div>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ProgressPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = use(params);
  const [keywords, setKeywords] = useState<KeywordScore[]>([]);
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [deckName, setDeckName] = useState("");
  const [loading, setLoading] = useState(true);

  const sessionId =
    typeof window !== "undefined"
      ? localStorage.getItem("ap_calc_student_session_id") ?? ""
      : "";

  useEffect(() => {
    if (!sessionId || !deckId) return;

    // Fetch deck info
    fetch(`/api/anki/decks?session_id=${sessionId}`)
      .then((r) => r.json())
      .then((d) => {
        const deck = (d.decks ?? []).find((dk: { id: string; name: string }) => dk.id === deckId);
        setDeckName(deck?.name ?? "Deck");
      });

    // Fetch keyword scores: get all keyword_weights from this deck's cards,
    // then join with learn_student_keyword_states
    (async () => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) return;

      // Get all keyword ids from deck cards
      const cardsRes = await fetch(`/api/anki/cards?deck_id=${deckId}&session_id=${sessionId}&page=0`);
      const cardsData = await cardsRes.json();
      const cards = cardsData.cards ?? [];

      // Collect all keyword ids
      const kwIds = new Set<string>();
      for (const card of cards) {
        if (card.keyword_weights) {
          Object.keys(card.keyword_weights as Record<string, number>).forEach((k) => kwIds.add(k));
        }
      }

      // Deck-level stats from attempt data
      let totalStudied = 0;
      let totalCorrect = 0;
      for (const card of cards) {
        totalStudied += card.attempts ?? 0;
        totalCorrect += card.correct_attempts ?? 0;
      }
      setStats({ total: cards.length, studied: totalStudied, correct: totalCorrect });

      if (kwIds.size === 0) {
        setLoading(false);
        return;
      }

      // Fetch mastery states for those keywords
      const { createClient } = await import("@supabase/supabase-js");
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      const supabase = createClient(supabaseUrl, key);

      const { data: states } = await supabase
        .from("learn_student_keyword_states")
        .select("keyword_id, in_depth_score, total_attempts, correct_attempts")
        .eq("session_id", sessionId)
        .in("keyword_id", [...kwIds]);

      // Fetch keyword labels
      const { data: kwData } = await supabase
        .from("learn_keywords")
        .select("id, label")
        .in("id", [...kwIds]);

      const labelMap: Record<string, string> = {};
      (kwData ?? []).forEach((k) => { labelMap[k.id] = k.label; });

      const scored: KeywordScore[] = (states ?? []).map((s) => ({
        id: s.keyword_id,
        label: labelMap[s.keyword_id] ?? s.keyword_id,
        score: s.in_depth_score,
        total_attempts: s.total_attempts,
        correct_attempts: s.correct_attempts,
      }));

      // Sort: weak keywords first
      scored.sort((a, b) => a.score - b.score);
      setKeywords(scored);
      setLoading(false);
    })();
  }, [deckId, sessionId]);

  if (loading) return <div className="p-8 text-gray-500 text-sm">Loading…</div>;

  const weak = keywords.filter((k) => k.score < 0.5);
  const strong = keywords.filter((k) => k.score >= 0.5);

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <Link href="/anki" className="text-xs text-gray-400 hover:text-gray-600">← Decks</Link>
          <p className="font-semibold text-gray-900 text-sm mt-0.5 truncate max-w-[240px]">{deckName}</p>
        </div>
        <Link
          href={`/anki/${deckId}/study`}
          className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700"
        >
          Study
        </Link>
      </div>

      {/* Summary stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-xs text-gray-500 mt-0.5">Cards</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-gray-900">{stats.studied}</p>
            <p className="text-xs text-gray-500 mt-0.5">Attempts</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-gray-900">
              {stats.studied > 0 ? Math.round((stats.correct / stats.studied) * 100) : 0}%
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Correct</p>
          </div>
        </div>
      )}

      {keywords.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          <p>No keyword data yet.</p>
          <p className="mt-1 text-xs">Study some cards to see your mastery scores.</p>
        </div>
      ) : (
        <>
          {weak.length > 0 && (
            <div className="mb-5">
              <h2 className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">
                Needs Work ({weak.length})
              </h2>
              <div className="rounded-xl border border-red-100 bg-white px-4 divide-y divide-gray-100">
                {weak.map((k) => (
                  <ScoreBar key={k.id} score={k.score} label={k.label} attempts={k.total_attempts} />
                ))}
              </div>
            </div>
          )}

          {strong.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">
                Looking Good ({strong.length})
              </h2>
              <div className="rounded-xl border border-green-100 bg-white px-4 divide-y divide-gray-100">
                {strong.map((k) => (
                  <ScoreBar key={k.id} score={k.score} label={k.label} attempts={k.total_attempts} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
