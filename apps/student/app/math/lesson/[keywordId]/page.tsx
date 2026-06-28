"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/LoginGate";
import { MathLessonView, type LessonData } from "@/components/math/MathLessonView";
import PrereqSeeAlso from "@/components/practice/PrereqSeeAlso";
import { NavMenu } from "@/components/nav/NavMenu";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getOrCreateMathSession } from "@/lib/mathSession";
import { humanizeSlug } from "@/lib/humanize";

// ─── Inner ────────────────────────────────────────────────────────────────────

function MathLessonPageInner({
  params,
}: {
  params: Promise<{ keywordId: string }>;
}) {
  const { keywordId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const label = searchParams.get("label") ?? undefined;
  // Topic context (passed by the category page) so the end screen can route
  // "practice more of this topic" and "back to topic" correctly.
  const course = searchParams.get("course");
  const category = searchParams.get("category");
  const scope = searchParams.get("scope"); // "keyword" | "umbrella"
  const enc = label ? `&label=${encodeURIComponent(label)}` : "";

  // Where "back to topic" goes: explicit return → the topic/category page → math home.
  const backToTopicHref =
    searchParams.get("return") ??
    (course && category ? `/math/${course}/${category}` : "/math");
  // Where "practice more of this topic" goes (only when we know the topic).
  const practiceMoreHref =
    course && category
      ? `/math/${course}/${category}/practice?${scope === "umbrella" ? "umbrella" : "keyword"}=${encodeURIComponent(keywordId)}${enc}`
      : null;

  const returnTo = backToTopicHref;
  const [sessionId, setSessionId] = useState("");

  // Page owns the lesson fetch so it can render a friendly error state on
  // failure instead of a raw JSON card. On success the lesson is handed to
  // MathLessonView via initialLesson (no double-fetch).
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrCreateMathSession().then(setSessionId);
  }, []);

  const fetchLesson = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setLesson(null);
    try {
      const res = await fetch(
        `/api/math/lesson/${encodeURIComponent(keywordId)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LessonData;
      setLesson(data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [keywordId]);

  useEffect(() => {
    fetchLesson();
  }, [fetchLesson]);

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-6 py-3 flex items-center gap-3">
          <Link
            href={returnTo}
            className="text-xs text-neutral-400 hover:text-neutral-600"
          >
            ← Back
          </Link>
          <h1 className="font-semibold text-neutral-900 text-sm truncate">
            {label ? `Lesson: ${label}` : "Lesson"}
          </h1>
          <NavMenu className="ml-auto" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {!loading && !loadError && lesson && (
          <PrereqSeeAlso
            system="math"
            course={course ?? undefined}
            keywordId={keywordId}
            className="mb-4"
          />
        )}
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : loadError || !lesson ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-brand-xs space-y-4">
            <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto">
              <span className="text-neutral-400 text-xl">!</span>
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-neutral-900">
                We couldn&apos;t build this lesson right now.
              </h2>
              <p className="text-sm text-neutral-500">
                Please try again in a moment.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={fetchLesson}
                className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
              >
                Try again
              </button>
              <Link
                href={returnTo}
                className="px-4 py-2 rounded-xl border border-neutral-200 text-neutral-700 text-sm font-medium hover:bg-neutral-50 transition-colors"
              >
                Back
              </Link>
            </div>
          </div>
        ) : (
          <MathLessonView
            sessionId={sessionId}
            keywordId={keywordId}
            keywordLabel={label ?? humanizeSlug(keywordId)}
            initialLesson={lesson}
            onComplete={() => router.push(returnTo)}
            onSkip={() => router.push(returnTo)}
            completionActions={[
              ...(practiceMoreHref
                ? [
                    {
                      label: "Practice this topic",
                      sublabel: "Try questions on what you just learned",
                      href: practiceMoreHref,
                      primary: true,
                    },
                  ]
                : []),
              {
                label: label ? `Back to ${label}` : "Back to topic",
                href: backToTopicHref,
                primary: !practiceMoreHref,
              },
              { label: "Math Center home", href: "/math" },
            ]}
          />
        )}
      </main>
    </div>
  );
}

function MathLessonPage({
  params,
}: {
  params: Promise<{ keywordId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <MathLessonPageInner params={params} />
    </Suspense>
  );
}

export default function MathLessonPageGated({
  params,
}: {
  params: Promise<{ keywordId: string }>;
}) {
  return (
    <LoginGate prompt="Sign in to access lessons.">
      <MathLessonPage params={params} />
    </LoginGate>
  );
}
