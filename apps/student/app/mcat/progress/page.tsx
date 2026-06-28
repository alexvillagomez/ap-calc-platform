"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { NavMenu } from "@/components/nav/NavMenu";
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
  return umbrellas;
}

function sortChildren(children: InDepthChild[]): InDepthChild[] {
  return children;
}

function scoreBarColor(pct: number): "brand" | "success" | "error" {
  if (pct >= 80) return "success";
  if (pct >= 55) return "brand";
  return "error";
}

// ── Word-label status (mirrors mathUiTypes.ts thresholds) ─────────────────────
// Keyword: ≥5 attempts | Umbrella: ≥5 total | Category: ≥5 attempts + ≥min(3,N) keywords

interface ProgressStatus {
  label: string;
  labelClass: string;
  sufficient: boolean;
}

function keywordProgressStatus(attempts: number, pct: number | null): ProgressStatus {
  if (attempts === 0 || pct === null) {
    return { label: "Not started", labelClass: "text-neutral-400", sufficient: false };
  }
  if (attempts < 5) {
    return { label: "Just started", labelClass: "text-neutral-500", sufficient: false };
  }
  if (pct >= 80) return { label: "Strong",        labelClass: "text-success-700", sufficient: true };
  if (pct >= 55) return { label: "Getting there", labelClass: "text-amber-700",   sufficient: true };
  return               { label: "Needs work",     labelClass: "text-error-600",   sufficient: true };
}

function umbrellaProgressStatus(totalAttempts: number, displayScore: number | null): ProgressStatus {
  if (totalAttempts === 0 || displayScore === null) {
    return { label: "Not started", labelClass: "text-neutral-400", sufficient: false };
  }
  if (totalAttempts < 5) {
    return { label: "Just started", labelClass: "text-neutral-500", sufficient: false };
  }
  if (displayScore >= 80) return { label: "Strong",        labelClass: "text-success-700", sufficient: true };
  if (displayScore >= 55) return { label: "Getting there", labelClass: "text-amber-700",   sufficient: true };
  return                  { label: "Needs work",           labelClass: "text-error-600",   sufficient: true };
}

function categoryProgressStatus(
  totalKeywords: number,
  keywordsAttempted: number,
  totalAttempts: number,
  avgScore: number | null
): ProgressStatus {
  if (totalAttempts === 0 || avgScore === null) {
    return { label: "Not started", labelClass: "text-neutral-400", sufficient: false };
  }
  const minKeywordsNeeded = Math.min(3, totalKeywords);
  const sufficient = totalAttempts >= 5 && keywordsAttempted >= minKeywordsNeeded;
  if (!sufficient) {
    return { label: "Just started", labelClass: "text-neutral-500", sufficient: false };
  }
  if (avgScore >= 80) return { label: "Strong",        labelClass: "text-success-700", sufficient: true };
  if (avgScore >= 55) return { label: "Getting there", labelClass: "text-amber-700",   sufficient: true };
  return               { label: "Needs work",          labelClass: "text-error-600",   sufficient: true };
}

// ── Category stats helpers ────────────────────────────────────────────────────

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

function categoryKeywordStats(cat: Category): { totalKeywords: number; keywordsAttempted: number; totalAttempts: number } {
  let totalKeywords = 0, keywordsAttempted = 0, totalAttempts = 0;
  if (cat.umbrellas && cat.umbrellas.length > 0) {
    for (const u of cat.umbrellas) {
      if (u.children.length > 0) {
        for (const c of u.children) {
          totalKeywords++;
          if (c.total_attempts > 0) keywordsAttempted++;
          totalAttempts += c.total_attempts;
        }
      } else {
        totalKeywords++;
        if (u.total_attempts > 0) keywordsAttempted++;
        totalAttempts += u.total_attempts;
      }
    }
  } else if (cat.keywords) {
    for (const k of cat.keywords) {
      totalKeywords++;
      if (k.total_attempts > 0) keywordsAttempted++;
      totalAttempts += k.total_attempts;
    }
  }
  return { totalKeywords, keywordsAttempted, totalAttempts };
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
  const status = umbrellaProgressStatus(attempts, displayScore);

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
          <span className={`text-xs font-medium shrink-0 ${status.labelClass}`}>{status.label}</span>
        </div>
        {status.sufficient && displayScore !== null && (
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
  const status = keywordProgressStatus(child.total_attempts, pct);

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
          {child.needs_lesson && (
            <Link
              href={`/mcat/lesson/${child.id}?label=${encodeURIComponent(child.label)}`}
              className="text-xs font-medium text-brand-600 hover:text-brand-800 underline shrink-0"
            >
              Lesson
            </Link>
          )}
          <span className={`text-xs font-medium ${status.labelClass}`}>{status.label}</span>
        </div>
      </div>
      {status.sufficient && pct !== null && (
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
  }, []); // load is stable (defined in component scope, not changing)

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
            <NavMenu />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-safe-bottom">
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
            {/* Per-category sections */}
            {categories.map((cat) => {
              const avgPct = categoryAvgPct(cat);
              const hasUmbrellas = cat.umbrellas && cat.umbrellas.length > 0;
              const sortedUmbrellas = hasUmbrellas ? sortUmbrellas(cat.umbrellas!) : [];
              const kwStats = categoryKeywordStats(cat);
              const catStatus = categoryProgressStatus(kwStats.totalKeywords, kwStats.keywordsAttempted, kwStats.totalAttempts, avgPct);

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
                      <span className={`text-xs font-semibold ${catStatus.labelClass}`}>
                        {catStatus.label}
                      </span>
                    </div>
                    {catStatus.sufficient && avgPct !== null && (
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
                        .map((kw) => {
                          const kwPct = kw.score !== null ? Math.round(kw.score * 100) : null;
                          const kwStatus = keywordProgressStatus(kw.total_attempts, kwPct);
                          return (
                            <div key={kw.id} className="py-2.5">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-sm text-neutral-800 truncate">{kw.label}</span>
                                <span className={`text-xs font-medium ${kwStatus.labelClass}`}>{kwStatus.label}</span>
                              </div>
                              {kwStatus.sufficient && kwPct !== null && (
                                <ProgressBar
                                  value={kwPct}
                                  size="xs"
                                  color={scoreBarColor(kwPct)}
                                  label={kw.label}
                                />
                              )}
                            </div>
                          );
                        })}
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
