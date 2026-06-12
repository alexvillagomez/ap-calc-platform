"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/LoginGate";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import MathText from "@/components/mcat/MathText";
import { getOrCreateMathSession } from "@/lib/mathSession";
import { COURSE_LABELS } from "@/components/math/mathUiTypes";
import type { MathCourse } from "@/lib/mathTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiagQuestion {
  id: string;
  stem_latex: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
  hint_latex: string | null;
  keyword_weights: Record<string, number>;
  difficulty: number;
}

interface StartResponse {
  diagnostic_id: string;
  question_number: number;
  total_estimated: number;
  category_id: string;
  question: DiagQuestion;
}

interface AnswerResponse {
  question_number: number;
  total_estimated: number;
  category_id?: string;
  question?: DiagQuestion;
  completed?: boolean;
  starting_category?: string;
  category_estimates?: Record<string, number>;
}

interface CategoryEstimate {
  id: string;
  label: string;
  estimate: number;
}

type Phase =
  | "intro"
  | "loading"
  | "question"
  | "revealed"
  | "completing"
  | "done"
  | "unavailable"
  | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function encouragingCopy(estimate: number): string {
  if (estimate >= 0.7) return "Strong";
  if (estimate >= 0.45) return "Learning";
  return "Starting out";
}

function estimateColor(e: number): string {
  if (e >= 0.7) return "text-success-700";
  if (e >= 0.45) return "text-amber-700";
  return "text-neutral-500";
}

// ─── Inner component ──────────────────────────────────────────────────────────

