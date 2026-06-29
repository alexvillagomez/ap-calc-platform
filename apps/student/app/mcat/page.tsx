"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { NavMenu } from "@/components/nav/NavMenu";
import McatOnboarding from "@/components/mcat/McatOnboarding";
import { getOrCreateMcatSession } from "@/lib/mcatSession";
import { LoginGate } from "@/components/auth/LoginGate";
import CourseSearch from "@/components/search/CourseSearch";

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
  section: string;
  label: string;
  description: string;
  order_index: number;
  keywords: Keyword[];
}

// Section tabs. Biology, Psych/Soc, Chemistry, and Physics are all live.
type SectionKey = "biology" | "psych_soc" | "chemistry" | "physics";
const LIVE_SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "biology", label: "Biology" },
  { key: "psych_soc", label: "Psych/Soc" },
  { key: "chemistry", label: "Chemistry" },
  { key: "physics", label: "Physics" },
];
const SOON_SECTIONS: string[] = [];

function categoryMastery(keywords: Keyword[]): { pct: number; attempted: number } {
  const attempted = keywords.filter((k) => k.total_attempts > 0);
  if (attempted.length === 0) return { pct: 0, attempted: 0 };
  const avg =
    attempted.reduce((sum, k) => sum + (k.score ?? 0), 0) / attempted.length;
  return { pct: Math.round(avg * 100), attempted: attempted.length };
}

function masteryColor(pct: number): string {
  if (pct >= 80) return "text-success-500";
  if (pct >= 50) return "text-amber-600";
  return "text-error-500";
}

function masteryBarColor(pct: number): "brand" | "success" | "error" {
  if (pct >= 80) return "success";
  if (pct >= 50) return "brand";
  return "error";
}

