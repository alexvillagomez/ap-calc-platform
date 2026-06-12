"use client";

/**
 * Fully-automatic mode — Duolingo-style "just press Continue".
 *
 * States:
 *   loading        → fetching auto-plan
 *   needs_diagnostic → card routing to /math/[course]/diagnostic?return=auto
 *   practicing     → embedded practice loop (mirrors category practice page)
 *   category_complete → interstitial: "Category complete 🎉 → next category"
 *   mini_quiz      → 4-question checkpoint quiz before advancing
 *   quiz_revealed  → showing quiz question answer before next
 *   course_complete → all categories mastered
 *   error          → recoverable error card
 *
 * Decision: focused COPY of the practice loop rather than a shared extraction,
 * because the auto page needs tight control over how it advances (re-fetching
 * auto-plan after every mastery event / every 8 questions) and adds layers
 * (category interstitial, mini-quiz checkpoint) that would require many props
 * to thread through a shared component.  A clean, self-contained copy keeps
 * both pages simple. Key differences from category/practice page:
 *   - fetchQueue hits practice-queue with the next_focus keyword ids as scope
 *   - After queue done / every 8 questions → re-fetch auto-plan → roll forward
 *   - Category avg crossing 0.8 triggers optional 4-question quiz checkpoint
 *   - Top bar shows course ProgressBar (overall_pct) not per-category queue bar
 */

import { useState, useEffect, useCallback, useRef, use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoginGate } from "@/components/auth/LoginGate";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import MathText from "@/components/mcat/MathText";
import MathFeedbackWidget from "@/components/math/MathFeedbackWidget";
import { MathLessonView } from "@/components/math/MathLessonView";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { ComboMeter } from "@/components/gamification/ComboMeter";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { CorrectPulse } from "@/components/ui/CorrectPulse";
import { ProgressBar } from "@/components/ui/ProgressBar";
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
const AUTO_REPLAN_INTERVAL = 8; // re-fetch auto-plan every N questions answered
const MINI_QUIZ_COUNT = 4;
const AUTO_COURSE_KEY = "lodera_auto_course";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | "loading"
  | "needs_diagnostic"
  | "lesson"
  | "practicing"
  | "revealed"
  | "generating"
  | "transition"
  | "category_complete"
  | "mini_quiz_loading"
  | "mini_quiz"
  | "mini_quiz_revealed"
  | "course_complete"
  | "done"
  | "error";

interface AutoPlanFrontier {
  id: string;
  label: string;
  section: string;
  role: string;
  umbrella_label: string | null;
  order_index: number;
}

interface AutoPlanCategoryProgress {
  id: string;
  label: string;
  section: string;
  order_index: number;
  avg_score: number | null;
  mastered_count: number;
  keyword_count: number;
  complete: boolean;
}

interface AutoPlanResponse {
  needs_diagnostic: boolean;
  frontier: AutoPlanFrontier | null;
  next_focus: string[];
  progress: AutoPlanCategoryProgress[];
  overall_pct: number;
}

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

// ─── Auto inner component ─────────────────────────────────────────────────────

