"use client";

/**
 * MCAT Automatic Mode — Duolingo-style "just press Continue".
 *
 * Mirrors the math auto page (`/math/[course]/auto/page.tsx`) adapted for MCAT:
 *   - No diagnostic gate (MCAT has no diagnostic; starts at first category)
 *   - Flat category list (no course sections)
 *   - Uses mcat_* tables and existing MCAT APIs
 *   - Reuses LessonView, ChoiceButton, MathText, ProgressBar, etc.
 *
 * States:
 *   loading          → fetching auto-plan
 *   flashcard        → warm-up flashcards for the frontier category
 *   practicing       → question loop (weakness-first, mastery gate)
 *   revealed         → answer revealed, waiting for Continue
 *   lesson           → inline LessonView (triggered on struggle)
 *   generating       → fetching next question
 *   transition       → brief "moving to next keyword" interstitial
 *   category_complete → "Category complete! Take a checkpoint quiz?"
 *   mini_quiz        → 4-question checkpoint quiz
 *   mini_quiz_revealed → quiz question revealed
 *   mini_quiz_loading → fetching quiz questions
 *   course_complete  → all categories mastered
 *   error            → recoverable error
 */

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/LoginGate";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import { LessonView } from "@/components/mcat/LessonView";
import MathText from "@/components/mcat/MathText";
import FeedbackWidget from "@/components/mcat/FeedbackWidget";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { ComboMeter } from "@/components/gamification/ComboMeter";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { CorrectPulse } from "@/components/ui/CorrectPulse";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useStreakTouchOnce } from "@/components/gamification/useStreakTouchOnce";
import { comboReducer, onCorrectAnswer, onIncorrectAnswer } from "@/lib/gamification";
import { getOrCreateMcatSession } from "@/lib/mcatSession";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOPIC_MAX_QUESTIONS = 8;
const MASTERY_STREAK = 4; // MCAT uses 4 consecutive correct (per existing practice page)
const REVIEW_PROBABILITY = 0.35;
const AUTO_REPLAN_INTERVAL = 8;
const MINI_QUIZ_COUNT = 4;
const MAX_WARMUP_FLASHCARDS = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | "loading"
  | "flashcard"
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
  | "error";

interface AutoPlanFrontier {
  id: string;
  label: string;
  order_index: number;
  umbrella_label: string | null;
}

interface AutoPlanCategoryProgress {
  id: string;
  label: string;
  order_index: number;
  avg_score: number | null;
  mastered_count: number;
  keyword_count: number;
  complete: boolean;
}

interface AutoPlanResponse {
  frontier: AutoPlanFrontier | null;
  next_focus: string[];
  progress: AutoPlanCategoryProgress[];
  overall_pct: number;
}

interface QueueKeyword {
  id: string;
  label: string;
  description: string;
  umbrella_id: string | null;
  umbrella_label: string | null;
  score: number | null;
  state: string | null;
  total_attempts: number;
  needs_lesson: boolean;
  yield_level: string | null;
}

interface ReviewKeyword {
  id: string;
  label: string;
  score: number | null;
  spaced_review_due_at: string | null;
}

interface PracticeQueueResponse {
  queue: QueueKeyword[];
  review_pool: ReviewKeyword[];
}

interface Question {
  id: string;
  stem: string;
  choices: string[];
  correct_index: number;
  explanation: string;
  keyword_weights: Record<string, number>;
  primary_keyword_id?: string | null;
  difficulty: number;
  parent_question_id: string | null;
}

interface Flashcard {
  id: string;
  front: string;
  back: string;
  keyword_weights: Record<string, number>;
}

