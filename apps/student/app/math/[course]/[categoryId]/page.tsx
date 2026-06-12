"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/LoginGate";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { YieldBadge } from "@/components/ui/Badge";
import { getOrCreateMathSession } from "@/lib/mathSession";
import {
  MathCategory,
  MathUmbrella,
  MathInDepthChild,
  MathTaxonomyResponse,
  umbrellaDisplayScore,
  umbrellaAttempts,
  scoreColor,
  COURSE_LABELS,
} from "@/components/math/mathUiTypes";

// ─── Action buttons (practice-first, flashcards as text link) ────────────────

function ActionButtons({
  practiceHref,
  quizHref,
  lessonHref,
  flashcardsHref,
}: {
  practiceHref: string;
  quizHref: string;
  lessonHref?: string;
  flashcardsHref?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link
        href={practiceHref}
        className="px-2.5 py-1 rounded-lg bg-brand-500 text-white text-xs font-semibold hover:bg-brand-600 transition-colors"
      >
        Practice
      </Link>
      <Link
        href={quizHref}
        className="px-2.5 py-1 rounded-lg border border-neutral-200 text-xs font-medium hover:bg-neutral-50 transition-colors"
      >
        Quiz
      </Link>
      {lessonHref && (
        <Link
          href={lessonHref}
          className="px-2.5 py-1 rounded-lg border border-brand-200 text-brand-600 text-xs font-medium hover:bg-brand-50 transition-colors"
        >
          Lesson
        </Link>
      )}
      {flashcardsHref && (
        <Link
          href={flashcardsHref}
          className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2 ml-1"
        >
          Flashcards
        </Link>
      )}
    </div>
  );
}

// ─── In-depth child row ───────────────────────────────────────────────────────

function ChildRow({
  child,
  categoryId,
  course,
}: {
  child: MathInDepthChild;
  categoryId: string;
  course: string;
}) {
  const pct = child.score !== null ? Math.round(child.score * 100) : null;
  const enc = encodeURIComponent(child.label);

  return (
    <div className="py-2.5 border-t border-neutral-50 first:border-0">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
          <span className="text-sm text-neutral-700 leading-snug">
            {child.label}
          </span>
          {child.yield_score !== null && (
            <YieldBadge value={child.yield_score} />
          )}
          {child.state === "mastered" && (
            <span title="Mastered" className="text-success-500 text-xs shrink-0">
              ✓
            </span>
          )}
          {child.needs_lesson && (
            <span className="text-xs bg-brand-50 text-brand-600 border border-brand-100 px-1.5 py-0.5 rounded shrink-0">
              lesson recommended
            </span>
          )}
        </div>
        <div className="shrink-0 text-right">
          {pct !== null ? (
            <span className={`text-sm font-medium ${scoreColor(pct)}`}>
              {pct}%
            </span>
          ) : (
            <span className="text-xs text-neutral-400">Not started</span>
          )}
        </div>
      </div>

      {pct !== null && (
        <div className="mb-2">
          <ProgressBar value={pct} size="xs" label={child.label} />
        </div>
      )}

      {child.total_attempts > 0 && (
        <p className="text-xs text-neutral-400 mb-1.5">
          {child.total_attempts} attempt{child.total_attempts !== 1 ? "s" : ""}
        </p>
      )}

      <ActionButtons
        practiceHref={`/math/${course}/${categoryId}/practice?keyword=${child.id}&label=${enc}`}
        quizHref={`/math/${course}/${categoryId}/quiz?keyword=${child.id}&label=${enc}`}
        lessonHref={`/math/lesson/${child.id}?label=${enc}`}
        flashcardsHref={`/math/${course}/${categoryId}/flashcards?keyword=${child.id}&label=${enc}`}
      />
    </div>
  );
}

// ─── Umbrella row ─────────────────────────────────────────────────────────────

