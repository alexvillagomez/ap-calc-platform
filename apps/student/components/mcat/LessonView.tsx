"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { LoadingPanel } from "@/components/mcat/LoadingPanel";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import FeedbackWidget from "@/components/mcat/FeedbackWidget";
import MathText from "@/components/mcat/MathText";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckQuestion {
  latex_content: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
}

interface MicroStep {
  step_index: number;
  explanation_latex: string;
  example_latex: string;
  check_question: CheckQuestion;
  hint_latex: string;
}

export interface LessonData {
  id: string;
  keyword_id: string;
  keyword_label: string;
  micro_steps: MicroStep[];
  generated_at: string;
}

type StepPhase = "read" | "question" | "correct" | "wrong";

// ─── Props ────────────────────────────────────────────────────────────────────

interface LessonViewProps {
  sessionId: string;
  keywordId: string;
  keywordLabel: string;
  onComplete: () => void;
  onSkip: () => void;
  /**
   * Optional pre-fetched lesson. When provided, the view renders it directly
   * and skips its own fetch (lets a host page own the fetch + error UI without
   * double-fetching the generation endpoint). Does not affect success
   * rendering.
   */
  initialLesson?: LessonData;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LessonView({
  sessionId,
  keywordId,
  keywordLabel,
  onComplete,
  onSkip,
  initialLesson,
}: LessonViewProps) {
  const [lesson, setLesson] = useState<LessonData | null>(initialLesson ?? null);
  const [loading, setLoading] = useState(!initialLesson);
  const [error, setError] = useState<string | null>(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [stepPhase, setStepPhase] = useState<StepPhase>("read");
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [done, setDone] = useState(false);

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
      const res = await fetch(`/api/mcat/lesson/${encodeURIComponent(keywordId)}`);
      if (!res.ok) {
        const body = await res.text().catch(() => "Unknown error");
        throw new Error(body || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as LessonData;
      setLesson(data);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load lesson");
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
      if (idx === step.check_question.correct_index) {
        setStepPhase("correct");
      } else {
        setStepPhase("wrong");
      }
    },
    [selectedChoice, lesson, stepIndex]
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

  const handleTryAgain = useCallback(() => {
    setSelectedChoice(null);
    setStepPhase("question");
    setShowHint(false);
  }, []);

  // ─── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <LoadingPanel
        message={`Building a quick lesson on ${keywordLabel}…`}
        sub="First time can take ~20s"
      />
    );
  }

  // ─── Error state ───────────────────────────────────────────────────────────
  if (error || !lesson) {
    return (
      <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center space-y-3">
        <p className="text-sm text-error-600">{error ?? "Failed to load lesson"}</p>
        <div className="flex gap-2 justify-center">
          <Button variant="primary" size="sm" onClick={fetchLesson}>Try again</Button>
          <Button variant="secondary" size="sm" onClick={onSkip}>Skip lesson</Button>
        </div>
      </div>
    );
  }

  const totalSteps = lesson.micro_steps.length;

  // ─── Completion screen ─────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="bg-white rounded-xl border border-neutral-200 p-6 shadow-brand-xs space-y-5">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center mx-auto">
            <span className="text-success-600 text-xl font-bold">✓</span>
          </div>
          <h2 className="text-base font-semibold text-neutral-900">
            Lesson complete!
          </h2>
          <p className="text-sm text-neutral-500">
            Great work on <span className="font-medium text-neutral-700">{keywordLabel}</span>. Time to practice.
          </p>
        </div>
        <div className="border-t border-neutral-100 pt-4">
          <FeedbackWidget
            sessionId={sessionId}
            contentType="lesson"
            contentId={lesson.id}
          />
        </div>
        <Button variant="primary" size="lg" className="w-full" onClick={onComplete}>
          Continue →
        </Button>
      </div>
    );
  }

  // ─── Step UI ───────────────────────────────────────────────────────────────
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
          <ProgressBar
            value={progressPct}
            size="xs"
            color="brand"
            label="Lesson progress"
            className="flex-1"
          />
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
        {/* Lesson label */}
        <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
            Lesson: {keywordLabel}
          </p>
        </div>

        <div className="p-5 space-y-5">
          {/* Read phase: explanation + example */}
          {(stepPhase === "read") && (
            <>
              {/* Explanation */}
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                  Explanation
                </p>
                <p className="text-sm text-neutral-800 leading-relaxed">
                  <MathText>{step.explanation_latex}</MathText>
                </p>
              </div>

              {/* Example */}
              {step.example_latex && (
                <div className="bg-brand-50 rounded-lg border border-brand-100 p-4">
                  <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide mb-2">
                    Example
                  </p>
                  <p className="text-sm text-neutral-800 leading-relaxed">
                    <MathText>{step.example_latex}</MathText>
                  </p>
                </div>
              )}

              <Button variant="primary" size="lg" className="w-full" onClick={() => setStepPhase("question")}>
                Try a question →
              </Button>
            </>
          )}

          {/* Question phase */}
          {(stepPhase === "question" || stepPhase === "correct" || stepPhase === "wrong") && (
            <>
              {/* Question stem */}
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
                  Check your understanding
                </p>
                <p className="text-sm text-neutral-800 leading-relaxed">
                  <MathText>{step.check_question.latex_content}</MathText>
                </p>
              </div>

              {/* Choices */}
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

              {/* Correct banner */}
              {stepPhase === "correct" && (
                <div className="bg-success-50 rounded-xl border border-success-200 p-4 space-y-2">
                  <p className="text-sm font-semibold text-success-700">Correct!</p>
                  {step.check_question.solution_latex && (
                    <p className="text-sm text-success-700 leading-relaxed">
                      <MathText>{step.check_question.solution_latex}</MathText>
                    </p>
                  )}
                  <div className="flex justify-end pt-1">
                    <Button variant="primary" size="md" onClick={handleNext}>
                      {stepIndex + 1 >= totalSteps ? "Finish lesson →" : "Next step →"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Wrong banner */}
              {stepPhase === "wrong" && (
                <div className="bg-error-50 rounded-xl border border-error-200 p-4 space-y-3">
                  <p className="text-sm font-semibold text-error-700">Not quite.</p>

                  {!showHint && step.hint_latex && (
                    <button
                      onClick={() => setShowHint(true)}
                      className="text-xs text-error-600 underline underline-offset-2 hover:text-error-700"
                    >
                      Show hint
                    </button>
                  )}

                  {showHint && step.hint_latex && (
                    <p className="text-sm text-error-700 leading-relaxed">
                      <MathText>{step.hint_latex}</MathText>
                    </p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button variant="primary" size="md" onClick={handleTryAgain} className="flex-1">
                      Try again
                    </Button>
                    <Button variant="secondary" size="md" onClick={handleNext} className="flex-1">
                      {stepIndex + 1 >= totalSteps ? "Finish lesson →" : "Move on →"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
