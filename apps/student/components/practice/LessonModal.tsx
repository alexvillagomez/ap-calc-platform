"use client";

/**
 * LessonModal — renders a full lesson as an IN-PAGE popup overlaid on the
 * current surface (flashcards/practice), so "See a lesson" no longer navigates
 * away. Closeable at any time via the X button, a click on the backdrop, or Esc.
 *
 * It owns the lesson fetch (mirroring the standalone lesson pages) so it can show
 * a loading spinner and a friendly error state, then hands the data to the
 * system-appropriate lesson view. Completing or skipping the lesson closes the
 * modal and returns the student to exactly where they were.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MathLessonView, type LessonData as MathLessonData } from "@/components/math/MathLessonView";
import { LessonView, type LessonData as McatLessonData } from "@/components/mcat/LessonView";
import { humanizeSlug } from "@/lib/humanize";

type LessonData = MathLessonData & McatLessonData;

export type LessonModalProps = {
  system: "math" | "mcat";
  course?: string;
  keywordId: string;
  label?: string;
  sessionId: string | null;
  onClose: () => void;
};

export default function LessonModal({
  system,
  keywordId,
  label,
  sessionId,
  onClose,
}: LessonModalProps) {
  const [mounted, setMounted] = useState(false);
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  // Prefer the clean DB label returned by the lesson API (lesson.keyword_label).
  // The passed-in `label` may be a humanized id slug (e.g. "Limit 1 …") when the
  // caller didn't have the real label; the loaded lesson always carries it.
  const keywordLabel =
    (lesson?.keyword_label as string | undefined)?.trim() ||
    label ||
    humanizeSlug(keywordId);

  useEffect(() => setMounted(true), []);

  // Close on Esc + lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const fetchLesson = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setLesson(null);
    try {
      const res = await fetch(`/api/${system}/lesson/${encodeURIComponent(keywordId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LessonData;
      setLesson(data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [system, keywordId]);

  useEffect(() => {
    fetchLesson();
  }, [fetchLesson]);

  if (!mounted) return null;

  const body = (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-neutral-900/50 p-4 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Lesson: ${keywordLabel}`}
      onMouseDown={(e) => {
        // Click on the backdrop (not the panel) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative my-auto w-full max-w-2xl rounded-2xl bg-neutral-50 shadow-brand-lg">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center gap-3 rounded-t-2xl border-b border-neutral-200 bg-white px-5 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">
            {`Lesson: ${keywordLabel}`}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close lesson"
            className="-mr-1 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-6 sm:px-6">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
            </div>
          ) : loadError || !lesson ? (
            <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-brand-xs">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
                <span className="text-xl text-neutral-400">!</span>
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-neutral-900">
                  We couldn&apos;t build this lesson right now.
                </h3>
                <p className="text-sm text-neutral-500">Please try again in a moment.</p>
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={fetchLesson}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
                >
                  Try again
                </button>
                <button
                  onClick={onClose}
                  className="rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                >
                  Close
                </button>
              </div>
            </div>
          ) : system === "math" ? (
            <MathLessonView
              sessionId={sessionId ?? ""}
              keywordId={keywordId}
              keywordLabel={keywordLabel}
              initialLesson={lesson}
              onComplete={onClose}
              onSkip={onClose}
            />
          ) : (
            <LessonView
              sessionId={sessionId ?? ""}
              keywordId={keywordId}
              keywordLabel={keywordLabel}
              initialLesson={lesson}
              onComplete={onClose}
              onSkip={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
