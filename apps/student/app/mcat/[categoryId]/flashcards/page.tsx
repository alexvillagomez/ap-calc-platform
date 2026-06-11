"use client";

import { useState, useEffect, use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoadingPanel } from "@/components/mcat/LoadingPanel";
import FeedbackWidget from "@/components/mcat/FeedbackWidget";
import MathText from "@/components/mcat/MathText";
import { getOrCreateMcatSession } from "@/lib/mcatSession";

const CARD_COUNT = 10;

interface Flashcard {
  id: string;
  front: string;
  back: string;
  keyword_weights: Record<string, number>;
}

type Result = "got_it" | "missed_it" | "dont_know";
type CardPhase = "front" | "back";
type PagePhase = "loading" | "study" | "done" | "error";

interface CardRecord {
  flashcard: Flashcard;
  result: Result;
}

interface TaxonomyChild {
  id: string;
}

interface TaxonomyUmbrella {
  id: string;
  children: TaxonomyChild[];
}

interface TaxonomyCategory {
  id: string;
  label: string;
  umbrellas?: TaxonomyUmbrella[];
}

function McatFlashcardsInner({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = use(params);

  // Scope params
  const searchParams = useSearchParams();
  const umbrellaId = searchParams.get("umbrella");
  const keywordScopeId = searchParams.get("keyword");
  const scopeLabel = searchParams.get("label");
  const isScoped = !!(umbrellaId || keywordScopeId);
  const backHref = isScoped ? `/mcat/${categoryId}` : "/mcat";

  const [sessionId, setSessionId] = useState("");
  const [categoryLabel, setCategoryLabel] = useState("");
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [cardPhase, setCardPhase] = useState<CardPhase>("front");
  const [pagePhase, setPagePhase] = useState<PagePhase>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [history, setHistory] = useState<CardRecord[]>([]);
  const [flipping, setFlipping] = useState(false);
  // Track whether back has been seen at least once for the current card
  const [seenBack, setSeenBack] = useState(false);

  // Resolve umbrella → children ids via taxonomy
  const resolveKeywordIds = async (
    sid: string
  ): Promise<{ keyword_id?: string; keyword_ids?: string[] }> => {
    if (keywordScopeId) return { keyword_id: keywordScopeId };
    if (!umbrellaId) return {};

    try {
      const r = await fetch(`/api/mcat/taxonomy?session_id=${sid}`);
      if (!r.ok) return {};
      const d = await r.json() as { categories: TaxonomyCategory[] };
      const cat = (d.categories ?? []).find((c) => c.id === categoryId);
      if (!cat?.umbrellas) return {};
      const umb = cat.umbrellas.find((u) => u.id === umbrellaId);
      if (!umb || umb.children.length === 0) return {};
      return { keyword_ids: umb.children.map((c) => c.id) };
    } catch {
      return {};
    }
  };

  const fetchCards = async (sid: string) => {
    setPagePhase("loading");
    setCards([]);
    setCurrentIdx(0);
    setCardPhase("front");
    setSeenBack(false);
    setHistory([]);
    setErrorMsg("");

    try {
      const scopeBody = await resolveKeywordIds(sid);

      const res = await fetch("/api/mcat/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          category_id: categoryId,
          count: CARD_COUNT,
          ...scopeBody,
        }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Unknown error"));
      const data = await res.json() as { flashcards: Flashcard[] };
      setCards(data.flashcards ?? []);
      setPagePhase("study");
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Failed to load flashcards");
      setPagePhase("error");
    }
  };

  useEffect(() => {
    (async () => {
      const sid = await getOrCreateMcatSession();
      setSessionId(sid);

      try {
        const r = await fetch(`/api/mcat/taxonomy?session_id=${sid}`);
        if (r.ok) {
          const d = await r.json() as { categories: TaxonomyCategory[] };
          const cat = (d.categories ?? []).find((c) => c.id === categoryId);
          if (cat) setCategoryLabel(cat.label);
        }
      } catch {
        // Non-fatal
      }

      await fetchCards(sid);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flipCard = () => {
    setFlipping(true);
    setTimeout(() => {
      setCardPhase((prev) => {
        const next = prev === "front" ? "back" : "front";
        if (next === "back") setSeenBack(true);
        return next;
      });
      setFlipping(false);
    }, 150);
  };

  const gradeCard = async (result: Result) => {
    const card = cards[currentIdx];
    if (!card) return;

    const newHistory = [...history, { flashcard: card, result }];
    setHistory(newHistory);

    // Record attempt (fire and forget)
    fetch("/api/mcat/flashcard-attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        flashcard_id: card.id,
        result,
      }),
    }).catch(() => {});

    if (currentIdx + 1 >= cards.length) {
      setPagePhase("done");
    } else {
      setCurrentIdx((i) => i + 1);
      setCardPhase("front");
      setSeenBack(false);
    }
  };

  const current = cards[currentIdx];
  const gotItCount = history.filter((h) => h.result === "got_it").length;
  const missedCount = history.filter((h) => h.result === "missed_it").length;

  // Derive heading label
  const headingLabel = isScoped && scopeLabel
    ? `${scopeLabel} Flashcards`
    : categoryLabel
    ? `${categoryLabel} Flashcards`
    : "Flashcards";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={backHref}
              className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
            >
              {isScoped ? "← Back" : "← MCAT"}
            </Link>
            {isScoped && scopeLabel && (
              <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                {umbrellaId ? "Topic" : "Keyword"}: {scopeLabel}
              </span>
            )}
            <p className="font-semibold text-gray-900 text-sm truncate">
              {headingLabel}
            </p>
          </div>
          {pagePhase === "study" && cards.length > 0 && (
            <p className="text-xs text-gray-500 shrink-0">
              {currentIdx + 1} / {cards.length}
            </p>
          )}
        </div>
      </header>

      {/* Progress bar */}
      {pagePhase === "study" && cards.length > 0 && (
        <div className="h-1 bg-gray-200">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${Math.round((currentIdx / cards.length) * 100)}%` }}
          />
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Loading */}
        {pagePhase === "loading" && (
          <LoadingPanel
            message="Preparing your flashcards…"
            sub="This can take 5–30 seconds"
          />
        )}

        {/* Error */}
        {pagePhase === "error" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm text-red-600 mb-3">
              {errorMsg || "Failed to load flashcards"}
            </p>
            <button
              onClick={() => fetchCards(sessionId)}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
            >
              Try again
            </button>
          </div>
        )}

        {/* Study phase */}
        {pagePhase === "study" && current && (
          <>
            {/* Card — click anywhere to flip */}
            <button
              type="button"
              onClick={flipCard}
              className={`w-full text-left bg-white rounded-2xl border-2 shadow-md p-6 min-h-[180px] flex flex-col justify-between transition-opacity duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                flipping ? "opacity-0" : "opacity-100"
              } ${cardPhase === "front" ? "border-gray-200" : "border-blue-300"}`}
            >
              {cardPhase === "front" ? (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                    Front
                  </p>
                  <p className="text-base font-medium text-gray-900 leading-relaxed">
                    <MathText>{current.front}</MathText>
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-3">
                    Back
                  </p>
                  <p className="text-base text-gray-800 leading-relaxed">
                    <MathText>{current.back}</MathText>
                  </p>
                </div>
              )}
              {/* Tap to flip hint */}
              <p className="text-xs text-gray-300 mt-4 text-right select-none">
                {cardPhase === "back" ? "tap to flip back" : "tap to flip"}
              </p>
            </button>

            {/* Show answer button — only on front when not yet seen back */}
            {cardPhase === "front" && !seenBack && (
              <button
                onClick={flipCard}
                className="w-full py-3.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors"
              >
                Show answer
              </button>
            )}

            {/* Grade buttons — only after back has been seen at least once */}
            {seenBack && (
              <>
                <div className="flex gap-2">
                  <button
                    onClick={() => gradeCard("missed_it")}
                    className="flex-1 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold hover:bg-red-100 transition-colors"
                  >
                    ✗ Missed it
                  </button>
                  <button
                    onClick={() => gradeCard("got_it")}
                    className="flex-1 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-semibold hover:bg-green-100 transition-colors"
                  >
                    ✓ Got it
                  </button>
                </div>
                <div className="flex justify-center">
                  <button
                    onClick={() => gradeCard("dont_know")}
                    className="text-xs text-gray-400 hover:text-gray-600 underline"
                  >
                    I didn&apos;t know this
                  </button>
                </div>
                {/* Feedback widget */}
                <FeedbackWidget
                  sessionId={sessionId}
                  contentType="flashcard"
                  contentId={current.id}
                  className="px-1"
                />
              </>
            )}
          </>
        )}

        {/* Completion screen */}
        {pagePhase === "done" && (
          <div className="text-center py-8 space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <p className="text-3xl mb-2">🎉</p>
              <p className="text-xl font-bold text-gray-900 mb-1">
                All {cards.length} cards done!
              </p>
              <div className="flex justify-center gap-6 mt-4">
                <div className="text-center">
                  <p className="text-xl font-bold text-green-600">{gotItCount}</p>
                  <p className="text-xs text-gray-500">Got it</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-red-500">{missedCount}</p>
                  <p className="text-xs text-gray-500">Missed</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-gray-400">
                    {history.filter((h) => h.result === "dont_know").length}
                  </p>
                  <p className="text-xs text-gray-500">Didn&apos;t know</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row justify-center">
              <button
                onClick={() => fetchCards(sessionId)}
                className="px-6 py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors"
              >
                10 more cards
              </button>
              <Link
                href={backHref}
                className="px-6 py-3 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50 transition-colors text-center"
              >
                {isScoped ? "Back" : "Back to MCAT"}
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function McatFlashcardsPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <McatFlashcardsInner params={params} />
    </Suspense>
  );
}
