"use client";

import { useState, useEffect, useCallback, useRef, use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import { LoadingPanel } from "@/components/mcat/LoadingPanel";
import { ScoreBar } from "@/components/mcat/ScoreBar";
import FeedbackWidget from "@/components/mcat/FeedbackWidget";
import { LessonView } from "@/components/mcat/LessonView";
import { getOrCreateMcatSession } from "@/lib/mcatSession";

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
  if (d < 0.35) return { label: "Easy", cls: "bg-green-100 text-green-800" };
  if (d < 0.65) return { label: "Medium", cls: "bg-yellow-100 text-yellow-800" };
  return { label: "Hard", cls: "bg-red-100 text-red-800" };
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

  // Question
  const [question, setQuestion] = useState<Question | null>(null);
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
      setSelectedChoice(null);
      setShowLessonOffer(false);
      setErrorMsg("");

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
        }),
      }).catch(() => {});

      setStats((s) => ({ ...s, flashcards: s.flashcards + 1 }));

      const nextIdx = fcIndex + 1;
      if (nextIdx >= flashcards.length) {
        // Warm-up done → proceed to questions
        loadQuestion(sessionId, currentKeyword.id);
      } else {
        setFcIndex(nextIdx);
        setFcBackShown(false);
      }
    },
    [flashcards, fcIndex, currentKeyword, sessionId, loadQuestion]
  );

  const flipFcCard = useCallback(() => {
    setFcFlipping(true);
    setTimeout(() => {
      setFcBackShown((prev) => !prev);
      setFcFlipping(false);
    }, 150);
  }, []);

  // ── Handle answer ─────────────────────────────────────────────────────────

  const handleChoice = useCallback(
    async (idx: number) => {
      if (!question || !currentKeyword || phase !== "practicing") return;

      setSelectedChoice(idx);
      setPhase("revealed");

      const correct = idx === question.correct_index;
      setStats((s) => ({
        ...s,
        answered: s.answered + 1,
        correct: s.correct + (correct ? 1 : 0),
      }));

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
    [question, currentKeyword, phase, sessionId, isReviewCard]
  );

  // ── Handle "I don't know" ─────────────────────────────────────────────────

  const handleDontKnow = useCallback(async () => {
    if (!question || !currentKeyword || phase !== "practicing") return;

    setSelectedChoice(null);
    setPhase("revealed");

    setStats((s) => ({ ...s, answered: s.answered + 1 }));

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
  }, [question, currentKeyword, phase, sessionId, isReviewCard]);

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

  const diff = question ? diffLabel(question.difficulty) : null;
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={backHref}
              className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
            >
              {isScoped ? "← Back" : "← MCAT"}
            </Link>
            {/* Scope chip */}
            {isScoped && scopeLabel && (
              <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                {umbrellaId ? "Topic" : "Keyword"}: {scopeLabel}
              </span>
            )}
            {/* Keyword label + umbrella chip + phase badge */}
            {currentKeyword && phase !== "loading" && phase !== "done" && (
              <div className="flex items-center gap-2 min-w-0">
                {isFlashcardPhase ? (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
                    Warm-up
                  </span>
                ) : null}
                <p className="font-semibold text-gray-900 text-sm truncate">
                  {currentKeyword.label}
                </p>
                {currentKeyword.umbrella_label && (
                  <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                    {currentKeyword.umbrella_label}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* "Learn this concept" — visible during question phases */}
            {currentKeyword &&
              (phase === "practicing" || phase === "revealed") &&
              !isReviewCard && (
                <button
                  onClick={handleStartLesson}
                  className="text-xs text-gray-400 hover:text-blue-600 underline underline-offset-2 transition-colors"
                >
                  Learn this
                </button>
              )}

            {/* Session stats */}
            <div className="text-right">
              {stats.answered > 0 && (
                <p className="text-xs text-gray-500">
                  {stats.correct}/{stats.answered} correct
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Mastery meter — visible during active question phases on current topic */}
        {currentKeyword &&
          !isReviewCard &&
          (phase === "practicing" || phase === "revealed") && (
            <div className="max-w-2xl mx-auto px-4 pb-1.5">
              <p className="text-xs text-gray-400">
                Mastering:{" "}
                <span className="font-mono tracking-wider text-indigo-500">
                  {masteryDots}
                </span>{" "}
                <span className="text-gray-400">
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
          <div className="max-w-2xl mx-auto px-4 pb-2">
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {difficultyOptions.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setDifficultyMode(value)}
                  className={`px-2.5 py-1 transition-colors font-medium ${
                    difficultyMode === value
                      ? "bg-gray-900 text-white"
                      : "bg-white text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Queue progress bar */}
        {queue.length > 0 && phase !== "loading" && phase !== "done" && (
          <div className="max-w-2xl mx-auto px-4 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-1 bg-blue-500 rounded-full transition-all"
                  style={{
                    width: `${Math.round((queueIndex / queue.length) * 100)}%`,
                  }}
                />
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                Keyword {queueIndex + 1} of {queue.length}
              </span>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">

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
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center space-y-3">
            <p className="text-sm text-red-600">{errorMsg || "Something went wrong"}</p>
            <button
              onClick={() => {
                if (currentKeyword) {
                  loadQuestion(sessionId, currentKeyword.id);
                } else {
                  fetchQueue(sessionId);
                }
              }}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Transition interstitial ── */}
        {phase === "transition" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-5 text-center space-y-2 max-w-sm w-full">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
                Keyword complete
              </p>
              <p className="text-base font-semibold text-gray-900 truncate">
                {transitionLabel}
              </p>
              <p className="text-sm text-gray-500 animate-pulse">
                Moving to next keyword…
              </p>
            </div>
          </div>
        )}

        {/* ── Flashcard warm-up ── */}
        {phase === "flashcard" && currentFc && (
          <>
            {/* Warm-up hint */}
            <div className="text-center">
              <p className="text-xs text-teal-600 font-medium bg-teal-50 border border-teal-100 rounded-full inline-block px-3 py-1">
                Quick warm-up — get familiar before questions
              </p>
            </div>

            {/* Card counter */}
            <p className="text-xs text-gray-400 text-right">
              {fcIndex + 1} / {flashcards.length}
            </p>

            {/* Flip card */}
            <button
              type="button"
              onClick={flipFcCard}
              className={`w-full text-left bg-white rounded-2xl border-2 shadow-md p-6 min-h-[180px] flex flex-col justify-between transition-opacity duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                fcFlipping ? "opacity-0" : "opacity-100"
              } ${
                fcBackShown
                  ? "border-teal-300 hover:border-teal-400"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              {!fcBackShown ? (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                    Front
                  </p>
                  <p className="text-base font-medium text-gray-900 leading-relaxed whitespace-pre-line">
                    {currentFc.front}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-teal-500 uppercase tracking-wide mb-3">
                    Back
                  </p>
                  <p className="text-base text-gray-800 leading-relaxed whitespace-pre-line">
                    {currentFc.back}
                  </p>
                </div>
              )}
              <p className="text-xs text-gray-300 mt-4 text-right select-none">
                {fcBackShown ? "tap to flip back" : "tap to flip"}
              </p>
            </button>

            {/* Show answer button */}
            {!fcBackShown && (
              <button
                onClick={flipFcCard}
                className="w-full py-3.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors"
              >
                Show answer
              </button>
            )}

            {/* Grade buttons */}
            {fcBackShown && (
              <>
                <div className="flex gap-2">
                  <button
                    onClick={() => gradeFlashcard("missed_it")}
                    className="flex-1 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold hover:bg-red-100 transition-colors"
                  >
                    ✗ Missed it
                  </button>
                  <button
                    onClick={() => gradeFlashcard("got_it")}
                    className="flex-1 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-semibold hover:bg-green-100 transition-colors"
                  >
                    ✓ Got it
                  </button>
                </div>
                <div className="flex justify-center">
                  <button
                    onClick={() => gradeFlashcard("dont_know")}
                    className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
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

        {/* ── Practice / Revealed ── */}
        {(phase === "practicing" || phase === "revealed") && question && (
          <>
            {/* Badge row */}
            <div className="flex items-center gap-2 flex-wrap">
              {isReviewCard && (
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                  Review
                </span>
              )}
              {diff && (
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${diff.cls}`}
                >
                  {diff.label}
                </span>
              )}
            </div>

            {/* Stem */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <p className="text-sm font-medium text-gray-900 leading-relaxed whitespace-pre-line">
                {question.stem}
              </p>
            </div>

            {/* Choices */}
            <div className="space-y-2">
              {question.choices.map((choice, i) => {
                let state: "default" | "selected" | "correct" | "wrong" | "dimmed" =
                  "default";
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

            {/* I don't know */}
            {phase === "practicing" && (
              <div className="flex justify-center">
                <button
                  onClick={handleDontKnow}
                  className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
                >
                  I don&apos;t know
                </button>
              </div>
            )}

            {/* Explanation */}
            {phase === "revealed" && question.explanation && (
              <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1.5">
                  Explanation
                </p>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                  {question.explanation}
                </p>
              </div>
            )}

            {/* Lesson offer banner — only if struggling and not yet lessoned */}
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

            {/* Feedback + action buttons */}
            {phase === "revealed" && (
              <>
                <FeedbackWidget
                  sessionId={sessionId}
                  contentType="question"
                  contentId={question.id}
                  className="px-1"
                />

                <div className="flex flex-col gap-2 sm:flex-row">
                  {!isReviewCard && (
                    <button
                      onClick={handleSimilar}
                      className="flex-1 py-3 rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 text-sm font-medium transition-colors"
                    >
                      Similar question
                    </button>
                  )}
                  <button
                    onClick={handleNext}
                    className="flex-1 py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors"
                  >
                    {nextButtonLabel()}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Done screen ── */}
        {phase === "done" && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 shadow-sm text-center space-y-5">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <span className="text-green-600 text-2xl font-bold">✓</span>
            </div>

            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {queue.length === 0
                  ? "All keywords mastered for now"
                  : "Great session!"}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {queue.length === 0
                  ? "Check back later for spaced-review questions."
                  : `You worked through ${queue.length} keyword${queue.length !== 1 ? "s" : ""}.`}
              </p>
            </div>

            {/* Stats */}
            {(stats.answered > 0 || stats.flashcards > 0) && (
              <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-2 text-left">
                {stats.flashcards > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Flashcards reviewed</span>
                    <span className="font-medium text-gray-900">{stats.flashcards}</span>
                  </div>
                )}
                {stats.answered > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Questions answered</span>
                      <span className="font-medium text-gray-900">{stats.answered}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Correct</span>
                      <span className="font-medium text-gray-900">
                        {stats.correct} ({stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 0}%)
                      </span>
                    </div>
                  </>
                )}
                {stats.topicsMastered > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Topics mastered</span>
                    <span className="font-medium text-gray-900">{stats.topicsMastered}</span>
                  </div>
                )}
                {stats.lessons > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Lessons taken</span>
                    <span className="font-medium text-gray-900">{stats.lessons}</span>
                  </div>
                )}
                {stats.answered > 0 && (
                  <div className="pt-1">
                    <ScoreBar
                      pct={
                        stats.answered > 0
                          ? Math.round((stats.correct / stats.answered) * 100)
                          : 0
                      }
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  lessonedKeywordsRef.current = new Set();
                  setStats({ answered: 0, correct: 0, lessons: 0, flashcards: 0, topicsMastered: 0 });
                  fetchQueue(sessionId);
                }}
                className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors"
              >
                Practice again
              </button>
              <Link
                href={backHref}
                className="w-full py-3 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors text-center"
              >
                {isScoped ? "Back" : "Back to MCAT"}
              </Link>
            </div>
          </div>
        )}
      </main>
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <McatPracticeInner params={params} />
    </Suspense>
  );
}
