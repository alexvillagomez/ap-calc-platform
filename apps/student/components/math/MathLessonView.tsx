"use client";

import { useState, useEffect, useCallback } from "react";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import MathText from "@/components/mcat/MathText";
import { breakOutKeyTakeaway } from "@/lib/lessonText";
import MathFeedbackWidget from "@/components/math/MathFeedbackWidget";
import { EndScreenActions, type EndAction } from "@/components/practice/EndScreenActions";
import { comboReducer, onCorrectAnswer, onIncorrectAnswer } from "@/lib/gamification";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckQuestion {
  latex_content: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
}

interface MicroStep {
  step_index: number;
  /** Optional understanding-check. When false (or choices blank), the page has no quiz. */
  has_check?: boolean;
  explanation_latex: string;
  example_latex: string;
  check_question: CheckQuestion;
  hint_latex: string;
}

/** A page carries a check only when flagged AND it has real (non-blank) choices. */
function stepHasCheck(step: MicroStep): boolean {
  return (
    step.has_check !== false &&
    Array.isArray(step.check_question?.choices) &&
    step.check_question.choices.some((c) => c.trim() !== "")
  );
}

export interface LessonData {
  id: string;
  keyword_id: string;
  keyword_label: string;
  micro_steps: MicroStep[];
  generated_at: string;
}

type StepPhase = "read" | "question" | "correct" | "wrong";

interface MathLessonViewProps {
  sessionId: string;
  keywordId: string;
  keywordLabel: string;
  onComplete: () => void;
  onSkip: () => void;
  /** Called with updated combo count on answer (optional) */
  onComboUpdate?: (combo: number) => void;
  /**
   * Optional pre-fetched lesson. When provided, the view renders it directly
   * and skips its own fetch (lets a host page own the fetch + error UI without
   * double-fetching the generation endpoint). Does not affect success
   * rendering.
   */
  initialLesson?: LessonData;
  /**
   * Optional end-of-lesson actions. When provided, the "Lesson complete" screen
   * shows these choices (e.g. practice more / back to topic / home) instead of a
   * single "Continue" button. Omit it (auto mode, struggle lessons) to keep the
   * single-Continue → onComplete behavior unchanged.
   */
  completionActions?: EndAction[];
  /** When true, render a "← Previous lesson" control (page 1 / footer). */
  hasPreviousLesson?: boolean;
  /** Invoked when the student chooses to go to the previous lesson. */
  onPreviousLesson?: () => void;
}

