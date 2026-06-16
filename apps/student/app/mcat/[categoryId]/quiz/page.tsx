"use client";

import { useState, useEffect, use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import { LoadingPanel } from "@/components/mcat/LoadingPanel";
import FeedbackWidget from "@/components/mcat/FeedbackWidget";
import MathText from "@/components/mcat/MathText";
import QuestionToolbar from "@/components/practice/QuestionToolbar";
import { primaryKeywordId } from "@/lib/primaryKeyword";
import { getOrCreateMcatSession } from "@/lib/mcatSession";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { ComboMeter } from "@/components/gamification/ComboMeter";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { useStreakTouchOnce } from "@/components/gamification/useStreakTouchOnce";
import { comboReducer, onCorrectAnswer, onIncorrectAnswer } from "@/lib/gamification";

const QUIZ_COUNT = 8;

interface Question {
  id: string;
  stem: string;
  choices: string[];
  correct_index: number;
  explanation: string;
  keyword_weights: Record<string, number>;
  /** Authoritative toolbar keyword (embedding-matched); falls back to max-weight. */
  primary_keyword_id?: string | null;
  difficulty: number;
  parent_question_id: string | null;
}

interface UserAnswer {
  question: Question;
  selected_index: number | null; // null = don't know
  dont_know: boolean;
}

interface TaxonomyChild {
  id: string;
}

interface TaxonomyUmbrella {
  id: string;
  children: TaxonomyChild[];
}

interface TaxonomyCategory {
  id: string;
  label: string;
  umbrellas?: TaxonomyUmbrella[];
}

type Phase = "loading" | "quiz" | "review" | "error";

function encouragingCopy(pct: number): string {
  if (pct === 100) return "Perfect score! Outstanding work!";
  if (pct >= 80) return "Great job — you're really solid on this material!";
  if (pct >= 60) return "Good effort! A bit more practice and you'll have it down.";
  if (pct >= 40) return "Keep going — you're building momentum.";
  return "Every attempt makes you stronger. Review the explanations and try again!";
}

function McatQuizInner({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = use(params);

  // Scope params
  const searchParams = useSearchParams();
  const umbrellaId = searchParams.get("umbrella");
  const keywordScopeId = searchParams.get("keyword");
  const scopeLabel = searchParams.get("label");
  const isScoped = !!(umbrellaId || keywordScopeId);
  const backHref = isScoped ? `/mcat/${categoryId}` : "/mcat";

  const [sessionId, setSessionId] = useState("");
  const [categoryLabel, setCategoryLabel] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<UserAnswer[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // ── Gamification ──────────────────────────────────────────────────────────
  const [combo, setCombo] = useState(0);
  const [usedRefresher, setUsedRefresher] = useState(false);

  useStreakTouchOnce();

  // Resolve umbrella → children ids via taxonomy
  const resolveKeywordIds = async (
    sid: string
  ): Promise<string[] | undefined> => {
    if (keywordScopeId) return [keywordScopeId];
    if (!umbrellaId) return undefined;

    try {
      const r = await fetch(`/api/mcat/taxonomy?session_id=${sid}`);
      if (!r.ok) return undefined;
      const d = await r.json() as { categories: TaxonomyCategory[] };
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

    try {
      const keywordIds = await resolveKeywordIds(sid);

      const body: Record<string, unknown> = {
        session_id: sid,
        category_id: categoryId,
        count: QUIZ_COUNT,
      };
      if (keywordIds) {
        body.keyword_ids = keywordIds;
      }

      const res = await fetch("/api/mcat/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Unknown error"));
      const data = await res.json() as { questions: Question[] };
      setQuestions(data.questions ?? []);
      setPhase("quiz");
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Failed to build quiz");
      setPhase("error");
    }
  };

  useEffect(() => {
    (async () => {
      const sid = await getOrCreateMcatSession();
      setSessionId(sid);

      try {
        const r = await fetch(`/api/mcat/taxonomy?session_id=${sid}`);
        if (r.ok) {
          const d = await r.json() as { categories: TaxonomyCategory[] };
          const cat = (d.categories ?? []).find((c) => c.id === categoryId);
          if (cat) setCategoryLabel(cat.label);
        }
      } catch {
        // Non-fatal
      }

      await fetchQuiz(sid);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recordAndAdvance = async (selectedIndex: number | null, dontKnow: boolean) => {
    const q = questions[currentIdx];
    if (!q) return;

    const newAnswer: UserAnswer = {
      question: q,
      selected_index: selectedIndex,
      dont_know: dontKnow,
    };
    const newAnswers = [...answers, newAnswer];
    setAnswers(newAnswers);

    // ── Gamification: quiz answers fire at moment of selection ───────────
    const correct = !dontKnow && selectedIndex === q.correct_index;
    setCombo((prev) => {
      const next = comboReducer({ count: prev }, correct ? "correct" : "incorrect").count;
      if (correct) onCorrectAnswer(next);
      else onIncorrectAnswer();
      return next;
    });

    // Record attempt (fire and forget — don't block UX)
    fetch("/api/mcat/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: q.id,
        ...(dontKnow
          ? { dont_know: true }
          : { selected_index: selectedIndex }),
        context: "quiz",
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

  const handleChoice = (idx: number) => {
    if (phase !== "quiz") return;
    recordAndAdvance(idx, false);
  };

  const handleDontKnow = () => {
    if (phase !== "quiz") return;
    recordAndAdvance(null, true);
  };

  // ── Review score computation ────────────────────────────────────────────────
  const correctCount = answers.filter(
    (a) => !a.dont_know && a.selected_index === a.question.correct_index
  ).length;
  const scorePct =
    answers.length > 0 ? Math.round((correctCount / answers.length) * 100) : 0;

  const currentQ = questions[currentIdx];
  const progress = questions.length > 0 ? currentIdx / questions.length : 0;

  // Derive heading label
  const headingLabel = isScoped && scopeLabel
    ? `${scopeLabel} Quiz`
    : categoryLabel
    ? `${categoryLabel} Quiz`
    : "Quiz";

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href={backHref} className="shrink-0">
              <LoderaLogo size={22} />
            </Link>
            <Link
              href={backHref}
              className="text-xs text-neutral-400 hover:text-brand-600 shrink-0 transition-colors"
            >
              {isScoped ? "← Back" : "← MCAT"}
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
        <ProgressBar
          value={Math.round(progress * 100)}
          size="xs"
          color="brand"
          label="Quiz progress"
          className="rounded-none"
        />
      )}

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Loading state */}
        {phase === "loading" && (
          <LoadingPanel
            message="Building your quiz… this can take up to a minute"
            sub="Generating fresh questions tailored to you"
          />
        )}

        {/* Shimmer cards while loading */}
        {phase === "loading" && (
          <div className="space-y-3 opacity-40 pointer-events-none">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-neutral-200 animate-pulse" />
            ))}
          </div>
        )}

        {/* Error state */}
        {phase === "error" && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center">
            <p className="text-sm text-error-600 mb-3">
              {errorMsg || "Failed to build quiz"}
            </p>
            <Button variant="primary" size="sm" onClick={() => fetchQuiz(sessionId)}>
              Try again
            </Button>
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
                      ? "bg-neutral-800"
                      : "bg-neutral-200"
                  }`}
                />
              ))}
            </div>

            {/* Stem */}
            <Card>
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{currentQ.stem}</MathText>
              </p>
            </Card>

            <QuestionToolbar
              system="mcat"
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

            {/* Combo meter — appears above choices from combo ≥ 2 */}
            <ComboMeter combo={combo} />

            {/* Choices — no immediate feedback */}
            <div className="space-y-2">
              {currentQ.choices.map((choice, i) => (
                <ChoiceButton
                  key={i}
                  index={i}
                  text={choice}
                  state="default"
                  onClick={() => handleChoice(i)}
                />
              ))}
            </div>

            <div className="flex justify-center">
              <button
                onClick={handleDontKnow}
                className="text-xs text-neutral-400 hover:text-neutral-600 underline"
              >
                I don&apos;t know — skip
              </button>
            </div>
          </>
        )}

        {/* Review / end screen */}
        {phase === "review" && (
          <div className="space-y-6">
            {/* Score card */}
            <Card className="p-6 text-center">
              <p className="text-4xl font-bold text-neutral-900 mb-1">
                {correctCount}/{answers.length}
              </p>
              <p className="text-2xl font-semibold text-neutral-600 mb-2">{scorePct}%</p>
              <p className="text-sm text-neutral-500 mb-4">
                {encouragingCopy(scorePct)}
              </p>
              <div className="flex gap-2 justify-center flex-wrap">
                <Button variant="primary" size="md" onClick={() => fetchQuiz(sessionId)}>
                  New quiz
                </Button>
                <Link href={backHref}>
                  <Button variant="secondary" size="md">
                    {isScoped ? "Back" : "Back to MCAT"}
                  </Button>
                </Link>
              </div>
            </Card>

            {/* Review list */}
            <div>
              <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">
                Review
              </h2>
              <div className="space-y-4">
                {answers.map((ans, qi) => {
                  const correct =
                    !ans.dont_know &&
                    ans.selected_index === ans.question.correct_index;
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
                          <MathText>{ans.question.stem}</MathText>
                        </p>
                      </div>

                      <div className="space-y-1.5 mb-3">
                        {ans.question.choices.map((choice, i) => {
                          const isCorrect = i === ans.question.correct_index;
                          const isPicked =
                            !ans.dont_know && i === ans.selected_index;
                          let cls =
                            "flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ";
                          if (isCorrect)
                            cls += "border-success-400 bg-success-50 text-success-700";
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

                      {ans.question.explanation && (
                        <div className="bg-brand-50 rounded-lg px-3 py-2">
                          <p className="text-xs text-brand-700 leading-relaxed">
                            <MathText>{ans.question.explanation}</MathText>
                          </p>
                        </div>
                      )}

                      <FeedbackWidget
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

export default function McatQuizPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="relative w-10 h-10">
          <div className="w-10 h-10 rounded-full border-4 border-brand-100" />
          <div className="absolute inset-0 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
        </div>
      </div>
    }>
      <McatQuizInner params={params} />
    </Suspense>
  );
}
