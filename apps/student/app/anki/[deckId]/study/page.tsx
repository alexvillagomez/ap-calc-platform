"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { AnkiCard } from "@/components/AnkiCard";

interface Card {
  id: string;
  front_html: string;
  back_html: string;
  css: string;
  tags: string[];
  mcq: { question: string; choices: string[]; correct_index: number; explanation: string } | null;
  learn_more: string | null;
  attempts: number;
  correct_attempts: number;
}

function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (a.attempts === 0 && b.attempts > 0) return -1;
    if (b.attempts === 0 && a.attempts > 0) return 1;
    const aWrong = a.attempts - a.correct_attempts;
    const bWrong = b.attempts - b.correct_attempts;
    if (aWrong !== bWrong) return bWrong - aWrong;
    return a.attempts - b.attempts;
  });
}

function formatTag(tag: string): string {
  return tag.replace(/::/g, " › ").replace(/_/g, " ");
}

export default function StudyPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = use(params);

  const [allCards, setAllCards] = useState<Card[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const [queue, setQueue] = useState<Card[]>([]);
  const [current, setCurrent] = useState<Card | null>(null);
  const [sessionStats, setSessionStats] = useState({ studied: 0, correct: 0 });
  const [done, setDone] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const sessionId =
    typeof window !== "undefined"
      ? localStorage.getItem("ap_calc_student_session_id") ?? ""
      : "";

  // Load all cards once
  useEffect(() => {
    if (!sessionId || !deckId) return;
    Promise.all([
      fetch(`/api/anki/cards?deck_id=${deckId}&session_id=${sessionId}`).then((r) => r.json()),
      fetch(`/api/anki/decks?session_id=${sessionId}`).then((r) => r.json()),
    ]).then(([cardsData, decksData]) => {
      const cards: Card[] = cardsData.cards ?? [];
      setAllCards(cards);

      const deck = (decksData.decks ?? []).find((d: { id: string; name: string }) => d.id === deckId);
      setDeckName(deck?.name ?? "Deck");

      const tags = [...new Set(cards.flatMap((c) => c.tags ?? []))].sort();
      setAllTags(tags);
      setSelectedTags(new Set(tags));

      setLoading(false);
    });
  }, [deckId, sessionId]);

  // Rebuild queue whenever tag selection or allCards changes
  const buildQueue = useCallback(
    (cards: Card[], selected: Set<string>, tags: string[]) => {
      const filtered =
        selected.size === 0 || selected.size === tags.length
          ? cards
          : cards.filter(
              (c) => (c.tags ?? []).length === 0 || (c.tags ?? []).some((t) => selected.has(t))
            );
      const sorted = sortCards(filtered);
      setQueue(sorted);
      setCurrent(sorted[0] ?? null);
      setDone(false);
      setSessionStats({ studied: 0, correct: 0 });
    },
    []
  );

  useEffect(() => {
    if (allCards.length > 0) buildQueue(allCards, selectedTags, allTags);
  }, [selectedTags, allCards, allTags, buildQueue]);

  const handleAnswer = async (correct: boolean, mode: "flip" | "mcq") => {
    if (!current || !sessionId) return;
    setSessionStats((s) => ({ studied: s.studied + 1, correct: s.correct + (correct ? 1 : 0) }));
    await fetch("/api/anki/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_id: current.id, session_id: sessionId, mode, correct }),
    });
    const nextQueue = queue.slice(1);
    setQueue(nextQueue);
    if (nextQueue.length === 0) { setCurrent(null); setDone(true); }
    else setCurrent(nextQueue[0]);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const totalFiltered = queue.length + sessionStats.studied;

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Topics</span>
        <span className="text-xs text-gray-400">{selectedTags.size} / {allTags.length}</span>
      </div>
      <div className="flex gap-2 px-4 pb-3">
        <button
          onClick={() => setSelectedTags(new Set(allTags))}
          className="text-xs text-blue-600 hover:underline"
        >
          All
        </button>
        <span className="text-xs text-gray-300">·</span>
        <button
          onClick={() => setSelectedTags(new Set())}
          className="text-xs text-blue-600 hover:underline"
        >
          None
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5">
        {allTags.map((tag) => {
          const checked = selectedTags.has(tag);
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-colors text-sm ${
                checked ? "text-gray-800 hover:bg-gray-100" : "text-gray-400 hover:bg-gray-50"
              }`}
            >
              <span
                className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center transition-colors ${
                  checked ? "bg-blue-600 border-blue-600" : "border-gray-300"
                }`}
              >
                {checked && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              <span className="truncate">{formatTag(tag)}</span>
            </button>
          );
        })}
        {allTags.length === 0 && (
          <p className="text-xs text-gray-400 px-2 py-2">No tags in this deck</p>
        )}
      </div>
    </div>
  );

  if (loading) return <div className="p-8 text-gray-500 text-sm">Loading cards…</div>;

  if (!sessionId) {
    return (
      <div className="p-8 text-center text-gray-600">
        <Link href="/login" className="text-blue-600 underline text-sm">Log in to study →</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/anki" className="text-xs text-gray-400 hover:text-gray-600 shrink-0">← Decks</Link>
          <p className="font-semibold text-gray-900 text-sm truncate">{deckName}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Mobile filter button */}
          {allTags.length > 0 && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 12h10M11 20h2" />
              </svg>
              Filter {selectedTags.size < allTags.length && `(${selectedTags.size})`}
            </button>
          )}
          <div className="text-right">
            <p className="text-sm font-medium text-gray-700">{queue.length} remaining</p>
            {sessionStats.studied > 0 && (
              <p className="text-xs text-gray-400">{sessionStats.correct}/{sessionStats.studied} correct</p>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {totalFiltered > 0 && (
        <div className="h-1 bg-gray-200 shrink-0">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${Math.round((sessionStats.studied / totalFiltered) * 100)}%` }}
          />
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        {allTags.length > 0 && (
          <aside className="hidden lg:flex flex-col w-64 border-r border-gray-200 bg-white shrink-0 overflow-hidden">
            {sidebar}
          </aside>
        )}

        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/30 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white z-50 shadow-xl lg:hidden flex flex-col">
              <div className="flex items-center justify-between px-4 pt-4 pb-0">
                <span className="text-sm font-semibold text-gray-800">Filter Topics</span>
                <button onClick={() => setSidebarOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {sidebar}
            </aside>
          </>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto py-6 px-4 flex flex-col items-center">
          <div className="w-full max-w-2xl">
            {done || !current ? (
              <div className="text-center py-16">
                <p className="text-4xl mb-3">🎉</p>
                <p className="text-xl font-bold text-gray-900 mb-1">Session complete!</p>
                <p className="text-gray-500 mb-6">
                  {sessionStats.correct} / {sessionStats.studied} correct
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => buildQueue(allCards, selectedTags, allTags)}
                    className="px-6 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700"
                  >
                    Study again
                  </button>
                  <Link
                    href={`/anki/${deckId}/progress`}
                    className="px-6 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50"
                  >
                    View progress
                  </Link>
                </div>
              </div>
            ) : (
              <AnkiCard
                key={current.id}
                cardId={current.id}
                frontHtml={current.front_html}
                backHtml={current.back_html}
                css={current.css ?? ""}
                mcq={current.mcq}
                learnMore={current.learn_more}
                onAnswer={handleAnswer}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
