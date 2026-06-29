"use client";

/**
 * Fully-automatic mode — Duolingo-style "just press Continue".
 *
 * States:
 *   loading          → fetching auto-plan
 *   needs_diagnostic → card routing to /math/[course]/diagnostic?return=auto
 *   flashcard        → flashcard warm-up before first question on a new keyword
 *   practicing       → embedded practice loop (mirrors category practice page)
 *   revealed         → showing answer before Next
 *   category_complete → interstitial: "Unit complete 🎉 → next unit"
 *   mini_quiz        → 4-question checkpoint quiz before advancing
 *   mini_quiz_revealed → showing quiz answer before next
 *   mini_quiz_loading → loading quiz questions
 *   course_complete  → all categories mastered
 *   error            → recoverable error card
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
 *   - Top bar shows course ProgressBar (overall_pct) + "Unit X of N" indicator
 *   - NEW keywords get a 2-card flashcard warm-up before first question
 *     (gracefully degrades if /api/math/flashcards returns 0 cards or 502s)
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
import { GrindMeter } from "@/components/gamification/GrindMeter";
import { NavMenu } from "@/components/nav/NavMenu";
import { CorrectPulse } from "@/components/ui/CorrectPulse";
import { AnswerAffirmation } from "@/components/ui/AnswerAffirmation";
import { GeneratingLoader } from "@/components/ui/GeneratingLoader";
import QuestionToolbar from "@/components/practice/QuestionToolbar";
import LessonModal from "@/components/practice/LessonModal";
import FlipCard from "@/components/cards/FlipCard";
import { primaryKeywordId } from "@/lib/primaryKeyword";
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
import {
  reviewProbabilityFor,
  FULL_INTRO_DECK_COUNT,
} from "@/lib/courseEngine/config";
import {
  type DifficultyTier,
  tierForMastery,
  isMastered,
  MASTERY_ADVANCE,
  MASTERY_START,
  flashcardProbability,
  decayedScore,
  isDue,
  type KeywordState,
} from "@/lib/courseEngine/adaptive";
import {
  createPracticeBuffer,
  type PracticeBuffer,
  type ServeDescriptor,
  type ReadyItem,
} from "@/lib/courseEngine/practiceBuffer";
import { nextSrsState, MEMORIZED_BOX, type SrsState } from "@/lib/flashcardSrs";

// ─── Constants ────────────────────────────────────────────────────────────────
//
// Emphasis-driven knobs (mastery streak, warm-up flashcard count, review rate) now
// come from the CourseConfig registry (lib/courseEngine/config.ts), proficiency-gated.
// The remaining constants below are course-agnostic engine constants.

const TOPIC_MAX_QUESTIONS = 8;
const AUTO_REPLAN_INTERVAL = 8; // re-fetch auto-plan every N questions answered
const MINI_QUIZ_COUNT = 4;

// Adaptive-engine knobs (mastery → flashcard:question ratio + difficulty) are
// shared with the MCAT auto mode in lib/courseEngine/adaptive.ts.

// ── Per-subtopic intro persistence ──────────────────────────────────────────
// Each subtopic's guided sequence is LESSON → FLASHCARDS → QUIZ. The lesson +
// flashcards "intro" is shown ONCE per subtopic; we remember which subtopics
// have had their intro so a reload (or returning later) drops straight into
// practice instead of re-showing the lesson.
//
// This "intro seen" set is SERVER-AUTHORITATIVE and keyed PER USER (session):
// it comes from /api/math/auto-plan (`intro_seen`) and is persisted via
// /api/math/auto-intro into math_student_keyword_states.intro_seen. It used to
// live in localStorage (`lodera_auto_intro_<course>`), which made a brand-new
// account in a browser with prior progress inherit stale "already seen" state
// and look like a returning student. localStorage is no longer consulted.

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | "loading"
  | "needs_diagnostic"
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
  | "quiz_results"
  | "course_complete"
  | "done"
  | "error";

interface MathFlashcard {
  id: string;
  front_latex: string;
  back_latex: string;
  keyword_weights: Record<string, number>;
}

interface AutoPlanFrontier {
  id: string;
  label: string;
  section: string;
  role: string;
  umbrella_label: string | null;
  order_index: number;
}

interface AutoPlanTopic {
  id: string;          // umbrella keyword id (used for the topic lesson + flashcards)
  label: string;
  category_id: string;
  topic_number: number;
  topic_total: number;
  in_depth_ids: string[];
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
  frontier_topic: AutoPlanTopic | null;
  next_focus: string[];
  review_focus: string[];
  progress: AutoPlanCategoryProgress[];
  overall_pct: number;
  intro_seen?: string[];
}

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

// ─── Auto inner component ─────────────────────────────────────────────────────

function MathAutoInner({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = use(params);
  const searchParams = useSearchParams();
  const returnParam = searchParams.get("return");
  // "Learn this" scope — when present, this auto run is a mini-auto restricted to a
  // single category / umbrella / keyword (forward path scoped; spiral review still
  // pulls from earlier mastered topics). Threaded into every auto-plan fetch.
  const scopeParam = searchParams.get("scope");
  const scopeIdParam = searchParams.get("scope_id");
  const courseLabel = COURSE_LABELS[course] ?? course;

  // Advancement is THRESHOLD-based on the 0–1 mastery score (MASTERY_ADVANCE) —
  // there is no longer a "N correct in a row" gate. See lib/courseEngine/adaptive.ts.
  const REVIEW_PROBABILITY = reviewProbabilityFor(course);

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
  const queueRef = useRef<MathQueueKeyword[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const [reviewPool, setReviewPool] = useState<MathReviewKeyword[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  useEffect(() => { reviewPoolRef.current = reviewPool; }, [reviewPool]);

  const currentKeyword = queue[queueIndex] ?? null;

  const lessonedKeywordsRef = useRef<Set<string>>(new Set());
  // In-sitting correct-streak setter retained for gamification reset points; the
  // value itself no longer gates mastery (threshold on score does) so it's unread.
  const [, setTopicCorrectStreak] = useState(0);
  const [topicQuestionCount, setTopicQuestionCount] = useState(0);
  const excludeIdsRef = useRef<string[]>([]);
  const recentKeywordIdsRef = useRef<string[]>([]);
  const recentQuestionIdsRef = useRef<string[]>([]);
  const seenStemsRef = useRef<string[]>([]);

  // ─── Practice buffer: serve the next item from memory / prefetch (instant Next).
  // Created once; the fetchers close over the stable diversity refs + the constant
  // `course`. The server hands back a `buffer` of ready extras with each fetch, so
  // one round-trip covers several questions and a prefetch during the answer-reveal
  // window makes Continue feel instant. take/prefetch are side-effect-free w.r.t.
  // the page (refs are mutated only in applyQuestion/applyFlashcards), so a prefetch
  // that's never applied leaks nothing.
  const bufferRef = useRef<PracticeBuffer<
    MathQuestion,
    MathFlashcard,
    MathReviewKeyword
  > | null>(null);
  if (!bufferRef.current) {
    bufferRef.current = createPracticeBuffer<MathQuestion, MathFlashcard, MathReviewKeyword>({
      fetchQuestionBatch: async (d) => {
        try {
          const body: Record<string, unknown> = {
            session_id: d.sessionId,
            category_id: d.categoryId,
            keyword_id: d.keywordId,
            exclude_ids: excludeIdsRef.current,
            recent_keyword_ids: recentKeywordIdsRef.current.slice(-6),
            recent_question_ids: recentQuestionIdsRef.current.slice(-10),
            seen_stems: seenStemsRef.current.slice(-30),
            course: course as MathCourse,
          };
          if (d.difficulty) body.difficulty = d.difficulty;
          const res = await fetch("/api/math/next-question", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const msg = await res.text().catch(() => "Unknown error");
            return { error: msg, status: res.status };
          }
          const data = (await res.json()) as {
            question: MathQuestion;
            buffer?: MathQuestion[];
          };
          return {
            head: data.question,
            extras: Array.isArray(data.buffer) ? data.buffer : [],
          };
        } catch (e) {
          return { error: (e as Error).message ?? "Failed to load question" };
        }
      },
      fetchFlashcards: async (d) => {
        try {
          const res = await fetch("/api/math/flashcards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: d.sessionId,
              category_id: d.categoryId,
              keyword_id: d.keywordId,
              count: 1,
              course: course as MathCourse,
            }),
          });
          if (!res.ok) {
            console.error("[auto] math/flashcards fetch failed:", res.status);
            return { flashcards: [] };
          }
          const data = (await res.json()) as { flashcards: MathFlashcard[] };
          return { flashcards: data.flashcards ?? [] };
        } catch (e) {
          console.error("[auto] math/flashcards fetch error:", (e as Error).message);
          return { flashcards: [] };
        }
      },
    });
  }
  // Indirection so handleChoice/handleDontKnow (defined before the decision logic)
  // can kick off a prefetch without a forward reference.
  const prefetchNextRef = useRef<((sid: string) => void) | null>(null);

  // Server-authoritative "intro seen" set (populated from auto-plan.intro_seen).
  const introSeenRef = useRef<Set<string>>(new Set());

  // Mark a subtopic's LESSON→FLASHCARDS intro complete: update the local cache
  // AND persist per-user to Supabase (math_student_keyword_states.intro_seen).
  const markIntroSeen = useCallback(
    (sid: string, keywordId: string, categoryId: string) => {
      introSeenRef.current.add(keywordId);
      void fetch("/api/math/auto-intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          keyword_id: keywordId,
          category_id: categoryId,
          course,
        }),
      }).catch(() => {});
    },
    [course]
  );

  // Authoritatively persist that a subtopic was MASTERED, so the server frontier
  // advances and reopening auto mode resumes past it (never re-serving its lesson).
  // The client advances on the consecutive-correct streak; this makes the server
  // agree instead of waiting for the unreachable EMA score≥0.8 gate.
  const markSkillMastered = useCallback(
    (sid: string, keywordId: string, categoryId: string) => {
      introSeenRef.current.add(keywordId);
      void fetch("/api/math/master-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          keyword_id: keywordId,
          category_id: categoryId,
          course,
        }),
      }).catch(() => {});
    },
    [course]
  );

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
  const [showHint, setShowHint] = useState(false);
  const consecutiveWrongRef = useRef(0);

  // ── Adaptive-engine refs ────────────────────────────────────────────────────
  // Live mastery score of the current keyword (seeds difficulty + flashcard ratio).
  const currentKwScoreRef = useRef(MASTERY_START);
  // How the active flashcard run should resume: 'intro' = the per-keyword
  // LESSON→FLASHCARDS warm-up (advance into first question when done); 'practice'
  // = an interleaved adaptive flashcard (resume the adaptive loop when done).
  const flashcardModeRef = useRef<"intro" | "practice">("intro");
  // Count of flashcards served consecutively (resets when a question is served).
  const fcInRowRef = useRef(0);
  const reviewPoolRef = useRef<MathReviewKeyword[]>([]);
  const queueIndexRef = useRef(0);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);

  // See-lesson POPUP (in-page, same treatment as the refresher). Keyed to the
  // served item's keyword so the lesson always corresponds to the question/card.
  const [lessonModal, setLessonModal] = useState<{ keywordId: string; label?: string } | null>(null);

  // The keyword the CURRENT live item (question or flashcard) was SERVED under —
  // i.e. the subtopic the student is actively practicing (or the spaced-review
  // keyword for a review item). This is authoritative for "the served item's
  // keyword" (behavior 7): we key every see-lesson / refresher / auto-surface to
  // it, NOT to the question's embedding-pinpointed primary_keyword_id, which can
  // resolve to a sibling and surface a mismatched lesson.
  const [servedKeywordId, setServedKeywordId] = useState<string | null>(null);

  const [stats, setStats] = useState({ answered: 0, correct: 0, lessons: 0, topicsMastered: 0 });
  const [transitionLabel, setTransitionLabel] = useState("");
  const [combo, setCombo] = useState(0);
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState(false);
  // When this study session started — drives the grind meter's time-on-app heat.
  const [sessionStart] = useState(() => Date.now());
  const sessionAnswersRef = useRef(0); // for re-plan trigger

  // ── Mini-quiz state ────────────────────────────────────────────────────────

  const [quizQuestions, setQuizQuestions] = useState<MathQuestion[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizSelectedChoice, setQuizSelectedChoice] = useState<number | null>(null);
  const [quizCorrect, setQuizCorrect] = useState(0);
  // Per-question result tracking for the remedial offer on quiz completion.
  // Maps dominant keyword_id → { label, correct } for questions answered in the quiz.
  const quizKwResultsRef = useRef<Map<string, { label: string; correct: boolean }>>(new Map());
  // Keywords that were failed in the checkpoint quiz (shown on quiz_results screen).
  const [failedQuizKeywords, setFailedQuizKeywords] = useState<Array<{ id: string; label: string }>>([]);
  const pendingAdvanceCategoryRef = useRef<string | null>(null); // category id to advance past

  // ── Category complete ──────────────────────────────────────────────────────

  const [completedCategoryLabel, setCompletedCategoryLabel] = useState("");
  const [skipQuizPending, setSkipQuizPending] = useState(false);

  // ── Flashcard warm-up state ────────────────────────────────────────────────

  const [flashcards, setFlashcards] = useState<MathFlashcard[]>([]);
  const [fcIndex, setFcIndex] = useState(0);
  // Per-card Leitner box for the current intro deck (reuses lib/flashcardSrs). A
  // missed card recirculates (spaced) until it reaches the memorized box.
  const fcBoxRef = useRef<Map<string, SrsState>>(new Map());

  // ── Topic intro (LESSON → FLASHCARDS → QUIZ) state ──────────────────────────
  // The current topic (umbrella) we're introducing. Its lesson + flashcards play
  // once before practice questions on the topic's skills begin.
  const [topic, setTopic] = useState<AutoPlanTopic | null>(null);
  const topicRef = useRef<AutoPlanTopic | null>(null);
  useEffect(() => { topicRef.current = topic; }, [topic]);
  // The keyword the inline lesson renders for: the topic (umbrella) during the
  // topic intro, or the current skill for a mid-practice struggle lesson.
  const [lessonTarget, setLessonTarget] = useState<{ id: string; label: string } | null>(null);
  // True while we're in the lesson/flashcard intro for a topic (vs. a mid-practice
  // struggle lesson, which returns to the same question instead of advancing).
  const inTopicIntroRef = useRef(false);
  // Function ref to advanceToNextCategory (defined later) — breaks the
  // beginTopic ⇄ advance circular dependency without forward references.
  const advanceToNextCategoryRef = useRef<((sid: string) => Promise<void>) | null>(null);

  useStreakTouchOnce();

  // ─── Fetch auto-plan ───────────────────────────────────────────────────────

  const fetchPlan = useCallback(async (sid: string): Promise<AutoPlanResponse | null> => {
    let url = `/api/math/auto-plan?session_id=${encodeURIComponent(sid)}&course=${encodeURIComponent(course)}`;
    if (scopeParam && scopeIdParam) {
      url += `&scope=${encodeURIComponent(scopeParam)}&scope_id=${encodeURIComponent(scopeIdParam)}`;
    }
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load plan"));
    const data = (await res.json()) as AutoPlanResponse;
    return data;
  }, [course, scopeParam, scopeIdParam]);

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
        checkpoint: true,
        course: course as MathCourse,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { questions: MathQuestion[] };
    return data.questions ?? [];
  }, [course]);

  // ─── Load flashcards for warm-up ──────────────────────────────────────────

  const loadFlashcards = useCallback(
    async (sid: string, kwId: string, categoryId: string, count = 2): Promise<MathFlashcard[]> => {
      try {
        const res = await fetch("/api/math/flashcards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sid,
            category_id: categoryId,
            keyword_id: kwId,
            count,
            course: course as MathCourse,
          }),
        });
        if (!res.ok) {
          // Non-fatal: skip warm-up if flashcards unavailable (e.g. 502 from generation)
          console.error("[auto] math/flashcards fetch failed:", res.status);
          return [];
        }
        const data = (await res.json()) as { flashcards: MathFlashcard[] };
        return data.flashcards ?? [];
      } catch (e) {
        console.error("[auto] math/flashcards fetch error:", (e as Error).message);
        return [];
      }
    },
    [course]
  );

  // ─── Apply a fetched item to the UI ─────────────────────────────────────────
  // The APPLY half (the only place the seen/exclude/recent refs are mutated). The
  // FETCH half lives in the practice buffer and is side-effect-free, so an unused
  // prefetch never pollutes these refs.

  const applyQuestion = useCallback(
    (q: MathQuestion, d: ServeDescriptor<MathReviewKeyword>) => {
      // A question is being served → reset the consecutive-flashcard counter and
      // record the keyword it was served under (for behavior-7 lesson keying).
      fcInRowRef.current = 0;
      setServedKeywordId(d.reviewKeyword?.id ?? d.keywordId);
      setQuestion(q);
      excludeIdsRef.current = [...excludeIdsRef.current, q.id];
      recentQuestionIdsRef.current = [...recentQuestionIdsRef.current, q.id].slice(-10);
      if (q.primary_keyword_id) {
        recentKeywordIdsRef.current = [...recentKeywordIdsRef.current, q.primary_keyword_id].slice(-10);
      }
      const stemText = q.stem_latex ?? "";
      if (stemText) {
        seenStemsRef.current = [...seenStemsRef.current, stemText].slice(-50);
      }
      setReviewIndex(null);
      setSelectedChoice(null);
      setShowHint(false);
      setErrorMsg("");
      setLastAnswerCorrect(false);
      setIsReviewCard(!!d.forReview);
      setPhase("practicing");
    },
    []
  );

  const applyFlashcards = useCallback(
    (cards: MathFlashcard[], d: ServeDescriptor<MathReviewKeyword>) => {
      flashcardModeRef.current = "practice";
      fcInRowRef.current += 1;
      setIsReviewCard(false);
      setServedKeywordId(d.reviewKeyword?.id ?? d.keywordId);
      setFlashcards(cards);
      setFcIndex(0);
      setPhase("flashcard");
    },
    []
  );

  const applyReady = useCallback(
    (ready: ReadyItem<MathQuestion, MathFlashcard, MathReviewKeyword>) => {
      if (!ready.ok) {
        setErrorMsg(ready.error);
        setPhase("error");
        return;
      }
      if (ready.kind === "question") applyQuestion(ready.question, ready.descriptor);
      else applyFlashcards(ready.flashcards, ready.descriptor);
    },
    [applyQuestion, applyFlashcards]
  );

  // ─── Load question ─────────────────────────────────────────────────────────
  // Serve a question for the given keyword via the buffer (instant if buffered).

  const loadQuestion = useCallback(
    async (
      sid: string,
      keywordId: string,
      categoryId: string,
      forReview?: MathReviewKeyword,
      difficulty?: DifficultyTier,
    ) => {
      setPhase("generating");
      setQuestion(null);
      setSelectedChoice(null);
      setReviewIndex(null);
      const ready = await bufferRef.current!.take({
        sessionId: sid,
        keywordId,
        categoryId,
        kind: "question",
        difficulty,
        forReview: !!forReview,
        reviewKeyword: forReview,
      });
      applyReady(ready);
    },
    [applyReady]
  );

  // ─── Start a practice question for a keyword ────────────────────────────────
  // (Flashcards are no longer per-keyword warm-ups — they play once per topic,
  //  up front, as part of the LESSON → FLASHCARDS → QUIZ sequence.)

  const startKeyword = useCallback(
    async (sid: string, kw: MathQueueKeyword, categoryId: string) => {
      // New keyword context → drop any prefetch/buffer from the previous keyword.
      bufferRef.current?.clear();
      setTopicCorrectStreak(0);
      setTopicQuestionCount(0);
      consecutiveWrongRef.current = 0;
      fcInRowRef.current = 0;
      currentKwScoreRef.current = kw.score ?? MASTERY_START;
      // Difficulty follows this keyword's mastery from the very first question.
      await loadQuestion(sid, kw.id, categoryId, undefined, tierForMastery(kw.score ?? 0.5, false));
    },
    [loadQuestion]
  );

  // ─── Per-SUBTOPIC intro: LESSON → FLASHCARDS → practice, for ONE in_depth skill.
  // A topic (umbrella) is taught subtopic-by-subtopic in CED order. Each subtopic
  // gets its own basic lesson + flashcard warm-up (shown once, remembered per skill
  // id) before its practice questions. Umbrellas themselves NEVER get a lesson.
  const beginSkillIntro = useCallback(
    (sid: string, kw: MathQueueKeyword, categoryId: string) => {
      // New subtopic context → drop any prefetch/buffer from the previous keyword.
      bufferRef.current?.clear();
      setTopicCorrectStreak(0);
      setTopicQuestionCount(0);
      consecutiveWrongRef.current = 0;
      fcInRowRef.current = 0;
      currentKwScoreRef.current = kw.score ?? MASTERY_START;
      if (introSeenRef.current.has(kw.id)) {
        // Already introduced this subtopic — straight to its practice question.
        inTopicIntroRef.current = false;
        void loadQuestion(sid, kw.id, categoryId, undefined, tierForMastery(kw.score ?? 0.5, false));
        return;
      }
      // Step 1: LESSON on the SUBTOPIC (in_depth skill). MathLessonView self-fetches.
      inTopicIntroRef.current = true;
      setLessonTarget({ id: kw.id, label: kw.label });
      setPhase("lesson");
    },
    [loadQuestion]
  );

  // ─── Begin practice for the current topic = begin its FIRST subtopic's intro ──
  const startTopicPractice = useCallback(
    (sid: string) => {
      const q = queueRef.current;
      const t = topicRef.current;
      if (q.length > 0 && t) {
        beginSkillIntro(sid, q[0]!, t.category_id);
      } else {
        // Nothing to practice — re-plan / advance.
        void advanceToNextCategoryRef.current?.(sid);
      }
    },
    [beginSkillIntro]
  );

  // ─── Subtopic flashcard warm-up (step 2 of LESSON → FLASHCARDS → QUIZ) ───────
  const startSkillFlashcards = useCallback(
    async (sid: string, kw: MathQueueKeyword, categoryId: string) => {
      // FLASHCARDS-FIRST: the student must see and try to memorize this subtopic's
      // COMPLETE flashcard deck BEFORE any practice question. Request the full deck
      // (route caps a complete per-keyword deck at FULL_INTRO_DECK_COUNT), scoped to
      // this one subtopic, so every card is shown up front.
      // The flashcards STEP must never be skipped between lesson and quiz. A cold
      // per-keyword deck may need a moment to generate, so retry once if empty.
      let cards = await loadFlashcards(sid, kw.id, categoryId, FULL_INTRO_DECK_COUNT);
      if (cards.length === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        cards = await loadFlashcards(sid, kw.id, categoryId, FULL_INTRO_DECK_COUNT);
      }
      if (cards.length > 0) {
        flashcardModeRef.current = "intro";
        setServedKeywordId(kw.id);
        fcBoxRef.current = new Map(); // fresh Leitner state for this deck
        setFlashcards(cards);
        setFcIndex(0);
        setPhase("flashcard");
        return;
      }
      // Still no flashcards available → mark this subtopic's intro done and start practice.
      markIntroSeen(sid, kw.id, categoryId);
      inTopicIntroRef.current = false;
      void loadQuestion(sid, kw.id, categoryId);
    },
    [loadFlashcards, loadQuestion, markIntroSeen]
  );

  // ─── Begin a topic: just record it; its first subtopic's intro starts practice ─
  const beginTopic = useCallback(
    async (sid: string, t: AutoPlanTopic | null) => {
      if (t) {
        setTopic(t);
        topicRef.current = t;
      }
      startTopicPractice(sid);
    },
    [startTopicPractice]
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

      if (!newPlan.frontier || !newPlan.frontier_topic) {
        setPhase("course_complete");
        return;
      }

      setFrontier(newPlan.frontier);
      const frontierCatId = newPlan.frontier.id;
      const topicPlan = newPlan.frontier_topic;

      // Seed the server-authoritative intro-seen set for this user.
      introSeenRef.current = new Set(newPlan.intro_seen ?? []);

      if (newPlan.next_focus.length === 0) {
        // Topic has no unmastered skills → advance (should be rare; plan re-fetch handles it)
        setPhase("course_complete");
        return;
      }

      // Build the practice queue. We query WHOLE-COURSE scope (no category_id) with
      // the topic's skills as keyword_ids, so the returned review_pool spans EVERY
      // earlier unit — that's what powers cross-unit spiral review. The queue itself
      // is just the current topic's skills.
      setPhase("loading");
      setErrorMsg("");
      try {
        const focusParam = newPlan.next_focus
          .map((id) => `keyword_ids=${encodeURIComponent(id)}`)
          .join("&");
        const url =
          `/api/math/practice-queue?session_id=${encodeURIComponent(sid)}` +
          `&course=${encodeURIComponent(course)}` +
          (focusParam ? `&${focusParam}` : "");

        let data: MathPracticeQueueResponse | null = null;
        const res = await fetch(url);
        if (res.ok) {
          data = (await res.json()) as MathPracticeQueueResponse;
        } else {
          // Fallback: scope to the frontier category only.
          const fallbackRes = await fetch(
            `/api/math/practice-queue?session_id=${encodeURIComponent(sid)}` +
              `&course=${encodeURIComponent(course)}` +
              `&category_id=${encodeURIComponent(frontierCatId)}`
          );
          if (!fallbackRes.ok) {
            const msg = await fallbackRes.text().catch(() => "Unknown error");
            setErrorMsg(msg);
            setPhase("error");
            return;
          }
          data = (await fallbackRes.json()) as MathPracticeQueueResponse;
        }

        if (!data || data.queue.length === 0) {
          setPhase("course_complete");
          return;
        }

        // Order the queue to follow the topic's CED skill order (next_focus order),
        // so practice walks the topic's skills in sequence rather than yield-nudged.
        const focusOrder = new Map(newPlan.next_focus.map((id, i) => [id, i]));
        const orderedQueue = [...data.queue].sort(
          (a, b) =>
            (focusOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (focusOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)
        );

        // Spiral review = previously-learned skills from EARLIER topics only.
        // Exclude the current topic's own skills from the review pool.
        const topicSkillSet = new Set(topicPlan.in_depth_ids);
        const reviewPoolFiltered = (data.review_pool ?? []).filter(
          (r) => !topicSkillSet.has(r.id)
        );

        setQueue(orderedQueue);
        queueRef.current = orderedQueue;
        setReviewPool(reviewPoolFiltered);
        setQueueIndex(0);
        setTopicCorrectStreak(0);
        setTopicQuestionCount(0);
        excludeIdsRef.current = [];
        setIsReviewCard(false);
        setPendingReviewBetweenTopics(false);

        // Enter the topic's LESSON → FLASHCARDS → QUIZ sequence.
        await beginTopic(sid, topicPlan);
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load practice queue");
        setPhase("error");
      }
    },
    [course, beginTopic]
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

  // Push the currently-live question into review history (answered or skipped).
  const pushHistory = useCallback((entry: HistoryEntry) => {
    historyRef.current = [...historyRef.current, entry].slice(-HISTORY_CAP);
  }, []);

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
          // Keep the live mastery score current — drives the flashcard:question
          // ratio + question difficulty for the next item.
          if (typeof kwState?.score === "number") currentKwScoreRef.current = kwState.score;

          // Prefetch the next item NOW — during the answer-reveal read window — so
          // Continue is instant. Skip when this answer will ADVANCE the keyword
          // (mastered): that path has its own transition that masks the load, and we
          // don't yet know the next keyword. A prefetch that ends up unused (e.g. the
          // 8-question cap fires) is harmless — handleNext's advance clears it.
          if (!isReviewCard && !isMastered(currentKwScoreRef.current)) {
            prefetchNextRef.current?.(sessionId);
          }
          const needsLesson = kwState?.needs_lesson === true;
          const tooManyWrong = consecutiveWrongRef.current >= 2;
          if (
            !correct &&
            (tooManyWrong || needsLesson) &&
            !lessonedKeywordsRef.current.has(currentKeyword.id)
          ) {
            // ANY lesson recommendation — the single needs_lesson signal OR
            // repeated misses (8) — surfaces as a closeable POPUP (not an inline
            // bottom offer), keyed to the SERVED keyword so it matches the
            // question (7).
            lessonedKeywordsRef.current.add(currentKeyword.id);
            setLessonModal({
              keywordId: servedKeywordId ?? currentKeyword.id,
              label: currentKeyword.label,
            });
          }
        }
      } catch { /* non-fatal */ }
    },
    [question, currentKeyword, phase, sessionId, isReviewCard, course, maybeTriggerReplan, inReview, pushHistory, servedKeywordId]
  );

  // ─── Handle don't know ─────────────────────────────────────────────────────

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
        if (typeof kwState?.score === "number") currentKwScoreRef.current = kwState.score;
        // Prefetch the next item during the reveal window (see handleChoice).
        if (!isReviewCard && !isMastered(currentKwScoreRef.current)) {
          prefetchNextRef.current?.(sessionId);
        }
        const needsLesson = kwState?.needs_lesson === true;
        if (
          (consecutiveWrongRef.current >= 2 || needsLesson) &&
          !lessonedKeywordsRef.current.has(currentKeyword.id)
        ) {
          // Any lesson recommendation → closeable POPUP (served keyword), 7+8.
          lessonedKeywordsRef.current.add(currentKeyword.id);
          setLessonModal({
            keywordId: servedKeywordId ?? currentKeyword.id,
            label: currentKeyword.label,
          });
        }
      }
    } catch { /* non-fatal */ }
  }, [question, currentKeyword, phase, sessionId, isReviewCard, maybeTriggerReplan, course, inReview, pushHistory, servedKeywordId]);

  // ─── Free movement: Back / Forward / Skip ───────────────────────────────────

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

  // Skip the live question: record NO attempt, no mastery/streak change; load next
  // from the SAME keyword (reuses the existing load path; never advances).
  const handleSkip = useCallback(() => {
    if (!question || !currentKeyword || phase !== "practicing" || inReview || !frontier?.id) return;
    pushHistory({ question, selectedChoice: null, revealed: false, wasCorrect: null });
    void loadQuestion(sessionId, currentKeyword.id, frontier.id);
  }, [question, currentKeyword, phase, inReview, frontier, pushHistory, loadQuestion, sessionId]);

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

  // Expose advanceToNextCategory through a ref so the topic-intro helpers
  // (defined earlier) can reach it without a forward reference.
  useEffect(() => {
    advanceToNextCategoryRef.current = advanceToNextCategory;
  }, [advanceToNextCategory]);

  // ─── Advance keyword in queue ──────────────────────────────────────────────

  const topicCountRef = useRef(topicQuestionCount);
  useEffect(() => { topicCountRef.current = topicQuestionCount; }, [topicQuestionCount]);

  const currentFrontierIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentFrontierIdRef.current = frontier?.id ?? null;
  }, [frontier]);

  // ─── Adaptive: DECIDE the next practice item ────────────────────────────────
  // Drives behaviors 2/4/5: mastery sets the flashcard:question ratio + difficulty,
  // struggling shifts to flashcards, and spaced review interleaves past keywords
  // (as questions OR flashcards). Pure + instant — returns a descriptor the buffer
  // serves (and that handleChoice prefetches during the answer-reveal window).
  // Mastery-gated ADVANCE stays in handleNext — this only describes the next item
  // when the current keyword is not yet mastered and the cap isn't hit.
  const decideNextDescriptor = useCallback(
    (sid: string): ServeDescriptor<MathReviewKeyword> | null => {
      const fid = currentFrontierIdRef.current;
      const cur = queueRef.current[queueIndexRef.current];
      if (!fid || !cur) return null;
      const recentlyBad = consecutiveWrongRef.current >= 2;
      const pool = reviewPoolRef.current;

      // (2) Spaced review — past keywords, as questions OR flashcards. Suppressed
      // while struggling so we keep focus on the current keyword.
      if (!recentlyBad && pool.length > 0 && Math.random() < REVIEW_PROBABILITY) {
        const rk = pickReviewKeyword(pool);
        if (rk) {
          const rcat = rk.category_id ?? fid;
          // v2: probabilistic flashcard draw based on keyword mastery (decayed if
          // last_review_at is available on the review keyword, else use raw score).
          const rkState: KeywordState = {
            score: rk.score ?? 0.5,
            floor: rk.floor,
            last_review_at: rk.last_review_at,
          };
          const rkDecayed = decayedScore(rkState, Date.now());
          // Suppress review item when decayed score is above the cohort goal
          // (it has not dipped below the mastery goal — not actually due yet).
          // isDue check: use mean decayed score of review pool as cohort proxy
          // and session-minutes as tStudied proxy.
          const cohortMean =
            pool.reduce((s, r) => {
              const st: KeywordState = { score: r.score ?? 0.5, floor: r.floor, last_review_at: r.last_review_at };
              return s + decayedScore(st, Date.now());
            }, 0) / pool.length;
          const tStudied = Math.max(0, (Date.now() - sessionStart) / 60_000);
          if (!isDue(rkState, Date.now(), cohortMean, tStudied)) {
            // Not due — fall through to current keyword
          } else {
            // v2: probabilistic flashcard draw driven by decayed mastery
            const kind = Math.random() < flashcardProbability(rkDecayed) ? "flashcard" : "question";
            return { sessionId: sid, keywordId: rk.id, categoryId: rcat, kind, forReview: true, reviewKeyword: rk };
          }
        }
      }

      // (4)(5) Current keyword — QUESTIONS ONLY. The subtopic's COMPLETE flashcard
      // deck is shown up front in the intro (flashcards-first), so no current-keyword
      // flashcards are interleaved into practice. Difficulty still tracks mastery and
      // struggle. (Spaced review of EARLIER, already-completed keywords above can
      // still surface a review flashcard.)
      const score = currentKwScoreRef.current;
      const tier = tierForMastery(score, recentlyBad);
      return { sessionId: sid, keywordId: cur.id, categoryId: fid, kind: "question", difficulty: tier };
    },
    [REVIEW_PROBABILITY]
  );

  // Serve the decided item now (the fallback path when nothing was prefetched).
  const serveNextItem = useCallback(
    (sid: string) => {
      const d = decideNextDescriptor(sid);
      if (!d) return;
      setPhase("generating");
      void bufferRef.current!.take(d).then(applyReady);
    },
    [decideNextDescriptor, applyReady]
  );

  // Expose decide+prefetch so handleChoice/handleDontKnow (defined earlier) can
  // warm the next item during the answer-reveal window without a forward reference.
  useEffect(() => {
    prefetchNextRef.current = (sid: string) => {
      const d = decideNextDescriptor(sid);
      if (d) bufferRef.current?.prefetch(d);
    };
  }, [decideNextDescriptor]);

  const advanceKeyword = useCallback(
    async (opts?: { wasMastered: boolean }) => {
      if (!currentKeyword) return;
      if (opts?.wasMastered) {
        setStats((s) => ({ ...s, topicsMastered: s.topicsMastered + 1 }));
        // Persist mastery server-side so the frontier advances across sessions.
        if (frontier?.id) markSkillMastered(sessionId, currentKeyword.id, frontier.id);
      }
      const nextIndex = queueIndex + 1;

      if (nextIndex >= queue.length) {
        // Topic's skills exhausted → re-plan. The plan advances the frontier to the
        // next topic (or next unit). We offer a checkpoint quiz only when a whole
        // UNIT just completed (the frontier category changed or the course finished).
        const prevCatId = currentFrontierIdRef.current;
        const prevCatLabel = frontier?.label ?? "";
        setPhase("loading");
        try {
          const newPlan = await fetchPlan(sessionId);
          planRef.current = newPlan;
          if (newPlan) setPlan(newPlan);

          const unitCompleted =
            !!prevCatId && (!newPlan || newPlan.frontier?.id !== prevCatId);

          if (unitCompleted) {
            // Checkpoint quiz over the just-finished unit, then advance.
            setCompletedCategoryLabel(prevCatLabel);
            pendingAdvanceCategoryRef.current = prevCatId!;
            setPhase("category_complete");
          } else if (!newPlan) {
            setPhase("course_complete");
          } else {
            // Same unit, next topic → LESSON → FLASHCARDS → QUIZ.
            await applyPlan(sessionId, newPlan);
          }
        } catch (e) {
          setErrorMsg((e as Error).message ?? "Failed to advance");
          setPhase("error");
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
            // Spiral review keywords can belong to EARLIER units — scope the
            // question to the review keyword's own category, not the frontier.
            loadQuestion(sessionId, reviewKw.id, reviewKw.category_id ?? frontier.id, reviewKw);
            return;
          }
        }
        // New subtopic → run its own LESSON → FLASHCARDS → practice intro.
        if (frontier?.id) beginSkillIntro(sessionId, nextKw, frontier.id);
      }, 1200);
    },
    [
      currentKeyword, queueIndex, queue, reviewPool, sessionId,
      loadQuestion, beginSkillIntro, fetchPlan, applyPlan, frontier,
      markSkillMastered,
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
        // Resuming onto a (possibly new) subtopic after an interleaved review card →
        // run its intro so a brand-new subtopic still gets its lesson + flashcards.
        if (nextKw && frontier?.id) { beginSkillIntro(sessionId, nextKw, frontier.id); }
        else { advanceToNextCategory(sessionId); }
        return;
      }
      if (frontier?.id) loadQuestion(sessionId, currentKeyword.id, frontier.id);
      return;
    }

    // THRESHOLD-based advancement: the keyword is mastered once its live 0–1
    // mastery score crosses MASTERY_ADVANCE (no consecutive-correct requirement).
    // The score is kept current from each /attempt response in currentKwScoreRef.
    const score = currentKwScoreRef.current;
    const count = topicCountRef.current;
    const masteredByScore = isMastered(score);
    const hitCap = count >= TOPIC_MAX_QUESTIONS;

    if (masteredByScore || hitCap) {
      // Advancing to a different keyword → any prefetched same-keyword item is stale.
      // Discard it (free — the buffer's fetch never touched the seen/exclude refs).
      bufferRef.current?.clear();
      if (hitCap && !masteredByScore) {
        setQueue((prev) => {
          const copy = [...prev];
          const [capped] = copy.splice(queueIndex, 1);
          if (capped) copy.push(capped);
          return copy;
        });
      }
      advanceKeyword({ wasMastered: masteredByScore });
      return;
    }

    // Not yet mastered, cap not hit → serve the next item. Use the item prefetched
    // during the answer-reveal window if one is ready (instant); otherwise fall back
    // to deciding + fetching now. The flashcard:question ratio + difficulty were
    // driven by mastery at decide time. topicQuestionCount is incremented when an
    // answer is recorded (handleChoice/handleDontKnow), not here.
    const pending = bufferRef.current?.consume();
    if (pending) {
      if (!pending.settled) setPhase("generating");
      void pending.promise.then(applyReady);
      return;
    }
    serveNextItem(sessionId);
  }, [
    currentKeyword, isReviewCard, pendingReviewBetweenTopics, queue, queueIndex,
    sessionId, loadQuestion, beginSkillIntro, advanceKeyword, frontier,
    advanceToNextCategory, serveNextItem, applyReady,
  ]);

  // ─── Lesson handlers ───────────────────────────────────────────────────────

  const handleLessonComplete = useCallback(() => {
    setStats((s) => ({ ...s, lessons: s.lessons + 1 }));
    consecutiveWrongRef.current = 0;
    setTopicCorrectStreak(0);
    // Subtopic-intro lesson → continue to FLASHCARDS for that subtopic. A mid-practice
    // struggle lesson (inTopicIntroRef false) just returns to the current question.
    if (inTopicIntroRef.current && currentKeyword && frontier?.id) {
      void startSkillFlashcards(sessionId, currentKeyword, frontier.id);
      return;
    }
    if (currentKeyword && frontier?.id) {
      lessonedKeywordsRef.current.add(currentKeyword.id);
      loadQuestion(sessionId, currentKeyword.id, frontier.id);
    }
  }, [currentKeyword, sessionId, frontier, loadQuestion, startSkillFlashcards]);

  const handleLessonSkip = useCallback(() => {
    consecutiveWrongRef.current = 0;
    setTopicCorrectStreak(0);
    // Skipping the subtopic-intro lesson → still show its FLASHCARDS, then practice.
    if (inTopicIntroRef.current && currentKeyword && frontier?.id) {
      void startSkillFlashcards(sessionId, currentKeyword, frontier.id);
      return;
    }
    if (currentKeyword && frontier?.id) {
      lessonedKeywordsRef.current.add(currentKeyword.id);
      loadQuestion(sessionId, currentKeyword.id, frontier.id);
    }
  }, [currentKeyword, sessionId, frontier, loadQuestion, startSkillFlashcards]);

  // ─── Flashcard warm-up handlers ───────────────────────────────────────────

  const gradeFlashcard = useCallback(
    async (result: "got_it" | "missed_it" | "dont_know") => {
      const card = flashcards[fcIndex];
      if (!card || !currentKeyword || !frontier?.id) return;

      // Record attempt — fire and forget (non-fatal)
      fetch("/api/math/flashcard-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          flashcard_id: card.id,
          result,
          course: course as MathCourse,
        }),
      }).catch(() => {});

      // Gamification
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

      // INTRO DECK — reuse the Leitner SRS so missed/"don't know" cards recirculate
      // (spaced a few cards later, expanding as they climb boxes) until memorized.
      // The deck ends only when every card reaches the memorized box — never with
      // misses left. (Practice-mode review card stays single-and-done below.)
      if (flashcardModeRef.current === "intro") {
        const t = nextSrsState(fcBoxRef.current.get(card.id) ?? null, result);
        fcBoxRef.current.set(card.id, { box: t.box, reps: t.reps, lapses: t.lapses, learned: t.learned });
        const rest = flashcards.filter((c) => c.id !== card.id);
        if (t.box >= MEMORIZED_BOX) {
          if (rest.length === 0) {
            // Every card memorized → intro complete; start the practice questions.
            markIntroSeen(sessionId, currentKeyword.id, frontier.id);
            inTopicIntroRef.current = false;
            startKeyword(sessionId, currentKeyword, frontier.id);
            return;
          }
          setFlashcards(rest); // graduated → drop from the deck
        } else {
          // Re-queue a few cards later (gap grows with the box → expanding interval).
          rest.splice(Math.min(rest.length, t.box <= 1 ? 2 : 5), 0, card);
          setFlashcards(rest);
        }
        setFcIndex(0);
        return;
      }

      // An interleaved adaptive (practice-mode) flashcard finished → resume the loop.
      serveNextItem(sessionId);
    },
    [flashcards, fcIndex, currentKeyword, frontier, sessionId, course, startKeyword, markIntroSeen, serveNextItem]
  );

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
      quizKwResultsRef.current = new Map();
      setQuizQuestions(qs);
      setQuizIndex(0);
      setQuizSelectedChoice(null);
      setQuizCorrect(0);
      setFailedQuizKeywords([]);
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

      // Track per-keyword result for the remedial offer. We attribute the question
      // to its dominant keyword and record the first (worst) result per keyword so
      // a high-yield keyword that gets two questions shows as failed if either fails.
      const kwWeights = currentQuizQuestion.keyword_weights ?? {};
      let domKwId: string | null = null;
      let domW = -Infinity;
      for (const [id, w] of Object.entries(kwWeights)) {
        if (w > domW) { domW = w; domKwId = id; }
      }
      if (domKwId) {
        const existing = quizKwResultsRef.current.get(domKwId);
        // Find label: prefer queue, fall back to keyword id
        const kwLabel = queueRef.current.find((k) => k.id === domKwId)?.label ?? domKwId;
        // If already recorded a wrong answer for this kw, keep it wrong
        if (!existing || (!existing.correct && correct) || (existing.correct && !correct)) {
          quizKwResultsRef.current.set(domKwId, { label: kwLabel, correct });
        }
      }

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
      // Quiz done → compute failed keywords and show results screen.
      const failed: Array<{ id: string; label: string }> = [];
      for (const [id, res] of quizKwResultsRef.current.entries()) {
        if (!res.correct) failed.push({ id, label: res.label });
      }
      if (failed.length > 0) {
        setFailedQuizKeywords(failed);
        setPhase("quiz_results");
      } else {
        // All passed — advance immediately.
        await advanceToNextCategory(sessionId);
      }
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

  // Mastery meter now reflects the 0–1 mastery SCORE's progress toward the
  // advancement threshold (MASTERY_ADVANCE) — not a correct-in-a-row streak.
  const MASTERY_DOT_COUNT = 5;
  const masteryProgress = Math.min(1, currentKwScoreRef.current / MASTERY_ADVANCE);
  const masteryPct = Math.round(masteryProgress * 100);
  const masteryDots = Array.from({ length: MASTERY_DOT_COUNT }, (_, i) =>
    i < Math.round(masteryProgress * MASTERY_DOT_COUNT) ? "●" : "○"
  ).join("");

  const isInQuizPhase = phase === "mini_quiz" || phase === "mini_quiz_revealed" || phase === "mini_quiz_loading" || phase === "quiz_results";
  const isInPracticePhase = phase === "practicing" || phase === "revealed";
  const isInFlashcardPhase = phase === "flashcard";
  const currentFc = isInFlashcardPhase ? (flashcards[fcIndex] ?? null) : null;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 py-2.5 flex items-center gap-2 flex-wrap">
          {/* Left: back + unit indicator + title */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link
              href={`/math/${course}`}
              className="text-sm font-bold text-neutral-700 hover:text-brand-600 shrink-0 whitespace-nowrap"
            >
              ← {courseLabel}
            </Link>
            {frontier && phase !== "loading" && phase !== "needs_diagnostic" && phase !== "course_complete" && (
              <span className="text-xs text-neutral-700 font-medium truncate min-w-0">
                {topic?.label ?? frontier.label}
              </span>
            )}
          </div>
          {/* Right: widgets. ("Learn this" removed — redundant with the
              QuestionToolbar's "Take a lesson"; category-row Learn-this stays.)
              The grind flame is a small, subtle corner indicator — it records
              continuously and shows the streak/multiplier WITHOUT the big bar. */}
          <div className="flex items-center gap-2 shrink-0">
            {plan && phase !== "loading" && phase !== "needs_diagnostic" && (
              <GrindMeter mode="quiz" streak={combo} answered={stats.answered} startedAt={sessionStart} compact />
            )}
            <StreakBadge />
            <NavMenu />
          </div>
        </div>

        {/* Mastery meter (practice only) */}
        {currentKeyword && !isReviewCard && isInPracticePhase && (
          <div className="w-full px-6 pb-1.5">
            <p className="text-xs text-neutral-400">
              Mastering:{" "}
              <span className="font-mono tracking-wider text-brand-500">
                {masteryDots}
              </span>{" "}
              <span className="text-neutral-400">
                ({masteryPct}%)
              </span>
            </p>
          </div>
        )}

        {/* Mini-quiz position (counter only — the GrindMeter is the single bar). */}
        {isInQuizPhase && quizQuestions.length > 0 && (
          <div className="w-full px-6 pb-2">
            <span className="text-xs text-neutral-400">
              Quiz {quizIndex + 1}/{quizQuestions.length}
              {quizQuestions.length > 0 && quizIndex > 0 && ` · ${quizScorePct}%`}
            </span>
          </div>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4 pb-safe-bottom">

        {/* Loading */}
        {(phase === "loading" || phase === "mini_quiz_loading") && (
          <GeneratingLoader
            messages={
              phase === "mini_quiz_loading"
                ? ["Loading your checkpoint quiz…", "Pulling together what you've learned…"]
                : ["Finding your next challenge…", "Tailoring it to where you are…"]
            }
          />
        )}

        {/* Generating */}
        {phase === "generating" && <GeneratingLoader />}

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
                    // Persist the skip server-side so the gate never re-appears.
                    await fetch("/api/math/diagnostic/skip", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        session_id: sessionId,
                        course: course as MathCourse,
                      }),
                    });
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

        {/* ─── Flashcard step (same universal flip-card as standalone) ─────── */}
        {isInFlashcardPhase && currentFc && (
          <>
            <FlipCard
              front={currentFc.front_latex}
              back={currentFc.back_latex}
              onGrade={gradeFlashcard}
              resetKey={`${currentFc.id}#${fcBoxRef.current.get(currentFc.id)?.reps ?? 0}`}
            />

            {/* Lesson / refresher access for the current card's topic */}
            <QuestionToolbar
              system="math"
              course={course}
              keywordId={servedKeywordId ?? primaryKeywordId(currentFc.keyword_weights) ?? currentKeyword?.id ?? null}
              sessionId={sessionId || null}
              questionId={currentFc.id}
              contentType="flashcard"
              resetSignal={currentFc.id}
              onStateChange={() => bufferRef.current?.clear()}
            />
          </>
        )}

        {/* Lesson (inline) — topic lesson during intro, or struggle lesson mid-practice */}
        {phase === "lesson" && lessonTarget && sessionId && (
          <>
            {inTopicIntroRef.current && (
              <div className="text-center">
                <p className="text-xs text-brand-600 font-medium bg-brand-50 border border-brand-100 rounded-full inline-block px-3 py-1">
                  Step 1 of 3 · Lesson
                </p>
              </div>
            )}
            <MathLessonView
              sessionId={sessionId}
              keywordId={lessonTarget.id}
              keywordLabel={lessonTarget.label}
              onComplete={handleLessonComplete}
              onSkip={handleLessonSkip}
              hasPreviousLesson={
                inTopicIntroRef.current &&
                lessonTarget.id === currentKeyword?.id &&
                queueIndex > 0
              }
              onPreviousLesson={() => {
                if (!frontier?.id || queueIndex <= 0) return;
                const prevKw = queue[queueIndex - 1];
                if (!prevKw) return;
                setQueueIndex(queueIndex - 1);
                introSeenRef.current.delete(prevKw.id);
                beginSkillIntro(sessionId, prevKw, frontier.id);
              }}
            />
          </>
        )}

        {/* ─── Practice / Revealed / Review ────────────────────────────────── */}
        {isInPracticePhase && (inReview ? reviewEntry : question) && (() => {
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

            {/* Action bar — quick refresher / see lesson (POPUP) / prioritize.
                Keyed to the SERVED question's keyword so see-lesson corresponds (3,7). */}
            {!inReview && (
              <QuestionToolbar
                system="math"
                course={course}
                keywordId={servedKeywordId ?? currentKeyword?.id ?? null}
                sessionId={sessionId || null}
                questionId={dispQuestion.id}
                contentType="question"
                resetSignal={dispQuestion.id}
                answerSignal={phase === "revealed" ? dispQuestion.id : undefined}
                onStateChange={() => bufferRef.current?.clear()}
              />
            )}

            {/* Hint */}
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

            {/* Affirmation — the satisfying "Correct!" moment (live only) */}
            {!inReview && phase === "revealed" && (
              <AnswerAffirmation correct={lastAnswerCorrect} streak={combo} />
            )}

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

            {/* Lesson recommendations now surface as a closeable POPUP (LessonModal,
                rendered near the page root), not an inline bottom offer. */}

            {/* Feedback + Continue — live only (review is navigated via Back/Forward) */}
            {!inReview && phase === "revealed" && (
              <>
                <MathFeedbackWidget
                  sessionId={sessionId}
                  contentType="question"
                  contentId={question!.id}
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
          );
        })()}

        {/* ─── Mini-quiz ──────────────────────────────────────────────────── */}
        {(phase === "mini_quiz" || phase === "mini_quiz_revealed") && currentQuizQuestion && (
          <>
            {/* Checkpoint badge */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                Checkpoint
              </span>
            </div>

            {/* Stem */}
            <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-brand-xs">
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{currentQuizQuestion.stem_latex}</MathText>
              </p>
            </div>

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

            {/* Affirmation */}
            {phase === "mini_quiz_revealed" && (
              <AnswerAffirmation correct={lastAnswerCorrect} streak={combo} />
            )}

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

        {/* ─── Checkpoint quiz results (remedial offer) ─────────────────── */}
        {phase === "quiz_results" && (
          <div className="bg-white rounded-xl border border-neutral-200 p-8 shadow-brand-xs space-y-5">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto text-2xl">
                📋
              </div>
              <h1 className="text-lg font-semibold text-neutral-900">
                Checkpoint results — {quizScorePct}% correct
              </h1>
              <p className="text-sm text-neutral-500">
                {failedQuizKeywords.length > 0
                  ? "You missed some topics. Practice them now or continue."
                  : "Great work! All topics passed."}
              </p>
            </div>
            {failedQuizKeywords.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                  Topics to review
                </p>
                {failedQuizKeywords.map((kw) => (
                  <button
                    key={kw.id}
                    onClick={() => {
                      const catId = pendingAdvanceCategoryRef.current;
                      if (!catId) return;
                      // Point queueIndex to this keyword (if in queue) so currentKeyword resolves correctly.
                      const kwIdx = queueRef.current.findIndex((q) => q.id === kw.id);
                      if (kwIdx >= 0) {
                        setQueueIndex(kwIdx);
                        queueIndexRef.current = kwIdx;
                      }
                      const fromQueue = queueRef.current[kwIdx >= 0 ? kwIdx : 0];
                      currentKwScoreRef.current = fromQueue?.score ?? MASTERY_START;
                      bufferRef.current?.clear();
                      loadQuestion(sessionId, kw.id, catId);
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-neutral-800 hover:bg-amber-100 transition-colors text-left"
                  >
                    <span className="font-medium">{kw.label}</span>
                    <span className="text-amber-700 text-xs font-semibold">Practice →</span>
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => advanceToNextCategory(sessionId)}
              className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
            >
              Continue to next unit
            </button>
          </div>
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

      {/* See-lesson POPUP — opened from the toolbar (handled there), the "Learn
          this" header button, the after-problem offer, and auto-surfaced on
          repeated misses (8). Same in-page treatment as the refresher. */}
      {lessonModal && (
        <LessonModal
          system="math"
          course={course}
          keywordId={lessonModal.keywordId}
          label={lessonModal.label}
          sessionId={sessionId || null}
          onClose={() => setLessonModal(null)}
        />
      )}

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
