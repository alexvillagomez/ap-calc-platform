"use client";

/**
 * RefresherModal — renders a quick refresher (rule + example LaTeX) as an
 * IN-PAGE popup overlaid on the current surface, exactly analogous to
 * LessonModal. Closeable at any time via the X button, a click on the
 * backdrop, or Esc.
 *
 * The component owns the fetch to /api/{system}/refresher/{keywordId} so the
 * caller (QuestionToolbar) is kept free of fetch state.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import MathText from "@/components/mcat/MathText";

type RefresherContent = {
  keyword_id: string;
  rule_latex: string | null;
  example_latex: string | null;
};

export type RefresherModalProps = {
  system: "math" | "mcat";
  keywordId: string;
  onClose: () => void;
};

export default function RefresherModal({
  system,
  keywordId,
  onClose,
}: RefresherModalProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [content, setContent] = useState<RefresherContent | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setContent(null);
    fetch(`/api/${system}/refresher/${encodeURIComponent(keywordId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json() as Promise<RefresherContent>;
      })
      .then((data) => {
        if (!cancelled) setContent(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [system, keywordId]);

  if (!mounted) return null;

  const hasContent =
    !loading && !error && content && (content.rule_latex || content.example_latex);
  const showEmpty =
    !loading && !error && content && !content.rule_latex && !content.example_latex;

  const body = (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-neutral-900/50 p-4 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Quick refresher"
      onMouseDown={(e) => {
        // Click on the backdrop (not the panel) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative my-auto w-full max-w-lg rounded-2xl bg-neutral-50 shadow-brand-lg">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center gap-3 rounded-t-2xl border-b border-neutral-200 bg-white px-5 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">
            Quick refresher
          </h2>
          <button
            onClick={onClose}
            aria-label="Close refresher"
            className="-mr-1 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5 sm:px-6">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="h-7 w-7 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
            </div>
          )}

          {!loading && (error || showEmpty) && (
            <p className="text-sm text-neutral-500">
              Couldn&apos;t load a refresher right now.
            </p>
          )}

          {hasContent && (
            <div className="space-y-3 text-sm text-neutral-700">
              {content!.rule_latex && (
                <div className="leading-relaxed">
                  <MathText>{content!.rule_latex}</MathText>
                </div>
              )}
              {content!.example_latex && (
                <div className="leading-relaxed">
                  <p className="mb-0.5 text-xs font-semibold text-neutral-500">
                    Example
                  </p>
                  <MathText>{content!.example_latex}</MathText>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
