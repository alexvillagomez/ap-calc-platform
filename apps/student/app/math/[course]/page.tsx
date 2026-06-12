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
import { SoundToggle } from "@/components/ui/SoundToggle";
import { getOrCreateMathSession } from "@/lib/mathSession";
import {
  MathCategory,
  MathTaxonomyResponse,
  categoryMasteryPct,
  COURSE_LABELS,
  SECTION_LABELS,
} from "@/components/math/mathUiTypes";

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
          {cat.yield_score !== null && (
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
            {cat.yield_score !== null && (
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
          className="flex-1 text-center py-2 rounded-xl bg-neutral-900 text-white text-xs font-semibold hover:bg-neutral-700 transition-colors"
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
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/math"
              className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0"
            >
              ← Math
            </Link>
            <LoderaLogo size={22} />
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
            <SoundToggle />
          </div>
        </div>

        {/* Top action row */}
        <div className="max-w-4xl mx-auto px-4 pb-3 flex flex-wrap gap-2">
          <Link href={`/math/${course}/auto`}>
            <Button variant="primary" size="sm">
              Continue
            </Button>
          </Link>
          <Link href={`/math/${course}/diagnostic`}>
            <Button variant="secondary" size="sm">
              Take placement diagnostic
            </Button>
          </Link>
          <Link href={`/math/${course}/practice`}>
            <Button variant="ghost" size="sm">
              General Practice
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-8">
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
