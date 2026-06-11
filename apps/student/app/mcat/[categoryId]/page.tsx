"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ScoreBar } from "@/components/mcat/ScoreBar";
import { YieldBadge } from "@/components/mcat/YieldBadge";
import AuthButtons from "@/components/mcat/AuthButtons";
import { getOrCreateMcatSession } from "@/lib/mcatSession";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface Category {
  id: string;
  label: string;
  description: string;
  order_index: number;
  umbrellas?: Umbrella[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  return pct >= 80 ? "text-green-700" : pct >= 50 ? "text-yellow-700" : "text-red-600";
}

// ── Small action button group ─────────────────────────────────────────────────

interface ActionButtonsProps {
  practiceHref: string;
  flashcardsHref: string;
  quizHref: string;
  lessonHref?: string;
}

function ActionButtons({ practiceHref, flashcardsHref, quizHref, lessonHref }: ActionButtonsProps) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      <Link
        href={practiceHref}
        className="px-2.5 py-1 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700 transition-colors"
      >
        Practice
      </Link>
      <Link
        href={flashcardsHref}
        className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50 transition-colors"
      >
        Cards
      </Link>
      <Link
        href={quizHref}
        className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50 transition-colors"
      >
        Quiz
      </Link>
      {lessonHref && (
        <Link
          href={lessonHref}
          className="px-2.5 py-1 rounded-lg border border-blue-200 text-blue-600 text-xs font-medium hover:bg-blue-50 transition-colors"
        >
          Lesson
        </Link>
      )}
    </div>
  );
}

// ── Umbrella row ──────────────────────────────────────────────────────────────

