"use client";

import { useState, useEffect, useCallback, useRef, use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import { LoadingPanel } from "@/components/mcat/LoadingPanel";
import FeedbackWidget from "@/components/mcat/FeedbackWidget";
import { LessonView } from "@/components/mcat/LessonView";
import MathText from "@/components/mcat/MathText";
import QuestionToolbar from "@/components/practice/QuestionToolbar";
import { HistorySidebar, type HistoryEntry } from "@/components/practice/HistorySidebar";
import HistoryReviewModal from "@/components/practice/HistoryReviewModal";
import { primaryKeywordId } from "@/lib/primaryKeyword";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { getOrCreateMcatSession } from "@/lib/mcatSession";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { GrindMeter } from "@/components/gamification/GrindMeter";
import { NavMenu } from "@/components/nav/NavMenu";
import { useStreakTouchOnce } from "@/components/gamification/useStreakTouchOnce";
import { CorrectPulse } from "@/components/ui/CorrectPulse";
import { comboReducer, onCorrectAnswer, onIncorrectAnswer } from "@/lib/gamification";
import { awardQuiz } from "@/lib/points";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard cap: maximum questions served on a single keyword per visit */
const TOPIC_MAX_QUESTIONS = 8;
/** Advance when the user has this many consecutive correct answers */
const MASTERY_STREAK = 3;
/** Probability of inserting a review question at each topic transition */
const REVIEW_PROBABILITY = 0.35;
/** localStorage key for persisting the manual difficulty setting */
const DIFFICULTY_STORAGE_KEY = "mcat_practice_difficulty";

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

interface ReviewKeyword {
  id: string;
  label: string;
  score: number;
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
  /** Authoritative toolbar keyword (embedding-matched); falls back to max-weight. */
  primary_keyword_id?: string | null;
  difficulty: number;
  parent_question_id: string | null;
}

interface AttemptResponse {
  correct: boolean;
  correct_index: number;
  keyword_states: Record<
    string,
    { score: number; state: string; needs_lesson: boolean }
  >;
}

const HISTORY_CAP = 30;

interface Flashcard {
  id: string;
  front: string;
  back: string;
  keyword_weights: Record<string, number>;
}

type Phase =
  | "loading"
  | "flashcard"
  | "lesson"
  | "practicing"
  | "revealed"
  | "generating"
  | "transition"
  | "done"
  | "error";

type DifficultyMode = "adaptive" | "easy" | "medium" | "hard";

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
    (kw) =>
      kw.spaced_review_due_at != null &&
      new Date(kw.spaced_review_due_at) <= now
  );
  const candidates = pastDue.length > 0 ? pastDue : pool;
  return candidates.reduce((best, kw) => (kw.score < best.score ? kw : best));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function McatPracticeInner({
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

  // Session
  const [sessionId, setSessionId] = useState("");

  // Phase state machine
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Queue
  const [queue, setQueue] = useState<QueueKeyword[]>([]);
  const [reviewPool, setReviewPool] = useState<ReviewKeyword[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);

  // Current keyword
  const currentKeyword = queue[queueIndex] ?? null;

  // Lesson tracking (once per keyword per session)
  const lessonedKeywordsRef = useRef<Set<string>>(new Set());

  // ── Mastery-gated per-topic tracking ──────────────────────────────────────
  // topicCorrectStreak: consecutive correct answers on the current keyword
  const [topicCorrectStreak, setTopicCorrectStreak] = useState(0);
  // topicQuestionCount: questions served on the current keyword this visit
  const [topicQuestionCount, setTopicQuestionCount] = useState(0);

  // Exclude-IDs accumulator (cross-session within one queue)
  const excludeIdsRef = useRef<string[]>([]);
  // Diversity tracking: recent primary keyword ids + normalized seen stems
  const recentKeywordIdsRef = useRef<string[]>([]);
  const recentQuestionIdsRef = useRef<string[]>([]);
  const seenStemsRef = useRef<string[]>([]);

  // Question
  const [question, setQuestion] = useState<Question | null>(null);
  // ── Desktop layout ──────────────────────────────────────────────────────────
  const isDesktop = useIsDesktop();
  // History sidebar entries (shared type from HistorySidebar)
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Entry selected from the sidebar → opens read-only modal
  const [historyReviewEntry, setHistoryReviewEntry] = useState<HistoryEntry | null>(null);

  // Movement/review history: previously-seen questions (answered or skipped).
  // historyRef is kept for in-page back/forward navigation logic.
  const historyRef = useRef<{ question: Question; selectedChoice: number | null; revealed: boolean; wasCorrect: boolean | null }[]>([]);
  // null = viewing the LIVE current question; otherwise index into historyRef.
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const inReview = reviewIndex !== null;
  const reviewEntry = inReview ? historyRef.current[reviewIndex] ?? null : null;
  const [isReviewCard, setIsReviewCard] = useState(false);
  // Pending review interleave at the next topic transition
  const [pendingReviewBetweenTopics, setPendingReviewBetweenTopics] =
    useState(false);

  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);

  // Lesson offer banner (mid-block, max once per keyword)
  const [showLessonOffer, setShowLessonOffer] = useState(false);
  const consecutiveWrongRef = useRef(0);

  // Flashcard sub-phase state
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [fcIndex, setFcIndex] = useState(0);
  const [fcBackShown, setFcBackShown] = useState(false);
  const [fcFlipping, setFcFlipping] = useState(false);

  // Session stats (add topicsMastered)
  const [stats, setStats] = useState({
    answered: 0,
    correct: 0,
    lessons: 0,
    flashcards: 0,
    topicsMastered: 0,
  });

  // Transition
  const [transitionLabel, setTransitionLabel] = useState("");

  // ── Gamification ──────────────────────────────────────────────────────────
  const [combo, setCombo] = useState(0);
  const [sessionStart] = useState(() => Date.now());
  // Last answered correct flag — drives CorrectPulse on the answer area
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState(false);
  const [usedRefresher, setUsedRefresher] = useState(false);

  useStreakTouchOnce();

  // ── Manual difficulty control ─────────────────────────────────────────────
  const [difficultyMode, setDifficultyMode] = useState<DifficultyMode>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
      if (
        stored === "adaptive" ||
        stored === "easy" ||
        stored === "medium" ||
        stored === "hard"
      ) {
        return stored as DifficultyMode;
      }
    }
    return "adaptive";
  });

  // Persist difficulty to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficultyMode);
    }
  }, [difficultyMode]);

  // ── Load flashcards for warm-up ───────────────────────────────────────────

  const loadFlashcards = useCallback(
    async (sid: string, kwId: string) => {
      setPhase("loading");
      setErrorMsg("");
      setFlashcards([]);
      setFcIndex(0);
      setFcBackShown(false);

      try {
        const res = await fetch("/api/mcat/flashcards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sid,
            category_id: categoryId,
            keyword_id: kwId,
            count: 2,
          }),
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => "Unknown error");
          // Non-fatal: if flashcards fail to load, skip warm-up and go to questions
          console.error("mcat/practice: flashcard fetch failed:", msg);
          return null;
        }
        const data = (await res.json()) as { flashcards: Flashcard[] };
        return data.flashcards ?? [];
      } catch (e) {
        console.error(
          "mcat/practice: flashcard fetch error:",
          (e as Error).message
        );
        return null;
      }
    },
    [categoryId]
  );

  // ── Fetch next question (next-question or similar) ─────────────────────────

  // difficultyModeRef lets async callbacks always read the latest difficulty
  const difficultyModeRef = useRef<DifficultyMode>(difficultyMode);
  useEffect(() => {
    difficultyModeRef.current = difficultyMode;
  }, [difficultyMode]);

  const loadQuestion = useCallback(
    async (
      sid: string,
      keywordId: string,
      forReview?: ReviewKeyword,
      useSimilar?: boolean
    ) => {
      setPhase("generating");
      setQuestion(null);
      setReviewIndex(null);
      setSelectedChoice(null);
      setShowLessonOffer(false);
      setErrorMsg("");
      setLastAnswerCorrect(false);
      setUsedRefresher(false);

      try {
        let data: { question: Question; generated?: boolean };

        if (useSimilar && question) {
          // Use the similar-question endpoint (same-difficulty variant)
          const res = await fetch("/api/mcat/similar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sid,
              question_id: question.id,
            }),
          });
          if (!res.ok) throw new Error(await res.text().catch(() => "Error"));
          data = (await res.json()) as { question: Question };
        } else {
          // Build next-question body with optional forced difficulty
          const body: Record<string, unknown> = {
            session_id: sid,
            category_id: categoryId,
            keyword_id: keywordId,
            exclude_ids: excludeIdsRef.current,
            recent_keyword_ids: recentKeywordIdsRef.current.slice(-6),
            recent_question_ids: recentQuestionIdsRef.current.slice(-10),
            seen_stems: seenStemsRef.current.slice(-30),
          };
          const mode = difficultyModeRef.current;
          if (mode !== "adaptive") {
            body.difficulty = mode;
          }
          const res = await fetch("/api/mcat/next-question", {
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
          data = (await res.json()) as { question: Question; generated: boolean };
        }

        setQuestion(data.question);
        excludeIdsRef.current = [
          ...excludeIdsRef.current,
          data.question.id,
        ];
        recentQuestionIdsRef.current = [...recentQuestionIdsRef.current, data.question.id].slice(-10);
        if (data.question.primary_keyword_id) {
          recentKeywordIdsRef.current = [...recentKeywordIdsRef.current, data.question.primary_keyword_id].slice(-10);
        }
        if (data.question.stem) {
          const norm = data.question.stem.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
          seenStemsRef.current = [...seenStemsRef.current, norm].slice(-50);
        }

        setIsReviewCard(!!forReview);
        setPhase("practicing");
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load question");
        setPhase("error");
      }
    },
    // question is intentionally included so useSimilar has access to latest question id
    [categoryId, question]
  );

  // ── Shared startKeyword helper ─────────────────────────────────────────────
  // Handles flashcard warm-up for NEW keywords, then falls through to first question.
  // Resets per-topic tracking.

  const startKeyword = useCallback(
    async (sid: string, kw: QueueKeyword) => {
      // Reset per-topic mastery trackers
      setTopicCorrectStreak(0);
      setTopicQuestionCount(0);
      consecutiveWrongRef.current = 0;

      const isNew = kw.total_attempts === 0 && kw.score === null;

      if (isNew) {
        setPhase("loading");
        const cards = await loadFlashcards(sid, kw.id);
        if (cards && cards.length > 0) {
          setFlashcards(cards);
          setFcIndex(0);
          setFcBackShown(false);
          setPhase("flashcard");
          return;
        }
        // If zero cards or fetch failed, fall through to question
      }

      loadQuestion(sid, kw.id);
    },
    [loadFlashcards, loadQuestion]
  );

  // ── Fetch practice queue ──────────────────────────────────────────────────

  const fetchQueue = useCallback(
    async (sid: string) => {
      setPhase("loading");
      setErrorMsg("");
      try {
        let queueUrl = `/api/mcat/practice-queue?session_id=${encodeURIComponent(sid)}&category_id=${encodeURIComponent(categoryId)}`;
        if (keywordScopeId) {
          queueUrl += `&keyword_id=${encodeURIComponent(keywordScopeId)}`;
        } else if (umbrellaId) {
          queueUrl += `&umbrella_id=${encodeURIComponent(umbrellaId)}`;
        }
        const res = await fetch(queueUrl);
        if (!res.ok) {
          const msg = await res.text().catch(() => "Unknown error");
          setErrorMsg(msg);
          setPhase("error");
          return;
        }
        const data = (await res.json()) as PracticeQueueResponse;

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

        // Start with keyword 0 — NEW keywords get flashcard warm-up
        const kw = data.queue[0]!;
        await startKeyword(sid, kw);
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load queue");
        setPhase("error");
      }
    },
    [categoryId, umbrellaId, keywordScopeId, startKeyword]
  );

  // ── Mount ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const sid = await getOrCreateMcatSession();
      setSessionId(sid);
      await fetchQueue(sid);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Flashcard grading ─────────────────────────────────────────────────────

  const gradeFlashcard = useCallback(
    async (result: "got_it" | "missed_it" | "dont_know") => {
      const card = flashcards[fcIndex];
      if (!card || !currentKeyword) return;

      // Record attempt (fire and forget)
      fetch("/api/mcat/flashcard-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          flashcard_id: card.id,
          result,
          usedRefresher,
        }),
      }).catch(() => {});

      // ── Gamification: got_it = correct, missed_it / dont_know = incorrect ──
      if (result === "got_it") {
        setCombo((prev) => {
          const next = comboReducer({ count: prev }, "correct").count;
          onCorrectAnswer(next);
          return next;
        });
      } else {
        setCombo((prev) => comboReducer({ count: prev }, "incorrect").count);
        onIncorrectAnswer();
      }

      setStats((s) => ({ ...s, flashcards: s.flashcards + 1 }));

      setUsedRefresher(false);
      const nextIdx = fcIndex + 1;
      if (nextIdx >= flashcards.length) {
        // Warm-up done → proceed to questions
        loadQuestion(sessionId, currentKeyword.id);
      } else {
        setFcIndex(nextIdx);
        setFcBackShown(false);
      }
    },
    [flashcards, fcIndex, currentKeyword, sessionId, loadQuestion, usedRefresher]
  );

  const flipFcCard = useCallback(() => {
    setFcFlipping(true);
    setTimeout(() => {
      setFcBackShown((prev) => !prev);
      setFcFlipping(false);
    }, 150);
  }, []);

  // ── Handle answer ─────────────────────────────────────────────────────────

  // Push the currently-live question into review history (answered or skipped).
  const pushHistory = useCallback(
    (entry: { question: Question; selectedChoice: number | null; revealed: boolean; wasCorrect: boolean | null }) => {
      historyRef.current = [...historyRef.current, entry].slice(-HISTORY_CAP);
    },
    []
  );

  // Push a graded question into the sidebar history list.
  const pushSidebarHistory = useCallback(
    (q: Question, selectedChoice: number | null, dontKnow: boolean, wasCorrect: boolean) => {
      const sidebarEntry: HistoryEntry = {
        uid: `${q.id}-${Date.now()}`,
        kind: "question",
        question: q,
        selectedChoice,
        dontKnow,
        wasCorrect,
        keywordId: q.primary_keyword_id ?? primaryKeywordId(q.keyword_weights),
      };
      setHistory((prev) => [...prev, sidebarEntry].slice(-HISTORY_CAP));
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
      pushSidebarHistory(question, idx, false, correct);

      // ── Gamification: sounds + combo ──────────────────────────────────────
      setLastAnswerCorrect(correct);
      setCombo((prev) => {
        const next = comboReducer({ count: prev }, correct ? "correct" : "incorrect").count;
        if (correct) onCorrectAnswer(next);
        else onIncorrectAnswer();
        return next;
      });

      setStats((s) => ({
        ...s,
        answered: s.answered + 1,
        correct: s.correct + (correct ? 1 : 0),
      }));
      awardQuiz();

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
        const res = await fetch("/api/mcat/attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            question_id: question.id,
            selected_index: idx,
            context: "practice",
            usedRefresher,
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as AttemptResponse;

          const kwState = data.keyword_states[currentKeyword.id];
          const needsLessonFromServer = kwState?.needs_lesson === true;
          const tooManyWrong = consecutiveWrongRef.current >= 2;

          if (
            !correct &&
            (tooManyWrong || needsLessonFromServer) &&
            !lessonedKeywordsRef.current.has(currentKeyword.id)
          ) {
            setShowLessonOffer(true);
          }
        } else {
          // Non-fatal — attempt already recorded client-side above
          if (!correct) {
            const tooManyWrong = consecutiveWrongRef.current >= 2;
            if (
              tooManyWrong &&
              !isReviewCard &&
              !lessonedKeywordsRef.current.has(currentKeyword.id)
            ) {
              setShowLessonOffer(true);
            }
          }
        }
      } catch {
        // Non-fatal
      }
    },
    [question, currentKeyword, phase, sessionId, isReviewCard, usedRefresher, inReview, pushHistory, pushSidebarHistory]
  );

  // ── Handle "I don't know" ─────────────────────────────────────────────────

  const handleDontKnow = useCallback(async () => {
    if (!question || !currentKeyword || phase !== "practicing" || inReview) return;

    setSelectedChoice(null);
    setPhase("revealed");
    pushHistory({ question, selectedChoice: null, revealed: true, wasCorrect: false });
    pushSidebarHistory(question, null, true, false);

    // ── Gamification: incorrect ───────────────────────────────────────────
    setLastAnswerCorrect(false);
    setCombo((prev) => comboReducer({ count: prev }, "incorrect").count);
    onIncorrectAnswer();

    setStats((s) => ({ ...s, answered: s.answered + 1 }));
    awardQuiz();

    if (!isReviewCard) {
      consecutiveWrongRef.current += 1;
      setTopicCorrectStreak(0);
      setTopicQuestionCount((n) => n + 1);
    }

    try {
      const res = await fetch("/api/mcat/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          question_id: question.id,
          dont_know: true,
          context: "practice",
          usedRefresher,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as AttemptResponse;

        const kwState = data.keyword_states[currentKeyword.id];
        const needsLessonFromServer = kwState?.needs_lesson === true;
        const tooManyWrong = consecutiveWrongRef.current >= 2;

        if (
          (tooManyWrong || needsLessonFromServer) &&
          !lessonedKeywordsRef.current.has(currentKeyword.id)
        ) {
          setShowLessonOffer(true);
        }
      }
    } catch {
      // Non-fatal
    }
  }, [question, currentKeyword, phase, sessionId, isReviewCard, usedRefresher, inReview, pushHistory, pushSidebarHistory]);

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
    loadQuestion(sessionId, currentKeyword.id, undefined, false);
  }, [question, currentKeyword, phase, inReview, pushHistory, loadQuestion, sessionId]);

  // ── Handle "Similar question" (explicit button press) ─────────────────────

  const handleSimilar = useCallback(async () => {
    if (!question || !currentKeyword) return;

    if (!isReviewCard) {
      setTopicQuestionCount((n) => n + 1);
      // Similar question is neutral — don't advance the streak but don't break it
    }

    await loadQuestion(sessionId, currentKeyword.id, undefined, true);
  }, [question, currentKeyword, sessionId, isReviewCard, loadQuestion]);

  // ── Handle lesson start ────────────────────────────────────────────────────

  const handleStartLesson = useCallback(() => {
    setShowLessonOffer(false);
    setPhase("lesson");
  }, []);

  // ── Handle lesson complete / skip ─────────────────────────────────────────
  // After lesson, ALWAYS return to question block (never re-show flashcards).
  // Reset topicCorrectStreak (must re-demonstrate mastery) but don't require
  // the full 8-question cap again.

  const handleLessonComplete = useCallback(() => {
    if (!currentKeyword) return;
    lessonedKeywordsRef.current.add(currentKeyword.id);
    setStats((s) => ({ ...s, lessons: s.lessons + 1 }));
    consecutiveWrongRef.current = 0;
    setTopicCorrectStreak(0);
    // topicQuestionCount is intentionally NOT reset — cap counts toward all questions
    loadQuestion(sessionId, currentKeyword.id);
  }, [currentKeyword, sessionId, loadQuestion]);

  const handleLessonSkip = useCallback(() => {
    if (!currentKeyword) return;
    lessonedKeywordsRef.current.add(currentKeyword.id);
    consecutiveWrongRef.current = 0;
    setTopicCorrectStreak(0);
    loadQuestion(sessionId, currentKeyword.id);
  }, [currentKeyword, sessionId, loadQuestion]);

  // ── Advance to next keyword ───────────────────────────────────────────────

  const advanceKeyword = useCallback(
    (opts?: { wasMastered: boolean }) => {
      if (!currentKeyword) return;

      if (opts?.wasMastered) {
        setStats((s) => ({ ...s, topicsMastered: s.topicsMastered + 1 }));
      }

      const nextIndex = queueIndex + 1;
      if (nextIndex >= queue.length) {
        setPhase("done");
        return;
      }

      const nextKw = queue[nextIndex]!;

      // Decide whether to insert a review question before the next topic
      const shouldInsertReview =
        reviewPool.length > 0 && Math.random() < REVIEW_PROBABILITY;
      setPendingReviewBetweenTopics(shouldInsertReview);

      setTransitionLabel(nextKw.label);
      setPhase("transition");

      setTimeout(() => {
        setQueueIndex(nextIndex);
        setIsReviewCard(false);

        if (shouldInsertReview) {
          // Insert one spaced-review question before starting next topic
          const reviewKw = pickReviewKeyword(reviewPool);
          if (reviewKw) {
            loadQuestion(sessionId, reviewKw.id, reviewKw);
            return;
          }
        }

        startKeyword(sessionId, nextKw);
      }, 1200);
    },
    [
      currentKeyword,
      queueIndex,
      queue,
      reviewPool,
      sessionId,
      loadQuestion,
      startKeyword,
    ]
  );

  // ── Handle "Next →" from revealed ─────────────────────────────────────────
  //
  // Advance conditions (evaluated using the snapshot values at click-time):
  //   A) server said keyword_states[kw].state === 'mastered' — we don't have
  //      that synchronously; instead we track via topicCorrectStreak / count
  //   B) topicCorrectStreak >= MASTERY_STREAK  (3 consecutive correct)
  //   C) topicQuestionCount >= TOPIC_MAX_QUESTIONS (hard cap = 8)
  //
  // We pass the latest streak/count via a ref to avoid stale closure issues.
  const topicStreakRef = useRef(topicCorrectStreak);
  const topicCountRef = useRef(topicQuestionCount);
  useEffect(() => { topicStreakRef.current = topicCorrectStreak; }, [topicCorrectStreak]);
  useEffect(() => { topicCountRef.current = topicQuestionCount; }, [topicQuestionCount]);

  const handleNext = useCallback(() => {
    if (!currentKeyword) return;

    // ── After a review card: return to focus keyword (or start next topic) ──
    if (isReviewCard) {
      setIsReviewCard(false);
      if (pendingReviewBetweenTopics) {
        // We just served the between-topics review — now start the next topic
        setPendingReviewBetweenTopics(false);
        const nextKw = queue[queueIndex]; // queueIndex was already advanced in advanceKeyword
        if (nextKw) {
          startKeyword(sessionId, nextKw);
        } else {
          setPhase("done");
        }
        return;
      }
      // Review card within a topic (shouldn't normally happen in new flow, safety)
      loadQuestion(sessionId, currentKeyword.id);
      return;
    }

    const streak = topicStreakRef.current;
    const count = topicCountRef.current;

    const masteredByStreak = streak >= MASTERY_STREAK;
    const hitCap = count >= TOPIC_MAX_QUESTIONS;

    if (masteredByStreak || hitCap) {
      // If capped without mastery, push keyword back onto the queue for later
      if (hitCap && !masteredByStreak) {
        setQueue((prev) => {
          const copy = [...prev];
          const [capped] = copy.splice(queueIndex, 1);
          if (capped) copy.push(capped);
          // Don't re-insert, just let advanceKeyword use the updated array
          return copy;
        });
      }
      advanceKeyword({ wasMastered: masteredByStreak });
      return;
    }

    // Not yet mastered — continue on the same keyword.
    // Roughly half the time (if the last answer was correct), use similar-question
    // for more batched variants; otherwise call next-question with keyword_id.
    const lastWasCorrect = streak > 0; // streak only increments on correct
    const useSimilarPath = lastWasCorrect && question !== null && Math.random() < 0.5;

    setTopicQuestionCount((n) => n + 1);
    loadQuestion(sessionId, currentKeyword.id, undefined, useSimilarPath);
  }, [
    currentKeyword,
    isReviewCard,
    pendingReviewBetweenTopics,
    queue,
    queueIndex,
    sessionId,
    loadQuestion,
    startKeyword,
    advanceKeyword,
    question,
  ]);

  // ─── Render ────────────────────────────────────────────────────────────────

  const isFlashcardPhase = phase === "flashcard";
  const currentFc = isFlashcardPhase ? (flashcards[fcIndex] ?? null) : null;

  // Mastery meter: how many filled dots out of MASTERY_STREAK
  const masteryDots = Array.from({ length: MASTERY_STREAK }, (_, i) =>
    i < topicCorrectStreak ? "●" : "○"
  ).join("");
  const cappedMessage = topicQuestionCount >= TOPIC_MAX_QUESTIONS
    ? " · cap reached"
    : "";

  // Button label for "Next →"
  const nextButtonLabel = () => {
    if (isReviewCard) return "Next →";
    const streak = topicStreakRef.current;
    const count = topicCountRef.current;
    if (streak >= MASTERY_STREAK || count >= TOPIC_MAX_QUESTIONS) {
      return queueIndex + 1 >= queue.length ? "Finish →" : "Next topic →";
    }
    return "Next →";
  };

  // Difficulty mode labels for the segmented control
  const difficultyOptions: { value: DifficultyMode; label: string }[] = [
    { value: "adaptive", label: "Adaptive" },
    { value: "easy", label: "Easy" },
    { value: "medium", label: "Medium" },
    { value: "hard", label: "Hard" },
  ];

  // ── Active QuestionToolbar props for the desktop right rail ───────────────
  // Compute once; rendered in right rail (desktop) or inline in center (mobile).
  const activeToolbar = (() => {
    if (phase === "flashcard" && currentFc) {
      return {
        keywordId: primaryKeywordId(currentFc.keyword_weights),
        questionId: currentFc.id,
        contentType: "flashcard" as const,
        resetSignal: currentFc.id,
        answerSignal: undefined as string | undefined,
      };
    }
    if ((phase === "practicing" || phase === "revealed") && question) {
      const dispQuestion = inReview && reviewEntry ? reviewEntry.question : question;
      const dispRevealed = inReview && reviewEntry ? reviewEntry.revealed : phase === "revealed";
      return {
        keywordId:
          dispQuestion.primary_keyword_id ??
          primaryKeywordId(dispQuestion.keyword_weights),
        questionId: dispQuestion.id,
        contentType: "question" as const,
        resetSignal: dispQuestion.id,
        answerSignal: dispRevealed ? "revealed" : phase,
      };
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Top bar */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 py-2.5 space-y-1.5">
          {/* Row 1 — nav controls */}
          <div className="flex items-center gap-2">
            <Link href={backHref} className="shrink-0">
              <LoderaLogo size={20} />
            </Link>
            <Link
              href={backHref}
              className="text-xs text-neutral-400 hover:text-brand-600 shrink-0 transition-colors whitespace-nowrap"
            >
              {isScoped ? "← Back" : "← MCAT"}
            </Link>
            <span className="text-[11px] uppercase tracking-wide text-neutral-400 font-medium">
              Practice
            </span>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {currentKeyword &&
                (phase === "practicing" || phase === "revealed") &&
                !isReviewCard && (
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
              {isFlashcardPhase ? "Warm-up · " : ""}{currentKeyword.label}
            </h1>
          ) : (
            isScoped && scopeLabel && (
              <h1 className="font-semibold text-neutral-900 text-base leading-snug">
                {scopeLabel}
              </h1>
            )
          )}
        </div>

        {/* Mastery meter — visible during active question phases on current topic */}
        {currentKeyword &&
          !isReviewCard &&
          (phase === "practicing" || phase === "revealed") && (
            <div className="w-full px-4 sm:px-6 pb-1.5">
              <p className="text-xs text-neutral-400">
                Mastering:{" "}
                <span className="font-mono tracking-wider text-brand-600">
                  {masteryDots}
                </span>{" "}
                <span className="text-neutral-400">
                  ({topicCorrectStreak}/{MASTERY_STREAK}
                  {cappedMessage})
                </span>
              </p>
            </div>
          )}

        {/* Difficulty segmented control */}
        {(phase === "practicing" ||
          phase === "revealed" ||
          phase === "generating" ||
          phase === "flashcard") && (
          <div className="w-full px-4 sm:px-6 pb-2">
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

      {/* History review modal — opened from the sidebar */}
      {historyReviewEntry && (
        <HistoryReviewModal
          entry={historyReviewEntry}
          sessionId={sessionId}
          system="mcat"
          onClose={() => setHistoryReviewEntry(null)}
        />
      )}

      {/* ── 3-column desktop layout ── */}
      <div className="max-w-6xl mx-auto px-4 py-8 flex gap-6 items-start pb-safe-bottom">

        {/* LEFT — history sidebar (desktop only) */}
        {isDesktop && (
          <aside className="w-56 shrink-0 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <HistorySidebar entries={history} onSelect={setHistoryReviewEntry} />
          </aside>
        )}

        {/* CENTER — main content */}
        <main className="flex-1 min-w-0 space-y-4">

        {/* ── Loading ── */}
        {phase === "loading" && (
          <LoadingPanel
            message={
              currentKeyword
                ? "Preparing a couple of cards…"
                : "Building your practice queue…"
            }
            sub={
              currentKeyword
                ? "Getting a warm-up ready for you"
                : "Selecting keywords based on your progress"
            }
          />
        )}

        {/* ── Generating question ── */}
        {phase === "generating" && (
          <LoadingPanel
            message="Finding your next question…"
            sub="Generation can take 5–30 seconds"
          />
        )}

        {/* ── Error ── */}
        {phase === "error" && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center space-y-3">
            <p className="text-sm text-error-600">{errorMsg || "Something went wrong"}</p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (currentKeyword) {
                  loadQuestion(sessionId, currentKeyword.id);
                } else {
                  fetchQueue(sessionId);
                }
              }}
            >
              Try again
            </Button>
          </div>
        )}

        {/* ── Transition interstitial ── */}
        {phase === "transition" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Card className="px-6 py-5 text-center space-y-2 max-w-sm w-full">
              <p className="text-xs text-neutral-400 uppercase tracking-wide font-medium">
                Keyword complete
              </p>
              <p className="text-base font-semibold text-neutral-900 truncate">
                {transitionLabel}
              </p>
              <p className="text-sm text-neutral-500 animate-pulse">
                Moving to next keyword…
              </p>
            </Card>
          </div>
        )}

        {/* ── Flashcard warm-up ── */}
        {phase === "flashcard" && currentFc && (
          <>
            {/* Warm-up hint */}
            <div className="text-center">
              <p className="text-xs text-success-600 font-medium bg-success-50 border border-success-100 rounded-full inline-block px-3 py-1">
                Quick warm-up — get familiar before questions
              </p>
            </div>

            {/* Card counter */}
            <p className="text-xs text-neutral-400 text-right">
              {fcIndex + 1} / {flashcards.length}
            </p>

            {/* Flip card */}
            <button
              type="button"
              onClick={flipFcCard}
              className={`w-full text-left bg-white rounded-2xl border-2 shadow-brand-sm p-6 min-h-[180px] flex flex-col justify-between transition-opacity duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                fcFlipping ? "opacity-0" : "opacity-100"
              } ${
                fcBackShown
                  ? "border-brand-300 hover:border-brand-400"
                  : "border-neutral-200 hover:border-neutral-300"
              }`}
            >
              {!fcBackShown ? (
                <div>
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">
                    Front
                  </p>
                  <p className="text-base font-medium text-neutral-900 leading-relaxed">
                    <MathText>{currentFc.front}</MathText>
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-brand-500 uppercase tracking-wide mb-3">
                    Back
                  </p>
                  <p className="text-base text-neutral-800 leading-relaxed">
                    <MathText>{currentFc.back}</MathText>
                  </p>
                </div>
              )}
              <p className="text-xs text-neutral-300 mt-4 text-right select-none">
                {fcBackShown ? "tap to flip back" : "tap to flip"}
              </p>
            </button>

            {/* Mobile-only inline toolbar; desktop shows in right rail */}
            <div className="lg:hidden">
              <QuestionToolbar
                system="mcat"
                keywordId={primaryKeywordId(currentFc.keyword_weights)}
                sessionId={sessionId}
                questionId={currentFc.id}
                contentType="flashcard"
                resetSignal={currentFc.id}
                onRefresherUsed={() => setUsedRefresher(true)}
              />
            </div>

            {/* Show answer button */}
            {!fcBackShown && (
              <Button variant="primary" size="lg" className="w-full" onClick={flipFcCard}>
                Show answer
              </Button>
            )}

            {/* Grade buttons */}
            {fcBackShown && (
              <>
                <div className="flex gap-2">
                  <button
                    onClick={() => gradeFlashcard("missed_it")}
                    className="flex-1 py-3 rounded-xl bg-error-50 border border-error-200 text-error-700 text-sm font-semibold hover:bg-error-100 transition-colors"
                  >
                    Missed it
                  </button>
                  <button
                    onClick={() => gradeFlashcard("got_it")}
                    className="flex-1 py-3 rounded-xl bg-success-50 border border-success-200 text-success-700 text-sm font-semibold hover:bg-success-100 transition-colors"
                  >
                    Got it
                  </button>
                </div>
                <div className="flex justify-center">
                  <button
                    onClick={() => gradeFlashcard("dont_know")}
                    className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2 transition-colors"
                  >
                    I didn&apos;t know this
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Lesson (inline) ── */}
        {phase === "lesson" && currentKeyword && sessionId && (
          <LessonView
            sessionId={sessionId}
            keywordId={currentKeyword.id}
            keywordLabel={currentKeyword.label}
            onComplete={handleLessonComplete}
            onSkip={handleLessonSkip}
          />
        )}

        {/* ── Practice / Revealed / Review ── */}
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
            <Card>
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{dispQuestion.stem}</MathText>
              </p>
            </Card>

            {/* Mobile-only inline toolbar; desktop shows in right rail */}
            <div className="lg:hidden">
              <QuestionToolbar
                system="mcat"
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
            </div>

            {/* Choices */}
            <CorrectPulse trigger={!inReview && phase === "revealed" && lastAnswerCorrect} className="block w-full">
              <div className="space-y-2">
                {dispQuestion.choices.map((choice, i) => {
                  let state: "default" | "selected" | "correct" | "wrong" | "dimmed" =
                    "default";
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

            {/* Explanation */}
            {dispRevealed && dispQuestion.explanation && (
              <div className="bg-brand-50 rounded-xl border border-brand-100 p-4">
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-1.5">
                  Explanation
                </p>
                <p className="text-sm text-neutral-700 leading-relaxed">
                  <MathText>{dispQuestion.explanation}</MathText>
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
                    className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors"
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

            {/* Feedback + action buttons — live only (review is navigated via Back/Forward) */}
            {!inReview && phase === "revealed" && (
              <>
                <FeedbackWidget
                  sessionId={sessionId}
                  contentType="question"
                  contentId={question!.id}
                  className="px-1"
                />

                <div className="flex flex-col gap-2 sm:flex-row">
                  {!isReviewCard && (
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={handleSimilar}
                      className="flex-1"
                    >
                      Similar question
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={handleNext}
                    className="flex-1"
                  >
                    {nextButtonLabel()}
                  </Button>
                </div>
              </>
            )}
          </>
          );
        })()}

        {/* ── Done screen ── */}
        {phase === "done" && (
          <Card className="p-8 text-center space-y-5">
            <div className="w-14 h-14 rounded-full bg-success-100 flex items-center justify-center mx-auto">
              <span className="text-success-600 text-2xl font-bold">✓</span>
            </div>

            <div>
              <h1 className="text-xl font-semibold text-neutral-900">
                {queue.length === 0
                  ? "All keywords mastered for now"
                  : "Great session!"}
              </h1>
              <p className="text-sm text-neutral-500 mt-1">
                {queue.length === 0
                  ? "Check back later for spaced-review questions."
                  : `You worked through ${queue.length} keyword${queue.length !== 1 ? "s" : ""}.`}
              </p>
            </div>

            {/* Stats */}
            {(stats.answered > 0 || stats.flashcards > 0) && (
              <div className="bg-neutral-50 rounded-xl border border-neutral-100 p-4 space-y-2 text-left">
                {stats.flashcards > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Flashcards reviewed</span>
                    <span className="font-medium text-neutral-900">{stats.flashcards}</span>
                  </div>
                )}
                {stats.answered > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Questions answered</span>
                      <span className="font-medium text-neutral-900">{stats.answered}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Correct</span>
                      <span className="font-medium text-neutral-900">
                        {stats.correct} ({stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 0}%)
                      </span>
                    </div>
                  </>
                )}
                {stats.topicsMastered > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Topics mastered</span>
                    <span className="font-medium text-neutral-900">{stats.topicsMastered}</span>
                  </div>
                )}
                {stats.lessons > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Lessons taken</span>
                    <span className="font-medium text-neutral-900">{stats.lessons}</span>
                  </div>
                )}
                {stats.answered > 0 && (
                  <div className="pt-1">
                    <ProgressBar
                      value={stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 0}
                      size="sm"
                      color={stats.answered > 0 && Math.round((stats.correct / stats.answered) * 100) >= 80 ? "success" : "brand"}
                      label="Session accuracy"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => {
                  lessonedKeywordsRef.current = new Set();
                  setStats({ answered: 0, correct: 0, lessons: 0, flashcards: 0, topicsMastered: 0 });
                  fetchQueue(sessionId);
                }}
              >
                Practice again
              </Button>
              <Link href={backHref}>
                <Button variant="secondary" size="lg" className="w-full">
                  {isScoped ? "Back" : "Back to MCAT"}
                </Button>
              </Link>
            </div>
          </Card>
        )}
        </main>

        {/* RIGHT — toolbar rail (desktop only) */}
        {isDesktop && activeToolbar && (
          <aside className="w-60 shrink-0 sticky top-20">
            <QuestionToolbar
              system="mcat"
              keywordId={activeToolbar.keywordId}
              sessionId={sessionId}
              questionId={activeToolbar.questionId}
              contentType={activeToolbar.contentType}
              resetSignal={activeToolbar.resetSignal}
              answerSignal={activeToolbar.answerSignal}
              onRefresherUsed={() => setUsedRefresher(true)}
            />
          </aside>
        )}

      </div>{/* end 3-column flex */}
    </div>
  );
}

export default function McatPracticePage({
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
      <McatPracticeInner params={params} />
    </Suspense>
  );
}
