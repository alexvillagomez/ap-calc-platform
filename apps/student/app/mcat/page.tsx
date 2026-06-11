"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ScoreBar } from "@/components/mcat/ScoreBar";
import AuthButtons from "@/components/mcat/AuthButtons";
import { getOrCreateMcatSession } from "@/lib/mcatSession";

interface Keyword {
  id: string;
  label: string;
  description: string;
  tier: "umbrella" | "in_depth";
  parent_keyword_id: string | null;
  score: number | null;
  total_attempts: number;
  correct_attempts: number;
  dont_know_count: number;
  state: string | null;
}

interface Category {
  id: string;
  label: string;
  description: string;
  order_index: number;
  keywords: Keyword[];
}

function categoryMastery(keywords: Keyword[]): { pct: number; attempted: number } {
  const attempted = keywords.filter((k) => k.total_attempts > 0);
  if (attempted.length === 0) return { pct: 0, attempted: 0 };
  const avg =
    attempted.reduce((sum, k) => sum + (k.score ?? 0), 0) / attempted.length;
  return { pct: Math.round(avg * 100), attempted: attempted.length };
}

function MasteryBadge({ pct, attempted, total }: { pct: number; attempted: number; total: number }) {
  if (attempted === 0) {
    return <span className="text-xs text-gray-400">Not started</span>;
  }
  const color =
    pct >= 80 ? "text-green-700" : pct >= 50 ? "text-yellow-700" : "text-red-600";
  return (
    <span className={`text-xs font-medium ${color}`}>
      {pct}% · {attempted}/{total} keywords
    </span>
  );
}

export default function McatLandingPage() {
  const [sessionId, setSessionId] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const sid = await getOrCreateMcatSession();
      setSessionId(sid);

      try {
        const res = await fetch(`/api/mcat/taxonomy?session_id=${sid}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json() as { categories: Category[] };
        setCategories(data.categories ?? []);
      } catch (e) {
        setError((e as Error).message ?? "Failed to load categories");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">MCAT Practice</h1>
            <p className="text-xs text-gray-400">AI-powered adaptive preparation</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/mcat/progress"
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50 transition-colors"
            >
              My Progress →
            </Link>
            <AuthButtons />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Section tabs */}
        <div className="flex gap-2 mb-8 flex-wrap">
          <span className="px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-medium">
            Biology
          </span>
          {["Chemistry", "Physics", "Psych/Soc"].map((s) => (
            <span
              key={s}
              className="px-4 py-2 rounded-full border border-gray-200 text-sm text-gray-400 cursor-not-allowed flex items-center gap-1.5"
            >
              {s}
              <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">
                coming soon
              </span>
            </span>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Loading categories…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm text-red-600 mb-3">{error}</p>
            <button
              onClick={() => {
                setError(null);
                setLoading(true);
                fetch(`/api/mcat/taxonomy?session_id=${sessionId}`)
                  .then((r) => r.json())
                  .then((d: { categories: Category[] }) => setCategories(d.categories ?? []))
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setLoading(false));
              }}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
            >
              Try again
            </button>
          </div>
        )}

        {/* Category grid */}
        {!loading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* General Practice card */}
            <div className="col-span-1 sm:col-span-2 rounded-xl border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 shadow-sm overflow-hidden">
              <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
                      General Practice
                    </span>
                  </div>
                  <h2 className="font-bold text-gray-900 text-base leading-snug mb-1">
                    Mix questions across any topics you choose
                  </h2>
                  <p className="text-xs text-gray-500">
                    Select multiple categories, practice at your own pace, and get similar questions on demand.
                  </p>
                </div>
                <Link
                  href="/mcat/practice"
                  className="shrink-0 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors text-center"
                >
                  Start Practice
                </Link>
              </div>
            </div>
            {categories.map((cat) => {
              const { pct, attempted } = categoryMastery(cat.keywords);
              return (
                <div
                  key={cat.id}
                  className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
                >
                  <div className="p-5">
                    {/* Card body — links to browse page */}
                    <Link href={`/mcat/${cat.id}`} className="block group mb-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h2 className="font-semibold text-gray-900 text-sm leading-snug group-hover:text-blue-600 transition-colors">
                          {cat.label}
                        </h2>
                      </div>
                      <p className="text-xs text-gray-500 line-clamp-2 mb-3">
                        {cat.description}
                      </p>

                      {/* Mastery bar */}
                      <div className="mb-1">
                        <ScoreBar pct={pct} />
                      </div>
                      <div className="flex items-center justify-between">
                        <MasteryBadge pct={pct} attempted={attempted} total={cat.keywords.length} />
                        <span className="text-xs text-gray-400">{cat.keywords.length} keywords</span>
                      </div>
                      <p className="text-xs text-blue-500 mt-2 font-medium">
                        Explore topics →
                      </p>
                    </Link>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Link
                        href={`/mcat/${cat.id}/practice`}
                        className="flex-1 text-center py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700 transition-colors"
                      >
                        Practice
                      </Link>
                      <Link
                        href={`/mcat/${cat.id}/flashcards`}
                        className="flex-1 text-center py-2 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50 transition-colors"
                      >
                        Flashcards
                      </Link>
                      <Link
                        href={`/mcat/${cat.id}/quiz`}
                        className="flex-1 text-center py-2 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50 transition-colors"
                      >
                        Quiz
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}

            {categories.length === 0 && (
              <div className="col-span-2 text-center py-12 text-gray-400 text-sm">
                No categories available yet.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