function McatLandingPageInner() {
  const [sessionId, setSessionId] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>("biology");

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

  // "Continue vs Start" is SERVER-AUTHORITATIVE: a student has progress only if
  // their per-user keyword states (loaded for this session, never cached) show a
  // recorded attempt. This must NOT key off mere session existence — that made a
  // brand-new account in a browser with prior local state show "Continue".
  // Categories are filtered by the active section tab; the auto/cards/practice
  // links carry the section so those global modes scope to it (default biology).
  const visibleCategories = categories.filter(
    (c) => (c.section ?? "biology") === activeSection
  );
  const sectionQuery = activeSection === "biology" ? "" : `?section=${activeSection}`;

  const hasProgress = visibleCategories.some((c) =>
    c.keywords.some((k) => k.total_attempts > 0)
  );

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* First-visit quick onboarding */}
      <McatOnboarding />

      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Lodera home" className="shrink-0">
              <LoderaLogo size={28} withWordmark />
            </Link>
            <span className="text-neutral-300 text-sm">|</span>
            <h1 className="text-sm font-semibold text-neutral-800">MCAT Practice</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/mcat/progress"
              className="text-xs font-medium text-neutral-600 hover:text-brand-600 transition-colors px-2 py-1"
            >
              My Progress
            </Link>
            <StreakBadge />
            <NavMenu />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Topic search */}
        <section className="space-y-2 mb-8">
          <h3 className="text-sm font-semibold text-neutral-800">
            Search MCAT topics
          </h3>
          <CourseSearch system="mcat" />
        </section>

        {/* Section tabs */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {LIVE_SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={
                activeSection === s.key
                  ? "px-4 py-2 rounded-full bg-brand-500 text-white text-sm font-medium shadow-brand-sm"
                  : "px-4 py-2 rounded-full border border-neutral-200 text-sm text-neutral-600 hover:border-brand-300 hover:text-brand-600 transition-colors"
              }
            >
              {s.label}
            </button>
          ))}
          {SOON_SECTIONS.map((s) => (
            <span
              key={s}
              className="px-4 py-2 rounded-full border border-neutral-200 text-sm text-neutral-400 cursor-not-allowed flex items-center gap-1.5"
            >
              {s}
              <span className="text-xs bg-neutral-100 text-neutral-400 px-1.5 py-0.5 rounded-full">
                soon
              </span>
            </span>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="relative w-10 h-10">
              <div className="w-10 h-10 rounded-full border-4 border-brand-100" />
              <div className="absolute inset-0 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
            </div>
            <p className="text-sm text-neutral-500">Loading categories…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center">
            <p className="text-sm text-error-600 mb-3">{error}</p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setError(null);
                setLoading(true);
                fetch(`/api/mcat/taxonomy?session_id=${sessionId}`)
                  .then((r) => r.json())
                  .then((d: { categories: Category[] }) => setCategories(d.categories ?? []))
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setLoading(false));
              }}
            >
              Try again
            </Button>
          </div>
        )}

        {/* ─── Automatic mode hero — the primary, recommended way to learn ─── */}
        {!loading && !error && (
          <section className="mb-8">
            <Link href={`/mcat/auto${sectionQuery}`} className="group block">
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
                      Your guided path — we pick what to study next.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-brand-700 shadow-sm transition-transform group-hover:scale-[1.02] shrink-0">
                    {hasProgress ? "Continue" : "Start"}
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                      <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              </div>
            </Link>

            {/* Custom Practice — pick your own topics + content mix (flashcards /
                quizzes / lessons). Replaces the old flashcards-only mode. */}
            <Link href={`/mcat/practice${sectionQuery}`} className="group block mt-3">
              <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-violet-50 p-5 transition-all group-hover:shadow-brand-sm group-hover:border-brand-300">
                <div className="flex items-center gap-3">
                  <span className="text-2xl shrink-0">🎯</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-neutral-900">Custom Practice</p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Pick your topics and mix — flashcards, quizzes, and lessons.
                    </p>
                  </div>
                  <span className="shrink-0 text-brand-600 font-semibold text-sm inline-flex items-center gap-1">
                    Start
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
                      <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              </div>
            </Link>
          </section>
        )}

        {/* Category grid */}
        {!loading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visibleCategories.map((cat) => {
              const { pct, attempted } = categoryMastery(cat.keywords);
              return (
                <Card key={cat.id} hover noPadding>
                  <div className="p-5">
                    {/* Card body */}
                    <Link href={`/mcat/${cat.id}`} className="block group mb-4">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h2 className="font-semibold text-neutral-900 text-sm leading-snug group-hover:text-brand-600 transition-colors">
                          {cat.label}
                        </h2>
                      </div>
                      <p className="text-xs text-neutral-500 line-clamp-2 mb-3">
                        {cat.description}
                      </p>

                      {/* Mastery bar */}
                      <ProgressBar
                        value={pct}
                        size="sm"
                        color={masteryBarColor(pct)}
                        label={`${cat.label} mastery`}
                        className="mb-1"
                      />
                      <div className="flex items-center justify-between">
                        {attempted === 0 ? (
                          <span className="text-xs text-neutral-400">Not started</span>
                        ) : (
                          <span className={`text-xs font-medium ${masteryColor(pct)}`}>
                            {pct}% · {attempted}/{cat.keywords.length} keywords
                          </span>
                        )}
                        <span className="text-xs text-neutral-400">{cat.keywords.length} keywords</span>
                      </div>
                      <p className="text-xs text-brand-500 mt-2 font-medium group-hover:text-brand-600 transition-colors">
                        Explore topics →
                      </p>
                    </Link>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Link href={`/mcat/${cat.id}/practice`} className="flex-1">
                        <Button variant="primary" size="sm" className="w-full">Practice</Button>
                      </Link>
                      <Link href={`/mcat/${cat.id}/flashcards`} className="flex-1">
                        <Button variant="secondary" size="sm" className="w-full">Flashcards</Button>
                      </Link>
                      <Link href={`/mcat/${cat.id}/quiz`} className="flex-1">
                        <Button variant="secondary" size="sm" className="w-full">Quiz</Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}

            {visibleCategories.length === 0 && (
              <div className="col-span-2 text-center py-12 text-neutral-400 text-sm">
                No categories available yet.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function McatLandingPage() {
  return (
    <LoginGate prompt="Sign in to access MCAT Practice.">
      <McatLandingPageInner />
    </LoginGate>
  );
}
