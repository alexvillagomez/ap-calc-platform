"use client";

import { useState, useEffect, use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoginGate } from "@/components/auth/LoginGate";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import MathText from "@/components/mcat/MathText";
import MathFeedbackWidget from "@/components/math/MathFeedbackWidget";
import QuestionToolbar from "@/components/practice/QuestionToolbar";
import { primaryKeywordId } from "@/lib/primaryKeyword";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { ComboMeter } from "@/components/gamification/ComboMeter";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { useStreakTouchOnce } from "@/components/gamification/useStreakTouchOnce";
import { comboReducer, onCorrectAnswer, onIncorrectAnswer } from "@/lib/gamification";
import { getOrCreateMathSession } from "@/lib/mathSession";
import { MathQuestion, diffLabel, COURSE_LABELS } from "@/components/math/mathUiTypes";
import type { MathCourse } from "@/lib/mathTypes";

const QUIZ_COUNT = 8;

interface UserAnswer {
  question: MathQuestion;
  selected_index: number | null;
  dont_know: boolean;
}

type Phase = "loading" | "quiz" | "review" | "error";

function encouragingCopy(pct: number): string {
  if (pct === 100) return "Perfect score! Outstanding work!";
  if (pct >= 80) return "Great job — you're really solid on this material!";
  if (pct >= 60) return "Good effort! A bit more practice and you'll have it down.";
  if (pct >= 40) return "Keep going — you're building momentum.";
  return "Every attempt makes you stronger. Review the solutions and try again!";
}

// ─── Inner component ──────────────────────────────────────────────────────────

