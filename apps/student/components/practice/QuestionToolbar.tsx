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
import PrereqSeeAlso from "@/components/practice/PrereqSeeAlso";
import LessonModal from "@/components/practice/LessonModal";
import RefresherModal from "@/components/practice/RefresherModal";
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
  /**
   * Changing this value auto-dismisses the quick-refresher modal (e.g. when
   * the student submits an answer). The refresher-used flag is NOT cleared —
   * ×0.4 credit is still applied if an answer is submitted after the refresher
   * was opened, regardless of whether the modal is currently visible.
   */
  answerSignal?: unknown;
  onRefresherUsed?: () => void;
  /**
   * Fired after an action that changes which item should be served next — today
   * just "Prioritize this topic", which alters question-selection inputs. The auto
   * pages use it to invalidate a next-item prefetch made before the change.
   */
  onStateChange?: () => void;
  label?: string;
};

export default function QuestionToolbar({
  system,
  course,
  keywordId,
  sessionId,
  questionId,
  contentType,
  resetSignal,
  answerSignal,
  onRefresherUsed,
  onStateChange,
  label,
}: QuestionToolbarProps) {
  // ── Timing (metrics only — no visible timer) ────────────────────────────────
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

  // Reset timing whenever resetSignal changes; emit the prior interval for metrics.
  useEffect(() => {
    emitTimerStop();
    startRef.current = Date.now();
    stopMetaRef.current = { questionId, keywordId };
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
  // Opens the lesson as an IN-PAGE popup overlaid on the current surface, so the
  // student never leaves their flashcard/question. Closeable any time.
  const [lessonOpen, setLessonOpen] = useState(false);
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
    setLessonOpen(true);
  };

  // ── Quick refresher ──────────────────────────────────────────────────────────
  const [refresherOpen, setRefresherOpen] = useState(false);

  // Close the refresher modal when the question/card changes.
  useEffect(() => {
    setRefresherOpen(false);
  }, [resetSignal]);

  // Auto-dismiss the modal when the student submits an answer (answerSignal
  // changes). We only close the visual modal — the parent's usedRefresher flag
  // is NOT cleared, so ×0.4 credit is fully preserved.
  useEffect(() => {
    if (answerSignal === undefined) return;
    setRefresherOpen(false);
  }, [answerSignal]);

  const handleRefresher = () => {
    if (!keywordId) return;
    setRefresherOpen(true);
    onRefresherUsed?.();
    trackEvent({
      event_type: "refresher_used",
      system,
      course,
      keyword_id: keywordId,
      question_id: questionId ?? undefined,
      content_type: contentType,
    });
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
        // Selection inputs changed → let the parent invalidate any next-item prefetch.
        onStateChange?.();
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
        onStateChange?.();
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
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresher}
          disabled={noKeyword}
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

      {/* Prerequisite "See also" — small, unobtrusive; hidden when there are none. */}
      <PrereqSeeAlso system={system} course={course} keywordId={keywordId} className="mt-1.5 px-0.5" />

      {/* In-page refresher popup */}
      {refresherOpen && keywordId && (
        <RefresherModal
          system={system}
          keywordId={keywordId}
          onClose={() => setRefresherOpen(false)}
        />
      )}

      {/* In-page lesson popup */}
      {lessonOpen && keywordId && (
        <LessonModal
          system={system}
          course={course}
          keywordId={keywordId}
          label={label}
          sessionId={sessionId}
          onClose={() => setLessonOpen(false)}
        />
      )}
    </div>
  );
}