export function MathLessonView({
  sessionId,
  keywordId,
  keywordLabel,
  onComplete,
  onSkip,
  completionActions,
  onComboUpdate,
  initialLesson,
  hasPreviousLesson,
  onPreviousLesson,
}: MathLessonViewProps) {
  const [lesson, setLesson] = useState<LessonData | null>(initialLesson ?? null);
  const [loading, setLoading] = useState(!initialLesson);
  const [error, setError] = useState<string | null>(null);

  // Prefer the clean DB label carried by the loaded lesson over a (possibly
  // humanized-slug) prop, so the heading never shows an internal id prefix.
  const displayLabel = lesson?.keyword_label?.trim() || keywordLabel;

  const [stepIndex, setStepIndex] = useState(0);
  const [stepPhase, setStepPhase] = useState<StepPhase>("read");
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [done, setDone] = useState(false);
  const [combo, setCombo] = useState(0);

  const fetchLesson = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLesson(null);
    setStepIndex(0);
    setStepPhase("read");
    setSelectedChoice(null);
    setShowHint(false);
    setDone(false);

    try {
      const res = await fetch(`/api/math/lesson/${encodeURIComponent(keywordId)}`);
      if (!res.ok) {
        // Log server detail for debugging, never surface raw error JSON to the user.
        await res.text().then((b) => console.error("math lesson load failed:", b)).catch(() => {});
        throw new Error("friendly");
      }
      const data = (await res.json()) as LessonData;
      setLesson(data);
    } catch {
      setError("We couldn't load this lesson right now — try again or skip.");
    } finally {
      setLoading(false);
    }
  }, [keywordId]);

  useEffect(() => {
    // When a host page provides the lesson, skip the internal fetch.
    if (initialLesson) return;
    fetchLesson();
  }, [fetchLesson, initialLesson]);

  const handleChoiceClick = useCallback(
    (idx: number) => {
      if (selectedChoice !== null || !lesson) return;
      setSelectedChoice(idx);
      const step = lesson.micro_steps[stepIndex];
      if (!step) return;

      const correct = idx === step.check_question.correct_index;
      const newCombo = correct
        ? comboReducer({ count: combo }, "correct").count
        : comboReducer({ count: combo }, "incorrect").count;
      setCombo(newCombo);
      if (correct) onCorrectAnswer(newCombo);
      else onIncorrectAnswer();
      onComboUpdate?.(newCombo);

      if (correct) {
        setStepPhase("correct");
      } else {
        setStepPhase("wrong");
      }
    },
    [selectedChoice, lesson, stepIndex, combo, onComboUpdate]
  );

  const handleNext = useCallback(() => {
    if (!lesson) return;
    const nextStep = stepIndex + 1;
    if (nextStep >= lesson.micro_steps.length) {
      setDone(true);
    } else {
      setStepIndex(nextStep);
      setStepPhase("read");
      setSelectedChoice(null);
      setShowHint(false);
    }
  }, [lesson, stepIndex]);

  // Spec: a wrong understanding-quiz answer takes the student back to the
  // initial lesson page (the read phase of the page the quiz just tested),
  // so they re-read it rather than being stuck re-attempting the question.
  const handleTryAgain = useCallback(() => {
    setSelectedChoice(null);
    setStepPhase("read");
    setShowHint(false);
  }, []);

  // Spec: free backward navigation between lesson pages.
  const handleBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
    setStepPhase("read");
    setSelectedChoice(null);
    setShowHint(false);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-neutral-500">
          Building a quick lesson on {keywordLabel}…
        </p>
        <p className="text-xs text-neutral-400">First time can take ~20s</p>
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center space-y-3">
        <p className="text-sm text-error-600">{error ?? "Failed to load lesson"}</p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={fetchLesson}
            className="px-4 py-2 rounded-xl bg-error-600 text-white text-sm font-medium hover:bg-error-700 transition-colors"
          >
            Try again
          </button>
          <button
            onClick={onSkip}
            className="px-4 py-2 rounded-xl border border-neutral-200 bg-white text-neutral-600 text-sm font-medium hover:bg-neutral-50 transition-colors"
          >
            Skip lesson
          </button>
        </div>
      </div>
    );
  }

  const totalSteps = lesson.micro_steps.length;

  if (done) {
    return (
      <div className="bg-white rounded-xl border border-neutral-200 shadow-brand-xs p-6 space-y-5">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center mx-auto">
            <span className="text-success-600 text-xl font-bold">✓</span>
          </div>
          <h2 className="text-base font-semibold text-neutral-900">
            Lesson complete!
          </h2>
          <p className="text-sm text-neutral-500">
            Great work on{" "}
            <span className="font-medium text-neutral-700"><MathText>{keywordLabel}</MathText></span>.
            {completionActions && completionActions.length > 0
              ? " What's next?"
              : " Time to practice."}
          </p>
        </div>
        <div className="border-t border-neutral-100 pt-4">
          <MathFeedbackWidget
            sessionId={sessionId}
            contentType="lesson"
            contentId={lesson.id}
          />
        </div>
        {completionActions && completionActions.length > 0 ? (
          <EndScreenActions actions={completionActions} />
        ) : (
          <button
            onClick={onComplete}
            className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
          >
            Continue
          </button>
        )}
      </div>
    );
  }

  const step = lesson.micro_steps[stepIndex];
  if (!step) return null;

  const progressPct = Math.round((stepIndex / totalSteps) * 100);

  return (
    <div className="space-y-4">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-xs font-medium text-neutral-500 shrink-0">
            Step {stepIndex + 1} of {totalSteps}
          </span>
          <div className="flex-1 h-1.5 bg-neutral-200 rounded-full overflow-hidden">
            <div
              className="h-1.5 bg-brand-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <button
          onClick={onSkip}
          className="ml-3 text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2 shrink-0"
        >
          Skip lesson
        </button>
      </div>

      {/* Step card */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-brand-xs overflow-hidden">
        <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
            Lesson: {displayLabel}
          </p>
        </div>

        <div className="p-5 space-y-5">
          {/* Read phase */}
          {stepPhase === "read" && (
            <>
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                  Explanation
                </p>
                {/* div (not p): MathText may render a figure block (graph/table). */}
                <div className="text-sm text-neutral-800 leading-relaxed">
                  <MathText>{breakOutKeyTakeaway(step.explanation_latex)}</MathText>
                </div>
              </div>
              {step.example_latex && (
                <div className="bg-brand-50 rounded-lg border border-brand-100 p-4">
                  <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide mb-2">
                    Example
                  </p>
                  <div className="text-sm text-neutral-800 leading-relaxed">
                    <MathText>{step.example_latex}</MathText>
                  </div>
                </div>
              )}
              {stepHasCheck(step) && (
                <button
                  onClick={() => setStepPhase("question")}
                  className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
                >
                  Try a question
                </button>
              )}
            </>
          )}

          {/* Question phase — only rendered for pages that carry a check */}
          {stepHasCheck(step) && (stepPhase === "question" || stepPhase === "correct" || stepPhase === "wrong") && (
            <>
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                  Check your understanding
                </p>
                <p className="text-sm text-neutral-800 leading-relaxed">
                  <MathText>{step.check_question.latex_content}</MathText>
                </p>
              </div>

              <div className="space-y-2">
                {step.check_question.choices.map((choice, i) => {
                  let state: "default" | "correct" | "wrong" | "dimmed" = "default";
                  if (selectedChoice !== null) {
                    if (i === step.check_question.correct_index) state = "correct";
                    else if (i === selectedChoice) state = "wrong";
                    else state = "dimmed";
                  }
                  return (
                    <ChoiceButton
                      key={i}
                      index={i}
                      text={choice}
                      state={state}
                      disabled={selectedChoice !== null}
                      onClick={() => handleChoiceClick(i)}
                    />
                  );
                })}
              </div>

              {stepPhase === "correct" && (
                <div className="bg-success-50 rounded-xl border border-success-200 p-4 space-y-2">
                  <p className="text-sm font-semibold text-success-800">Correct!</p>
                  {step.check_question.solution_latex && (
                    <p className="text-sm text-success-700 leading-relaxed">
                      <MathText>{step.check_question.solution_latex}</MathText>
                    </p>
                  )}
                </div>
              )}

              {stepPhase === "wrong" && (
                <div className="bg-error-50 rounded-xl border border-error-200 p-4 space-y-3">
                  <p className="text-sm font-semibold text-error-800">Not quite.</p>

                  {!showHint && step.hint_latex && (
                    <button
                      onClick={() => setShowHint(true)}
                      className="text-xs text-error-600 underline underline-offset-2 hover:text-error-800"
                    >
                      Show hint
                    </button>
                  )}

                  {showHint && step.hint_latex && (
                    <p className="text-sm text-error-700 leading-relaxed">
                      <MathText>{step.hint_latex}</MathText>
                    </p>
                  )}

                  <div className="flex pt-1">
                    <button
                      onClick={handleTryAgain}
                      className="flex-1 py-2.5 rounded-xl bg-error-600 text-white text-sm font-semibold hover:bg-error-700 transition-colors"
                    >
                      Re-read the page
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Persistent footer: free navigation — answering the check is optional */}
        <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50 flex items-center gap-2">
          <button
            onClick={handleBack}
            disabled={stepIndex === 0}
            className="py-2.5 px-4 rounded-xl border border-neutral-200 bg-white text-neutral-700 text-sm font-medium hover:bg-neutral-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Back
          </button>
          {stepIndex === 0 && hasPreviousLesson && onPreviousLesson && (
            <button
              onClick={onPreviousLesson}
              className="py-2.5 px-4 rounded-xl border border-neutral-200 bg-white text-neutral-600 text-sm font-medium hover:bg-neutral-50 transition-colors"
            >
              ← Previous lesson
            </button>
          )}
          <button
            onClick={handleNext}
            className="ml-auto py-2.5 px-5 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
          >
            {stepIndex + 1 >= totalSteps ? "Finish lesson →" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MathLessonView;
