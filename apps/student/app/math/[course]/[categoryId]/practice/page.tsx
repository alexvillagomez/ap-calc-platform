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
import { GrindMeter } from "@/components/gamification/GrindMeter";
import { NavMenu } from "@/components/nav/NavMenu";
import { CorrectPulse } from "@/components/ui/CorrectPulse";
import { useStreakTouchOnce } from "@/components/gamification/useStreakTouchOnce";
import { comboReducer, onCorrectAnswer, onIncorrectAnswer } from "@/lib/gamification";
import { getOrCreateMathSession } from "@/lib/mathSession";
import {
  MathQueueKeyword,
  MathReviewKeyword,
  MathPracticeQueueResponse,
  MathQuestion,
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

/** A snapshot of a previously-seen question for read-only review navigation. */
interface HistoryEntry {
  question: MathQuestion;
  selectedChoice: number | null;
  revealed: boolean;
  wasCorrect: boolean | null;
}

const HISTORY_CAP = 30;

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
  const recentKeywordIdsRef = useRef<string[]>([]);
  const recentQuestionIdsRef = useRef<string[]>([]);
  const seenStemsRef = useRef<string[]>([]);

  const [question, setQuestion] = useState<MathQuestion | null>(null);
  // Movement/review history: previously-seen questions (answered or skipped).
  const historyRef = useRef<HistoryEntry[]>([]);
  // null = viewing the LIVE current question; otherwise index into historyRef.
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const inReview = reviewIndex !== null;
  const reviewEntry = inReview ? historyRef.current[reviewIndex] ?? null : null;
  const [isReviewCard, setIsReviewCard] = useState(false);
  const [pendingReviewBetweenTopics, setPendingReviewBetweenTopics] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [showLessonOffer, setShowLessonOffer] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const consecutiveWrongRef = useRef(0);

  const [stats, setStats] = useState({ answered: 0, correct: 0, lessons: 0, topicsMastered: 0 });
  const [transitionLabel, setTransitionLabel] = useState("");
  const [combo, setCombo] = useState(0);
  const [sessionStart] = useState(() => Date.now());
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
      setReviewIndex(null);
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
            recent_keyword_ids: recentKeywordIdsRef.current.slice(-6),
            recent_question_ids: recentQuestionIdsRef.current.slice(-10),
            seen_stems: seenStemsRef.current.slice(-30),
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
        recentQuestionIdsRef.current = [...recentQuestionIdsRef.current, data.question.id].slice(-10);
        if (data.question.primary_keyword_id) {
          recentKeywordIdsRef.current = [...recentKeywordIdsRef.current, data.question.primary_keyword_id].slice(-10);
        }
        const stemText = data.question.stem_latex ?? "";
        if (stemText) {
          seenStemsRef.current = [...seenStemsRef.current, stemText].slice(-50);
        }
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

  // Push the currently-live question into review history (answered or skipped).
  const pushHistory = useCallback(
    (entry: HistoryEntry) => {
      historyRef.current = [...historyRef.current, entry].slice(-HISTORY_CAP);
    },
    []
  );

  const handleChoice = useCallback(
    async (idx: number) => {
      if (!question || !currentKeyword || phase !== "practicing" || inReview) return;

      setSelectedChoice(idx);
      setPhase("revealed");

      const correct = idx === question.correct_index;
      pushHistory({ question, selectedChoice: idx, revealed: true, wasCorrect: correct });
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
            !correct &&
            (tooManyWrong || needsLesson) &&
            !lessonedKeywordsRef.current.has(currentKeyword.id)
          ) {
            setShowLessonOffer(true);
          }
        }
      } catch { /* non-fatal */ }
    },
    [question, currentKeyword, phase, sessionId, isReviewCard, course, usedRefresher, inReview, pushHistory]
  );

  // ── Handle don't know ──────────────────────────────────────────────────────

  const handleDontKnow = useCallback(async () => {
    if (!question || !currentKeyword || phase !== "practicing" || inReview) return;
    setSelectedChoice(null);
    setPhase("revealed");
    pushHistory({ question, selectedChoice: null, revealed: true, wasCorrect: false });
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
  }, [question, currentKeyword, phase, sessionId, isReviewCard, course, usedRefresher, inReview, pushHistory]);

  // ── Free movement: Back / Forward / Skip ───────────────────────────────────

  // Step back to an earlier history entry (read-only review).
  const handleReviewBack = useCallback(() => {
    const hist = historyRef.current;
    if (hist.length === 0) return;
    setReviewIndex((cur) => (cur === null ? hist.length - 1 : Math.max(0, cur - 1)));
  }, []);

  // Step forward through history; past the last entry returns to the LIVE question.
  const handleReviewForward = useCallback(() => {
    setReviewIndex((cur) => {
      if (cur === null) return null;
      const next = cur + 1;
      return next >= historyRef.current.length ? null : next;
    });
  }, []);

  // Skip the live question: record NO attempt, no mastery change; load next.
  const handleSkip = useCallback(() => {
    if (!question || !currentKeyword || phase !== "practicing" || inReview) return;
    pushHistory({ question, selectedChoice: null, revealed: false, wasCorrect: null });
    const useSimilarPath = false;
    loadQuestion(sessionId, currentKeyword.id, undefined, useSimilarPath);
  }, [question, currentKeyword, phase, inReview, pushHistory, loadQuestion, sessionId]);

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
        <div className="w-full px-4 sm:px-6 py-2.5 space-y-1.5">
          {/* Row 1 — nav controls */}
          <div className="flex items-center gap-2">
            <Link href={backHref} className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0 whitespace-nowrap">
              {isScoped ? "← Back" : `← ${courseLabel}`}
            </Link>
            <span className="text-[11px] uppercase tracking-wide text-neutral-400 font-medium">
              Practice
            </span>
            <div className="ml-auto flex items-center gap-2 shrink-0">
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
              <NavMenu />
            </div>
          </div>
          {/* Row 2 — topic title gets its own room */}
          {currentKeyword && phase !== "loading" && phase !== "done" ? (
            <h1 className="font-semibold text-neutral-900 text-base leading-snug">
              {currentKeyword.label}
            </h1>
          ) : (
            isScoped && scopeLabel && (
              <h1 className="font-semibold text-neutral-900 text-base leading-snug">
                {scopeLabel}
              </h1>
            )
          )}
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

      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4 pb-safe-bottom">
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

        {/* Practice / Revealed / Review */}
        {(phase === "practicing" || phase === "revealed") && (inReview ? reviewEntry : question) && (() => {
          // When in review, render the historical entry READ-ONLY.
          const dispQuestion = (inReview ? reviewEntry!.question : question)!;
          const dispSelected = inReview ? reviewEntry!.selectedChoice : selectedChoice;
          const dispRevealed = inReview ? reviewEntry!.revealed : phase === "revealed";
          const hasEarlier = inReview ? reviewIndex! > 0 : historyRef.current.length > 0;
          const positionLabel = inReview
            ? `Reviewing earlier question (${reviewIndex! + 1} of ${historyRef.current.length})`
            : `Question ${historyRef.current.length + 1}`;
          return (
          <>
            {/* Grind meter */}
            <div className="pb-2">
              <GrindMeter mode="quiz" streak={combo} answered={stats.answered} startedAt={sessionStart} hidden />
            </div>

            {/* Position + movement controls */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs text-neutral-400">{positionLabel}</span>
              <div className="flex items-center gap-2">
                {hasEarlier && (
                  <button
                    onClick={handleReviewBack}
                    className="text-xs text-neutral-500 hover:text-brand-600 underline underline-offset-2 transition-colors"
                  >
                    ← Back
                  </button>
                )}
                {inReview && (
                  <button
                    onClick={handleReviewForward}
                    className="text-xs text-neutral-500 hover:text-brand-600 underline underline-offset-2 transition-colors"
                  >
                    {reviewIndex! + 1 >= historyRef.current.length ? "Return to current →" : "Forward →"}
                  </button>
                )}
                {!inReview && phase === "practicing" && (
                  <button
                    onClick={handleSkip}
                    className="text-xs text-neutral-500 hover:text-brand-600 underline underline-offset-2 transition-colors"
                  >
                    Skip →
                  </button>
                )}
              </div>
            </div>

            {/* Badge row */}
            <div className="flex items-center gap-2 flex-wrap">
              {isReviewCard && !inReview && (
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-brand-100 text-brand-700">
                  Review
                </span>
              )}
              {inReview && (
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-neutral-200 text-neutral-600">
                  {dispRevealed ? "Read-only" : "Skipped"}
                </span>
              )}
            </div>

            {/* Stem */}
            <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-brand-xs">
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{dispQuestion.stem_latex}</MathText>
              </p>
            </div>

            <QuestionToolbar
              system="math"
              course={course}
              keywordId={
                dispQuestion.primary_keyword_id ??
                primaryKeywordId(dispQuestion.keyword_weights)
              }
              sessionId={sessionId}
              questionId={dispQuestion.id}
              contentType="question"
              resetSignal={dispQuestion.id}
              answerSignal={dispRevealed ? "revealed" : phase}
              onRefresherUsed={() => setUsedRefresher(true)}
            />

            {/* Hint button */}
            {!inReview && phase === "practicing" && question?.hint_latex && (
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

            {/* Choices */}
            <CorrectPulse
              trigger={!inReview && phase === "revealed" && lastAnswerCorrect}
              className="block w-full"
            >
              <div className="space-y-2">
                {dispQuestion.choices.map((choice, i) => {
                  let state: "default" | "selected" | "correct" | "wrong" | "dimmed" = "default";
                  if (dispRevealed) {
                    if (i === dispQuestion.correct_index) state = "correct";
                    else if (i === dispSelected) state = "wrong";
                    else state = "dimmed";
                  }
                  return (
                    <ChoiceButton
                      key={i}
                      index={i}
                      text={choice}
                      state={state}
                      disabled={inReview || dispRevealed}
                      onClick={() => { if (!inReview) handleChoice(i); }}
                    />
                  );
                })}
              </div>
            </CorrectPulse>

            {/* I don't know — live only */}
            {!inReview && phase === "practicing" && (
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
            {dispRevealed && dispQuestion.solution_latex && (
              <div className="bg-brand-50 rounded-xl border border-brand-100 p-4">
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-1.5">
                  Solution
                </p>
                <p className="text-sm text-neutral-700 leading-relaxed">
                  <MathText>{dispQuestion.solution_latex}</MathText>
                </p>
              </div>
            )}

            {/* Lesson offer banner — live only */}
            {!inReview && phase === "revealed" && showLessonOffer && currentKeyword && (
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
                    onClick={() => {
                      if (currentKeyword) lessonedKeywordsRef.current.add(currentKeyword.id);
                      setShowLessonOffer(false);
                    }}
                    className="flex-1 py-2.5 rounded-xl border border-amber-200 bg-white text-amber-700 text-sm font-medium hover:bg-amber-50 transition-colors"
                  >
                    Keep practicing
                  </button>
                </div>
              </div>
            )}

            {/* Feedback + actions — live only (review is navigated via Back/Forward) */}
            {!inReview && phase === "revealed" && (
              <>
                <MathFeedbackWidget
                  sessionId={sessionId}
                  contentType="question"
                  contentId={question!.id}
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
          );
        })()}

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
