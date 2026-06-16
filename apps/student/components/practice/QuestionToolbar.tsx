"use client";

/**
 * QuestionToolbar — shared, compact action bar shown beside a question or
 * flashcard across all practice/quiz surfaces.
 *
 * Features:
 *  - Stopwatch (Task 2): counts up from when `resetSignal` changes; emits a
 *    'timer_stop' metric for the PREVIOUS question on each reset and on unmount.
 *  - Take a lesson (Task 3): navigates to /{system}/lesson/{keywordId}.
 *  - Quick refresher (Task 4): fetches the refresher endpoint and renders the
 *    rule/example LaTeX inline in an expandable panel; flags usedRefresher.
 *  - Prioritize this (Task 5): toggles a priority via /api/priority.
 *
 * Everything fails soft — telemetry and the priority/refresher endpoints never
 * block the user. The bar wraps on mobile.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import MathText from "@/components/mcat/MathText";
import { trackEvent } from "@/lib/metrics";

export type QuestionToolbarProps = {
  system: "math" | "mcat";
  course?: string;
  keywordId: string | null;
  sessionId: string | null;
  questionId: string | null;
  contentType: "question" | "flashcard";
  /** Changing this value resets the stopwatch (new question/card). */
  resetSignal: unknown;
  onRefresherUsed?: () => void;
  label?: string;
};

