"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ScoreBar } from "@/components/mcat/ScoreBar";
import { YieldBadge } from "@/components/mcat/YieldBadge";
import { getOrCreateMcatSession } from "@/lib/mcatSession";

// ── Types ────────────────────────────────────────────────────────────────────

interface InDepthChild {
  id: string;
  label: string;
  description: string;
  yield_level?: "high" | "medium" | "low" | null;
  score: number | null;
  total_attempts: number;
  correct_attempts: number;
  dont_know_count: number;
  state: string | null;
  needs_lesson: boolean;
}

interface Umbrella {
  id: string;
  label: string;
  description: string;
  yield_level?: "high" | "medium" | "low" | null;
  score: number | null;
  total_attempts: number;
  correct_attempts: number;
  dont_know_count: number;
  state: string | null;
  implied_score: number | null;
  children: InDepthChild[];
}

// Legacy keyword shape (flat list — still present in response)
interface LegacyKeyword {
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
  umbrellas?: Umbrella[];
  keywords?: LegacyKeyword[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Effective score to display for an umbrella (implied → own → null) */
function umbrellaDisplayScore(u: Umbrella): number | null {
  if (u.implied_score !== null) return Math.round(u.implied_score * 100);
  if (u.score !== null) return Math.round(u.score * 100);
  return null;
}

/** Sum of children attempts (fallback to umbrella's own total_attempts) */
function umbrellaAttempts(u: Umbrella): number {
  if (u.children.length > 0) {
    return u.children.reduce((s, c) => s + c.total_attempts, 0);
  }
  return u.total_attempts;
}

/** Umbrella sort: attempted-and-weak first, then attempted-strong, then unattempted */
function sortUmbrellas(umbrellas: Umbrella[]): Umbrella[] {
  return [...umbrellas].sort((a, b) => {
    const aAtt = umbrellaAttempts(a) > 0;
    const bAtt = umbrellaAttempts(b) > 0;
    if (!aAtt && !bAtt) return 0;
    if (aAtt && !bAtt) return -1;
    if (!aAtt && bAtt) return 1;
    // Both attempted — weak first
    const aScore = umbrellaDisplayScore(a) ?? 100;
    const bScore = umbrellaDisplayScore(b) ?? 100;
    return aScore - bScore;
  });
}

/** Children sort: weakest first */
function sortChildren(children: InDepthChild[]): InDepthChild[] {
  return [...children].sort((a, b) => {
    const aAtt = a.total_attempts > 0;
    const bAtt = b.total_attempts > 0;
    if (!aAtt && !bAtt) return 0;
    if (aAtt && !bAtt) return -1;
    if (!aAtt && bAtt) return 1;
    const aScore = a.score ?? 1;
    const bScore = b.score ?? 1;
    return aScore - bScore;
  });
}

function scoreColor(pct: number): string {
  return pct >= 80 ? "text-green-700" : pct >= 50 ? "text-yellow-700" : "text-red-600";
}

// ── Overall stats helpers ─────────────────────────────────────────────────────

interface OverallStats {
  totalKeywords: number;
  practicedKeywords: number;
  totalAttempts: number;
  totalCorrect: number;
}

function computeOverallStats(categories: Category[]): OverallStats {
  let totalKeywords = 0;
  let practicedKeywords = 0;
  let totalAttempts = 0;
  let totalCorrect = 0;

  for (const cat of categories) {
    if (cat.umbrellas && cat.umbrellas.length > 0) {
      for (const u of cat.umbrellas) {
        if (u.children.length > 0) {
          for (const c of u.children) {
            totalKeywords++;
            if (c.total_attempts > 0) practicedKeywords++;
            totalAttempts += c.total_attempts;
            totalCorrect += c.correct_attempts;
          }
        } else {
          totalKeywords++;
          if (u.total_attempts > 0) practicedKeywords++;
          totalAttempts += u.total_attempts;
          totalCorrect += u.correct_attempts;
        }
      }
    } else if (cat.keywords) {
      for (const k of cat.keywords) {
        totalKeywords++;
        if (k.total_attempts > 0) practicedKeywords++;
        totalAttempts += k.total_attempts;
        totalCorrect += k.correct_attempts;
      }
    }
  }

  return { totalKeywords, practicedKeywords, totalAttempts, totalCorrect };
}

function categoryAvgPct(cat: Category): number | null {
  if (cat.umbrellas && cat.umbrellas.length > 0) {
    const scores = cat.umbrellas
      .map((u) => umbrellaDisplayScore(u))
      .filter((s): s is number => s !== null);
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }
  if (cat.keywords) {
    const attempted = cat.keywords.filter((k) => k.total_attempts > 0);
    if (attempted.length === 0) return null;
    return Math.round(
      (attempted.reduce((s, k) => s + (k.score ?? 0), 0) / attempted.length) * 100
    );
  }
  return null;
}

// ── Umbrella row with expandable children ─────────────────────────────────────

function UmbrellaRow({
  umbrella,
  defaultExpanded = false,
}: {
  umbrella: Umbrella;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const displayScore = umbrellaDisplayScore(umbrella);
  const attempts = umbrellaAttempts(umbrella);
  const dontKnow = umbrella.dont_know_count > 0
    ? umbrella.dont_know_count
    : umbrella.children.reduce((s, c) => s + c.dont_know_count, 0);
  const hasChildren = umbrella.children.length > 0;
  const sorted = hasChildren ? sortChildren(umbrella.children) : [];

  return (
    <div>
      {/* Umbrella header row */}
      <div className="py-2.5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {hasChildren && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="shrink-0 w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                <svg
                  className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 12 12"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <span className="text-sm font-medium text-gray-800 truncate">
              {umbrella.label}
            </span>
            <YieldBadge level={umbrella.yield_level} />
            {umbrella.state === "mastered" && (
              <span title="Mastered" className="text-green-500 text-xs shrink-0">
                ✓
              </span>
            )}
            {dontKnow > 0 && (
              <span className="text-xs bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded shrink-0">
                didn&apos;t know ×{dontKnow}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {attempts > 0 && attempts < 5 && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
                low sample (n={attempts})
              </span>
            )}
            {displayScore !== null ? (
              <span className={`text-sm font-medium ${scoreColor(displayScore)}`}>
                {displayScore}%
              </span>
            ) : (
              <span className="text-xs text-gray-400">Not started</span>
            )}
          </div>
        </div>
        {displayScore !== null && <ScoreBar pct={displayScore} />}
      </div>

      {/* Children — shown when expanded */}
      {hasChildren && expanded && (
        <div className="pl-5 border-l-2 border-blue-100 ml-2 mb-2 space-y-0">
          {sorted.map((child) => (
            <ChildRow key={child.id} child={child} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChildRow({ child }: { child: InDepthChild }) {
  const pct = child.score !== null ? Math.round(child.score * 100) : null;

  return (
    <div className="py-2.5 border-t border-gray-50 first:border-0">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-sm text-gray-700 truncate">{child.label}</span>
          <YieldBadge level={child.yield_level} />
          {child.state === "mastered" && (
            <span title="Mastered" className="text-green-500 text-xs shrink-0">
              ✓
            </span>
          )}
          {child.dont_know_count > 0 && (
            <span className="text-xs bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded shrink-0">
              didn&apos;t know ×{child.dont_know_count}
            </span>
          )}
          {child.needs_lesson && (
            <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded shrink-0">
              lesson recommended
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {child.total_attempts > 0 && child.total_attempts < 5 && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
              low sample (n={child.total_attempts})
            </span>
          )}
          {child.needs_lesson && (
            <Link
              href={`/mcat/lesson/${child.id}?label=${encodeURIComponent(child.label)}`}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 underline shrink-0"
            >
              Lesson
            </Link>
          )}
          {pct !== null ? (
            <span className={`text-sm font-medium ${scoreColor(pct)}`}>{pct}%</span>
          ) : (
            <span className="text-xs text-gray-400">not started</span>
          )}
        </div>
      </div>
      {pct !== null && <ScoreBar pct={pct} />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function McatProgressPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const sid = await getOrCreateMcatSession();
      const res = await fetch(`/api/mcat/taxonomy?session_id=${sid}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { categories: Category[] };
      setCategories(data.categories ?? []);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load progress");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = computeOverallStats(categories);
  const overallAccuracy =
    stats.totalAttempts > 0
      ? Math.round((stats.totalCorrect / stats.totalAttempts) * 100)
      : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/mcat"
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              ← MCAT
            </Link>
            <h1 className="font-semibold text-gray-900 text-sm">My Progress</h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Loading progress…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm text-red-600 mb-3">{error}</p>
            <button
              onClick={load}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Overall stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 bg-white p-3 text-center shadow-sm">
                <p className="text-xl font-bold text-gray-900">
                  {stats.practicedKeywords}/{stats.totalKeywords}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Keywords practiced</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-3 text-center shadow-sm">
                <p className="text-xl font-bold text-gray-900">{stats.totalAttempts}</p>
                <p className="text-xs text-gray-500 mt-0.5">Total attempts</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-3 text-center shadow-sm">
                <p className="text-xl font-bold text-gray-900">
                  {overallAccuracy !== null ? `${overallAccuracy}%` : "—"}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Accuracy</p>
              </div>
            </div>

            {/* Per-category sections */}
            {categories.map((cat) => {
              const avgPct = categoryAvgPct(cat);
              const hasUmbrellas = cat.umbrellas && cat.umbrellas.length > 0;
              const sortedUmbrellas = hasUmbrellas ? sortUmbrellas(cat.umbrellas!) : [];

              return (
                <div
                  key={cat.id}
                  className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
                >
                  {/* Category header */}
                  <div className="px-4 pt-4 pb-3 border-b border-gray-100">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <Link
                        href={`/mcat/${cat.id}/practice`}
                        className="font-semibold text-gray-900 text-sm hover:text-blue-600 transition-colors"
                      >
                        {cat.label}
                      </Link>
                      {avgPct !== null ? (
                        <span
                          className={`text-sm font-semibold ${scoreColor(avgPct)}`}
                        >
                          {avgPct}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Not started</span>
                      )}
                    </div>
                    {avgPct !== null && <ScoreBar pct={avgPct} />}
                  </div>

                  {/* Umbrella rows (new nested format) */}
                  {hasUmbrellas && (
                    <div className="px-4 divide-y divide-gray-50">
                      {sortedUmbrellas.length === 0 && (
                        <p className="text-xs text-gray-400 py-3">No topics yet.</p>
                      )}
                      {sortedUmbrellas.map((u) => (
                        <UmbrellaRow key={u.id} umbrella={u} />
                      ))}
                    </div>
                  )}

                  {/* Fallback: legacy flat keyword list */}
                  {!hasUmbrellas && cat.keywords && cat.keywords.length > 0 && (
                    <div className="px-4 divide-y divide-gray-50">
                      {cat.keywords
                        .filter((k) => k.tier === "umbrella" || !k.parent_keyword_id)
                        .map((kw) => (
                          <div key={kw.id} className="py-2.5">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-sm text-gray-800 truncate">{kw.label}</span>
                              {kw.score !== null ? (
                                <span className={`text-sm font-medium ${scoreColor(Math.round(kw.score * 100))}`}>
                                  {Math.round(kw.score * 100)}%
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">not started</span>
                              )}
                            </div>
                            {kw.score !== null && <ScoreBar pct={Math.round(kw.score * 100)} />}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}

            {categories.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">
                <p>No categories available yet.</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