interface AttemptResponse {
  correct: boolean;
  correct_index: number;
  keyword_states: Record<string, { score: number; state: string; needs_lesson: boolean }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function diffLabel(d: number) {
  if (d < 0.35) return { label: "Easy",   cls: "bg-success-100 text-success-600" };
  if (d < 0.65) return { label: "Medium", cls: "bg-amber-100 text-amber-700" };
  return            { label: "Hard",   cls: "bg-error-100 text-error-600" };
}

function pickReviewKeyword(pool: ReviewKeyword[]): ReviewKeyword | null {
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

// ─── Inner component ──────────────────────────────────────────────────────────

function McatAutoInner() {
  // Session
  const [sessionId, setSessionId] = useState("");
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Auto plan
  const [plan, setPlan] = useState<AutoPlanResponse | null>(null);
  const [frontier, setFrontier] = useState<AutoPlanFrontier | null>(null);
  const planRef = useRef<AutoPlanResponse | null>(null);

  // Practice queue state
  const [queue, setQueue] = useState<QueueKeyword[]>([]);
  const [reviewPool, setReviewPool] = useState<ReviewKeyword[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const currentKeyword = queue[queueIndex] ?? null;

  const lessonedKeywordsRef = useRef<Set<string>>(new Set());
  const [topicCorrectStreak, setTopicCorrectStreak] = useState(0);
  const [topicQuestionCount, setTopicQuestionCount] = useState(0);
  const excludeIdsRef = useRef<string[]>([]);

  const [question, setQuestion] = useState<Question | null>(null);
  const [isReviewCard, setIsReviewCard] = useState(false);
  const [pendingReviewBetweenTopics, setPendingReviewBetweenTopics] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [showLessonOffer, setShowLessonOffer] = useState(false);
  const consecutiveWrongRef = useRef(0);

  // Flashcard warm-up
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [fcIndex, setFcIndex] = useState(0);
  const [fcBackShown, setFcBackShown] = useState(false);
  const warmupDoneCategoriesRef = useRef<Set<string>>(new Set());

  // Stats + gamification
  const [stats, setStats] = useState({ answered: 0, correct: 0, lessons: 0, topicsMastered: 0 });
  const [transitionLabel, setTransitionLabel] = useState("");
  const [combo, setCombo] = useState(0);
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState(false);
  const sessionAnswersRef = useRef(0);

  // Category complete
  const [completedCategoryLabel, setCompletedCategoryLabel] = useState("");
  const [skipQuizPending, setSkipQuizPending] = useState(false);
  const pendingAdvanceCategoryRef = useRef<string | null>(null);

  // Mini-quiz
  const [quizQuestions, setQuizQuestions] = useState<Question[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizSelectedChoice, setQuizSelectedChoice] = useState<number | null>(null);
  const [quizCorrect, setQuizCorrect] = useState(0);

  // Refs for handlers that need latest state
  const topicStreakRef = useRef(topicCorrectStreak);
  const topicCountRef = useRef(topicQuestionCount);
  const currentFrontierIdRef = useRef<string | null>(null);
  useEffect(() => { topicStreakRef.current = topicCorrectStreak; }, [topicCorrectStreak]);
  useEffect(() => { topicCountRef.current = topicQuestionCount; }, [topicQuestionCount]);
  useEffect(() => { currentFrontierIdRef.current = frontier?.id ?? null; }, [frontier]);

  useStreakTouchOnce();

  // ─── Fetch auto-plan ─────────────────────────────────────────────────────

  const fetchPlan = useCallback(async (sid: string): Promise<AutoPlanResponse | null> => {
    const res = await fetch(`/api/mcat/auto-plan?session_id=${encodeURIComponent(sid)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load plan"));
    return (await res.json()) as AutoPlanResponse;
  }, []);

  // ─── Fetch mini-quiz questions ────────────────────────────────────────────

  const fetchMiniQuiz = useCallback(async (sid: string, categoryId: string): Promise<Question[]> => {
    const res = await fetch("/api/mcat/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sid,
        category_id: categoryId,
        count: MINI_QUIZ_COUNT,
        mixed: true,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { questions: Question[] };
    return data.questions ?? [];
  }, []);

  // ─── Fetch warmup flashcards ─────────────────────────────────────────────

  const fetchFlashcards = useCallback(async (sid: string, categoryId: string, keywordIds: string[]): Promise<Flashcard[]> => {
    try {
      const res = await fetch("/api/mcat/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          category_id: categoryId,
          count: MAX_WARMUP_FLASHCARDS,
          keyword_ids: keywordIds,
        }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { flashcards: Flashcard[] };
      return (data.flashcards ?? []).slice(0, MAX_WARMUP_FLASHCARDS);
    } catch {
      return [];
    }
  }, []);

  // ─── Load question ────────────────────────────────────────────────────────

  const loadQuestion = useCallback(
    async (sid: string, keywordId: string, categoryId: string) => {
      setPhase("generating");
      setQuestion(null);
      setSelectedChoice(null);
      setShowLessonOffer(false);
      setLastAnswerCorrect(false);

      try {
        const res = await fetch("/api/mcat/next-question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sid,
            category_id: categoryId,
            keyword_id: keywordId,
            exclude_ids: excludeIdsRef.current,
          }),
        });

        if (!res.ok) {
          // Degrade gracefully: if generation 502s, show error but allow retry
          const msg = await res.text().catch(() => "Unknown error");
          if (res.status === 502) {
            setErrorMsg("Question generation is temporarily unavailable. Please try again.");
          } else {
            setErrorMsg(msg);
          }
          setPhase("error");
          return;
        }

        const data = (await res.json()) as { question: Question; generated?: boolean };
        setQuestion(data.question);
        excludeIdsRef.current = [...excludeIdsRef.current, data.question.id];
        setIsReviewCard(false);
        setPhase("practicing");
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load question");
        setPhase("error");
      }
    },
    []
  );

  // ─── Start keyword ────────────────────────────────────────────────────────

  const startKeyword = useCallback(
    async (sid: string, kw: QueueKeyword, categoryId: string) => {
      setTopicCorrectStreak(0);
      setTopicQuestionCount(0);
      consecutiveWrongRef.current = 0;
      await loadQuestion(sid, kw.id, categoryId);
    },
    [loadQuestion]
  );

  // ─── Advance to next category (re-plan) ───────────────────────────────────

  const advanceToNextCategory = useCallback(
    async (sid: string) => {
      try {
        const newPlan = await fetchPlan(sid);
        if (!newPlan || !newPlan.frontier) {
          setPhase("course_complete");
          return;
        }
        await applyPlan(sid, newPlan);
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to advance");
        setPhase("error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchPlan]
  );

  // ─── Apply plan ───────────────────────────────────────────────────────────

  const applyPlan = useCallback(
    async (sid: string, newPlan: AutoPlanResponse) => {
      setPlan(newPlan);
      planRef.current = newPlan;

      if (!newPlan.frontier) {
        setPhase("course_complete");
        return;
      }

      setFrontier(newPlan.frontier);
      const frontierCatId = newPlan.frontier.id;

      if (newPlan.next_focus.length === 0) {
        setPhase("course_complete");
        return;
      }

      // Build scoped practice queue using next_focus keyword ids
      setPhase("loading");
      setErrorMsg("");

      try {
        const queueUrl =
          `/api/mcat/practice-queue?session_id=${encodeURIComponent(sid)}` +
          `&category_id=${encodeURIComponent(frontierCatId)}`;

        // Try scoped queue first (using keyword_id param for single, fallback to category)
        const res = await fetch(queueUrl);
        if (!res.ok) {
          setErrorMsg("Failed to load practice queue");
          setPhase("error");
          return;
        }

        const data = (await res.json()) as PracticeQueueResponse;
        // Filter queue to next_focus keywords
        const focusSet = new Set(newPlan.next_focus);
        let scopedQueue = data.queue.filter((kw) => focusSet.has(kw.id));
        // Fallback to full queue if nothing matches
        if (scopedQueue.length === 0) scopedQueue = data.queue;
        if (scopedQueue.length === 0) {
          // No unmastered keywords → advance
          await advanceToNextCategory(sid);
          return;
        }

        setQueue(scopedQueue);
        setReviewPool(data.review_pool ?? []);
        setQueueIndex(0);
        setTopicCorrectStreak(0);
        setTopicQuestionCount(0);
        excludeIdsRef.current = [];
        setIsReviewCard(false);
        setPendingReviewBetweenTopics(false);

        // Flashcard warm-up for new category (once per session per category)
        if (!warmupDoneCategoriesRef.current.has(frontierCatId)) {
          warmupDoneCategoriesRef.current.add(frontierCatId);
          const cards = await fetchFlashcards(sid, frontierCatId, newPlan.next_focus);
          if (cards.length > 0) {
            setFlashcards(cards);
            setFcIndex(0);
            setFcBackShown(false);
            setPhase("flashcard");
            return;
          }
        }

        await startKeyword(sid, scopedQueue[0]!, frontierCatId);
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load practice queue");
        setPhase("error");
      }
    },
    [advanceToNextCategory, fetchFlashcards, startKeyword]
  );

  // ─── Initial mount ────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const sid = await getOrCreateMcatSession();
        setSessionId(sid);
        const newPlan = await fetchPlan(sid);
        if (!newPlan) {
          setPhase("course_complete");
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

  // ─── Re-plan after N answers ──────────────────────────────────────────────

  const maybeTriggerReplan = useCallback(async (sid: string) => {
    const count = sessionAnswersRef.current;
    if (count > 0 && count % AUTO_REPLAN_INTERVAL === 0) {
      try {
        const newPlan = await fetchPlan(sid);
        if (!newPlan) return;
        planRef.current = newPlan;
        setPlan(newPlan);
      } catch { /* non-fatal */ }
    }
  }, [fetchPlan]);

  // ─── Handle choice ────────────────────────────────────────────────────────

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
        const res = await fetch("/api/mcat/attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            question_id: question.id,
            selected_index: idx,
            context: "practice",
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as AttemptResponse;
          const kwState = data.keyword_states[currentKeyword.id];
          const needsLesson = kwState?.needs_lesson === true;
          const tooManyWrong = consecutiveWrongRef.current >= 2;
          if ((tooManyWrong || needsLesson) && !lessonedKeywordsRef.current.has(currentKeyword.id)) {
            setShowLessonOffer(true);
          }
        }
      } catch { /* non-fatal */ }
    },
    [question, currentKeyword, phase, sessionId, isReviewCard, maybeTriggerReplan]
  );

  // ─── Handle don't know ────────────────────────────────────────────────────

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
      const res = await fetch("/api/mcat/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          question_id: question.id,
          dont_know: true,
          context: "practice",
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
  }, [question, currentKeyword, phase, sessionId, isReviewCard, maybeTriggerReplan]);

  // ─── Advance keyword in queue ─────────────────────────────────────────────

  const advanceKeyword = useCallback(
    async (opts?: { wasMastered: boolean }) => {
      if (!currentKeyword) return;
      if (opts?.wasMastered) {
        setStats((s) => ({ ...s, topicsMastered: s.topicsMastered + 1 }));
      }
      const nextIndex = queueIndex + 1;

      if (nextIndex >= queue.length) {
        // Queue exhausted → check if category crossed mastery threshold
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
            loadQuestion(sessionId, reviewKw.id, frontier.id);
            return;
          }
        }
        if (frontier?.id) startKeyword(sessionId, nextKw, frontier.id);
      }, 1200);
    },
    [currentKeyword, queueIndex, queue, reviewPool, sessionId, loadQuestion, startKeyword, advanceToNextCategory, frontier]
  );

  // ─── Handle Next (after answer) ───────────────────────────────────────────

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

    if (frontier?.id) loadQuestion(sessionId, currentKeyword.id, frontier.id);
  }, [
    currentKeyword, isReviewCard, pendingReviewBetweenTopics, queue, queueIndex,
    sessionId, loadQuestion, startKeyword, advanceKeyword, frontier, advanceToNextCategory,
  ]);

  // ─── Lesson handlers ──────────────────────────────────────────────────────

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

  // ─── Category complete handlers ───────────────────────────────────────────

  const handleTakeQuiz = useCallback(async () => {
    const catId = pendingAdvanceCategoryRef.current;
    if (!catId) return;
    setPhase("mini_quiz_loading");
    try {
      const qs = await fetchMiniQuiz(sessionId, catId);
      if (qs.length === 0) {
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

  // ─── Mini-quiz handlers ───────────────────────────────────────────────────

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
        await fetch("/api/mcat/attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            question_id: currentQuizQuestion.id,
            selected_index: idx,
            context: "quiz",
          }),
        });
      } catch { /* non-fatal */ }
    },
    [currentQuizQuestion, phase, sessionId]
  );

  const handleQuizNext = useCallback(async () => {
    const nextIdx = quizIndex + 1;
    if (nextIdx >= quizQuestions.length) {
      await advanceToNextCategory(sessionId);
      return;
    }
    setQuizIndex(nextIdx);
    setQuizSelectedChoice(null);
    setLastAnswerCorrect(false);
    setPhase("mini_quiz");
  }, [quizIndex, quizQuestions.length, sessionId, advanceToNextCategory]);

  // ─── Flashcard handlers ───────────────────────────────────────────────────

  const handleFlashcardFlip = useCallback(() => {
    setFcBackShown(true);
  }, []);

  const handleFlashcardNext = useCallback(async () => {
    const nextIdx = fcIndex + 1;
    if (nextIdx >= flashcards.length || nextIdx >= MAX_WARMUP_FLASHCARDS) {
      // Warm-up done → start practice
      if (queue.length > 0 && frontier?.id) {
        await startKeyword(sessionId, queue[0]!, frontier.id);
      } else {
        await advanceToNextCategory(sessionId);
      }
      return;
    }
    setFcIndex(nextIdx);
    setFcBackShown(false);
    setStats((s) => ({ ...s, flashcards: (s as typeof s & { flashcards: number }).flashcards + 1 }));
  }, [fcIndex, flashcards.length, queue, frontier, sessionId, startKeyword, advanceToNextCategory]);

  const handleSkipFlashcards = useCallback(async () => {
    if (queue.length > 0 && frontier?.id) {
      await startKeyword(sessionId, queue[0]!, frontier.id);
    } else {
      await advanceToNextCategory(sessionId);
    }
  }, [queue, frontier, sessionId, startKeyword, advanceToNextCategory]);

  // ─── Derived state ────────────────────────────────────────────────────────

  const diff = question ? diffLabel(question.difficulty) : null;
  const quizDiff = currentQuizQuestion ? diffLabel(currentQuizQuestion.difficulty) : null;
  const masteryDots = Array.from({ length: MASTERY_STREAK }, (_, i) =>
    i < topicCorrectStreak ? "●" : "○"
  ).join("");
  const overallPct = plan?.overall_pct ?? 0;
  const totalCategories = plan?.progress.length ?? 0;
  const completedCategories = plan?.progress.filter((p) => p.complete).length ?? 0;
  const frontierOrderIndex = frontier?.order_index ?? 0;
  const isInQuizPhase = phase === "mini_quiz" || phase === "mini_quiz_revealed" || phase === "mini_quiz_loading";
  const isInPracticePhase = phase === "practicing" || phase === "revealed";
  const quizScorePct = quizQuestions.length > 0
    ? Math.round((quizCorrect / quizQuestions.length) * 100)
    : 0;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 py-2.5 flex items-center gap-2 flex-wrap">
          {/* Left: back + category info */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link
              href="/mcat"
              className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0 whitespace-nowrap"
            >
              ← MCAT
            </Link>
            {frontier && phase !== "loading" && phase !== "course_complete" && (
              <>
                <span className="hidden sm:inline text-xs text-neutral-500 shrink-0 whitespace-nowrap">
                  {frontierOrderIndex + 1}/{totalCategories}
                </span>
                <span className="text-xs font-medium text-neutral-700 truncate min-w-0">
                  {frontier.label}
                </span>
              </>
            )}
          </div>
          {/* Right: learn this + widgets */}
          <div className="flex items-center gap-2 shrink-0">
            {isInPracticePhase && currentKeyword && !isReviewCard && (
              <button
                onClick={handleStartLesson}
                className="hidden sm:inline text-xs text-neutral-400 hover:text-brand-600 underline underline-offset-2 transition-colors whitespace-nowrap"
              >
                Learn this
              </button>
            )}
            <StreakBadge />
            <SoundToggle />
          </div>
        </div>

        {/* Overall progress bar */}
        {plan && phase !== "loading" && (
          <div className="w-full px-6 pb-2">
            <div className="flex items-center gap-2">
              <ProgressBar
                value={overallPct}
                size="sm"
                color={overallPct >= 80 ? "success" : "brand"}
                label="MCAT overall progress"
                className="flex-1"
              />
              <span className="text-xs text-neutral-400 shrink-0">
                {completedCategories}/{totalCategories} categories
              </span>
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
                {quizIndex > 0 && ` · ${quizScorePct}%`}
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

        {/* Flashcard warm-up */}
        {phase === "flashcard" && flashcards[fcIndex] && (
          <div className="space-y-4">
            {/* Warm-up header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 uppercase tracking-wide font-medium mb-0.5">
                  Warm-up · {fcIndex + 1} of {Math.min(flashcards.length, MAX_WARMUP_FLASHCARDS)}
                </p>
                <p className="text-sm font-semibold text-neutral-800">{frontier?.label}</p>
              </div>
              <button
                onClick={handleSkipFlashcards}
                className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2"
              >
                Skip warm-up
              </button>
            </div>

            {/* Flashcard */}
            <div className="bg-white rounded-xl border border-neutral-200 shadow-brand-xs overflow-hidden">
              <div className="p-6 text-center">
                <p className="text-xs text-brand-500 font-semibold uppercase tracking-wide mb-3">
                  {fcBackShown ? "Answer" : "Question"}
                </p>
                <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                  <MathText>{fcBackShown ? flashcards[fcIndex]!.back : flashcards[fcIndex]!.front}</MathText>
                </p>
              </div>
              {!fcBackShown && (
                <div className="border-t border-neutral-100 p-4 flex justify-center">
                  <button
                    onClick={handleFlashcardFlip}
                    className="px-6 py-2.5 rounded-lg bg-brand-50 text-brand-700 text-sm font-semibold hover:bg-brand-100 transition-colors"
                  >
                    Reveal answer
                  </button>
                </div>
              )}
              {fcBackShown && (
                <div className="border-t border-neutral-100 p-4 flex justify-center">
                  <button
                    onClick={handleFlashcardNext}
                    className="px-6 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
                  >
                    {fcIndex + 1 >= Math.min(flashcards.length, MAX_WARMUP_FLASHCARDS) ? "Start practice" : "Next card"}
                  </button>
                </div>
              )}
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
              <h1 className="text-xl font-semibold text-neutral-900">MCAT Biology complete!</h1>
              <p className="text-sm text-neutral-500 mt-1 leading-relaxed">
                You&apos;ve mastered all categories. Come back for spaced review or browse by topic.
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
                href="/mcat"
                className="w-full py-3 rounded-xl border border-neutral-200 bg-white text-neutral-600 text-sm font-medium hover:bg-neutral-50 transition-colors text-center"
              >
                Browse all categories
              </Link>
            </div>
          </div>
        )}

        {/* Lesson (inline) */}
        {phase === "lesson" && currentKeyword && sessionId && (
          <LessonView
            sessionId={sessionId}
            keywordId={currentKeyword.id}
            keywordLabel={currentKeyword.label}
            onComplete={handleLessonComplete}
            onSkip={handleLessonSkip}
          />
        )}

        {/* ─── Practice / Revealed ──────────────────────────────────────────── */}
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
                <MathText>{question.stem}</MathText>
              </p>
            </div>

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

            {/* Explanation */}
            {phase === "revealed" && question.explanation && (
              <div className="bg-brand-50 rounded-xl border border-brand-100 p-4">
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-1.5">
                  Explanation
                </p>
                <p className="text-sm text-neutral-700 leading-relaxed">
                  <MathText>{question.explanation}</MathText>
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
                <FeedbackWidget
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

        {/* ─── Mini-quiz ───────────────────────────────────────────────────── */}
        {(phase === "mini_quiz" || phase === "mini_quiz_revealed") && currentQuizQuestion && (
          <>
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

            <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-brand-xs">
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{currentQuizQuestion.stem}</MathText>
              </p>
            </div>

            <ComboMeter combo={combo} />

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

            {phase === "mini_quiz_revealed" && currentQuizQuestion.explanation && (
              <div className="bg-brand-50 rounded-xl border border-brand-100 p-4">
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-1.5">
                  Explanation
                </p>
                <p className="text-sm text-neutral-700 leading-relaxed">
                  <MathText>{currentQuizQuestion.explanation}</MathText>
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

      </main>
    </div>
  );
}

// ─── Suspense wrapper ─────────────────────────────────────────────────────────

function McatAutoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <McatAutoInner />
    </Suspense>
  );
}

export default function McatAutoPageGated() {
  return (
    <LoginGate prompt="Sign in to use automatic mode.">
      <McatAutoPage />
    </LoginGate>
  );
}
