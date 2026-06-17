"use client";

import { useState, useEffect, useCallback, useRef, use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoginGate } from "@/components/auth/LoginGate";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import MathText from "@/components/mcat/MathText";
import MathFeedbackWidget from "@/components/math/MathFeedbackWidget";
import QuestionToolbar from "@/components/practice/QuestionToolbar";
import { primaryKeywordId } from "@/lib/primaryKeyword";
import { MathLessonView } from "@/components/math/MathLessonView";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { ComboMeter } from "@/components/gamification/ComboMeter";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { CorrectPulse } from "@/components/ui/CorrectPulse";
import { useStreakTouchOnce } from "@/components/gamification/useStreakTouchOnce";
import { comboReducer, onCorrectAnswer, onIncorrectAnswer } from "@/lib/gamification";
import { getOrCreateMathSession } from "@/lib/mathSession";
import {
  MathQueueKeyword,
  MathReviewKeyword,
  MathPracticeQueueResponse,
  MathQuestion,
  diffLabel,
  COURSE_LABELS,
} from "@/components/math/mathUiTypes";
import type { MathCourse } from "@/lib/mathTypes";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOPIC_MAX_QUESTIONS = 8;
const MASTERY_STREAK = 3;
const REVIEW_PROBABILITY = 0.35;
const DIFFICULTY_STORAGE_KEY = "math_practice_difficulty";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | "loading"
  | "lesson"
  | "practicing"
  | "revealed"
  | "generating"
  | "transition"
  | "done"
  | "error";

type DifficultyMode = "adaptive" | "easy" | "medium" | "hard";

