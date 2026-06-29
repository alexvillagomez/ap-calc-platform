"use client";

/**
 * HistoryReviewModal — read-only re-view of a previously answered practice item.
 * Opens as a portal modal. NEVER calls attempt/grade endpoints or mutates score.
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import MathText from "@/components/mcat/MathText";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import LessonModal from "@/components/practice/LessonModal";
import RefresherModal from "@/components/practice/RefresherModal";
import { primaryKeywordId } from "@/lib/primaryKeyword";
import type { HistoryEntry } from "@/components/practice/HistorySidebar";

interface HistoryReviewModalProps {
  entry: HistoryEntry;
  sessionId: string;
  onClose: () => void;
  system?: "math" | "mcat";
}

export default function HistoryReviewModal({
  entry,
  sessionId,
  onClose,
  system = "mcat",
}: HistoryReviewModalProps) {
  const [mounted, setMounted] = useState(false);
  const [sub, setSub] = useState<null | "lesson" | "refresher">(null);

  useEffect(() => setMounted(true), []);

  // Esc closes; scroll-lock while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (sub) setSub(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, sub]);

  if (!mounted) return null;

  // Derive the keyword id for lesson/refresher buttons.
  const kwId: string | null =
    entry.keywordId ??
    (entry.kind === "question"
      ? (entry.question.primary_keyword_id ?? primaryKeywordId(entry.question.keyword_weights))
      : primaryKeywordId(entry.card.keyword_weights));

  const body = (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-neutral-900/50 p-4 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Review"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative my-auto w-full max-w-lg rounded-2xl bg-neutral-50 shadow-brand-lg">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start gap-3 rounded-t-2xl border-b border-neutral-200 bg-white px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-neutral-900">
              Review
            </h2>
            <p className="text-[11px] text-neutral-400">
              Read-only — you can&apos;t change your answer
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close review"
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

        {/* Body */}
        <div className="px-5 py-5 sm:px-6 space-y-4">
          {entry.kind === "question" ? (
            <>
              {/* Stem */}
              <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-brand-xs">
                <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                  <MathText>{entry.question.stem}</MathText>
                </p>
              </div>

              {/* Choices — frozen in their final answered state */}
              <div className="space-y-2">
                {entry.question.choices.map((choice, i) => {
                  let state: "default" | "correct" | "wrong" | "dimmed" = "dimmed";
                  if (i === entry.question.correct_index) {
                    state = "correct";
                  } else if (!entry.dontKnow && i === entry.selectedChoice) {
                    state = "wrong";
                  }
                  return (
                    <ChoiceButton
                      key={i}
                      index={i}
                      text={choice}
                      state={state}
                      disabled
                      onClick={() => {}}
                    />
                  );
                })}
              </div>

              {/* Explanation */}
              {entry.question.explanation && (
                <div className="bg-brand-50 rounded-xl px-4 py-3 border border-brand-100">
                  <p className="text-xs font-semibold text-brand-600 mb-1 uppercase tracking-wide">
                    Explanation
                  </p>
                  <p className="text-sm text-brand-800 leading-relaxed">
                    <MathText>{entry.question.explanation}</MathText>
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Flashcard front + back (both revealed) */}
              <div className="space-y-3">
                <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-brand-xs">
                  <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">
                    Front
                  </p>
                  <p className="text-sm text-neutral-900 leading-relaxed">
                    <MathText>{entry.card.front}</MathText>
                  </p>
                </div>
                <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3">
                  <p className="text-[11px] font-semibold text-brand-500 uppercase tracking-wide mb-1">
                    Back
                  </p>
                  <p className="text-sm text-brand-900 leading-relaxed">
                    <MathText>{entry.card.back}</MathText>
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Footer — lesson + refresher buttons */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={!kwId}
              onClick={() => kwId && setSub("lesson")}
              className="flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 hover:border-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Take a lesson
            </button>
            <button
              type="button"
              disabled={!kwId}
              onClick={() => kwId && setSub("refresher")}
              className="flex-1 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Quick refresher
            </button>
          </div>
        </div>
      </div>

      {/* Sub-modals (rendered inside the portal so z-index stacks correctly) */}
      {sub === "lesson" && kwId && (
        <LessonModal
          system={system}
          keywordId={kwId}
          sessionId={sessionId}
          onClose={() => setSub(null)}
        />
      )}
      {sub === "refresher" && kwId && (
        <RefresherModal
          system={system}
          keywordId={kwId}
          onClose={() => setSub(null)}
        />
      )}
    </div>
  );

  return createPortal(body, document.body);
}
