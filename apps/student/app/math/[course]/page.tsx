"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/LoginGate";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { YieldBadge } from "@/components/ui/Badge";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { NavMenu } from "@/components/nav/NavMenu";
import { getOrCreateMathSession, setLastMathCourse } from "@/lib/mathSession";
import {
  MathCategory,
  MathTaxonomyResponse,
  categoryMasteryPct,
  COURSE_LABELS,
  SECTION_LABELS,
} from "@/components/math/mathUiTypes";
import CourseSearch from "@/components/search/CourseSearch";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupBySection(cats: MathCategory[]): Array<{
  section: string;
  label: string;
  categories: MathCategory[];
}> {
  const map = new Map<string, MathCategory[]>();
  for (const cat of cats) {
    if (!map.has(cat.section)) map.set(cat.section, []);
    map.get(cat.section)!.push(cat);
  }
  return Array.from(map.entries()).map(([section, categories]) => ({
    section,
    label: SECTION_LABELS[section] ?? section,
    categories,
  }));
}

// ─── Category Card ────────────────────────────────────────────────────────────

function CategoryCard({
  cat,
  course,
  collapsed,
}: {
  cat: MathCategory;
  course: string;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  const pct = categoryMasteryPct(cat);
  const keywordCount = cat.umbrellas.reduce(
    (s, u) => s + (u.children.length > 0 ? u.children.length : 1),
    0
  );

  // Math hides yield entirely (no decimals, no badges) for every course.
  const showYield = false;

  if (collapsed && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left rounded-xl border border-neutral-200 bg-white shadow-brand-xs px-4 py-3 flex items-center justify-between hover:border-brand-200 hover:bg-brand-50 transition-all"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-neutral-700 truncate">
            {cat.label}
          </span>
          {showYield && cat.yield_score !== null && (
            <YieldBadge value={cat.yield_score} />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pct !== null ? (
            <span className="text-xs text-neutral-500">{pct}%</span>
          ) : (
            <span className="text-xs text-neutral-400">not started</span>
          )}
          <svg
            className="w-3.5 h-3.5 text-neutral-400"
            fill="none"
            viewBox="0 0 12 12"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>
    );
  }

  return (
    <Card hover className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <Link
              href={`/math/${course}/${cat.id}`}
              className="text-sm font-semibold text-neutral-900 hover:text-brand-600 transition-colors"
            >
              {cat.label}
            </Link>
            {showYield && cat.yield_score !== null && (
              <YieldBadge value={cat.yield_score} />
            )}
            {cat.role === "foundation" && (
              <span className="text-xs bg-neutral-100 text-neutral-500 rounded-full px-2 py-0.5">
                Foundation
              </span>
            )}
          </div>
          {cat.description && (
            <p className="text-xs text-neutral-500 line-clamp-2">
              {cat.description}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          {pct !== null ? (
            <span
              className={`text-sm font-medium ${
                pct >= 80
                  ? "text-success-700"
                  : pct >= 50
                  ? "text-amber-700"
                  : "text-error-600"
              }`}
            >
              {pct}%
            </span>
          ) : (
            <span className="text-xs text-neutral-400">Not started</span>
          )}
        </div>
      </div>

      {/* Mastery bar */}
      <ProgressBar
        value={pct ?? 0}
        size="sm"
        color={pct !== null && pct >= 80 ? "success" : "brand"}
        label={`${cat.label} mastery`}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400">{keywordCount} keywords</span>
        {cat.umbrellas.length > 0 && (
          <Link
            href={`/math/${course}/${cat.id}`}
            className="text-xs text-brand-500 hover:text-brand-700"
          >
            Browse topics
          </Link>
        )}
      </div>

      {/* Action buttons — practice-first, no flashcards */}
      <div className="flex gap-2 pt-1">
        <Link
          href={`/math/${course}/${cat.id}/practice`}
          className="flex-1 text-center py-2 rounded-xl bg-brand-500 text-white text-xs font-semibold hover:bg-brand-600 transition-colors"
        >
          Practice
        </Link>
        <Link
          href={`/math/${course}/${cat.id}/quiz`}
          className="flex-1 text-center py-2 rounded-xl border border-neutral-200 text-xs font-medium hover:bg-neutral-50 transition-colors"
        >
          Quiz
        </Link>
        <Link
          href={`/math/${course}/${cat.id}`}
          className="flex-1 text-center py-2 rounded-xl border border-neutral-200 text-xs font-medium hover:bg-neutral-50 transition-colors"
        >
          Browse
        </Link>
      </div>

      {/* Collapse button for foundation sections */}
      {collapsed && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2"
        >
          Collapse
        </button>
      )}
    </Card>
  );
}

// ─── Section group ────────────────────────────────────────────────────────────

function SectionGroup({
  section,
  label,
  categories,
  course,
  defaultCollapsed,
}: {
  section: string;
  label: string;
  categories: MathCategory[];
  course: string;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 uppercase tracking-wide">
          {label}
        </h2>
        {defaultCollapsed !== undefined && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-xs text-neutral-400 hover:text-neutral-600"
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {categories.map((cat) => (
            <CategoryCard
              key={cat.id}
              cat={cat}
              course={course}
              collapsed={section === "foundations" && defaultCollapsed}
            />
          ))}
        </div>
      )}

      {collapsed && (
        <p className="text-xs text-neutral-400 italic">
          {categories.length} categor{categories.length !== 1 ? "ies" : "y"} hidden —
          click Show to expand.
        </p>
      )}
    </div>
  );
}

// ─── Main inner component ─────────────────────────────────────────────────────

function MathCourseLandingInner({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = use(params);

  const [categories, setCategories] = useState<MathCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const courseLabel = COURSE_LABELS[course] ?? course;
  const isCalcAb = course === "calc_ab";

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
      setCategories(data.categories ?? []);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course]);

  const sections = groupBySection(categories);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <LoderaLogo size={22} />
            <Link
              href="/math"
              className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0"
            >
              ← Math
            </Link>
            <h1 className="font-semibold text-neutral-900 text-sm truncate">
              {courseLabel}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/math/${course}/progress`}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs font-medium hover:bg-neutral-50 transition-colors"
            >
              My Progress
            </Link>
            <StreakBadge />
            <NavMenu />
          </div>
        </div>

      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        {/* ─── Automatic mode hero — the primary, recommended way to learn ─── */}
        <section>
          <Link href={`/math/${course}/auto`} className="group block">
            <div className="relative overflow-hidden rounded-2xl border border-brand-300 bg-gradient-to-br from-brand-500 to-brand-700 p-5 shadow-brand-md transition-all group-hover:shadow-brand-lg group-hover:border-brand-400">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-700 bg-white rounded-full px-2 py-0.5">
                    ★ Recommended
                  </span>
                  <h2 className="text-xl font-bold text-white leading-tight mt-2">
                    Automatic Mode
                  </h2>
                  <p className="text-sm text-brand-50/80 mt-1">
                    Your guided path through {courseLabel} — we pick what&apos;s next.
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-brand-700 shadow-sm transition-transform group-hover:scale-[1.02] shrink-0">
                  Start
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                    <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            </div>
          </Link>

          {/* Flashcards-only mode — Anki-style spaced repetition, alongside auto. */}
          <Link href={`/math/${course}/cards`} className="group block mt-3">
            <div className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-5 transition-all group-hover:shadow-brand-sm group-hover:border-orange-300">
              <div className="flex items-center gap-3">
                <span className="text-2xl shrink-0">🔥</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-neutral-900">Flashcards</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Memorize the whole course.
                  </p>
                </div>
                <span className="shrink-0 text-orange-600 font-semibold text-sm inline-flex items-center gap-1">
                  Start
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                    <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            </div>
          </Link>

          {/* Secondary modes — kept available, visually subordinate */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 px-1">
            <span className="text-xs text-neutral-400">Prefer to choose your own path?</span>
            <Link
              href={`/math/${course}/diagnostic`}
              className="text-xs font-medium text-neutral-500 hover:text-brand-600 underline underline-offset-2 transition-colors"
            >
              Take placement diagnostic
            </Link>
            <Link
              href={`/math/${course}/practice`}
              className="text-xs font-medium text-neutral-500 hover:text-brand-600 underline underline-offset-2 transition-colors"
            >
              General practice
            </Link>
          </div>

          {/* Backtrack into Precalc — only on the calc course, to shore up prerequisites */}
          {isCalcAb && (
            <Link
              href="/math/precalc/auto"
              onClick={() => setLastMathCourse("precalc")}
              className="group mt-3 flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-brand-200 hover:bg-brand-50 transition-all"
            >
              <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center shrink-0 text-brand-600">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                  <path d="M10 13L5 8l5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-neutral-800">
                  New to calculus, or shaky on the basics?
                </p>
                <p className="text-xs text-neutral-500">
                  Back up into the guided <span className="font-medium text-brand-600">Precalculus</span> path
                  to shore up prerequisites — your calc progress is saved and waiting.
                </p>
              </div>
              <span className="text-xs font-medium text-brand-600 group-hover:text-brand-700 shrink-0 whitespace-nowrap">
                Go to Precalc →
              </span>
            </Link>
          )}
        </section>

        {/* Topic search */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-neutral-800">
            Search {courseLabel} topics
          </h3>
          <CourseSearch system="math" course={course} />
        </section>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Loading {courseLabel}…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <Card className="text-center space-y-3">
            <p className="text-sm text-error-600">{error}</p>
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          </Card>
        )}

        {/* Empty */}
        {!loading && !error && categories.length === 0 && (
          <Card className="text-center py-10">
            <p className="text-sm text-neutral-500">
              Content is being seeded — check back shortly.
            </p>
          </Card>
        )}

        {/* Section-grouped category grid */}
        {!loading && !error && categories.length > 0 && (
          <>
            {sections.map(({ section, label, categories: cats }) => (
              <SectionGroup
                key={section}
                section={section}
                label={label}
                categories={cats}
                course={course}
                defaultCollapsed={
                  isCalcAb && (section === "foundations" || section === "ap_precalc")
                    ? true
                    : undefined
                }
              />
            ))}
          </>
        )}

        {/* Spacer */}
        <div className="h-8" />
      </main>
    </div>
  );
}

export default function MathCourseLandingPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  return (
    <LoginGate prompt="Sign in to access Math Center.">
      <MathCourseLandingInner params={params} />
    </LoginGate>
  );
}