function DiagnosticInner({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = use(params);
  const courseLabel = COURSE_LABELS[course] ?? course;

  const [sessionId, setSessionId] = useState("");
  const [phase, setPhase] = useState<Phase>("intro");
  const [errorMsg, setErrorMsg] = useState("");

  const [diagnosticId, setDiagnosticId] = useState("");
  const [questionNumber, setQuestionNumber] = useState(1);
  const [totalEstimated, setTotalEstimated] = useState(12);
  const [question, setQuestion] = useState<DiagQuestion | null>(null);
  // category_id from API response is used server-side for routing; no local state needed

  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [dontKnow, setDontKnow] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const [startingCategory, setStartingCategory] = useState("");
  const [categoryEstimates, setCategoryEstimates] = useState<
    CategoryEstimate[]
  >([]);

  // Initialize session on mount
  useEffect(() => {
    getOrCreateMathSession()
      .then((sid) => setSessionId(sid))
      .catch(() => setPhase("error"));
  }, []);

  const startDiagnostic = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/math/diagnostic/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, course: course as MathCourse }),
      });

      if (res.status === 404) {
        setPhase("unavailable");
        return;
      }

      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as StartResponse;

      setDiagnosticId(data.diagnostic_id);
      setQuestionNumber(data.question_number);
      setTotalEstimated(data.total_estimated);
      setQuestion(data.question);
      setSelectedChoice(null);
      setDontKnow(false);
      setShowHint(false);
      setPhase("question");
    } catch (e) {
      const msg = (e as Error).message ?? "Failed to start diagnostic";
      if (msg.includes("404") || msg.includes("not seeded")) {
        setPhase("unavailable");
        return;
      }
      setErrorMsg(msg);
      setPhase("error");
    }
  }, [sessionId, course]);

  const submitAnswer = useCallback(
    async (selectedIndex: number | null, isDontKnow: boolean) => {
      if (!diagnosticId || !question) return;
      setPhase("completing");

      try {
        const res = await fetch("/api/math/diagnostic/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            diagnostic_id: diagnosticId,
            question_id: question.id,
            selected_index: selectedIndex,
            dont_know: isDontKnow,
          }),
        });

        if (res.status === 404) {
          setPhase("unavailable");
          return;
        }

        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as AnswerResponse;

        if (data.completed) {
          // Build sorted estimates list
          const estimates: CategoryEstimate[] = Object.entries(
            data.category_estimates ?? {}
          )
            .map(([id, estimate]) => ({
              id,
              label: id.replace(/_/g, " "),
              estimate: estimate as number,
            }))
            .sort((a, b) => b.estimate - a.estimate);

          setCategoryEstimates(estimates);
          setStartingCategory(data.starting_category ?? "");
          setPhase("done");
          return;
        }

        if (data.question) {
          setQuestionNumber(data.question_number);
          setTotalEstimated(data.total_estimated);
          setQuestion(data.question);
          setSelectedChoice(null);
          setDontKnow(false);
          setShowHint(false);
          setPhase("question");
        } else {
          setPhase("done");
        }
      } catch (e) {
        const msg = (e as Error).message ?? "Failed to submit answer";
        if (msg.includes("404")) {
          setPhase("unavailable");
          return;
        }
        setErrorMsg(msg);
        setPhase("error");
      }
    },
    [diagnosticId, question, sessionId]
  );

  const handleChoice = useCallback(
    (idx: number) => {
      if (phase !== "question" || selectedChoice !== null) return;
      setSelectedChoice(idx);
      setDontKnow(false);
      setPhase("revealed");
    },
    [phase, selectedChoice]
  );

  const handleDontKnow = useCallback(() => {
    if (phase !== "question") return;
    setSelectedChoice(null);
    setDontKnow(true);
    setPhase("revealed");
  }, [phase]);

  const handleNext = useCallback(() => {
    submitAnswer(selectedChoice, dontKnow);
  }, [submitAnswer, selectedChoice, dontKnow]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href={`/math/${course}`}
            className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0"
          >
            ← {courseLabel}
          </Link>
          <h1 className="font-semibold text-neutral-900 text-sm">
            Placement Diagnostic
          </h1>
        </div>

        {/* Progress dots */}
        {(phase === "question" || phase === "revealed" || phase === "completing") && (
          <div className="max-w-2xl mx-auto px-4 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {Array.from({ length: Math.min(totalEstimated, 16) }).map(
                  (_, i) => (
                    <div
                      key={i}
                      className={`w-2 h-2 rounded-full transition-all ${
                        i < questionNumber - 1
                          ? "bg-brand-500"
                          : i === questionNumber - 1
                          ? "bg-brand-400 scale-125"
                          : "bg-neutral-200"
                      }`}
                    />
                  )
                )}
              </div>
              <span className="text-xs text-neutral-400 shrink-0">
                {questionNumber} / ~{totalEstimated}
              </span>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Intro */}
        {phase === "intro" && (
          <Card className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-neutral-900">
                Placement Diagnostic
              </h2>
              <p className="text-sm text-neutral-600 leading-relaxed">
                ~10 questions, a few minutes. We walk the prerequisite chain and
                find your starting point. No pressure — be honest about what you
                know.
              </p>
            </div>
            <ul className="space-y-1.5 text-sm text-neutral-600">
              {[
                "Adaptive — we skip topics you clearly know",
                "\"I don't know\" is always an honest option",
                "Results: per-category estimates + starting category",
              ].map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <span className="text-brand-400 mt-0.5 shrink-0">•</span>
                  {point}
                </li>
              ))}
            </ul>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={startDiagnostic}
              disabled={!sessionId}
            >
              Start diagnostic
            </Button>
          </Card>
        )}

        {/* Loading */}
        {phase === "loading" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Preparing your diagnostic…</p>
          </div>
        )}

        {/* Completing (submitting answer) */}
        {phase === "completing" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Analyzing your answer…</p>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <Card className="text-center space-y-3">
            <p className="text-sm text-error-600">{errorMsg}</p>
            <Button variant="secondary" size="sm" onClick={() => setPhase("intro")}>
              Try again
            </Button>
          </Card>
        )}

        {/* Unavailable */}
        {phase === "unavailable" && (
          <Card className="text-center space-y-4">
            <p className="text-base font-semibold text-neutral-800">
              Diagnostic not ready yet
            </p>
            <p className="text-sm text-neutral-500">
              The diagnostic requires course content to be seeded. Check back
              once taxonomy is populated.
            </p>
            <Link href={`/math/${course}`}>
              <Button variant="secondary" size="md">
                Back to {courseLabel}
              </Button>
            </Link>
          </Card>
        )}

        {/* Active question */}
        {(phase === "question" || phase === "revealed") && question && (
          <>
            {/* Stem */}
            <Card>
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{question.stem_latex}</MathText>
              </p>
            </Card>

            {/* Choices */}
            <div className="space-y-2">
              {question.choices.map((choice, i) => {
                let state: "default" | "correct" | "wrong" | "dimmed" = "default";
                if (phase === "revealed") {
                  if (i === question.correct_index) state = "correct";
                  else if (!dontKnow && i === selectedChoice) state = "wrong";
                  else state = "dimmed";
                }
                return (
                  <ChoiceButton
                    key={i}
                    index={i}
                    text={choice}
                    state={state}
                    disabled={phase === "revealed"}
                    onClick={() => handleChoice(i)}
                  />
                );
              })}
            </div>

            {/* I don't know */}
            {phase === "question" && (
              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={handleDontKnow}>
                  I don&apos;t know
                </Button>
              </div>
            )}

            {/* Hint */}
            {phase === "question" && question.hint_latex && (
              <div className="flex justify-center">
                {!showHint ? (
                  <button
                    onClick={() => setShowHint(true)}
                    className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2"
                  >
                    Show hint
                  </button>
                ) : (
                  <div className="bg-amber-50 rounded-xl border border-amber-100 p-3 w-full">
                    <p className="text-xs font-semibold text-amber-700 mb-1">
                      Hint
                    </p>
                    <p className="text-sm text-neutral-700 leading-relaxed">
                      <MathText>{question.hint_latex}</MathText>
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Solution reveal */}
            {phase === "revealed" && (
              <>
                {question.solution_latex && (
                  <div className="bg-brand-50 rounded-xl border border-brand-100 p-4">
                    <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide mb-1.5">
                      Solution
                    </p>
                    <p className="text-sm text-neutral-700 leading-relaxed">
                      <MathText>{question.solution_latex}</MathText>
                    </p>
                  </div>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={handleNext}
                >
                  Next
                </Button>
              </>
            )}
          </>
        )}

        {/* Done — results */}
        {phase === "done" && (
          <div className="space-y-5">
            <Card className="space-y-4">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center mx-auto">
                  <span className="text-success-600 text-xl font-bold">✓</span>
                </div>
                <h2 className="text-base font-bold text-neutral-900">
                  Placement complete
                </h2>
                <p className="text-sm text-neutral-500">
                  Here&apos;s where we estimate you stand across {courseLabel}.
                </p>
              </div>

              {/* Per-category estimates */}
              {categoryEstimates.length > 0 && (
                <div className="space-y-2">
                  {categoryEstimates.map((est) => (
                    <div key={est.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-neutral-700 font-medium capitalize">
                          {est.label}
                        </span>
                        <span className={`font-medium ${estimateColor(est.estimate)}`}>
                          {encouragingCopy(est.estimate)}
                        </span>
                      </div>
                      <ProgressBar
                        value={Math.round(est.estimate * 100)}
                        size="sm"
                        color={est.estimate >= 0.7 ? "success" : "brand"}
                        label={est.label}
                      />
                    </div>
                  ))}
                </div>
              )}

              {categoryEstimates.length === 0 && (
                <p className="text-sm text-neutral-500 text-center">
                  Estimates are being computed. Practice to see your progress.
                </p>
              )}
            </Card>

            {/* Start here CTA */}
            <div className="space-y-2">
              {startingCategory ? (
                <Link href={`/math/${course}/${startingCategory}/practice`}>
                  <Button variant="primary" size="lg" className="w-full">
                    Start here
                  </Button>
                </Link>
              ) : (
                <Link href={`/math/${course}/practice`}>
                  <Button variant="primary" size="lg" className="w-full">
                    Start practicing
                  </Button>
                </Link>
              )}
              <Link href={`/math/${course}`}>
                <Button variant="secondary" size="md" className="w-full">
                  View all categories
                </Button>
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function DiagnosticPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  return (
    <LoginGate prompt="Sign in to take your placement diagnostic.">
      <DiagnosticInner params={params} />
    </LoginGate>
  );
}
