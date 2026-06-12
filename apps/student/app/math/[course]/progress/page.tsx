"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/LoginGate";
import { YieldBadge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { getOrCreateMathSession } from "@/lib/mathSession";
import {
  MathCategory,
  MathTaxonomyResponse,
  MathUmbrella,
  MathInDepthChild,
  umbrellaDisplayScore,
  umbrellaAttempts,
  scoreColor,
  COURSE_LABELS,
  SECTION_LABELS,
} from "@/components/math/mathUiTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortUmbrellas(umbrellas: MathUmbrella[]): MathUmbrella[] {
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

function sortChildren(children: MathInDepthChild[]): MathInDepthChild[] {
  return [...children].sort((a, b) => {
    const aAtt = a.total_attempts > 0;
    const bAtt = b.total_attempts > 0;
    if (!aAtt && !bAtt) return 0;
    if (aAtt && !bAtt) return -1;
    if (!aAtt && bAtt) return 1;
    return (a.score ?? 1) - (b.score ?? 1);
  });
}

function categoryAvgPct(cat: MathCategory): number | null {
  const scores = cat.umbrellas
    .map((u) => umbrellaDisplayScore(u))
    .filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

interface OverallStats {
  totalKeywords: number;
  practicedKeywords: number;
  totalAttempts: number;
  totalCorrect: number;
}

function computeOverallStats(categories: MathCategory[]): OverallStats {
  let totalKeywords = 0, practicedKeywords = 0, totalAttempts = 0, totalCorrect = 0;
  for (const cat of categories) {
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
  }
  return { totalKeywords, practicedKeywords, totalAttempts, totalCorrect };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChildRow({ child }: { child: MathInDepthChild }) {
  const pct = child.score !== null ? Math.round(child.score * 100) : null;
  return (
    <div className="py-2.5 border-t border-neutral-50 first:border-0">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-sm text-neutral-700 truncate">{child.label}</span>
          {child.yield_score !== null && (
            <YieldBadge value={child.yield_score} />
          )}
          {child.state === "mastered" && (
            <span title="Mastered" className="text-success-500 text-xs shrink-0">✓</span>
          )}
          {child.dont_know_count > 0 && (
            <span className="text-xs bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded shrink-0">
              didn&apos;t know ×{child.dont_know_count}
            </span>
          )}
        </div>
        {pct !== null ? (
          <span className={`text-sm font-medium shrink-0 ${scoreColor(pct)}`}>{pct}%</span>
        ) : (
          <span className="text-xs text-neutral-400 shrink-0">Not started</span>
        )}
      </div>
      {pct !== null && <ProgressBar value={pct} size="xs" color={pct >= 80 ? "success" : "brand"} />}
    </div>
  );
}

function UmbrellaRow({
  umbrella,
  defaultExpanded = false,
}: {
  umbrella: MathUmbrella;
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
            <span className="text-sm font-medium text-neutral-800 truncate">{umbrella.label}</span>
            {umbrella.yield_score !== null && <YieldBadge value={umbrella.yield_score} />}
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
            color={displayScore >= 80 ? "success" : "brand"}
          />
        )}
      </div>

      {hasChildren && expanded && (
        <div className="pl-5 border-l-2 border-brand-100 ml-2 mb-2">
          {sorted.map((child) => (
            <ChildRow key={child.id} child={child} />
          ))}
        </div>
      )}
    </div>
  );
}

function CategorySection({
  cat,
  course,
}: {
  cat: MathCategory;
  course: string;
}) {
  const [open, setOpen] = useState(true);
  const avg = categoryAvgPct(cat);
  const sorted = sortUmbrellas(cat.umbrellas);

  return (
    <div className="bg-white rounded-xl border border-neutral-200 shadow-brand-xs overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-neutral-50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg
            className={`w-3.5 h-3.5 text-neutral-400 transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 12 12"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-semibold text-neutral-900 truncate text-left">
            {cat.label}
          </span>
          {cat.yield_score !== null && <YieldBadge value={cat.yield_score} />}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {avg !== null ? (
            <span className={`text-sm font-medium ${scoreColor(avg)}`}>{avg}%</span>
          ) : (
            <span className="text-xs text-neutral-400">Not started</span>
          )}
          <Link
            href={`/math/${course}/${cat.id}/practice`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 font-medium hover:bg-brand-100 transition-colors"
          >
            Practice
          </Link>
        </div>
      </button>

      {/* Umbrella list */}
      {open && cat.umbrellas.length > 0 && (
        <div className="border-t border-neutral-100 px-5 divide-y divide-neutral-50">
          {sorted.map((u, i) => (
            <UmbrellaRow
              key={u.id}
              umbrella={u}
              defaultExpanded={i === 0 && umbrellaAttempts(u) > 0}
            />
          ))}
        </div>
      )}

      {open && cat.umbrellas.length === 0 && (
        <p className="px-5 pb-4 text-xs text-neutral-400">No topics yet.</p>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function MathProgressInner({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = use(params);
  const courseLabel = COURSE_LABELS[course] ?? course;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<MathCategory[]>([]);
  const [sectionFilter, setSectionFilter] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const sid = await getOrCreateMathSession();
      const r = await fetch(
        `/api/math/taxonomy?session_id=${encodeURIComponent(sid)}&course=${encodeURIComponent(course)}`
      );
      if (!r.ok) throw new Error(await r.text().catch(() => "Unknown error"));
      const d = (await r.json()) as MathTaxonomyResponse;
      setCategories(d.categories ?? []);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load progress");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course]);

  const stats = computeOverallStats(categories);
  const overallPct =
    stats.totalAttempts > 0
      ? Math.round((stats.totalCorrect / stats.totalAttempts) * 100)
      : null;

  // Section filter
  const sections = [...new Set(categories.map((c) => c.section))];
  const visibleCats =
    sectionFilter !== null
      ? categories.filter((c) => c.section === sectionFilter)
      : categories;

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href={`/math/${course}`} className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0">
              ← {courseLabel}
            </Link>
            <h1 className="font-semibold text-neutral-900 text-sm truncate">
              My Progress
            </h1>
          </div>
          <div className="shrink-0">
            <Link href={`/math/${course}/practice`}>
              <span className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-semibold hover:bg-neutral-700 transition-colors">
                Practice now
              </span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Loading your progress…</p>
          </div>
        )}

        {!loading && error && (
          <div className="bg-white rounded-xl border border-error-200 p-6 text-center space-y-3">
            <p className="text-sm text-error-600">{error}</p>
            <button
              onClick={load}
              className="px-4 py-2 rounded-lg bg-error-600 text-white text-sm font-medium hover:bg-error-700 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Overall stats card */}
            <div className="bg-white rounded-xl border border-neutral-200 shadow-brand-xs p-5">
              <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-4">
                Overview — {courseLabel}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-2xl font-bold text-neutral-900">
                    {stats.practicedKeywords}
                    <span className="text-sm text-neutral-400 font-normal">
                      /{stats.totalKeywords}
                    </span>
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">Keywords practiced</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-neutral-900">{stats.totalAttempts}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Questions answered</p>
                </div>
                <div>
                  <p className={`text-2xl font-bold ${overallPct !== null ? scoreColor(overallPct) : "text-neutral-900"}`}>
                    {overallPct !== null ? `${overallPct}%` : "—"}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">Overall accuracy</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-neutral-900">{stats.totalCorrect}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Correct answers</p>
                </div>
              </div>
              {overallPct !== null && (
                <div className="mt-4">
                  <ProgressBar
                    value={overallPct}
                    size="sm"
                    color={overallPct >= 80 ? "success" : "brand"}
                  />
                </div>
              )}
            </div>

            {/* Section filter tabs */}
            {sections.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setSectionFilter(null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    sectionFilter === null
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  All sections
                </button>
                {sections.map((sec) => (
                  <button
                    key={sec}
                    onClick={() => setSectionFilter(sec)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                      sectionFilter === sec
                        ? "bg-neutral-900 text-white border-neutral-900"
                        : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
                    }`}
                  >
                    {SECTION_LABELS[sec] ?? sec}
                  </button>
                ))}
              </div>
            )}

            {/* Category sections */}
            {visibleCats.length === 0 ? (
              <div className="bg-white rounded-xl border border-neutral-200 shadow-brand-xs p-8 text-center">
                <p className="text-sm text-neutral-500">
                  No categories found. Content may still be loading.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleCats.map((cat) => (
                  <CategorySection key={cat.id} cat={cat} course={course} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function MathProgressPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  return (
    <LoginGate prompt="Sign in to view your math progress.">
      <MathProgressInner params={params} />
    </LoginGate>
  );
}
