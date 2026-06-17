"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { SoundToggle } from "@/components/ui/SoundToggle";
import AuthButtons from "@/components/mcat/AuthButtons";
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
  label: string;
  description: string;
  order_index: number;
  keywords: Keyword[];
}

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

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* First-visit quick onboarding */}
      <McatOnboarding />

      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LoderaLogo size={28} withWordmark />
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
            <SoundToggle />
            <AuthButtons />
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
          <span className="px-4 py-2 rounded-full bg-brand-500 text-white text-sm font-medium shadow-brand-sm">
            Biology
          </span>
          {["Chemistry", "Physics", "Psych/Soc"].map((s) => (
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

        {/* Category grid */}
        {!loading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Auto mode card — primary CTA */}
            <div className="col-span-1 sm:col-span-2">
              <Card
                className="border-brand-400 bg-gradient-to-r from-brand-500 to-indigo-600"
                noPadding
              >
                <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-brand-100 uppercase tracking-wide mb-1">
                      Auto Mode · Recommended
                    </p>
                    <h2 className="font-bold text-white text-base leading-snug mb-1">
                      Guided path through all MCAT Biology
                    </h2>
                    <p className="text-xs text-brand-100">
                      Flashcard warm-ups, weakness-first questions, push-lessons when you&apos;re stuck, and category checkpoint quizzes — all in one continuous path.
                    </p>
                  </div>
                  <Link href="/mcat/auto" className="shrink-0">
                    <Button size="md" className="whitespace-nowrap bg-white text-brand-700 hover:bg-brand-50">
                      {sessionId ? "Continue" : "Start learning"}
                    </Button>
                  </Link>
                </div>
              </Card>
            </div>

            {/* General Practice card */}
            <div className="col-span-1 sm:col-span-2">
              <Card
                className="border-brand-200 bg-gradient-to-r from-brand-50 to-indigo-50"
                noPadding
              >
                <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide mb-1">
                      General Practice
                    </p>
                    <h2 className="font-bold text-neutral-900 text-base leading-snug mb-1">
                      Mix questions across any topics you choose
                    </h2>
                    <p className="text-xs text-neutral-500">
                      Select multiple categories, practice at your own pace, and get similar questions on demand.
                    </p>
                  </div>
                  <Link href="/mcat/practice" className="shrink-0">
                    <Button size="md" className="whitespace-nowrap">Start Practice</Button>
                  </Link>
                </div>
              </Card>
            </div>

            {categories.map((cat) => {
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

            {categories.length === 0 && (
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