function UmbrellaRow({
  umbrella,
  categoryId,
}: {
  umbrella: Umbrella;
  categoryId: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const displayScore = umbrellaDisplayScore(umbrella);
  const attempts = umbrellaAttempts(umbrella);
  const hasChildren = umbrella.children.length > 0;
  const sorted = hasChildren ? sortChildren(umbrella.children) : [];

  const encLabel = encodeURIComponent(umbrella.label);

  return (
    <div>
      {/* Umbrella header */}
      <div className="py-3">
        <div className="flex items-start justify-between gap-2 mb-1.5">
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
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-medium text-gray-800 leading-snug">{umbrella.label}</p>
                <YieldBadge level={umbrella.yield_level} />
              </span>
              {attempts > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">{attempts} attempt{attempts !== 1 ? "s" : ""}</p>
              )}
            </div>
            {umbrella.state === "mastered" && (
              <span title="Mastered" className="text-green-500 text-xs shrink-0">✓</span>
            )}
          </div>
          <div className="shrink-0 text-right">
            {displayScore !== null ? (
              <span className={`text-sm font-medium ${scoreColor(displayScore)}`}>
                {displayScore}%
              </span>
            ) : (
              <span className="text-xs text-gray-400">Not started</span>
            )}
          </div>
        </div>

        {displayScore !== null && (
          <div className="mb-2">
            <ScoreBar pct={displayScore} />
          </div>
        )}

        <ActionButtons
          practiceHref={`/mcat/${categoryId}/practice?umbrella=${umbrella.id}&label=${encLabel}`}
          flashcardsHref={`/mcat/${categoryId}/flashcards?umbrella=${umbrella.id}&label=${encLabel}`}
          quizHref={`/mcat/${categoryId}/quiz?umbrella=${umbrella.id}&label=${encLabel}`}
          lessonHref={`/mcat/lesson/${umbrella.id}?label=${encLabel}`}
        />
      </div>

      {/* Children — shown when expanded */}
      {hasChildren && expanded && (
        <div className="pl-5 border-l-2 border-blue-100 ml-2 mb-2 space-y-0">
          {sorted.map((child) => (
            <ChildRow key={child.id} child={child} categoryId={categoryId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Child row ─────────────────────────────────────────────────────────────────

function ChildRow({
  child,
  categoryId,
}: {
  child: InDepthChild;
  categoryId: string;
}) {
  const pct = child.score !== null ? Math.round(child.score * 100) : null;
  const encLabel = encodeURIComponent(child.label);

  return (
    <div className="py-2.5 border-t border-gray-50 first:border-0">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-sm text-gray-700 leading-snug truncate">{child.label}</span>
          <YieldBadge level={child.yield_level} />
          {child.state === "mastered" && (
            <span title="Mastered" className="text-green-500 text-xs shrink-0">✓</span>
          )}
          {child.needs_lesson && (
            <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded shrink-0">
              lesson recommended
            </span>
          )}
        </div>
        <div className="shrink-0 text-right">
          {pct !== null ? (
            <span className={`text-sm font-medium ${scoreColor(pct)}`}>{pct}%</span>
          ) : (
            <span className="text-xs text-gray-400">Not started</span>
          )}
        </div>
      </div>

      {pct !== null && (
        <div className="mb-2">
          <ScoreBar pct={pct} />
        </div>
      )}

      {child.total_attempts > 0 && (
        <p className="text-xs text-gray-400 mb-1.5">
          {child.total_attempts} attempt{child.total_attempts !== 1 ? "s" : ""}
        </p>
      )}

      <ActionButtons
        practiceHref={`/mcat/${categoryId}/practice?keyword=${child.id}&label=${encLabel}`}
        flashcardsHref={`/mcat/${categoryId}/flashcards?keyword=${child.id}&label=${encLabel}`}
        quizHref={`/mcat/${categoryId}/quiz?keyword=${child.id}&label=${encLabel}`}
        lessonHref={`/mcat/lesson/${child.id}?label=${encLabel}`}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CategoryBrowsePage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = use(params);

  const [category, setCategory] = useState<Category | null>(null);
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
      const found = (data.categories ?? []).find((c) => c.id === categoryId);
      if (!found) throw new Error("Category not found");
      setCategory(found);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load category");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const sortedUmbrellas =
    category?.umbrellas && category.umbrellas.length > 0
      ? sortUmbrellas(category.umbrellas)
      : [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/mcat"
              className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
            >
              ← MCAT
            </Link>
            <h1 className="font-semibold text-gray-900 text-sm truncate">
              {category?.label ?? "Category"}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/mcat/progress"
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50 transition-colors"
            >
              My Progress
            </Link>
            <AuthButtons />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Loading topics…</p>
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

        {!loading && !error && category && (
          <>
            {/* Whole-category action card */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
              <div className="mb-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Whole Category
                </span>
              </div>
              <h2 className="font-semibold text-gray-900 text-sm mb-1">
                {category.label}
              </h2>
              {category.description && (
                <p className="text-xs text-gray-500 line-clamp-2 mb-3">
                  {category.description}
                </p>
              )}
              <div className="flex gap-2">
                <Link
                  href={`/mcat/${categoryId}/practice`}
                  className="flex-1 text-center py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-700 transition-colors"
                >
                  Practice
                </Link>
                <Link
                  href={`/mcat/${categoryId}/flashcards`}
                  className="flex-1 text-center py-2 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50 transition-colors"
                >
                  Flashcards
                </Link>
                <Link
                  href={`/mcat/${categoryId}/quiz`}
                  className="flex-1 text-center py-2 rounded-lg border border-gray-200 text-xs font-medium hover:bg-gray-50 transition-colors"
                >
                  Quiz
                </Link>
              </div>
            </div>

            {/* Umbrella list */}
            {sortedUmbrellas.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 pt-3 pb-1 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Topics ({sortedUmbrellas.length})
                  </p>
                </div>
                <div className="px-4 divide-y divide-gray-100">
                  {sortedUmbrellas.map((u) => (
                    <UmbrellaRow
                      key={u.id}
                      umbrella={u}
                      categoryId={categoryId}
                    />
                  ))}
                </div>
              </div>
            )}

            {sortedUmbrellas.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">
                No topics available yet.
              </div>
            )}
          </>
        )}
      </main>

    </div>
  );
}
