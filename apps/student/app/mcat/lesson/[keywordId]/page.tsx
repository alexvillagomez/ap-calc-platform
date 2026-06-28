"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { NavMenu } from "@/components/nav/NavMenu";
import { getOrCreateMcatSession } from "@/lib/mcatSession";
import { LessonView, type LessonData } from "@/components/mcat/LessonView";
import PrereqSeeAlso from "@/components/practice/PrereqSeeAlso";
import { humanizeSlug } from "@/lib/humanize";

export default function StandaloneLessonPage({
  params,
}: {
  params: Promise<{ keywordId: string }>;
}) {
  const { keywordId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Topic context (passed by the category page) so the end screen can route
  // "practice more of this topic" and "back to topic" correctly.
  const category = searchParams.get("category");
  const scope = searchParams.get("scope"); // "keyword" | "umbrella"

  const [sessionId, setSessionId] = useState<string>("");
  const [ready, setReady] = useState(false);

  // Page owns the lesson fetch so it can render a friendly error state on
  // failure instead of a raw JSON card. On success the lesson is handed to
  // LessonView via initialLesson (no double-fetch).
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const rawLabel = searchParams.get("label") ?? "";
  const keywordLabel = rawLabel ? rawLabel : humanizeSlug(keywordId);

  const enc = rawLabel ? `&label=${encodeURIComponent(rawLabel)}` : "";
  // Where "back" goes: an explicit ?return → the topic/category page → progress.
  // Mirrors the math lesson page so the header, completion buttons, and skip all
  // land where the user came from instead of dumping on the section home.
  const backToTopicHref =
    searchParams.get("return") ?? (category ? `/mcat/${category}` : "/mcat/progress");
  const practiceMoreHref = category
    ? `/mcat/${category}/practice?${scope === "umbrella" ? "umbrella" : "keyword"}=${encodeURIComponent(keywordId)}${enc}`
    : null;

  useEffect(() => {
    getOrCreateMcatSession().then((sid) => {
      setSessionId(sid);
      setReady(true);
    });
  }, []);

  const fetchLesson = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setLesson(null);
    try {
      const res = await fetch(
        `/api/mcat/lesson/${encodeURIComponent(keywordId)}`
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

  const handleDone = () => {
    router.push(backToTopicHref);
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Top bar */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/mcat/progress" className="shrink-0">
              <LoderaLogo size={22} />
            </Link>
            <Link
              href={backToTopicHref}
              className="text-xs text-neutral-400 hover:text-brand-600 shrink-0 transition-colors"
            >
              ← Back
            </Link>
          </div>
          <p className="font-semibold text-neutral-900 text-sm truncate px-3">
            {keywordLabel}
          </p>
          <NavMenu />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {ready && sessionId && !loading && lesson && (
          <PrereqSeeAlso system="mcat" keywordId={keywordId} className="mb-4" />
        )}
        {!ready || !sessionId || loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="relative w-10 h-10">
              <div className="w-10 h-10 rounded-full border-4 border-brand-100" />
              <div className="absolute inset-0 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
            </div>
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
                href={backToTopicHref}
                className="px-4 py-2 rounded-xl border border-neutral-200 text-neutral-700 text-sm font-medium hover:bg-neutral-50 transition-colors"
              >
                Back
              </Link>
            </div>
          </div>
        ) : (
          <LessonView
            sessionId={sessionId}
            keywordId={keywordId}
            keywordLabel={keywordLabel}
            initialLesson={lesson}
            onComplete={handleDone}
            onSkip={handleDone}
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
                label: rawLabel ? `Back to ${rawLabel}` : "Back to topic",
                href: backToTopicHref,
                primary: !practiceMoreHref,
              },
              { label: "MCAT home", href: "/mcat" },
            ]}
          />
        )}
      </main>
    </div>
  );
}