type RefresherContent = {
  keyword_id: string;
  rule_latex: string | null;
  example_latex: string | null;
};

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function QuestionToolbar({
  system,
  course,
  keywordId,
  sessionId,
  questionId,
  contentType,
  resetSignal,
  onRefresherUsed,
  label,
}: QuestionToolbarProps) {
  // ── Stopwatch ──────────────────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(Date.now());
  // Snapshot of the question/keyword the running timer belongs to, so the
  // 'timer_stop' we emit on reset/unmount references the PREVIOUS question.
  const stopMetaRef = useRef<{ questionId: string | null; keywordId: string | null }>({
    questionId,
    keywordId,
  });

  const emitTimerStop = useCallback(() => {
    const meta = stopMetaRef.current;
    const ms = Date.now() - startRef.current;
    if (ms <= 0) return;
    trackEvent({
      event_type: "timer_stop",
      system,
      course,
      question_id: meta.questionId ?? undefined,
      keyword_id: meta.keywordId ?? undefined,
      content_type: contentType,
      time_ms: ms,
    });
  }, [system, course, contentType]);

  // Reset the stopwatch whenever resetSignal changes; emit the prior interval.
  useEffect(() => {
    emitTimerStop();
    startRef.current = Date.now();
    setElapsed(0);
    stopMetaRef.current = { questionId, keywordId };
    const id = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  // Keep the stop-metadata pointing at the current question without restarting
  // the timer (handles late-arriving questionId/keywordId for the same card).
  useEffect(() => {
    stopMetaRef.current = { questionId, keywordId };
  }, [questionId, keywordId]);

  // Emit a final timer_stop on unmount.
  useEffect(() => {
    return () => emitTimerStop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Take a lesson ────────────────────────────────────────────────────────────
  const handleLesson = () => {
    if (!keywordId) return;
    trackEvent({
      event_type: "lesson_opened",
      system,
      course,
      keyword_id: keywordId,
      question_id: questionId ?? undefined,
      content_type: contentType,
    });
    const q = label ? `?label=${encodeURIComponent(label)}` : "";
    // Open in a NEW TAB so the in-progress practice/quiz session is preserved
    // (router.push would unmount this surface and abandon the session).
    window.open(
      `/${system}/lesson/${encodeURIComponent(keywordId)}${q}`,
      "_blank",
      "noopener"
    );
  };

  // ── Quick refresher ──────────────────────────────────────────────────────────
  const [refOpen, setRefOpen] = useState(false);
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState(false);
  const [refContent, setRefContent] = useState<RefresherContent | null>(null);

  // Collapse + clear the refresher panel when the question/card changes.
  useEffect(() => {
    setRefOpen(false);
    setRefContent(null);
    setRefError(false);
    setRefLoading(false);
  }, [resetSignal]);

  const handleRefresher = async () => {
    if (!keywordId) return;
    if (refOpen) {
      setRefOpen(false);
      return;
    }
    setRefOpen(true);
    onRefresherUsed?.();
    trackEvent({
      event_type: "refresher_used",
      system,
      course,
      keyword_id: keywordId,
      question_id: questionId ?? undefined,
      content_type: contentType,
    });
    if (refContent || refError) return; // already loaded for this card
    setRefLoading(true);
    setRefError(false);
    try {
      const res = await fetch(
        `/api/${system}/refresher/${encodeURIComponent(keywordId)}`
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as RefresherContent;
      setRefContent(data);
    } catch {
      setRefError(true);
    } finally {
      setRefLoading(false);
    }
  };

  // ── Prioritize this ──────────────────────────────────────────────────────────
  const [prioritized, setPrioritized] = useState(false);
  const [prioBusy, setPrioBusy] = useState(false);

  const handlePrioritize = async () => {
    if (!keywordId || !sessionId || prioBusy) return;
    setPrioBusy(true);
    const next = !prioritized;
    // Optimistic toggle.
    setPrioritized(next);
    try {
      if (next) {
        const res = await fetch("/api/priority", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            system,
            keyword_id: keywordId,
            course,
          }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        trackEvent({
          event_type: "prioritize_added",
          system,
          course,
          keyword_id: keywordId,
          question_id: questionId ?? undefined,
          content_type: contentType,
        });
        toast.success("We'll show this topic more often until you improve.");
      } else {
        const res = await fetch("/api/priority", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            system,
            keyword_id: keywordId,
          }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        toast("Removed from prioritized topics.");
      }
    } catch {
      // Roll back on failure.
      setPrioritized(!next);
      toast.error("Couldn't update prioritized topics right now.");
    } finally {
      setPrioBusy(false);
    }
  };

  const noKeyword = !keywordId;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-2.5 py-2 shadow-brand-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Stopwatch pill */}
        <span
          className="inline-flex items-center gap-1 rounded-lg bg-neutral-100 px-2 py-1 text-xs font-medium tabular-nums text-neutral-600"
          aria-label="Time on this question"
          title="Time on this question"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          {fmt(elapsed)}
        </span>

        <span className="mx-0.5 hidden h-4 w-px bg-neutral-200 sm:block" />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresher}
          disabled={noKeyword}
          aria-expanded={refOpen}
        >
          Quick refresher
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleLesson}
          disabled={noKeyword}
        >
          Take a lesson
        </Button>

        <Button
          variant={prioritized ? "secondary" : "ghost"}
          size="sm"
          onClick={handlePrioritize}
          disabled={noKeyword || !sessionId}
          loading={prioBusy}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill={prioritized ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          {prioritized ? "Prioritized" : "Prioritize this topic"}
        </Button>
      </div>

      {/* Inline refresher panel */}
      {refOpen && (
        <div className="mt-2 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm text-neutral-700">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-700">
            Quick refresher
          </p>
          {refLoading && (
            <p className="text-xs text-neutral-500">Loading a refresher…</p>
          )}
          {!refLoading && refError && (
            <p className="text-xs text-neutral-500">
              Couldn&apos;t load a refresher right now.
            </p>
          )}
          {!refLoading &&
            !refError &&
            refContent &&
            !refContent.rule_latex &&
            !refContent.example_latex && (
              <p className="text-xs text-neutral-500">
                Couldn&apos;t load a refresher right now.
              </p>
            )}
          {!refLoading && !refError && refContent?.rule_latex && (
            <div className="leading-relaxed">
              <MathText>{refContent.rule_latex}</MathText>
            </div>
          )}
          {!refLoading && !refError && refContent?.example_latex && (
            <div className="mt-2 leading-relaxed">
              <p className="mb-0.5 text-xs font-semibold text-neutral-500">
                Example
              </p>
              <MathText>{refContent.example_latex}</MathText>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