function MathCategoryQuizInner({
  params,
}: {
  params: Promise<{ course: string; categoryId: string }>;
}) {
  const { course, categoryId } = use(params);
  const searchParams = useSearchParams();
  const umbrellaId = searchParams.get("umbrella");
  const keywordScopeId = searchParams.get("keyword");
  const scopeLabel = searchParams.get("label");
  const isScoped = !!(umbrellaId || keywordScopeId);
  const backHref = isScoped ? `/math/${course}/${categoryId}` : `/math/${course}`;
  const courseLabel = COURSE_LABELS[course] ?? course;

  const [sessionId, setSessionId] = useState("");
  const [questions, setQuestions] = useState<MathQuestion[]>([]);
  const [answers, setAnswers] = useState<UserAnswer[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [combo, setCombo] = useState(0);
  const [usedRefresher, setUsedRefresher] = useState(false);

  useStreakTouchOnce();

  // Resolve umbrella children via taxonomy
  const resolveKeywordIds = async (sid: string): Promise<string[] | undefined> => {
    if (keywordScopeId) return [keywordScopeId];
    if (!umbrellaId) return undefined;
    try {
      const r = await fetch(
        `/api/math/taxonomy?session_id=${encodeURIComponent(sid)}&course=${encodeURIComponent(course)}`
      );
      if (!r.ok) return undefined;
      const d = await r.json() as {
        categories: Array<{
          id: string;
          umbrellas?: Array<{ id: string; children: Array<{ id: string }> }>;
        }>;
      };
      const cat = (d.categories ?? []).find((c) => c.id === categoryId);
      if (!cat?.umbrellas) return undefined;
      const umb = cat.umbrellas.find((u) => u.id === umbrellaId);
      if (!umb || umb.children.length === 0) return undefined;
      return umb.children.map((c) => c.id);
    } catch {
      return undefined;
    }
  };

  const fetchQuiz = async (sid: string) => {
    setPhase("loading");
    setQuestions([]);
    setAnswers([]);
    setCurrentIdx(0);
    setErrorMsg("");
    setCombo(0);

    try {
      const keywordIds = await resolveKeywordIds(sid);
      const body: Record<string, unknown> = {
        session_id: sid,
        category_id: categoryId,
        count: QUIZ_COUNT,
        mixed: true,
        course: course as MathCourse,
      };
      if (keywordIds) body.keyword_ids = keywordIds;

      const res = await fetch("/api/math/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Unknown error"));
      const data = (await res.json()) as { questions: MathQuestion[] };
      setQuestions(data.questions ?? []);
      setPhase("quiz");
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Failed to build quiz");
      setPhase("error");
    }
  };

  useEffect(() => {
    (async () => {
      const sid = await getOrCreateMathSession();
      setSessionId(sid);
      await fetchQuiz(sid);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recordAndAdvance = async (selectedIndex: number | null, dontKnow: boolean) => {
    const q = questions[currentIdx];
    if (!q) return;

    const newAnswer: UserAnswer = { question: q, selected_index: selectedIndex, dont_know: dontKnow };
    const newAnswers = [...answers, newAnswer];
    setAnswers(newAnswers);

    const correct = !dontKnow && selectedIndex === q.correct_index;
    setCombo((prev) => {
      const next = comboReducer({ count: prev }, correct ? "correct" : "incorrect").count;
      if (correct) onCorrectAnswer(next);
      else onIncorrectAnswer();
      return next;
    });

    // Record attempt fire-and-forget
    fetch("/api/math/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sid,
        question_id: q.id,
        ...(dontKnow ? { dont_know: true } : { selected_index: selectedIndex }),
        context: "quiz",
        course: course as MathCourse,
        usedRefresher,
      }),
    }).catch(() => {});

    setUsedRefresher(false);
    if (currentIdx + 1 >= questions.length) {
      setPhase("review");
    } else {
      setCurrentIdx((i) => i + 1);
    }
  };

  // local capture for fire-and-forget
  const sid = sessionId;

  const correctCount = answers.filter(
    (a) => !a.dont_know && a.selected_index === a.question.correct_index
  ).length;
  const scorePct =
    answers.length > 0 ? Math.round((correctCount / answers.length) * 100) : 0;

  const currentQ = questions[currentIdx];
  const progress = questions.length > 0 ? currentIdx / questions.length : 0;

  const headingLabel = isScoped && scopeLabel
    ? `${scopeLabel} Quiz`
    : `${courseLabel} Quiz`;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href={backHref} className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0">
              {isScoped ? "← Back" : `← ${courseLabel}`}
            </Link>
            {isScoped && scopeLabel && (
              <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 font-medium">
                {umbrellaId ? "Topic" : "Keyword"}: {scopeLabel}
              </span>
            )}
            <p className="font-semibold text-neutral-900 text-sm truncate">
              {headingLabel}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {phase === "quiz" && questions.length > 0 && (
              <p className="text-xs text-neutral-500">
                {currentIdx + 1} / {questions.length}
              </p>
            )}
            <StreakBadge />
            <SoundToggle />
          </div>
        </div>
      </header>

      {/* Progress bar */}
      {phase === "quiz" && (
        <div className="h-1 bg-neutral-200">
          <div
            className="h-full bg-brand-500 transition-all duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Loading */}
        {phase === "loading" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Building your quiz…</p>
            <p className="text-xs text-neutral-400">Can take up to a minute</p>
          </div>
        )}

        {phase === "loading" && (
          <div className="space-y-3 opacity-40 pointer-events-none">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-neutral-200 animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center space-y-3">
            <p className="text-sm text-error-600">{errorMsg || "Failed to build quiz"}</p>
            <button
              onClick={() => fetchQuiz(sessionId)}
              className="px-4 py-2 rounded-lg bg-error-600 text-white text-sm font-medium hover:bg-error-700 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Active quiz question */}
        {phase === "quiz" && currentQ && (
          <>
            {/* Progress dots */}
            <div className="flex gap-1.5 flex-wrap justify-center">
              {questions.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i < currentIdx
                      ? "bg-brand-500"
                      : i === currentIdx
                      ? "bg-neutral-900"
                      : "bg-neutral-200"
                  }`}
                />
              ))}
            </div>

            {/* Difficulty chip */}
            {(() => {
              const diff = diffLabel(currentQ.difficulty);
              return diff ? (
                <div className="flex">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${diff.cls}`}>
                    {diff.label}
                  </span>
                </div>
              ) : null;
            })()}

            {/* Stem */}
            <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-brand-xs">
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{currentQ.stem_latex}</MathText>
              </p>
            </div>

            <QuestionToolbar
              system="math"
              course={course}
              keywordId={
                currentQ.primary_keyword_id ??
                primaryKeywordId(currentQ.keyword_weights)
              }
              sessionId={sessionId}
              questionId={currentQ.id}
              contentType="question"
              resetSignal={currentQ.id}
              onRefresherUsed={() => setUsedRefresher(true)}
            />

            {/* Combo meter */}
            <ComboMeter combo={combo} />

            {/* Choices — deferred feedback */}
            <div className="space-y-2">
              {currentQ.choices.map((choice, i) => (
                <ChoiceButton
                  key={i}
                  index={i}
                  text={choice}
                  state="default"
                  onClick={() => recordAndAdvance(i, false)}
                />
              ))}
            </div>

            <div className="flex justify-center">
              <button
                onClick={() => recordAndAdvance(null, true)}
                className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2"
              >
                I don&apos;t know — skip
              </button>
            </div>
          </>
        )}

        {/* Review screen */}
        {phase === "review" && (
          <div className="space-y-6">
            {/* Score card */}
            <div className="bg-white rounded-xl border border-neutral-200 shadow-brand-xs p-6 text-center">
              <p className="text-4xl font-bold text-neutral-900 mb-1">
                {correctCount}/{answers.length}
              </p>
              <p className="text-2xl font-semibold text-neutral-500 mb-2">{scorePct}%</p>
              <p className="text-sm text-neutral-500 mb-5">{encouragingCopy(scorePct)}</p>
              <div className="flex gap-2 justify-center flex-wrap">
                <button
                  onClick={() => fetchQuiz(sessionId)}
                  className="px-5 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
                >
                  New quiz
                </button>
                <Link
                  href={`/math/${course}/${categoryId}/practice`}
                  className="px-5 py-2.5 rounded-xl border border-neutral-200 text-sm font-semibold hover:bg-neutral-50 transition-colors"
                >
                  Practice
                </Link>
                <Link
                  href={backHref}
                  className="px-5 py-2.5 rounded-xl border border-neutral-200 text-sm font-semibold hover:bg-neutral-50 transition-colors"
                >
                  {isScoped ? "Back" : `Back to ${courseLabel}`}
                </Link>
              </div>
            </div>

            {/* Review list */}
            <div>
              <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">
                Review
              </h2>
              <div className="space-y-4">
                {answers.map((ans, qi) => {
                  const correct =
                    !ans.dont_know && ans.selected_index === ans.question.correct_index;
                  return (
                    <div
                      key={qi}
                      className={`rounded-xl border bg-white p-4 shadow-brand-xs ${
                        correct
                          ? "border-success-200"
                          : ans.dont_know
                          ? "border-neutral-200"
                          : "border-error-200"
                      }`}
                    >
                      <div className="flex items-start gap-2 mb-3">
                        <span
                          className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            correct
                              ? "bg-success-500 text-white"
                              : ans.dont_know
                              ? "bg-neutral-300 text-white"
                              : "bg-error-500 text-white"
                          }`}
                        >
                          {correct ? "✓" : ans.dont_know ? "?" : "✗"}
                        </span>
                        <p className="text-sm text-neutral-900 font-medium leading-snug">
                          <MathText>{ans.question.stem_latex}</MathText>
                        </p>
                      </div>

                      <div className="space-y-1.5 mb-3">
                        {ans.question.choices.map((choice, i) => {
                          const isCorrect = i === ans.question.correct_index;
                          const isPicked = !ans.dont_know && i === ans.selected_index;
                          let cls =
                            "flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ";
                          if (isCorrect)
                            cls += "border-success-400 bg-success-50 text-success-800";
                          else if (isPicked)
                            cls += "border-error-300 bg-error-50 text-error-700";
                          else cls += "border-neutral-100 text-neutral-400";
                          return (
                            <div key={i} className={cls}>
                              <span className="font-mono font-bold">
                                {String.fromCharCode(65 + i)}.
                              </span>
                              <MathText>{choice}</MathText>
                            </div>
                          );
                        })}
                      </div>

                      {ans.dont_know && (
                        <p className="text-xs text-neutral-400 italic mb-2">
                          You skipped this question.
                        </p>
                      )}

                      {ans.question.solution_latex && (
                        <div className="bg-brand-50 rounded-lg px-3 py-2 mb-2">
                          <p className="text-xs font-semibold text-brand-700 mb-0.5">
                            Solution
                          </p>
                          <p className="text-xs text-neutral-700 leading-relaxed">
                            <MathText>{ans.question.solution_latex}</MathText>
                          </p>
                        </div>
                      )}

                      <MathFeedbackWidget
                        sessionId={sessionId}
                        contentType="question"
                        contentId={ans.question.id}
                        className="mt-2"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function MathCategoryQuizPage({
  params,
}: {
  params: Promise<{ course: string; categoryId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <MathCategoryQuizInner params={params} />
    </Suspense>
  );
}

export default function MathCategoryQuizGated({
  params,
}: {
  params: Promise<{ course: string; categoryId: string }>;
}) {
  return (
    <LoginGate prompt="Sign in to take a math quiz.">
      <MathCategoryQuizPage params={params} />
    </LoginGate>
  );
}