function UmbrellaRow({
  umbrella,
  categoryId,
  course,
}: {
  umbrella: MathUmbrella;
  categoryId: string;
  course: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const displayScore = umbrellaDisplayScore(umbrella);
  const attempts = umbrellaAttempts(umbrella);
  const hasChildren = umbrella.children.length > 0;
  const enc = encodeURIComponent(umbrella.label);

  return (
    <div>
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
                  <path
                    d="M4 2l4 4-4 4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-medium text-neutral-800 leading-snug">
                  {umbrella.label}
                </p>
                {umbrella.yield_score !== null && (
                  <YieldBadge value={umbrella.yield_score} />
                )}
              </span>
              {attempts > 0 && (
                <p className="text-xs text-neutral-400 mt-0.5">
                  {attempts} attempt{attempts !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            {umbrella.state === "mastered" && (
              <span title="Mastered" className="text-success-500 text-xs shrink-0">
                ✓
              </span>
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
            <ProgressBar value={displayScore} size="xs" label={umbrella.label} />
          </div>
        )}

        <ActionButtons
          practiceHref={`/math/${course}/${categoryId}/practice?umbrella=${umbrella.id}&label=${enc}`}
          quizHref={`/math/${course}/${categoryId}/quiz?umbrella=${umbrella.id}&label=${enc}`}
          lessonHref={`/math/lesson/${umbrella.id}?label=${enc}`}
          flashcardsHref={`/math/${course}/${categoryId}/flashcards?umbrella=${umbrella.id}&label=${enc}`}
        />
      </div>

      {hasChildren && expanded && (
        <div className="pl-5 border-l-2 border-brand-100 ml-2 mb-2">
          {umbrella.children.map((child) => (
            <ChildRow
              key={child.id}
              child={child}
              categoryId={categoryId}
              course={course}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function CategoryBrowseInner({
  params,
}: {
  params: Promise<{ course: string; categoryId: string }>;
}) {
  const { course, categoryId } = use(params);
  const courseLabel = COURSE_LABELS[course] ?? course;

  const [category, setCategory] = useState<MathCategory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const sid = await getOrCreateMathSession();
      const res = await fetch(
        `/api/math/taxonomy?session_id=${encodeURIComponent(sid)}&course=${encodeURIComponent(course)}`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as MathTaxonomyResponse;
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
  }, [categoryId, course]);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={`/math/${course}`}
              className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0"
            >
              ← {courseLabel}
            </Link>
            <h1 className="font-semibold text-neutral-900 text-sm truncate">
              {category?.label ?? "Category"}
            </h1>
          </div>
          <Link
            href={`/math/${course}/progress`}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs font-medium hover:bg-neutral-50 transition-colors shrink-0"
          >
            My Progress
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Loading topics…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center">
            <p className="text-sm text-error-600 mb-3">{error}</p>
            <button
              onClick={load}
              className="px-4 py-2 rounded-lg bg-error-600 text-white text-sm font-medium hover:bg-error-700"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && category && (
          <>
            {/* Whole-category action card */}
            <div className="rounded-xl border border-neutral-200 bg-white shadow-brand-xs p-4">
              <div className="mb-1">
                <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                  Whole Category
                </span>
              </div>
              <h2 className="font-semibold text-neutral-900 text-sm mb-1">
                {category.label}
              </h2>
              {category.description && (
                <p className="text-xs text-neutral-500 line-clamp-2 mb-3">
                  {category.description}
                </p>
              )}
              {category.yield_score !== null && (
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs text-neutral-400">
                    Category yield:
                  </span>
                  <YieldBadge value={category.yield_score} />
                </div>
              )}
              <div className="flex gap-2">
                <Link
                  href={`/math/${course}/${categoryId}/practice`}
                  className="flex-1 text-center py-2 rounded-xl bg-brand-500 text-white text-xs font-semibold hover:bg-brand-600 transition-colors"
                >
                  Practice
                </Link>
                <Link
                  href={`/math/${course}/${categoryId}/quiz`}
                  className="flex-1 text-center py-2 rounded-xl border border-neutral-200 text-xs font-medium hover:bg-neutral-50 transition-colors"
                >
                  Quiz
                </Link>
              </div>
            </div>

            {/* Umbrella list */}
            {category.umbrellas.length > 0 ? (
              <div className="rounded-xl border border-neutral-200 bg-white shadow-brand-xs overflow-hidden">
                <div className="px-4 pt-3 pb-1 border-b border-neutral-100">
                  <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                    Topics ({category.umbrellas.length})
                  </p>
                </div>
                <div className="px-4 divide-y divide-neutral-100">
                  {category.umbrellas.map((u) => (
                    <UmbrellaRow
                      key={u.id}
                      umbrella={u}
                      categoryId={categoryId}
                      course={course}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-neutral-400 text-sm">
                Content is being seeded — check back shortly.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function CategoryBrowsePage({
  params,
}: {
  params: Promise<{ course: string; categoryId: string }>;
}) {
  return (
    <LoginGate prompt="Sign in to access Math Center.">
      <CategoryBrowseInner params={params} />
    </LoginGate>
  );
}
