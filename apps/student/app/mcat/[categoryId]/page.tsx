"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { YieldBadge } from "@/components/mcat/YieldBadge";
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
  return pct >= 80 ? "text-success-500" : pct >= 50 ? "text-amber-600" : "text-error-500";
}

function scoreBarColor(pct: number): "brand" | "success" | "error" {
  if (pct >= 80) return "success";
  if (pct >= 50) return "brand";
  return "error";
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
      <Link href={practiceHref}>
        <Button variant="primary" size="sm">Practice</Button>
      </Link>
      <Link href={flashcardsHref}>
        <Button variant="secondary" size="sm">Cards</Button>
      </Link>
      <Link href={quizHref}>
        <Button variant="secondary" size="sm">Quiz</Button>
      </Link>
      {lessonHref && (
        <Link href={lessonHref}>
          <Button variant="ghost" size="sm">Lesson</Button>
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
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-medium text-neutral-800 leading-snug">{umbrella.label}</p>
                <YieldBadge level={umbrella.yield_level} />
              </span>
              {attempts > 0 && (
                <p className="text-xs text-neutral-400 mt-0.5">{attempts} attempt{attempts !== 1 ? "s" : ""}</p>
              )}
            </div>
            {umbrella.state === "mastered" && (
              <span title="Mastered" className="text-success-500 text-xs shrink-0">✓</span>
            )}
          </div>
          <div className="shrink-0 text-right">
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
          <div className="mb-2">
            <ProgressBar value={displayScore} size="xs" color={scoreBarColor(displayScore)} label={umbrella.label} />
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
        <div className="pl-5 border-l-2 border-brand-100 ml-2 mb-2 space-y-0">
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
    <div className="py-2.5 border-t border-neutral-50 first:border-0">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-sm text-neutral-700 leading-snug truncate">{child.label}</span>
          <YieldBadge level={child.yield_level} />
          {child.state === "mastered" && (
            <span title="Mastered" className="text-success-500 text-xs shrink-0">✓</span>
          )}
          {child.needs_lesson && (
            <span className="text-xs bg-brand-50 text-brand-600 border border-brand-100 px-1.5 py-0.5 rounded shrink-0">
              lesson recommended
            </span>
          )}
        </div>
        <div className="shrink-0 text-right">
          {pct !== null ? (
            <span className={`text-sm font-medium ${scoreColor(pct)}`}>{pct}%</span>
          ) : (
            <span className="text-xs text-neutral-400">Not started</span>
          )}
        </div>
      </div>

      {pct !== null && (
        <div className="mb-2">
          <ProgressBar value={pct} size="xs" color={scoreBarColor(pct)} label={child.label} />
        </div>
      )}

      {child.total_attempts > 0 && (
        <p className="text-xs text-neutral-400 mb-1.5">
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
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/mcat" className="shrink-0">
              <LoderaLogo size={24} />
            </Link>
            <span className="text-neutral-300 text-sm shrink-0">|</span>
            <Link
              href="/mcat"
              className="text-xs text-neutral-400 hover:text-brand-600 shrink-0 transition-colors"
            >
              MCAT
            </Link>
            <span className="text-neutral-300 text-sm shrink-0">/</span>
            <h1 className="font-semibold text-neutral-900 text-sm truncate">
              {category?.label ?? "Category"}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/mcat/progress"
              className="text-xs font-medium text-neutral-600 hover:text-brand-600 transition-colors px-2 py-1"
            >
              Progress
            </Link>
            <StreakBadge />
            <SoundToggle />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="relative w-10 h-10">
              <div className="w-10 h-10 rounded-full border-4 border-brand-100" />
              <div className="absolute inset-0 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
            </div>
            <p className="text-sm text-neutral-500">Loading topics…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center">
            <p className="text-sm text-error-600 mb-3">{error}</p>
            <Button variant="primary" size="sm" onClick={load}>Try again</Button>
          </div>
        )}

        {!loading && !error && category && (
          <>
            {/* Whole-category action card */}
            <Card>
              <div className="mb-1">
                <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                  Whole Category
                </span>
              </div>
              <h2 className="font-semibold text-neutral-900 text-sm mb-1">
                {category.label}
              </h2>
              {category.description && (
                <p className="text-xs text-neutral-500 line-clamp-2 mb-4">
                  {category.description}
                </p>
              )}
              <div className="flex gap-2">
                <Link href={`/mcat/${categoryId}/practice`} className="flex-1">
                  <Button variant="primary" size="sm" className="w-full">Practice</Button>
                </Link>
                <Link href={`/mcat/${categoryId}/flashcards`} className="flex-1">
                  <Button variant="secondary" size="sm" className="w-full">Flashcards</Button>
                </Link>
                <Link href={`/mcat/${categoryId}/quiz`} className="flex-1">
                  <Button variant="secondary" size="sm" className="w-full">Quiz</Button>
                </Link>
              </div>
            </Card>

            {/* Umbrella list */}
            {sortedUmbrellas.length > 0 && (
              <Card noPadding>
                <div className="px-4 pt-3 pb-1 border-b border-neutral-100">
                  <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                    Topics ({sortedUmbrellas.length})
                  </p>
                </div>
                <div className="px-4 divide-y divide-neutral-100">
                  {sortedUmbrellas.map((u) => (
                    <UmbrellaRow
                      key={u.id}
                      umbrella={u}
                      categoryId={categoryId}
                    />
                  ))}
                </div>
              </Card>
            )}

            {sortedUmbrellas.length === 0 && (
              <div className="text-center py-12 text-neutral-400 text-sm">
                No topics available yet.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