function MathAutoInner({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = use(params);
  const searchParams = useSearchParams();
  const returnParam = searchParams.get("return");
  const courseLabel = COURSE_LABELS[course] ?? course;

  // ── Session ───────────────────────────────────────────────────────────────

  const [sessionId, setSessionId] = useState("");
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // ── Auto plan ──────────────────────────────────────────────────────────────

  const [plan, setPlan] = useState<AutoPlanResponse | null>(null);
  const [frontier, setFrontier] = useState<AutoPlanFrontier | null>(null);
  const planRef = useRef<AutoPlanResponse | null>(null);

  // ── Practice queue state ───────────────────────────────────────────────────

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
  const sessionAnswersRef = useRef(0); // for re-plan trigger

  // ── Mini-quiz state ────────────────────────────────────────────────────────

  const [quizQuestions, setQuizQuestions] = useState<MathQuestion[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizSelectedChoice, setQuizSelectedChoice] = useState<number | null>(null);
  const [quizCorrect, setQuizCorrect] = useState(0);
  const pendingAdvanceCategoryRef = useRef<string | null>(null); // category id to advance past

  // ── Category complete ──────────────────────────────────────────────────────

  const [completedCategoryLabel, setCompletedCategoryLabel] = useState("");
  const [skipQuizPending, setSkipQuizPending] = useState(false);

  useStreakTouchOnce();

  // Store last used course for persistence
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(AUTO_COURSE_KEY, course);
    }
  }, [course]);

  // ─── Fetch auto-plan ───────────────────────────────────────────────────────

  const fetchPlan = useCallback(async (sid: string): Promise<AutoPlanResponse | null> => {
    const url = `/api/math/auto-plan?session_id=${encodeURIComponent(sid)}&course=${encodeURIComponent(course)}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load plan"));
    const data = (await res.json()) as AutoPlanResponse;
    return data;
  }, [course]);

  // ─── Fetch mini-quiz questions ─────────────────────────────────────────────

  const fetchMiniQuiz = useCallback(async (sid: string, categoryId: string): Promise<MathQuestion[]> => {
    const res = await fetch("/api/math/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sid,
        category_id: categoryId,
        count: MINI_QUIZ_COUNT,
        mixed: true,
        course: course as MathCourse,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { questions: MathQuestion[] };
    return data.questions ?? [];
  }, [course]);

  // ─── Load question ─────────────────────────────────────────────────────────

  const loadQuestion = useCallback(
    async (sid: string, keywordId: string, categoryId: string, forReview?: MathReviewKeyword) => {
      setPhase("generating");
      setQuestion(null);
      setSelectedChoice(null);
      setShowLessonOffer(false);
      setShowHint(false);
      setErrorMsg("");
      setLastAnswerCorrect(false);

      try {
        const body: Record<string, unknown> = {
          session_id: sid,
          category_id: categoryId,
          keyword_id: keywordId,
          exclude_ids: excludeIdsRef.current,
          course: course as MathCourse,
        };

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
        const data = (await res.json()) as { question: MathQuestion; generated?: boolean };
        setQuestion(data.question);
        excludeIdsRef.current = [...excludeIdsRef.current, data.question.id];
        setIsReviewCard(!!forReview);
        setPhase("practicing");
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load question");
        setPhase("error");
      }
    },
    [course]
  );

  // ─── Start keyword ─────────────────────────────────────────────────────────

  const startKeyword = useCallback(
    async (sid: string, kw: MathQueueKeyword, categoryId: string) => {
      setTopicCorrectStreak(0);
      setTopicQuestionCount(0);
      consecutiveWrongRef.current = 0;
      await loadQuestion(sid, kw.id, categoryId);
    },
    [loadQuestion]
  );

  // ─── Apply new plan (start practicing from frontier) ──────────────────────

  const applyPlan = useCallback(
    async (sid: string, newPlan: AutoPlanResponse) => {
      setPlan(newPlan);
      planRef.current = newPlan;

      if (newPlan.needs_diagnostic) {
        setPhase("needs_diagnostic");
        return;
      }

      if (!newPlan.frontier) {
        setPhase("course_complete");
        return;
      }

      setFrontier(newPlan.frontier);
      const frontierCatId = newPlan.frontier.id;

      if (newPlan.next_focus.length === 0) {
        // Frontier has no unmastered keywords → treat as category complete → advance
        setPhase("course_complete");
        return;
      }

      // Build a scoped practice queue using the next_focus keyword ids
      setPhase("loading");
      setErrorMsg("");
      try {
        const focusParam = newPlan.next_focus
          .map((id) => `keyword_ids=${encodeURIComponent(id)}`)
          .join("&");
        const url =
          `/api/math/practice-queue?session_id=${encodeURIComponent(sid)}` +
          `&course=${encodeURIComponent(course)}` +
          `&category_id=${encodeURIComponent(frontierCatId)}` +
          (focusParam ? `&${focusParam}` : "");

        const res = await fetch(url);
        if (!res.ok) {
          // Fallback: use full category queue if scoped fails
          const fallbackUrl =
            `/api/math/practice-queue?session_id=${encodeURIComponent(sid)}` +
            `&course=${encodeURIComponent(course)}` +
            `&category_id=${encodeURIComponent(frontierCatId)}`;
          const fallbackRes = await fetch(fallbackUrl);
          if (!fallbackRes.ok) {
            const msg = await fallbackRes.text().catch(() => "Unknown error");
            setErrorMsg(msg);
            setPhase("error");
            return;
          }
          const data = (await fallbackRes.json()) as MathPracticeQueueResponse;
          if (data.queue.length === 0) {
            // No unmastered keywords left in category → category done
            setPhase("course_complete");
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
          await startKeyword(sid, data.queue[0]!, frontierCatId);
          return;
        }

        const data = (await res.json()) as MathPracticeQueueResponse;
        if (data.queue.length === 0) {
          setPhase("course_complete");
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

        await startKeyword(sid, data.queue[0]!, frontierCatId);
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load practice queue");
        setPhase("error");
      }
    },
    [course, startKeyword]
  );

  // ─── Initial mount ─────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const sid = await getOrCreateMathSession();
        setSessionId(sid);
        const newPlan = await fetchPlan(sid);
        if (!newPlan) {
          setPhase("needs_diagnostic");
          return;
        }
        await applyPlan(sid, newPlan);
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to initialize auto mode");
        setPhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Re-plan after N answers ───────────────────────────────────────────────

  const maybeTriggerReplan = useCallback(async (sid: string) => {
    const count = sessionAnswersRef.current;
    if (count > 0 && count % AUTO_REPLAN_INTERVAL === 0) {
      try {
        const newPlan = await fetchPlan(sid);
        if (!newPlan) return;
        planRef.current = newPlan;
        setPlan(newPlan);
        // Don't interrupt mid-queue — just update plan state for next advance
      } catch { /* non-fatal */ }
    }
  }, [fetchPlan]);

  // ─── Handle choice ─────────────────────────────────────────────────────────

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

      sessionAnswersRef.current += 1;
      await maybeTriggerReplan(sessionId);

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
    [question, currentKeyword, phase, sessionId, isReviewCard, course, maybeTriggerReplan]
  );

  // ─── Handle don't know ─────────────────────────────────────────────────────

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

    sessionAnswersRef.current += 1;
    await maybeTriggerReplan(sessionId);

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
  }, [question, currentKeyword, phase, sessionId, isReviewCard, maybeTriggerReplan, course]);

  // ─── Advance to next category ──────────────────────────────────────────────

  const advanceToNextCategory = useCallback(
    async (sid: string) => {
      try {
        const newPlan = await fetchPlan(sid);
        if (!newPlan) {
          setPhase("course_complete");
          return;
        }
        await applyPlan(sid, newPlan);
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to advance");
        setPhase("error");
      }
    },
    [fetchPlan, applyPlan]
  );

  // ─── Advance keyword in queue ──────────────────────────────────────────────

  const topicStreakRef = useRef(topicCorrectStreak);
  const topicCountRef = useRef(topicQuestionCount);
  useEffect(() => { topicStreakRef.current = topicCorrectStreak; }, [topicCorrectStreak]);
  useEffect(() => { topicCountRef.current = topicQuestionCount; }, [topicQuestionCount]);

  const currentFrontierIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentFrontierIdRef.current = frontier?.id ?? null;
  }, [frontier]);

  const advanceKeyword = useCallback(
    async (opts?: { wasMastered: boolean }) => {
      if (!currentKeyword) return;
      if (opts?.wasMastered) {
        setStats((s) => ({ ...s, topicsMastered: s.topicsMastered + 1 }));
      }
      const nextIndex = queueIndex + 1;

      if (nextIndex >= queue.length) {
        // Queue exhausted → re-plan (may have crossed 0.8 threshold)
        const latestPlan = planRef.current;
        const catId = currentFrontierIdRef.current;
        const catProgress = latestPlan?.progress.find((p) => p.id === catId);
        const avgScore = catProgress?.avg_score ?? 0;
        const shouldOfferQuiz =
          catId &&
          (opts?.wasMastered || avgScore >= 0.8) &&
          !catProgress?.complete;

        if (shouldOfferQuiz && catId) {
          setCompletedCategoryLabel(frontier?.label ?? "");
          pendingAdvanceCategoryRef.current = catId;
          setPhase("category_complete");
        } else {
          // Re-plan and continue
          await advanceToNextCategory(sessionId);
        }
        return;
      }

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
          if (reviewKw && frontier?.id) {
            loadQuestion(sessionId, reviewKw.id, frontier.id, reviewKw);
            return;
          }
        }
        if (frontier?.id) startKeyword(sessionId, nextKw, frontier.id);
      }, 1200);
    },
    [
      currentKeyword, queueIndex, queue, reviewPool, sessionId,
      loadQuestion, startKeyword, advanceToNextCategory, frontier,
    ]
  );

  // ─── Handle Next (after answer) ────────────────────────────────────────────

  const handleNext = useCallback(() => {
    if (!currentKeyword) return;

    if (isReviewCard) {
      setIsReviewCard(false);
      if (pendingReviewBetweenTopics) {
        setPendingReviewBetweenTopics(false);
        const nextKw = queue[queueIndex];
        if (nextKw && frontier?.id) { startKeyword(sessionId, nextKw, frontier.id); }
        else { advanceToNextCategory(sessionId); }
        return;
      }
      if (frontier?.id) loadQuestion(sessionId, currentKeyword.id, frontier.id);
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
    if (useSimilarPath && question && frontier?.id) {
      // Use similar question path via next-question with same keyword
      loadQuestion(sessionId, currentKeyword.id, frontier.id);
    } else if (frontier?.id) {
      loadQuestion(sessionId, currentKeyword.id, frontier.id);
    }
  }, [
    currentKeyword, isReviewCard, pendingReviewBetweenTopics, queue, queueIndex,
    sessionId, loadQuestion, startKeyword, advanceKeyword, question, frontier,
    advanceToNextCategory,
  ]);

  // ─── Lesson handlers ───────────────────────────────────────────────────────

  const handleStartLesson = useCallback(() => {
    setShowLessonOffer(false);
    setPhase("lesson");
  }, []);

  const handleLessonComplete = useCallback(() => {
    if (!currentKeyword || !frontier?.id) return;
    lessonedKeywordsRef.current.add(currentKeyword.id);
    setStats((s) => ({ ...s, lessons: s.lessons + 1 }));
    consecutiveWrongRef.current = 0;
    setTopicCorrectStreak(0);
    loadQuestion(sessionId, currentKeyword.id, frontier.id);
  }, [currentKeyword, sessionId, frontier, loadQuestion]);

  const handleLessonSkip = useCallback(() => {
    if (!currentKeyword || !frontier?.id) return;
    lessonedKeywordsRef.current.add(currentKeyword.id);
    consecutiveWrongRef.current = 0;
    setTopicCorrectStreak(0);
    loadQuestion(sessionId, currentKeyword.id, frontier.id);
  }, [currentKeyword, sessionId, frontier, loadQuestion]);

  // ─── Category complete handlers ────────────────────────────────────────────

  const handleTakeQuiz = useCallback(async () => {
    const catId = pendingAdvanceCategoryRef.current;
    if (!catId) return;
    setPhase("mini_quiz_loading");
    try {
      const qs = await fetchMiniQuiz(sessionId, catId);
      if (qs.length === 0) {
        // No quiz available → just advance
        await advanceToNextCategory(sessionId);
        return;
      }
      setQuizQuestions(qs);
      setQuizIndex(0);
      setQuizSelectedChoice(null);
      setQuizCorrect(0);
      setPhase("mini_quiz");
    } catch {
      await advanceToNextCategory(sessionId);
    }
  }, [sessionId, fetchMiniQuiz, advanceToNextCategory]);

  const handleSkipQuiz = useCallback(async () => {
    setSkipQuizPending(true);
    await advanceToNextCategory(sessionId);
    setSkipQuizPending(false);
  }, [sessionId, advanceToNextCategory]);

  // ─── Mini-quiz handlers ────────────────────────────────────────────────────

  const currentQuizQuestion = quizQuestions[quizIndex] ?? null;

  const handleQuizChoice = useCallback(
    async (idx: number) => {
      if (!currentQuizQuestion || phase !== "mini_quiz") return;
      setQuizSelectedChoice(idx);
      setPhase("mini_quiz_revealed");

      const correct = idx === currentQuizQuestion.correct_index;
      if (correct) setQuizCorrect((n) => n + 1);
      setCombo((prev) => {
        const next = comboReducer({ count: prev }, correct ? "correct" : "incorrect").count;
        if (correct) onCorrectAnswer(next);
        else onIncorrectAnswer();
        return next;
      });
      setLastAnswerCorrect(correct);

      sessionAnswersRef.current += 1;
      try {
        await fetch("/api/math/attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            question_id: currentQuizQuestion.id,
            selected_index: idx,
            context: "quiz",
            course: course as MathCourse,
          }),
        });
      } catch { /* non-fatal */ }
    },
    [currentQuizQuestion, phase, sessionId, course]
  );

  const handleQuizNext = useCallback(async () => {
    const nextIdx = quizIndex + 1;
    if (nextIdx >= quizQuestions.length) {
      // Quiz done → advance
      await advanceToNextCategory(sessionId);
      return;
    }
    setQuizIndex(nextIdx);
    setQuizSelectedChoice(null);
    setLastAnswerCorrect(false);
    setPhase("mini_quiz");
  }, [quizIndex, quizQuestions.length, sessionId, advanceToNextCategory]);

  const quizScorePct =
    quizQuestions.length > 0
      ? Math.round((quizCorrect / quizQuestions.length) * 100)
      : 0;

  // ─── Render helpers ────────────────────────────────────────────────────────

  const diff = question ? diffLabel(question.difficulty) : null;
  const quizDiff = currentQuizQuestion ? diffLabel(currentQuizQuestion.difficulty) : null;

  const masteryDots = Array.from({ length: MASTERY_STREAK }, (_, i) =>
    i < topicCorrectStreak ? "●" : "○"
  ).join("");

  const overallPct = plan?.overall_pct ?? 0;
  const isInQuizPhase = phase === "mini_quiz" || phase === "mini_quiz_revealed" || phase === "mini_quiz_loading";
  const isInPracticePhase = phase === "practicing" || phase === "revealed";

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={`/math/${course}`}
              className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0"
            >
              ← {courseLabel}
            </Link>
            {frontier && phase !== "loading" && phase !== "needs_diagnostic" && phase !== "course_complete" && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-neutral-500 shrink-0">{frontier.label}</span>
                {frontier.umbrella_label && (
                  <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 font-medium">
                    {frontier.umbrella_label}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isInPracticePhase && currentKeyword && !isReviewCard && (
              <button
                onClick={handleStartLesson}
                className="text-xs text-neutral-400 hover:text-brand-600 underline underline-offset-2 transition-colors"
              >
                Learn this
              </button>
            )}
            <StreakBadge />
            <SoundToggle />
          </div>
        </div>

        {/* Course progress bar */}
        {plan && phase !== "loading" && phase !== "needs_diagnostic" && (
          <div className="w-full px-6 pb-2">
            <div className="flex items-center gap-2">
              <ProgressBar
                value={overallPct}
                size="sm"
                color={overallPct >= 80 ? "success" : "brand"}
                label={`${courseLabel} overall progress`}
                className="flex-1"
              />
              <span className="text-xs text-neutral-400 shrink-0">{overallPct}%</span>
            </div>
          </div>
        )}

        {/* Mastery meter (practice only) */}
        {currentKeyword && !isReviewCard && isInPracticePhase && (
          <div className="w-full px-6 pb-1.5">
            <p className="text-xs text-neutral-400">
              Mastering:{" "}
              <span className="font-mono tracking-wider text-brand-500">
                {masteryDots}
              </span>{" "}
              <span className="text-neutral-400">
                ({topicCorrectStreak}/{MASTERY_STREAK})
              </span>
            </p>
          </div>
        )}

        {/* Mini-quiz progress */}
        {isInQuizPhase && quizQuestions.length > 0 && (
          <div className="w-full px-6 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-1.5 bg-brand-500 rounded-full transition-all"
                  style={{ width: `${Math.round((quizIndex / quizQuestions.length) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-neutral-400 shrink-0">
                Quiz {quizIndex + 1}/{quizQuestions.length}
                {quizQuestions.length > 0 && quizIndex > 0 && ` · ${quizScorePct}%`}
              </span>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">

        {/* Loading */}
        {(phase === "loading" || phase === "mini_quiz_loading") && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">
              {phase === "mini_quiz_loading" ? "Loading checkpoint quiz…" : "Finding your next challenge…"}
            </p>
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

        {/* Needs diagnostic */}
        {phase === "needs_diagnostic" && (
          <div className="bg-white rounded-xl border border-neutral-200 p-8 shadow-brand-xs text-center space-y-5">
            <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center mx-auto">
              <span className="text-brand-600 text-2xl">✦</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-neutral-900">
                Start with a placement check
              </h1>
              <p className="text-sm text-neutral-500 mt-1 leading-relaxed">
                A quick 8–14 question diagnostic will find your starting point so
                automatic mode begins where you need it most.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Link
                href={`/math/${course}/diagnostic?return=auto`}
                className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors text-center"
              >
                Take placement diagnostic
              </Link>
              <button
                onClick={async () => {
                  // Skip diagnostic — start from beginning
                  setPhase("loading");
                  try {
                    const newPlan = await fetchPlan(sessionId);
                    if (!newPlan) { setPhase("needs_diagnostic"); return; }
                    // Force skip diagnostic by faking no needs_diagnostic
                    await applyPlan(sessionId, { ...newPlan, needs_diagnostic: false });
                  } catch (e) {
                    setErrorMsg((e as Error).message ?? "Failed to start");
                    setPhase("error");
                  }
                }}
                className="w-full py-3 rounded-xl border border-neutral-200 bg-white text-neutral-600 text-sm font-medium hover:bg-neutral-50 transition-colors"
              >
                Skip and start from the beginning
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center space-y-3">
            <p className="text-sm text-red-600">{errorMsg || "Something went wrong"}</p>
            <button
              onClick={() => {
                setPhase("loading");
                advanceToNextCategory(sessionId);
              }}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
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

        {/* Category complete interstitial */}
        {phase === "category_complete" && (
          <div className="bg-white rounded-xl border border-neutral-200 p-8 shadow-brand-xs text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-success-100 flex items-center justify-center mx-auto text-3xl">
              🎉
            </div>
            <div>
              <h1 className="text-xl font-semibold text-neutral-900">
                {completedCategoryLabel} complete!
              </h1>
              <p className="text-sm text-neutral-500 mt-1">
                Great progress. Take a quick 4-question checkpoint quiz before continuing.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleTakeQuiz}
                className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
              >
                Take checkpoint quiz
              </button>
              <button
                onClick={handleSkipQuiz}
                disabled={skipQuizPending}
                className="w-full py-3 rounded-xl border border-neutral-200 bg-white text-neutral-600 text-sm font-medium hover:bg-neutral-50 transition-colors disabled:opacity-60"
              >
                {skipQuizPending ? "Continuing…" : "Skip quiz, keep going"}
              </button>
            </div>
          </div>
        )}

        {/* Course complete */}
        {phase === "course_complete" && (
          <div className="bg-white rounded-xl border border-neutral-200 p-8 shadow-brand-xs text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-success-100 flex items-center justify-center mx-auto">
              <span className="text-success-600 text-3xl font-bold">✓</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-neutral-900">
                {courseLabel} complete!
              </h1>
              <p className="text-sm text-neutral-500 mt-1 leading-relaxed">
                You&apos;ve mastered all categories. Come back for spaced review or explore
                the full course.
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
              </div>
            )}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => advanceToNextCategory(sessionId)}
                className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
              >
                Find spaced review
              </button>
              <Link
                href={`/math/${course}`}
                className="w-full py-3 rounded-xl border border-neutral-200 bg-white text-neutral-600 text-sm font-medium hover:bg-neutral-50 transition-colors text-center"
              >
                View all categories
              </Link>
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

        {/* ─── Practice / Revealed ─────────────────────────────────────────── */}
        {isInPracticePhase && question && (
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

            {/* Hint */}
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

            {/* Lesson offer */}
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
                    Keep going
                  </button>
                </div>
              </div>
            )}

            {/* Feedback + Continue */}
            {phase === "revealed" && (
              <>
                <MathFeedbackWidget
                  sessionId={sessionId}
                  contentType="question"
                  contentId={question.id}
                  className="px-1"
                />
                <button
                  onClick={handleNext}
                  className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
                >
                  Continue
                </button>
              </>
            )}
          </>
        )}

        {/* ─── Mini-quiz ──────────────────────────────────────────────────── */}
        {(phase === "mini_quiz" || phase === "mini_quiz_revealed") && currentQuizQuestion && (
          <>
            {/* Checkpoint badge */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                Checkpoint
              </span>
              {quizDiff && (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${quizDiff.cls}`}>
                  {quizDiff.label}
                </span>
              )}
            </div>

            {/* Stem */}
            <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-brand-xs">
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{currentQuizQuestion.stem_latex}</MathText>
              </p>
            </div>

            {/* Combo */}
            <ComboMeter combo={combo} />

            {/* Choices */}
            <CorrectPulse
              trigger={phase === "mini_quiz_revealed" && lastAnswerCorrect}
              className="block w-full"
            >
              <div className="space-y-2">
                {currentQuizQuestion.choices.map((choice, i) => {
                  let state: "default" | "selected" | "correct" | "wrong" | "dimmed" = "default";
                  if (phase === "mini_quiz_revealed") {
                    if (i === currentQuizQuestion.correct_index) state = "correct";
                    else if (i === quizSelectedChoice) state = "wrong";
                    else state = "dimmed";
                  }
                  return (
                    <ChoiceButton
                      key={i}
                      index={i}
                      text={choice}
                      state={state}
                      disabled={phase === "mini_quiz_revealed"}
                      onClick={() => handleQuizChoice(i)}
                    />
                  );
                })}
              </div>
            </CorrectPulse>

            {/* Solution */}
            {phase === "mini_quiz_revealed" && currentQuizQuestion.solution_latex && (
              <div className="bg-brand-50 rounded-xl border border-brand-100 p-4">
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-1.5">
                  Solution
                </p>
                <p className="text-sm text-neutral-700 leading-relaxed">
                  <MathText>{currentQuizQuestion.solution_latex}</MathText>
                </p>
              </div>
            )}

            {phase === "mini_quiz_revealed" && (
              <button
                onClick={handleQuizNext}
                className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
              >
                {quizIndex + 1 >= quizQuestions.length ? "Continue" : "Next"}
              </button>
            )}
          </>
        )}

        {/* Done (shouldn't appear — course_complete replaces it) */}
        {phase === "done" && (
          <div className="bg-white rounded-xl border border-neutral-200 p-8 shadow-brand-xs text-center space-y-4">
            <p className="text-neutral-900 font-semibold">Session complete!</p>
            <button
              onClick={() => advanceToNextCategory(sessionId)}
              className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
            >
              Continue
            </button>
          </div>
        )}

      </main>

      {/* Auto-scroll to keep return param usage harmless */}
      {returnParam && <span className="hidden">{returnParam}</span>}
    </div>
  );
}

// ─── Suspense wrapper ─────────────────────────────────────────────────────────

function MathAutoPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <MathAutoInner params={params} />
    </Suspense>
  );
}

export default function MathAutoPageGated({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  return (
    <LoginGate prompt="Sign in to use automatic mode.">
      <MathAutoPage params={params} />
    </LoginGate>
  );
}