interface AttemptResponse {
  correct: boolean;
  correct_index: number;
  keyword_states: Record<string, { score: number; state: string; needs_lesson: boolean }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pickReviewKeyword(pool: MathReviewKeyword[]): MathReviewKeyword | null {
  if (pool.length === 0) return null;
  const now = new Date();
  const pastDue = pool.filter(
    (kw) => kw.spaced_review_due_at != null && new Date(kw.spaced_review_due_at) <= now
  );
  const candidates = pastDue.length > 0 ? pastDue : pool;
  return candidates.reduce((best, kw) =>
    (kw.score ?? 0.5) < (best.score ?? 0.5) ? kw : best
  );
}

// ─── Practice inner component ─────────────────────────────────────────────────

function MathPracticeInner({
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
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const [queue, setQueue] = useState<MathQueueKeyword[]>([]);
  const [reviewPool, setReviewPool] = useState<MathReviewKeyword[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);

  const currentKeyword = queue[queueIndex] ?? null;

  const lessonedKeywordsRef = useRef<Set<string>>(new Set());
  const [topicCorrectStreak, setTopicCorrectStreak] = useState(0);
  const [topicQuestionCount, setTopicQuestionCount] = useState(0);
  const excludeIdsRef = useRef<string[]>([]);

  const [question, setQuestion] = useState<MathQuestion | null>(null);
  const [isReviewCard, setIsReviewCard] = useState(false);
  const [pendingReviewBetweenTopics, setPendingReviewBetweenTopics] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [showLessonOffer, setShowLessonOffer] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const consecutiveWrongRef = useRef(0);

  const [stats, setStats] = useState({ answered: 0, correct: 0, lessons: 0, topicsMastered: 0 });
  const [transitionLabel, setTransitionLabel] = useState("");
  const [combo, setCombo] = useState(0);
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState(false);
  const [usedRefresher, setUsedRefresher] = useState(false);

  useStreakTouchOnce();

  const [difficultyMode, setDifficultyMode] = useState<DifficultyMode>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
      if (stored === "adaptive" || stored === "easy" || stored === "medium" || stored === "hard")
        return stored as DifficultyMode;
    }
    return "adaptive";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficultyMode);
    }
  }, [difficultyMode]);

  const difficultyModeRef = useRef<DifficultyMode>(difficultyMode);
  useEffect(() => { difficultyModeRef.current = difficultyMode; }, [difficultyMode]);

  // ── Load question ──────────────────────────────────────────────────────────

  const loadQuestion = useCallback(
    async (sid: string, keywordId: string, forReview?: MathReviewKeyword, useSimilar?: boolean) => {
      setPhase("generating");
      setQuestion(null);
      setSelectedChoice(null);
      setShowLessonOffer(false);
      setShowHint(false);
      setErrorMsg("");
      setLastAnswerCorrect(false);
      setUsedRefresher(false);

      try {
        let data: { question: MathQuestion; generated?: boolean };

        if (useSimilar && question) {
          const res = await fetch("/api/math/similar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sid, question_id: question.id }),
          });
          if (!res.ok) throw new Error(await res.text().catch(() => "Error"));
          data = (await res.json()) as { question: MathQuestion };
        } else {
          const body: Record<string, unknown> = {
            session_id: sid,
            category_id: categoryId,
            keyword_id: keywordId,
            exclude_ids: excludeIdsRef.current,
            course: course as MathCourse,
          };
          const mode = difficultyModeRef.current;
          if (mode !== "adaptive") body.difficulty = mode;

          const res = await fetch("/api/math/next-question", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const msg = await res.text().catch(() => "Unknown error");
            setErrorMsg(msg);
            setPhase("error");
            return;
          }
          data = (await res.json()) as { question: MathQuestion; generated: boolean };
        }

        setQuestion(data.question);
        excludeIdsRef.current = [...excludeIdsRef.current, data.question.id];
        setIsReviewCard(!!forReview);
        setPhase("practicing");
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load question");
        setPhase("error");
      }
    },
    [categoryId, course, question]
  );

  // ── Start keyword ──────────────────────────────────────────────────────────

  const startKeyword = useCallback(
    async (sid: string, kw: MathQueueKeyword) => {
      setTopicCorrectStreak(0);
      setTopicQuestionCount(0);
      consecutiveWrongRef.current = 0;
      loadQuestion(sid, kw.id);
    },
    [loadQuestion]
  );

  // ── Fetch queue ────────────────────────────────────────────────────────────

  const fetchQueue = useCallback(
    async (sid: string) => {
      setPhase("loading");
      setErrorMsg("");
      try {
        let url = `/api/math/practice-queue?session_id=${encodeURIComponent(sid)}&course=${encodeURIComponent(course)}&category_id=${encodeURIComponent(categoryId)}`;
        if (keywordScopeId) url += `&keyword_id=${encodeURIComponent(keywordScopeId)}`;
        else if (umbrellaId) url += `&umbrella_id=${encodeURIComponent(umbrellaId)}`;

        const res = await fetch(url);
        if (!res.ok) {
          const msg = await res.text().catch(() => "Unknown error");
          setErrorMsg(msg);
          setPhase("error");
          return;
        }
        const data = (await res.json()) as MathPracticeQueueResponse;

        if (data.queue.length === 0) {
          setPhase("done");
          return;
        }

        setQueue(data.queue);
        setReviewPool(data.review_pool ?? []);
        setQueueIndex(0);
        setTopicCorrectStreak(0);
        setTopicQuestionCount(0);
        excludeIdsRef.current = [];
        setIsReviewCard(false);
        setPendingReviewBetweenTopics(false);

        const kw = data.queue[0]!;
        await startKeyword(sid, kw);
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load queue");
        setPhase("error");
      }
    },
    [categoryId, course, umbrellaId, keywordScopeId, startKeyword]
  );

  // Mount
  useEffect(() => {
    (async () => {
      const sid = await getOrCreateMathSession();
      setSessionId(sid);
      await fetchQueue(sid);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handle choice ──────────────────────────────────────────────────────────

  const handleChoice = useCallback(
    async (idx: number) => {
      if (!question || !currentKeyword || phase !== "practicing") return;

      setSelectedChoice(idx);
      setPhase("revealed");

      const correct = idx === question.correct_index;
      setLastAnswerCorrect(correct);
      setCombo((prev) => {
        const next = comboReducer({ count: prev }, correct ? "correct" : "incorrect").count;
        if (correct) onCorrectAnswer(next);
        else onIncorrectAnswer();
        return next;
      });

      setStats((s) => ({ ...s, answered: s.answered + 1, correct: s.correct + (correct ? 1 : 0) }));

      if (!isReviewCard) {
        setTopicQuestionCount((n) => n + 1);
        if (correct) {
          setTopicCorrectStreak((n) => n + 1);
          consecutiveWrongRef.current = 0;
        } else {
          setTopicCorrectStreak(0);
          consecutiveWrongRef.current += 1;
        }
      }

      try {
        const res = await fetch("/api/math/attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            question_id: question.id,
            selected_index: idx,
            context: "practice",
            course: course as MathCourse,
            usedRefresher,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as AttemptResponse;
          const kwState = data.keyword_states[currentKeyword.id];
          const needsLesson = kwState?.needs_lesson === true;
          const tooManyWrong = consecutiveWrongRef.current >= 2;
          if (
            (tooManyWrong || needsLesson) &&
            !lessonedKeywordsRef.current.has(currentKeyword.id)
          ) {
            setShowLessonOffer(true);
          }
        }
      } catch { /* non-fatal */ }
    },
    [question, currentKeyword, phase, sessionId, isReviewCard, course, usedRefresher]
  );

  // ── Handle don't know ──────────────────────────────────────────────────────

  const handleDontKnow = useCallback(async () => {
    if (!question || !currentKeyword || phase !== "practicing") return;
    setSelectedChoice(null);
    setPhase("revealed");
    setLastAnswerCorrect(false);
    setCombo((prev) => comboReducer({ count: prev }, "incorrect").count);
    onIncorrectAnswer();
    setStats((s) => ({ ...s, answered: s.answered + 1 }));
    if (!isReviewCard) {
      consecutiveWrongRef.current += 1;
      setTopicCorrectStreak(0);
      setTopicQuestionCount((n) => n + 1);
    }
    try {
      const res = await fetch("/api/math/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          question_id: question.id,
          dont_know: true,
          context: "practice",
          course: course as MathCourse,
          usedRefresher,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as AttemptResponse;
        const kwState = data.keyword_states[currentKeyword.id];
        const needsLesson = kwState?.needs_lesson === true;
        if ((consecutiveWrongRef.current >= 2 || needsLesson) && !lessonedKeywordsRef.current.has(currentKeyword.id)) {
          setShowLessonOffer(true);
        }
      }
    } catch { /* non-fatal */ }
  }, [question, currentKeyword, phase, sessionId, isReviewCard, course, usedRefresher]);

  // ── Advance keyword ────────────────────────────────────────────────────────

  const advanceKeyword = useCallback(
    (opts?: { wasMastered: boolean }) => {
      if (!currentKeyword) return;
      if (opts?.wasMastered) setStats((s) => ({ ...s, topicsMastered: s.topicsMastered + 1 }));
      const nextIndex = queueIndex + 1;
      if (nextIndex >= queue.length) { setPhase("done"); return; }
      const nextKw = queue[nextIndex]!;
      const shouldInsertReview = reviewPool.length > 0 && Math.random() < REVIEW_PROBABILITY;
      setPendingReviewBetweenTopics(shouldInsertReview);
      setTransitionLabel(nextKw.label);
      setPhase("transition");
      setTimeout(() => {
        setQueueIndex(nextIndex);
        setIsReviewCard(false);
        if (shouldInsertReview) {
          const reviewKw = pickReviewKeyword(reviewPool);
          if (reviewKw) { loadQuestion(sessionId, reviewKw.id, reviewKw); return; }
        }
        startKeyword(sessionId, nextKw);
      }, 1200);
    },
    [currentKeyword, queueIndex, queue, reviewPool, sessionId, loadQuestion, startKeyword]
  );

  // ── Track refs for next handler ────────────────────────────────────────────

  const topicStreakRef = useRef(topicCorrectStreak);
  const topicCountRef = useRef(topicQuestionCount);
  useEffect(() => { topicStreakRef.current = topicCorrectStreak; }, [topicCorrectStreak]);
  useEffect(() => { topicCountRef.current = topicQuestionCount; }, [topicQuestionCount]);

  const handleNext = useCallback(() => {
    if (!currentKeyword) return;

    if (isReviewCard) {
      setIsReviewCard(false);
      if (pendingReviewBetweenTopics) {
        setPendingReviewBetweenTopics(false);
        const nextKw = queue[queueIndex];
        if (nextKw) { startKeyword(sessionId, nextKw); }
        else { setPhase("done"); }
        return;
      }
      loadQuestion(sessionId, currentKeyword.id);
      return;
    }

    const streak = topicStreakRef.current;
    const count = topicCountRef.current;
    const masteredByStreak = streak >= MASTERY_STREAK;
    const hitCap = count >= TOPIC_MAX_QUESTIONS;

    if (masteredByStreak || hitCap) {
      if (hitCap && !masteredByStreak) {
        setQueue((prev) => {
          const copy = [...prev];
          const [capped] = copy.splice(queueIndex, 1);
          if (capped) copy.push(capped);
          return copy;
        });
      }
      advanceKeyword({ wasMastered: masteredByStreak });
      return;
    }

    const lastWasCorrect = streak > 0;
    const useSimilarPath = lastWasCorrect && question !== null && Math.random() < 0.5;
    setTopicQuestionCount((n) => n + 1);
    loadQuestion(sessionId, currentKeyword.id, undefined, useSimilarPath);
  }, [
    currentKeyword, isReviewCard, pendingReviewBetweenTopics, queue, queueIndex,
    sessionId, loadQuestion, startKeyword, advanceKeyword, question
  ]);

  const handleSimilar = useCallback(async () => {
    if (!question || !currentKeyword) return;
    if (!isReviewCard) setTopicQuestionCount((n) => n + 1);
    await loadQuestion(sessionId, currentKeyword.id, undefined, true);
  }, [question, currentKeyword, sessionId, isReviewCard, loadQuestion]);

  const handleStartLesson = useCallback(() => {
    setShowLessonOffer(false);
    setPhase("lesson");
  }, []);

  const handleLessonComplete = useCallback(() => {
    if (!currentKeyword) return;
    lessonedKeywordsRef.current.add(currentKeyword.id);
    setStats((s) => ({ ...s, lessons: s.lessons + 1 }));
    consecutiveWrongRef.current = 0;
    setTopicCorrectStreak(0);
    loadQuestion(sessionId, currentKeyword.id);
  }, [currentKeyword, sessionId, loadQuestion]);

  const handleLessonSkip = useCallback(() => {
    if (!currentKeyword) return;
    lessonedKeywordsRef.current.add(currentKeyword.id);
    consecutiveWrongRef.current = 0;
    setTopicCorrectStreak(0);
    loadQuestion(sessionId, currentKeyword.id);
  }, [currentKeyword, sessionId, loadQuestion]);

  // ─── Render ────────────────────────────────────────────────────────────────

  const diff = question ? diffLabel(question.difficulty) : null;
  const masteryDots = Array.from({ length: MASTERY_STREAK }, (_, i) =>
    i < topicCorrectStreak ? "●" : "○"
  ).join("");
  const cappedMsg = topicQuestionCount >= TOPIC_MAX_QUESTIONS ? " · cap" : "";

  const nextButtonLabel = () => {
    if (isReviewCard) return "Next";
    const streak = topicStreakRef.current;
    const count = topicCountRef.current;
    if (streak >= MASTERY_STREAK || count >= TOPIC_MAX_QUESTIONS)
      return queueIndex + 1 >= queue.length ? "Finish" : "Next topic";
    return "Next";
  };

  const difficultyOptions: { value: DifficultyMode; label: string }[] = [
    { value: "adaptive", label: "Adaptive" },
    { value: "easy", label: "Easy" },
    { value: "medium", label: "Medium" },
    { value: "hard", label: "Hard" },
  ];

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 py-2.5 flex items-center gap-2 flex-wrap">
          {/* Left: back + title */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link href={backHref} className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0 whitespace-nowrap">
              {isScoped ? "← Back" : `← ${courseLabel}`}
            </Link>
            {isScoped && scopeLabel && (
              <span className="hidden sm:inline shrink-0 text-xs px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 font-medium">
                {umbrellaId ? "Topic" : "Keyword"}: {scopeLabel}
              </span>
            )}
            {currentKeyword && phase !== "loading" && phase !== "done" && (
              <p className="font-semibold text-neutral-900 text-sm truncate min-w-0">
                {currentKeyword.label}
              </p>
            )}
          </div>
          {/* Right: actions + widgets */}
          <div className="flex items-center gap-2 shrink-0">
            {currentKeyword && (phase === "practicing" || phase === "revealed") && !isReviewCard && (
              <button
                onClick={handleStartLesson}
                className="hidden sm:inline text-xs text-neutral-400 hover:text-brand-600 underline underline-offset-2 transition-colors whitespace-nowrap"
              >
                Learn this
              </button>
            )}
            {stats.answered > 0 && (
              <p className="text-xs text-neutral-500 tabular-nums shrink-0">
                {stats.correct}/{stats.answered}
              </p>
            )}
            <StreakBadge />
            <SoundToggle />
          </div>
        </div>

        {/* Mastery meter */}
        {currentKeyword && !isReviewCard && (phase === "practicing" || phase === "revealed") && (
          <div className="w-full px-6 pb-1.5">
            <p className="text-xs text-neutral-400">
              Mastering:{" "}
              <span className="font-mono tracking-wider text-brand-500">
                {masteryDots}
              </span>{" "}
              <span className="text-neutral-400">
                ({topicCorrectStreak}/{MASTERY_STREAK}{cappedMsg})
              </span>
            </p>
          </div>
        )}

        {/* Difficulty control */}
        {(phase === "practicing" || phase === "revealed" || phase === "generating") && (
          <div className="w-full px-6 pb-2">
            <div className="inline-flex rounded-lg border border-neutral-200 overflow-hidden text-xs">
              {difficultyOptions.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setDifficultyMode(value)}
                  className={`px-2.5 py-1 transition-colors font-medium ${
                    difficultyMode === value
                      ? "bg-brand-500 text-white"
                      : "bg-white text-neutral-500 hover:bg-neutral-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Queue progress */}
        {queue.length > 0 && phase !== "loading" && phase !== "done" && (
          <div className="w-full px-6 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-1 bg-brand-500 rounded-full transition-all"
                  style={{ width: `${Math.round((queueIndex / queue.length) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-neutral-400 shrink-0">
                {queueIndex + 1} / {queue.length}
              </span>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Loading */}
        {phase === "loading" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Building your practice queue…</p>
          </div>
        )}

        {/* Generating */}
        {phase === "generating" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Finding your next question…</p>
            <p className="text-xs text-neutral-400">Can take 5–30 seconds</p>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center space-y-3">
            <p className="text-sm text-error-600">{errorMsg || "Something went wrong"}</p>
            <button
              onClick={() => {
                if (currentKeyword) loadQuestion(sessionId, currentKeyword.id);
                else fetchQueue(sessionId);
              }}
              className="px-4 py-2 rounded-lg bg-error-600 text-white text-sm font-medium hover:bg-error-700 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Transition */}
        {phase === "transition" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="bg-white rounded-xl border border-neutral-200 shadow-brand-xs px-6 py-5 text-center space-y-2 max-w-sm w-full">
              <p className="text-xs text-neutral-400 uppercase tracking-wide font-medium">
                Keyword complete
              </p>
              <p className="text-base font-semibold text-neutral-900 truncate">
                {transitionLabel}
              </p>
              <p className="text-sm text-neutral-500 animate-pulse">
                Moving to next keyword…
              </p>
            </div>
          </div>
        )}

        {/* Lesson (inline) */}
        {phase === "lesson" && currentKeyword && sessionId && (
          <MathLessonView
            sessionId={sessionId}
            keywordId={currentKeyword.id}
            keywordLabel={currentKeyword.label}
            onComplete={handleLessonComplete}
            onSkip={handleLessonSkip}
          />
        )}

        {/* Practice / Revealed */}
        {(phase === "practicing" || phase === "revealed") && question && (
          <>
            {/* Badge row */}
            <div className="flex items-center gap-2 flex-wrap">
              {isReviewCard && (
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-brand-100 text-brand-700">
                  Review
                </span>
              )}
              {diff && (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${diff.cls}`}>
                  {diff.label}
                </span>
              )}
            </div>

            {/* Stem */}
            <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-brand-xs">
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{question.stem_latex}</MathText>
              </p>
            </div>

            <QuestionToolbar
              system="math"
              course={course}
              keywordId={
                question.primary_keyword_id ??
                primaryKeywordId(question.keyword_weights)
              }
              sessionId={sessionId}
              questionId={question.id}
              contentType="question"
              resetSignal={question.id}
              answerSignal={phase}
              onRefresherUsed={() => setUsedRefresher(true)}
            />

            {/* Hint button */}
            {phase === "practicing" && question.hint_latex && (
              <div className="flex justify-center">
                {!showHint ? (
                  <button
                    onClick={() => setShowHint(true)}
                    className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2"
                  >
                    Show hint
                  </button>
                ) : (
                  <div className="bg-amber-50 rounded-xl border border-amber-100 p-3 w-full text-left">
                    <p className="text-xs font-semibold text-amber-700 mb-1">Hint</p>
                    <p className="text-sm text-neutral-700 leading-relaxed">
                      <MathText>{question.hint_latex}</MathText>
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Combo meter */}
            <ComboMeter combo={combo} />

            {/* Choices */}
            <CorrectPulse
              trigger={phase === "revealed" && lastAnswerCorrect}
              className="block w-full"
            >
              <div className="space-y-2">
                {question.choices.map((choice, i) => {
                  let state: "default" | "selected" | "correct" | "wrong" | "dimmed" = "default";
                  if (phase === "revealed") {
                    if (i === question.correct_index) state = "correct";
                    else if (i === selectedChoice) state = "wrong";
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
            </CorrectPulse>

            {/* I don't know */}
            {phase === "practicing" && (
              <div className="flex justify-center">
                <button
                  onClick={handleDontKnow}
                  className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2 transition-colors"
                >
                  I don&apos;t know
                </button>
              </div>
            )}

            {/* Worked solution */}
            {phase === "revealed" && question.solution_latex && (
              <div className="bg-brand-50 rounded-xl border border-brand-100 p-4">
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-1.5">
                  Solution
                </p>
                <p className="text-sm text-neutral-700 leading-relaxed">
                  <MathText>{question.solution_latex}</MathText>
                </p>
              </div>
            )}

            {/* Lesson offer banner */}
            {phase === "revealed" && showLessonOffer && currentKeyword && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="text-sm font-medium text-amber-800">
                  Struggling with {currentKeyword.label}? Take a quick lesson.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleStartLesson}
                    className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-colors"
                  >
                    Start lesson
                  </button>
                  <button
                    onClick={() => setShowLessonOffer(false)}
                    className="flex-1 py-2.5 rounded-xl border border-amber-200 bg-white text-amber-700 text-sm font-medium hover:bg-amber-50 transition-colors"
                  >
                    Keep practicing
                  </button>
                </div>
              </div>
            )}

            {/* Feedback + actions */}
            {phase === "revealed" && (
              <>
                <MathFeedbackWidget
                  sessionId={sessionId}
                  contentType="question"
                  contentId={question.id}
                  className="px-1"
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  {!isReviewCard && (
                    <button
                      onClick={handleSimilar}
                      className="flex-1 py-3 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-medium transition-colors"
                    >
                      Similar question
                    </button>
                  )}
                  <button
                    onClick={handleNext}
                    className="flex-1 py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
                  >
                    {nextButtonLabel()}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* Done */}
        {phase === "done" && (
          <div className="bg-white rounded-xl border border-neutral-200 p-8 shadow-brand-xs text-center space-y-5">
            <div className="w-14 h-14 rounded-full bg-success-100 flex items-center justify-center mx-auto">
              <span className="text-success-600 text-2xl font-bold">✓</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-neutral-900">
                {queue.length === 0 ? "All keywords mastered" : "Great session!"}
              </h1>
              <p className="text-sm text-neutral-500 mt-1">
                {queue.length === 0
                  ? "Check back later for spaced-review questions."
                  : `Worked through ${queue.length} keyword${queue.length !== 1 ? "s" : ""}.`}
              </p>
            </div>
            {stats.answered > 0 && (
              <div className="bg-neutral-50 rounded-xl border border-neutral-100 p-4 space-y-2 text-left">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Questions answered</span>
                  <span className="font-medium">{stats.answered}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Correct</span>
                  <span className="font-medium">
                    {stats.correct} ({stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 0}%)
                  </span>
                </div>
                {stats.topicsMastered > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Topics mastered</span>
                    <span className="font-medium text-success-700">{stats.topicsMastered}</span>
                  </div>
                )}
                {stats.lessons > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Lessons taken</span>
                    <span className="font-medium">{stats.lessons}</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  lessonedKeywordsRef.current = new Set();
                  setStats({ answered: 0, correct: 0, lessons: 0, topicsMastered: 0 });
                  fetchQueue(sessionId);
                }}
                className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
              >
                Practice again
              </button>
              <Link
                href={backHref}
                className="w-full py-3 rounded-xl border border-neutral-200 bg-white text-neutral-600 text-sm font-medium hover:bg-neutral-50 transition-colors text-center"
              >
                {isScoped ? "Back" : `Back to ${courseLabel}`}
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function MathPracticePage({
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
      <MathPracticeInner params={params} />
    </Suspense>
  );
}

export default function MathPracticePageGated({
  params,
}: {
  params: Promise<{ course: string; categoryId: string }>;
}) {
  return (
    <LoginGate prompt="Sign in to practice math.">
      <MathPracticePage params={params} />
    </LoginGate>
  );
}
