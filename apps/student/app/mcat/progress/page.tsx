"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { SoundToggle } from "@/components/ui/SoundToggle";
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

function umbrellaDisplayScore(u: Umbrella): number | null {
  if (u.implied_score !== null) return Math.round(u.implied_score * 100);
  if (u.score !== null) return Math.round(u.score * 100);
  return null;
}

function umbrellaAttempts(u: Umbrella): number {
  if (u.children.length > 0) {
    return u.children.reduce((s, c) => s + c.total_attempts, 0);
  }
  return u.total_attempts;
}

function sortUmbrellas(umbrellas: Umbrella[]): Umbrella[] {
  return [...umbrellas].sort((a, b) => {
    const aAtt = umbrellaAttempts(a) > 0;
    const bAtt = umbrellaAttempts(b) > 0;
    if (!aAtt && !bAtt) return 0;
    if (aAtt && !bAtt) return -1;
    if (!aAtt && bAtt) return 1;
    const aScore = umbrellaDisplayScore(a) ?? 100;
    const bScore = umbrellaDisplayScore(b) ?? 100;
    return aScore - bScore;
  });
}

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
  return pct >= 80 ? "text-success-500" : pct >= 50 ? "text-amber-600" : "text-error-500";
}

function scoreBarColor(pct: number): "brand" | "success" | "error" {
  if (pct >= 80) return "success";
  if (pct >= 50) return "brand";
  return "error";
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
                className="shrink-0 w-4 h-4 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-colors"
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
            <span className="text-sm font-medium text-neutral-800 truncate">
              {umbrella.label}
            </span>
            <YieldBadge level={umbrella.yield_level} />
            {umbrella.state === "mastered" && (
              <span title="Mastered" className="text-success-500 text-xs shrink-0">✓</span>
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
              <span className="text-xs text-neutral-400">Not started</span>
            )}
          </div>
        </div>
        {displayScore !== null && (
          <ProgressBar
            value={displayScore}
            size="xs"
            color={scoreBarColor(displayScore)}
            label={umbrella.label}
          />
        )}
      </div>

      {/* Children — shown when expanded */}
      {hasChildren && expanded && (
        <div className="pl-5 border-l-2 border-brand-100 ml-2 mb-2 space-y-0">
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
    <div className="py-2.5 border-t border-neutral-50 first:border-0">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-sm text-neutral-700 truncate">{child.label}</span>
          <YieldBadge level={child.yield_level} />
          {child.state === "mastered" && (
            <span title="Mastered" className="text-success-500 text-xs shrink-0">✓</span>
          )}
          {child.dont_know_count > 0 && (
            <span className="text-xs bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded shrink-0">
              didn&apos;t know ×{child.dont_know_count}
            </span>
          )}
          {child.needs_lesson && (
            <span className="text-xs bg-brand-50 text-brand-600 border border-brand-100 px-1.5 py-0.5 rounded shrink-0">
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
              className="text-xs font-medium text-brand-600 hover:text-brand-800 underline shrink-0"
            >
              Lesson
            </Link>
          )}
          {pct !== null ? (
            <span className={`text-sm font-medium ${scoreColor(pct)}`}>{pct}%</span>
          ) : (
            <span className="text-xs text-neutral-400">not started</span>
          )}
        </div>
      </div>
      {pct !== null && (
        <ProgressBar value={pct} size="xs" color={scoreBarColor(pct)} label={child.label} />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function McatProgressPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Honest per-question counts from the attempt log (NOT summed per-keyword).
  const [questionsAnswered, setQuestionsAnswered] = useState(0);
  const [correctAnswers, setCorrectAnswers] = useState(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const sid = await getOrCreateMcatSession();
      const res = await fetch(`/api/mcat/taxonomy?session_id=${sid}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { categories: Category[]; questions_answered?: number; correct_answers?: number };
      setCategories(data.categories ?? []);
      setQuestionsAnswered(data.questions_answered ?? 0);
      setCorrectAnswers(data.correct_answers ?? 0);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load progress");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // load is stable (defined in component scope, not changing)

  const stats = computeOverallStats(categories);
  const overallAccuracy =
    questionsAnswered > 0
      ? Math.round((correctAnswers / questionsAnswered) * 100)
      : null;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/mcat" className="shrink-0">
              <LoderaLogo size={22} />
            </Link>
            <Link
              href="/mcat"
              className="text-xs text-neutral-400 hover:text-brand-600 transition-colors"
            >
              ← MCAT
            </Link>
            <h1 className="font-semibold text-neutral-900 text-sm">My Progress</h1>
          </div>
          <div className="flex items-center gap-2">
            <StreakBadge />
            <SoundToggle />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="relative w-10 h-10">
              <div className="w-10 h-10 rounded-full border-4 border-brand-100" />
              <div className="absolute inset-0 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
            </div>
            <p className="text-sm text-neutral-500">Loading progress…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center">
            <p className="text-sm text-error-600 mb-3">{error}</p>
            <Button variant="primary" size="sm" onClick={load}>Try again</Button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Overall stats */}
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-3 text-center" noPadding>
                <div className="p-3 text-center">
                  <p className="text-xl font-bold text-neutral-900">
                    {stats.practicedKeywords}/{stats.totalKeywords}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">Practiced</p>
                </div>
              </Card>
              <Card className="p-3 text-center" noPadding>
                <div className="p-3 text-center">
                  <p className="text-xl font-bold text-neutral-900">{questionsAnswered}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Questions answered</p>
                </div>
              </Card>
              <Card className="p-3 text-center" noPadding>
                <div className="p-3 text-center">
                  <p className={`text-xl font-bold ${overallAccuracy !== null ? (overallAccuracy >= 80 ? "text-success-500" : overallAccuracy >= 50 ? "text-amber-600" : "text-error-500") : "text-neutral-900"}`}>
                    {overallAccuracy !== null ? `${overallAccuracy}%` : "—"}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">Accuracy</p>
                </div>
              </Card>
            </div>

            {/* Per-category sections */}
            {categories.map((cat) => {
              const avgPct = categoryAvgPct(cat);
              const hasUmbrellas = cat.umbrellas && cat.umbrellas.length > 0;
              const sortedUmbrellas = hasUmbrellas ? sortUmbrellas(cat.umbrellas!) : [];

              return (
                <Card key={cat.id} noPadding>
                  {/* Category header */}
                  <div className="px-4 pt-4 pb-3 border-b border-neutral-100">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <Link
                        href={`/mcat/${cat.id}/practice`}
                        className="font-semibold text-neutral-900 text-sm hover:text-brand-600 transition-colors"
                      >
                        {cat.label}
                      </Link>
                      {avgPct !== null ? (
                        <span className={`text-sm font-semibold ${scoreColor(avgPct)}`}>
                          {avgPct}%
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">Not started</span>
                      )}
                    </div>
                    {avgPct !== null && (
                      <ProgressBar
                        value={avgPct}
                        size="xs"
                        color={scoreBarColor(avgPct)}
                        label={`${cat.label} average`}
                      />
                    )}
                  </div>

                  {/* Umbrella rows */}
                  {hasUmbrellas && (
                    <div className="px-4 divide-y divide-neutral-50">
                      {sortedUmbrellas.length === 0 && (
                        <p className="text-xs text-neutral-400 py-3">No topics yet.</p>
                      )}
                      {sortedUmbrellas.map((u) => (
                        <UmbrellaRow key={u.id} umbrella={u} />
                      ))}
                    </div>
                  )}

                  {/* Fallback: legacy flat keyword list */}
                  {!hasUmbrellas && cat.keywords && cat.keywords.length > 0 && (
                    <div className="px-4 divide-y divide-neutral-50">
                      {cat.keywords
                        .filter((k) => k.tier === "umbrella" || !k.parent_keyword_id)
                        .map((kw) => (
                          <div key={kw.id} className="py-2.5">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-sm text-neutral-800 truncate">{kw.label}</span>
                              {kw.score !== null ? (
                                <span className={`text-sm font-medium ${scoreColor(Math.round(kw.score * 100))}`}>
                                  {Math.round(kw.score * 100)}%
                                </span>
                              ) : (
                                <span className="text-xs text-neutral-400">not started</span>
                              )}
                            </div>
                            {kw.score !== null && (
                              <ProgressBar
                                value={Math.round(kw.score * 100)}
                                size="xs"
                                color={scoreBarColor(Math.round(kw.score * 100))}
                                label={kw.label}
                              />
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </Card>
              );
            })}

            {categories.length === 0 && (
              <div className="text-center py-12 text-neutral-400 text-sm">
                No categories available yet.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
