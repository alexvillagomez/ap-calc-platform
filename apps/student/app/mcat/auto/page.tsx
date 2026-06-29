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
import { useRouter, useSearchParams } from "next/navigation";
import { LoginGate } from "@/components/auth/LoginGate";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import { LessonView } from "@/components/mcat/LessonView";
import MathText from "@/components/mcat/MathText";
import FeedbackWidget from "@/components/mcat/FeedbackWidget";
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
import { getOrCreateMcatSession } from "@/lib/mcatSession";
import {
  reviewProbabilityFor,
  FULL_INTRO_DECK_COUNT,
} from "@/lib/courseEngine/config";
import {
  type DifficultyTier,
  tierForMastery,
  isMastered,
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
// MCAT is flashcard-dominant until proficient, then shifts toward quiz.

const COURSE_ID = "mcat_bio";
const TOPIC_MAX_QUESTIONS = 8;
// Advancement is THRESHOLD-based on the 0–1 mastery score (MASTERY_ADVANCE) — no
// "N correct in a row" gate. See lib/courseEngine/adaptive.ts.
const REVIEW_PROBABILITY = reviewProbabilityFor(COURSE_ID);
const AUTO_REPLAN_INTERVAL = 8;
const MINI_QUIZ_COUNT = 4;

// ── Per-keyword intro persistence ───────────────────────────────────────────
// Each frontier skill's guided sequence is LESSON → FLASHCARDS → PRACTICE. The
// lesson + flashcards "intro" is shown ONCE per keyword; we remember which
// keywords have had their intro so a reload (or returning later) drops straight
// into practice instead of re-showing the lesson.
//
// This "intro seen" set is SERVER-AUTHORITATIVE and keyed PER USER (session):
// it comes from /api/mcat/auto-plan (`intro_seen`) and is persisted via
// /api/mcat/auto-intro into mcat_student_keyword_states.intro_seen. It used to
// live in localStorage (`lodera_auto_intro_mcat`), which made a brand-new
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
  | "error";

interface AutoPlanFrontier {
  id: string;
  label: string;
  order_index: number;
}

interface AutoPlanTopic {
  id: string;          // umbrella keyword id (the current topic)
  label: string;
  category_id: string;
  topic_number: number;
  topic_total: number;
  in_depth_ids: string[];
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
  needs_diagnostic: boolean;
  frontier: AutoPlanFrontier | null;
  frontier_topic: AutoPlanTopic | null;
  next_focus: string[];
  review_focus: string[];
  progress: AutoPlanCategoryProgress[];
  overall_pct: number;
  intro_seen?: string[];
  intro_ids?: string[];
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
  /** v2: ISO timestamp of last review — used for time-decay in decideNextDescriptor. */
  last_review_at?: string | null;
  /** v2: Rising floor value — used for decayedScore clamping. */
  floor?: number;
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

/** A snapshot of a previously-seen question for read-only review navigation. */
interface HistoryEntry {
  question: Question;
  selectedChoice: number | null;
  revealed: boolean;
  wasCorrect: boolean | null;
}

// ── Unified timeline (Phase E: unified back/forward) ────────────────────────
// Every step shown to the student is appended here in order. Back/Forward walk
// this ref; the live item is NEVER in the timeline.
//
// - kind "question" : answered or skipped question (same as old HistoryEntry).
// - kind "flashcard": a single flashcard that was SHOWN (face the student saw).
// - kind "lesson"   : a lesson that was displayed for a keyword.
//
// Nothing re-scores on review — all answer/grade side-effects are guarded by
// `!inReview` in the handlers below.
type TimelineEntry =
  | { kind: "question"; question: Question; selectedChoice: number | null; revealed: boolean; wasCorrect: boolean | null }
  | { kind: "flashcard"; card: Flashcard; keywordId: string; keywordLabel: string }
  | { kind: "lesson"; keywordId: string; keywordLabel: string };

const HISTORY_CAP = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const router = useRouter();
  // "Learn this" scope — when present, restricts this auto run to a single object
  // (category / umbrella / keyword). Threaded into every auto-plan fetch.
  const searchParams = useSearchParams();
  const scopeParam = searchParams.get("scope");
  const scopeIdParam = searchParams.get("scope_id");
  const sectionParam = searchParams.get("section");
  // Session
  const [sessionId, setSessionId] = useState("");
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Auto plan
  const [plan, setPlan] = useState<AutoPlanResponse | null>(null);
  const [frontier, setFrontier] = useState<AutoPlanFrontier | null>(null);
  const [topic, setTopic] = useState<AutoPlanTopic | null>(null);
  const planRef = useRef<AutoPlanResponse | null>(null);

  // Practice queue state
  const [queue, setQueue] = useState<QueueKeyword[]>([]);
  const queueRef = useRef<QueueKeyword[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const [reviewPool, setReviewPool] = useState<ReviewKeyword[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const currentKeyword = queue[queueIndex] ?? null;

  const lessonedKeywordsRef = useRef<Set<string>>(new Set());
  // Setter retained for gamification reset points; value no longer gates mastery.
  const [, setTopicCorrectStreak] = useState(0);
  const [topicQuestionCount, setTopicQuestionCount] = useState(0);
  const excludeIdsRef = useRef<string[]>([]);

  const [question, setQuestion] = useState<Question | null>(null);
  // Unified ordered timeline of every step shown to the student in this session.
  // null reviewIndex = viewing the LIVE item. See TimelineEntry for shape.
  const historyRef = useRef<TimelineEntry[]>([]);
  // null = viewing the LIVE item; otherwise an index into historyRef.
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const inReview = reviewIndex !== null;
  // The timeline entry currently being reviewed (null when live).
  const reviewEntry = inReview ? historyRef.current[reviewIndex] ?? null : null;

  const [isReviewCard, setIsReviewCard] = useState(false);
  const [pendingReviewBetweenTopics, setPendingReviewBetweenTopics] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const consecutiveWrongRef = useRef(0);

  // ── Adaptive-engine refs (mastery → flashcard:question ratio + difficulty) ───
  const currentKwScoreRef = useRef(MASTERY_START);
  const flashcardModeRef = useRef<"intro" | "practice">("intro");
  const fcInRowRef = useRef(0);
  const reviewPoolRef = useRef<ReviewKeyword[]>([]);
  const queueIndexRef = useRef(0);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
  useEffect(() => { reviewPoolRef.current = reviewPool; }, [reviewPool]);

  // See-lesson POPUP (in-page) + the keyword the live item was SERVED under, so
  // every see-lesson / refresher / auto-surface corresponds to the question/card
  // (behavior 7) instead of the embedding-pinpointed primary_keyword_id.
  const [lessonModal, setLessonModal] = useState<{ keywordId: string; label?: string } | null>(null);
  const [servedKeywordId, setServedKeywordId] = useState<string | null>(null);

  // Per-topic flashcard step (LESSON → FLASHCARDS → QUESTIONS)
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [fcIndex, setFcIndex] = useState(0);
  // Per-card Leitner box for the current intro deck (reuses lib/flashcardSrs). A
  // missed card recirculates (spaced) until it reaches the memorized box.
  const fcBoxRef = useRef<Map<string, SrsState>>(new Map());

  // Topic intro (LESSON → FLASHCARDS → PRACTICE) — true while we're in the
  // proactive intro for a frontier skill (vs. a mid-practice struggle lesson,
  // which returns to the same question instead of advancing the sequence).
  const inTopicIntroRef = useRef(false);

  // Stats + gamification
  const [stats, setStats] = useState({ answered: 0, correct: 0, lessons: 0, topicsMastered: 0 });
  const [transitionLabel, setTransitionLabel] = useState("");
  const [combo, setCombo] = useState(0);
  // When this study session started — drives the grind meter's time-on-app heat.
  const [sessionStart] = useState(() => Date.now());
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
  // Per-question result tracking for the remedial offer on quiz completion.
  const quizKwResultsRef = useRef<Map<string, { label: string; correct: boolean }>>(new Map());
  // Keywords that were failed in the checkpoint quiz (shown on quiz_results screen).
  const [failedQuizKeywords, setFailedQuizKeywords] = useState<Array<{ id: string; label: string }>>([]);

  // Refs for handlers that need latest state
  const topicCountRef = useRef(topicQuestionCount);
  const currentFrontierIdRef = useRef<string | null>(null);
  useEffect(() => { topicCountRef.current = topicQuestionCount; }, [topicQuestionCount]);
  useEffect(() => { currentFrontierIdRef.current = frontier?.id ?? null; }, [frontier]);

  // Diversity tracking: last N primary keyword ids + seen stems for near-dup filter
  const recentKeywordIdsRef = useRef<string[]>([]);
  const recentQuestionIdsRef = useRef<string[]>([]);
  const seenStemsRef = useRef<string[]>([]);

  // ─── Practice buffer: serve the next item from memory / prefetch (instant Next).
  // See lib/courseEngine/practiceBuffer.ts. The server hands back a `buffer` of ready
  // extras with each fetch (one round-trip covers several questions); a prefetch
  // during the answer-reveal window makes Continue instant. take/prefetch are
  // side-effect-free w.r.t. the page (refs mutate only in applyQuestion/applyFlashcards).
  const bufferRef = useRef<PracticeBuffer<Question, Flashcard, ReviewKeyword> | null>(null);
  if (!bufferRef.current) {
    bufferRef.current = createPracticeBuffer<Question, Flashcard, ReviewKeyword>({
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
          };
          if (d.difficulty) body.difficulty = d.difficulty;
          const res = await fetch("/api/mcat/next-question", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const msg =
              res.status === 502
                ? "Question generation is temporarily unavailable. Please try again."
                : await res.text().catch(() => "Unknown error");
            return { error: msg, status: res.status };
          }
          const data = (await res.json()) as { question: Question; buffer?: Question[] };
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
          const res = await fetch("/api/mcat/flashcards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: d.sessionId,
              category_id: d.categoryId,
              count: 1,
              keyword_ids: [d.keywordId],
            }),
          });
          if (!res.ok) return { flashcards: [] };
          const data = (await res.json()) as { flashcards: Flashcard[] };
          return { flashcards: (data.flashcards ?? []).slice(0, 1) };
        } catch {
          return { flashcards: [] };
        }
      },
    });
  }
  // Indirection so handleChoice/handleDontKnow (defined earlier) can kick off a
  // prefetch without a forward reference.
  const prefetchNextRef = useRef<((sid: string) => void) | null>(null);

  // Server-authoritative "intro seen" set (populated from auto-plan.intro_seen).
  const introSeenRef = useRef<Set<string>>(new Set());

  // Set of framing-only INTRO keyword ids (order_index === -1), from auto-plan.
  // An intro shows LESSON → FLASHCARDS then advances — it is NEVER practiced.
  const introIdsRef = useRef<Set<string>>(new Set());
  const isIntroKw = useCallback((id: string) => introIdsRef.current.has(id), []);
  // Latest advanceKeyword, so callbacks defined BEFORE it (startSkillFlashcards)
  // can advance past a framing-only intro without a TDZ forward-reference.
  const advanceKeywordRef = useRef<((opts?: { wasMastered: boolean }) => Promise<void>) | null>(null);

  // Mark a skill's LESSON→FLASHCARDS intro complete: update the local cache AND
  // persist per-user to Supabase (mcat_student_keyword_states.intro_seen).
  const markIntroSeen = useCallback(
    (sid: string, keywordId: string, categoryId: string) => {
      introSeenRef.current.add(keywordId);
      void fetch("/api/mcat/auto-intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          keyword_id: keywordId,
          category_id: categoryId,
        }),
      }).catch(() => {});
    },
    []
  );

  // Authoritatively persist that a subtopic was MASTERED so the server frontier
  // advances and reopening auto mode resumes past it (mirror of math master-skill).
  const markSkillMastered = useCallback(
    (sid: string, keywordId: string, categoryId: string) => {
      introSeenRef.current.add(keywordId);
      void fetch("/api/mcat/master-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          keyword_id: keywordId,
          category_id: categoryId,
        }),
      }).catch(() => {});
    },
    []
  );

  useStreakTouchOnce();

  // ─── Fetch auto-plan ─────────────────────────────────────────────────────

  const fetchPlan = useCallback(async (sid: string): Promise<AutoPlanResponse | null> => {
    let url = `/api/mcat/auto-plan?session_id=${encodeURIComponent(sid)}`;
    if (scopeParam && scopeIdParam) {
      url += `&scope=${encodeURIComponent(scopeParam)}&scope_id=${encodeURIComponent(scopeIdParam)}`;
    }
    if (sectionParam) {
      url += `&section=${encodeURIComponent(sectionParam)}`;
    }
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load plan"));
    return (await res.json()) as AutoPlanResponse;
  }, [scopeParam, scopeIdParam, sectionParam]);

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
        checkpoint: true,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { questions: Question[] };
    return data.questions ?? [];
  }, []);

  // ─── Fetch warmup flashcards ─────────────────────────────────────────────

  const fetchFlashcards = useCallback(async (sid: string, categoryId: string, keywordIds: string[], count: number): Promise<Flashcard[]> => {
    try {
      const res = await fetch("/api/mcat/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          category_id: categoryId,
          count,
          keyword_ids: keywordIds,
        }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { flashcards: Flashcard[] };
      return (data.flashcards ?? []).slice(0, count);
    } catch {
      return [];
    }
  }, []);

  // ─── Apply a fetched item to the UI ─────────────────────────────────────────
  // The APPLY half (the only place the seen/exclude/recent refs are mutated). The
  // FETCH half lives in the practice buffer and is side-effect-free, so an unused
  // prefetch never pollutes these refs.

  const applyQuestion = useCallback(
    (q: Question, d: ServeDescriptor<ReviewKeyword>) => {
      fcInRowRef.current = 0;
      setServedKeywordId(d.reviewKeyword?.id ?? d.keywordId);
      setQuestion(q);
      excludeIdsRef.current = [...excludeIdsRef.current, q.id];
      recentQuestionIdsRef.current = [...recentQuestionIdsRef.current, q.id].slice(-10);
      if (q.primary_keyword_id) {
        recentKeywordIdsRef.current = [...recentKeywordIdsRef.current, q.primary_keyword_id].slice(-10);
      }
      if (q.stem) {
        const norm = q.stem.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
        seenStemsRef.current = [...seenStemsRef.current, norm].slice(-50);
      }
      setReviewIndex(null);
      setSelectedChoice(null);
      setLastAnswerCorrect(false);
      setIsReviewCard(!!d.forReview);
      setPhase("practicing");
    },
    []
  );

  const applyFlashcards = useCallback(
    (cards: Flashcard[], d: ServeDescriptor<ReviewKeyword>) => {
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
    (ready: ReadyItem<Question, Flashcard, ReviewKeyword>) => {
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

  // ─── Load question ────────────────────────────────────────────────────────
  // Serve a question for the given keyword via the buffer (instant if buffered).

  const loadQuestion = useCallback(
    async (
      sid: string,
      keywordId: string,
      categoryId: string,
      forReview?: ReviewKeyword,
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

  // ─── Start keyword ────────────────────────────────────────────────────────

  const startKeyword = useCallback(
    async (sid: string, kw: QueueKeyword, categoryId: string) => {
      // New keyword context → drop any prefetch/buffer from the previous keyword.
      bufferRef.current?.clear();
      setTopicCorrectStreak(0);
      setTopicQuestionCount(0);
      consecutiveWrongRef.current = 0;
      fcInRowRef.current = 0;
      currentKwScoreRef.current = kw.score ?? MASTERY_START;
      await loadQuestion(sid, kw.id, categoryId, undefined, tierForMastery(kw.score ?? 0.5, false));
    },
    [loadQuestion]
  );

  // ─── Per-skill intro: LESSON → FLASHCARDS → PRACTICE for ONE frontier skill ──
  // Each frontier skill (next_focus keyword) gets its own lesson + flashcard
  // warm-up (shown once, remembered per keyword id) before its practice
  // questions. If the intro is already done for this skill, jump straight to
  // its practice question.
  const beginSkillIntro = useCallback(
    (sid: string, kw: QueueKeyword, categoryId: string) => {
      // New skill context → drop any prefetch/buffer from the previous keyword.
      bufferRef.current?.clear();
      setTopicCorrectStreak(0);
      setTopicQuestionCount(0);
      consecutiveWrongRef.current = 0;
      fcInRowRef.current = 0;
      currentKwScoreRef.current = kw.score ?? MASTERY_START;
      // A previously-seen NORMAL subtopic jumps straight to practice. Intros are
      // never practiced — always run their (short) framing lesson + flashcards,
      // which ends by persisting mastery and advancing (self-heals a missed master).
      if (introSeenRef.current.has(kw.id) && !isIntroKw(kw.id)) {
        inTopicIntroRef.current = false;
        void loadQuestion(sid, kw.id, categoryId, undefined, tierForMastery(kw.score ?? 0.5, false));
        return;
      }
      // Step 1: LESSON on the skill. LessonView self-fetches /api/mcat/lesson.
      inTopicIntroRef.current = true;
      setPhase("lesson");
    },
    [loadQuestion, isIntroKw]
  );

  // ─── Skill flashcard warm-up (step 2 of LESSON → FLASHCARDS → PRACTICE) ──────
  const startSkillFlashcards = useCallback(
    async (sid: string, kw: QueueKeyword, categoryId: string) => {
      // (D) INTRO KEYWORDS: framing-only (order_index === -1). After their lesson,
      // go straight to auto-master + advance — do NOT fetch or show flashcards.
      if (isIntroKw(kw.id)) {
        markIntroSeen(sid, kw.id, categoryId);
        inTopicIntroRef.current = false;
        markSkillMastered(sid, kw.id, categoryId);
        void advanceKeywordRef.current?.({ wasMastered: false });
        return;
      }

      // FLASHCARDS-FIRST: the student must see and try to memorize this subtopic's
      // COMPLETE flashcard deck BEFORE any practice question. Request the full deck
      // (route caps a complete per-keyword deck at FULL_INTRO_DECK_COUNT), scoped to
      // this one subtopic, so every card is shown up front. (Scoping to the single
      // subtopic — not the whole topic — keeps each subtopic's intro to its OWN deck
      // and avoids re-showing the same cards across the topic's subtopics.)
      const scopeIds = [kw.id];
      // The flashcards STEP must never be skipped between lesson and quiz. A cold
      // per-keyword deck may need a moment to generate, so if the first fetch is
      // empty, retry once before falling through to practice.
      let cards = await fetchFlashcards(sid, categoryId, scopeIds, FULL_INTRO_DECK_COUNT);
      if (cards.length === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        cards = await fetchFlashcards(sid, categoryId, scopeIds, FULL_INTRO_DECK_COUNT);
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
      // No flashcards for this warm-up (generation unavailable) → start practice.
      markIntroSeen(sid, kw.id, categoryId);
      inTopicIntroRef.current = false;
      void loadQuestion(sid, kw.id, categoryId);
    },
    [fetchFlashcards, loadQuestion, markIntroSeen, isIntroKw, markSkillMastered]
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

      if (newPlan.needs_diagnostic) {
        setPhase("needs_diagnostic");
        return;
      }

      if (!newPlan.frontier || !newPlan.frontier_topic) {
        setPhase("course_complete");
        return;
      }

      setFrontier(newPlan.frontier);
      const topicPlan = newPlan.frontier_topic;
      setTopic(topicPlan);
      // The current topic's category drives question scope / lesson fetches.
      const frontierCatId = topicPlan.category_id || newPlan.frontier.id;

      // Seed the server-authoritative intro-seen set for this user.
      introSeenRef.current = new Set(newPlan.intro_seen ?? []);
      // Seed the framing-only intro keyword ids (never practiced).
      introIdsRef.current = new Set(newPlan.intro_ids ?? []);

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

        // PRESERVE next_focus order (in-order guided path), NOT the weakness-ranked
        // queue order. next_focus is already the unmastered in_depth skills of the
        // current topic in CED order.
        const focusOrder = new Map(newPlan.next_focus.map((id, i) => [id, i]));
        const orderedQueue = [...scopedQueue].sort(
          (a, b) =>
            (focusOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (focusOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)
        );

        // Spiral review = earlier topics' skills only. Exclude the current topic's
        // own skills (review_focus from the plan, when present, scopes the pool).
        const topicSkillSet = new Set(topicPlan.in_depth_ids);
        const reviewFocusSet = new Set(newPlan.review_focus ?? []);
        let reviewPoolFiltered = (data.review_pool ?? []).filter(
          (r) => !topicSkillSet.has(r.id)
        );
        if (reviewFocusSet.size > 0) {
          const scoped = reviewPoolFiltered.filter((r) => reviewFocusSet.has(r.id));
          if (scoped.length > 0) reviewPoolFiltered = scoped;
        }

        setQueue(orderedQueue);
        setReviewPool(reviewPoolFiltered);
        setQueueIndex(0);
        setTopicCorrectStreak(0);
        setTopicQuestionCount(0);
        excludeIdsRef.current = [];
        setIsReviewCard(false);
        setPendingReviewBetweenTopics(false);

        // Begin the first subtopic (next_focus[0]) LESSON → FLASHCARDS → PRACTICE intro.
        beginSkillIntro(sid, orderedQueue[0]!, frontierCatId);
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load practice queue");
        setPhase("error");
      }
    },
    [advanceToNextCategory, beginSkillIntro]
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

  // Append any timeline step (question / flashcard / lesson). Capped at HISTORY_CAP.
  const pushHistory = useCallback((entry: TimelineEntry) => {
    historyRef.current = [...historyRef.current, entry].slice(-HISTORY_CAP);
  }, []);

  const handleChoice = useCallback(
    async (idx: number) => {
      if (!question || !currentKeyword || phase !== "practicing" || inReview) return;

      setSelectedChoice(idx);
      setPhase("revealed");

      const correct = idx === question.correct_index;
      pushHistory({ kind: "question", question, selectedChoice: idx, revealed: true, wasCorrect: correct });
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
          if (typeof kwState?.score === "number") currentKwScoreRef.current = kwState.score;
          // Prefetch the next item NOW — during the answer-reveal read window — so
          // Continue is instant. Skip when this answer will ADVANCE the keyword
          // (mastered): that path has its own transition and a different keyword.
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
            // ANY lesson recommendation — single needs_lesson signal OR repeated
            // misses (8) — surfaces as a closeable POPUP (not an inline offer),
            // keyed to the SERVED keyword so it matches the question (7).
            lessonedKeywordsRef.current.add(currentKeyword.id);
            setLessonModal({ keywordId: servedKeywordId ?? currentKeyword.id, label: currentKeyword.label });
          }
        }
      } catch { /* non-fatal */ }
    },
    [question, currentKeyword, phase, sessionId, isReviewCard, maybeTriggerReplan, inReview, pushHistory, servedKeywordId]
  );

  // ─── Handle don't know ────────────────────────────────────────────────────

  const handleDontKnow = useCallback(async () => {
    if (!question || !currentKeyword || phase !== "practicing" || inReview) return;
    setSelectedChoice(null);
    setPhase("revealed");
    pushHistory({ kind: "question", question, selectedChoice: null, revealed: true, wasCorrect: false });
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
          setLessonModal({ keywordId: servedKeywordId ?? currentKeyword.id, label: currentKeyword.label });
        }
      }
    } catch { /* non-fatal */ }
  }, [question, currentKeyword, phase, sessionId, isReviewCard, maybeTriggerReplan, inReview, pushHistory, servedKeywordId]);

  // ─── Free movement: Back / Forward / Skip ───────────────────────────────────

  // Step back into the unified timeline (read-only).
  // Any answer/grade side-effects are guarded by !inReview in their handlers.
  const handleReviewBack = useCallback(() => {
    const hist = historyRef.current;
    if (hist.length === 0) return;
    setReviewIndex((cur) => (cur === null ? hist.length - 1 : Math.max(0, cur - 1)));
  }, []);

  // Step forward through the timeline; past the last entry returns to the LIVE item.
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
    pushHistory({ kind: "question", question, selectedChoice: null, revealed: false, wasCorrect: null });
    void loadQuestion(sessionId, currentKeyword.id, frontier.id);
  }, [question, currentKeyword, phase, inReview, frontier, pushHistory, loadQuestion, sessionId]);

  // ─── Review a past session event (timeline tile click) ──────────────────────
  // ─── Adaptive: DECIDE the next practice item ────────────────────────────────
  // Behaviors 2/4/5: mastery sets the flashcard:question ratio + difficulty,
  // struggling shifts to flashcards, and spaced review interleaves past keywords
  // (as questions OR flashcards). Pure + instant — returns a descriptor the buffer
  // serves (and that handleChoice prefetches during the answer-reveal window).
  // Mastery-gated ADVANCE stays in handleNext.
  const decideNextDescriptor = useCallback(
    (sid: string): ServeDescriptor<ReviewKeyword> | null => {
      const fid = currentFrontierIdRef.current;
      const cur = queue[queueIndexRef.current];
      if (!fid || !cur) return null;
      const recentlyBad = consecutiveWrongRef.current >= 2;
      const pool = reviewPoolRef.current;

      // (2) Spaced review — past keywords, as questions OR flashcards. Suppressed
      // while struggling so we keep focus on the current keyword.
      if (!recentlyBad && pool.length > 0 && Math.random() < REVIEW_PROBABILITY) {
        const rk = pickReviewKeyword(pool);
        if (rk) {
          // v2: probabilistic flashcard draw based on decayed keyword mastery.
          const rkState: KeywordState = {
            score: rk.score ?? 0.5,
            floor: rk.floor,
            last_review_at: rk.last_review_at,
          };
          const nowTs = Date.now();
          const rkDecayed = decayedScore(rkState, nowTs);
          // isDue check: compute cohort mean from pool, tStudied from session elapsed.
          const cohortMean =
            pool.reduce((s, r) => {
              const st: KeywordState = { score: r.score ?? 0.5, floor: r.floor, last_review_at: r.last_review_at };
              return s + decayedScore(st, nowTs);
            }, 0) / pool.length;
          const tStudied = Math.max(0, (nowTs - sessionStart) / 60_000);
          if (!isDue(rkState, nowTs, cohortMean, tStudied)) {
            // Not due — fall through to current keyword
          } else {
            // v2: probabilistic flashcard draw driven by decayed mastery
            const kind = Math.random() < flashcardProbability(rkDecayed) ? "flashcard" : "question";
            return { sessionId: sid, keywordId: rk.id, categoryId: fid, kind, forReview: true, reviewKeyword: rk };
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
    [queue]
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

  // ─── Advance keyword in queue ─────────────────────────────────────────────

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
        // New skill → run its own LESSON → FLASHCARDS → PRACTICE intro.
        if (frontier?.id) beginSkillIntro(sessionId, nextKw, frontier.id);
      }, 1200);
    },
    [currentKeyword, queueIndex, queue, reviewPool, sessionId, loadQuestion, beginSkillIntro, advanceToNextCategory, frontier, markSkillMastered]
  );
  advanceKeywordRef.current = advanceKeyword;

  // ─── Handle Next (after answer) ───────────────────────────────────────────

  const handleNext = useCallback(() => {
    if (!currentKeyword) return;

    if (isReviewCard) {
      setIsReviewCard(false);
      if (pendingReviewBetweenTopics) {
        setPendingReviewBetweenTopics(false);
        const nextKw = queue[queueIndex];
        // Resuming onto a (possibly new) skill after an interleaved review card →
        // run its intro so a brand-new skill still gets its lesson + flashcards.
        if (nextKw && frontier?.id) { beginSkillIntro(sessionId, nextKw, frontier.id); }
        else { advanceToNextCategory(sessionId); }
        return;
      }
      if (frontier?.id) loadQuestion(sessionId, currentKeyword.id, frontier.id);
      return;
    }

    // THRESHOLD-based advancement: mastered once the live 0–1 mastery score
    // crosses MASTERY_ADVANCE (no consecutive-correct requirement). Score is kept
    // current from each /attempt response in currentKwScoreRef.
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
    // during the answer-reveal window if one is ready (instant); else decide + fetch
    // now. topicQuestionCount is incremented when an answer is recorded
    // (handleChoice/handleDontKnow), not here.
    const pending = bufferRef.current?.consume();
    if (pending) {
      if (!pending.settled) setPhase("generating");
      void pending.promise.then(applyReady);
      return;
    }
    serveNextItem(sessionId);
  }, [
    currentKeyword, isReviewCard, pendingReviewBetweenTopics, queue, queueIndex,
    sessionId, loadQuestion, beginSkillIntro, advanceKeyword, frontier, advanceToNextCategory,
    serveNextItem, applyReady,
  ]);

  // ─── Lesson handlers ──────────────────────────────────────────────────────

  const handleLessonComplete = useCallback(() => {
    if (!currentKeyword || !frontier?.id) return;
    setStats((s) => ({ ...s, lessons: s.lessons + 1 }));
    consecutiveWrongRef.current = 0;
    setTopicCorrectStreak(0);
    // Record the lesson in the unified timeline so Back can replay it.
    pushHistory({ kind: "lesson", keywordId: currentKeyword.id, keywordLabel: currentKeyword.label });
    // Intro lesson → continue to FLASHCARDS for this skill. A mid-practice
    // struggle lesson (inTopicIntroRef false) just returns to the question.
    if (inTopicIntroRef.current) {
      void startSkillFlashcards(sessionId, currentKeyword, frontier.id);
      return;
    }
    lessonedKeywordsRef.current.add(currentKeyword.id);
    loadQuestion(sessionId, currentKeyword.id, frontier.id);
  }, [currentKeyword, sessionId, frontier, loadQuestion, startSkillFlashcards, pushHistory]);

  const handleLessonSkip = useCallback(() => {
    if (!currentKeyword || !frontier?.id) return;
    consecutiveWrongRef.current = 0;
    setTopicCorrectStreak(0);
    // Record the lesson in the unified timeline so Back can replay it (even if skipped).
    pushHistory({ kind: "lesson", keywordId: currentKeyword.id, keywordLabel: currentKeyword.label });
    // Skipping the intro lesson → still show its FLASHCARDS, then practice.
    if (inTopicIntroRef.current) {
      void startSkillFlashcards(sessionId, currentKeyword, frontier.id);
      return;
    }
    lessonedKeywordsRef.current.add(currentKeyword.id);
    loadQuestion(sessionId, currentKeyword.id, frontier.id);
  }, [currentKeyword, sessionId, frontier, loadQuestion, startSkillFlashcards, pushHistory]);

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

      // Track per-keyword result for the remedial offer.
      const kwWeights = currentQuizQuestion.keyword_weights ?? {};
      let domKwId: string | null = null;
      let domW = -Infinity;
      for (const [id, w] of Object.entries(kwWeights)) {
        if (w > domW) { domW = w; domKwId = id; }
      }
      if (domKwId) {
        const existing = quizKwResultsRef.current.get(domKwId);
        const kwLabel = queueRef.current.find((k) => k.id === domKwId)?.label ?? domKwId;
        // Keep a wrong answer if any question for this kw was wrong
        if (!existing || (!existing.correct && correct) || (existing.correct && !correct)) {
          quizKwResultsRef.current.set(domKwId, { label: kwLabel, correct });
        }
      }

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
      // Quiz done → compute failed keywords and show results screen.
      const failed: Array<{ id: string; label: string }> = [];
      for (const [id, res] of quizKwResultsRef.current.entries()) {
        if (!res.correct) failed.push({ id, label: res.label });
      }
      if (failed.length > 0) {
        setFailedQuizKeywords(failed);
        setPhase("quiz_results");
      } else {
        await advanceToNextCategory(sessionId);
      }
      return;
    }
    setQuizIndex(nextIdx);
    setQuizSelectedChoice(null);
    setLastAnswerCorrect(false);
    setPhase("mini_quiz");
  }, [quizIndex, quizQuestions.length, sessionId, advanceToNextCategory]);

  // ─── Flashcard handlers ───────────────────────────────────────────────────

  // Advance past the END of the intro deck (every card memorized) or a practice-mode
  // card. The intro recirculation itself lives in gradeFlashcard/handleFlashcardSkip;
  // this only runs once the deck is exhausted (fcIndex stays 0 in intro mode, so the
  // intro branch fires when the last remaining card is dropped).
  const handleFlashcardNext = useCallback(async () => {
    const nextIdx = fcIndex + 1;
    if (nextIdx >= flashcards.length) {
      if (flashcardModeRef.current === "intro") {
        // End of the per-keyword warm-up deck.
        if (currentKeyword && frontier?.id) {
          markIntroSeen(sessionId, currentKeyword.id, frontier.id);
          inTopicIntroRef.current = false;
          if (isIntroKw(currentKeyword.id)) {
            // Framing-only intro: NO practice. Persist mastered so it leaves
            // next_focus, then advance straight to the first real subtopic.
            markSkillMastered(sessionId, currentKeyword.id, frontier.id);
            await advanceKeyword({ wasMastered: false });
          } else {
            // Normal subtopic → start its practice questions (step 3 of the path).
            await startKeyword(sessionId, currentKeyword, frontier.id);
          }
        } else {
          await advanceToNextCategory(sessionId);
        }
      } else {
        // An interleaved adaptive flashcard finished → resume the adaptive loop.
        serveNextItem(sessionId);
      }
      return;
    }
    setFcIndex(nextIdx);
  }, [fcIndex, flashcards.length, currentKeyword, frontier, sessionId, startKeyword, advanceToNextCategory, markIntroSeen, serveNextItem, isIntroKw, markSkillMastered, advanceKeyword]);

  // Grade the current card (universal SRS + keyword state via the shared route),
  // then advance. INTRO deck → reuse the Leitner SRS so missed/"don't know" cards
  // recirculate (spaced) until memorized; the deck ends only when all are memorized.
  const gradeFlashcard = useCallback(
    async (result: "got_it" | "missed_it" | "dont_know") => {
      // Guard: no re-grading while in review.
      if (inReview) return;
      const card = flashcards[fcIndex];
      // Record that this card was shown (read-only replay available via Back).
      if (card && currentKeyword) {
        pushHistory({
          kind: "flashcard",
          card,
          keywordId: servedKeywordId ?? currentKeyword.id,
          keywordLabel: currentKeyword.label,
        });
      }
      if (card) {
        fetch("/api/mcat/flashcard-attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, flashcard_id: card.id, result }),
        }).catch(() => {});
      }
      if (flashcardModeRef.current === "intro" && card) {
        const t = nextSrsState(fcBoxRef.current.get(card.id) ?? null, result);
        fcBoxRef.current.set(card.id, { box: t.box, reps: t.reps, lapses: t.lapses, learned: t.learned });
        const rest = flashcards.filter((c) => c.id !== card.id);
        if (t.box < MEMORIZED_BOX) {
          // Not yet memorized → re-queue a few cards later (gap grows with the box).
          rest.splice(Math.min(rest.length, t.box <= 1 ? 2 : 5), 0, card);
          setFlashcards(rest);
          setFcIndex(0);
          return;
        }
        if (rest.length > 0) {
          setFlashcards(rest); // graduated, deck not empty → next card
          setFcIndex(0);
          return;
        }
        // Last card memorized → fall through to handleFlashcardNext for completion.
      }
      await handleFlashcardNext();
    },
    [flashcards, fcIndex, sessionId, handleFlashcardNext, inReview, pushHistory, servedKeywordId, currentKeyword]
  );

  // Skip the current flashcard: no SRS update. In the intro deck the card is
  // deferred (recirculates later, never back-to-back), so it isn't lost.
  const handleFlashcardSkip = useCallback(async () => {
    const card = flashcards[fcIndex];
    if (flashcardModeRef.current === "intro" && card) {
      const rest = flashcards.filter((c) => c.id !== card.id);
      rest.splice(Math.min(rest.length, 3), 0, card);
      setFlashcards(rest);
      setFcIndex(0);
      return;
    }
    await handleFlashcardNext();
  }, [flashcards, fcIndex, handleFlashcardNext]);

  // ─── Derived state ────────────────────────────────────────────────────────

  const isInQuizPhase = phase === "mini_quiz" || phase === "mini_quiz_revealed" || phase === "mini_quiz_loading" || phase === "quiz_results";
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
              className="text-sm font-bold text-neutral-700 hover:text-brand-600 shrink-0 whitespace-nowrap"
            >
              ← MCAT
            </Link>
            {frontier && phase !== "loading" && phase !== "needs_diagnostic" && phase !== "course_complete" && (
              <span className="text-xs font-medium text-neutral-700 truncate min-w-0">
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

        {/* Mini-quiz position (counter only — the GrindMeter is the single bar). */}
        {isInQuizPhase && quizQuestions.length > 0 && (
          <div className="w-full px-6 pb-2">
            <span className="text-xs text-neutral-400">
              Quiz {quizIndex + 1}/{quizQuestions.length}
              {quizIndex > 0 && ` · ${quizScorePct}%`}
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
                A quick diagnostic finds your starting point so automatic mode
                begins where you need it most.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => router.push("/mcat/diagnostic")}
                className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors text-center"
              >
                Take placement diagnostic
              </button>
              <button
                onClick={async () => {
                  // Skip diagnostic — start from the beginning.
                  setPhase("loading");
                  try {
                    // Persist the skip server-side so the diagnostic gate never
                    // re-appears on future page loads (client-only was forgotten).
                    await fetch("/api/mcat/diagnostic/skip", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ session_id: sessionId }),
                    });
                    const newPlan = await fetchPlan(sessionId);
                    if (!newPlan) { setPhase("course_complete"); return; }
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

        {/* ─── Practice / Revealed / Flashcard / Lesson / Review ──────────── */}
        {/* Shared Back/Forward nav bar — shown any time the student can step back. */}
        {(isInPracticePhase || phase === "flashcard" || phase === "lesson" || inReview) && (() => {
          const hasEarlier = inReview ? reviewIndex! > 0 : historyRef.current.length > 0;
          const totalSteps = historyRef.current.length;
          const positionLabel = inReview
            ? `Reviewing step ${reviewIndex! + 1} of ${totalSteps}`
            : `Step ${totalSteps + 1}`;
          return (
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
          );
        })()}

        {/* ─── Live flashcard step (hidden while reviewing a timeline entry) ─ */}
        {phase === "flashcard" && !inReview && flashcards[fcIndex] && (
          <div className="space-y-4">
            <FlipCard
              front={flashcards[fcIndex]!.front}
              back={flashcards[fcIndex]!.back}
              onGrade={gradeFlashcard}
              resetKey={`${flashcards[fcIndex]!.id}#${fcBoxRef.current.get(flashcards[fcIndex]!.id)?.reps ?? 0}`}
            />

            {/* Lesson (POPUP) / refresher access for the current card's topic */}
            <QuestionToolbar
              system="mcat"
              keywordId={servedKeywordId ?? primaryKeywordId(flashcards[fcIndex]!.keyword_weights) ?? currentKeyword?.id ?? null}
              sessionId={sessionId || null}
              questionId={flashcards[fcIndex]!.id}
              contentType="flashcard"
              resetSignal={flashcards[fcIndex]!.id}
              onStateChange={() => bufferRef.current?.clear()}
            />

            {/* Skip flashcard — no SRS update, no mastery change */}
            <div className="flex justify-center">
              <button
                onClick={handleFlashcardSkip}
                className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2 transition-colors"
              >
                Skip →
              </button>
            </div>
          </div>
        )}

        {/* ─── Live lesson (inline) — hidden while reviewing a timeline entry ─ */}
        {phase === "lesson" && !inReview && currentKeyword && sessionId && (
          <LessonView
            sessionId={sessionId}
            keywordId={currentKeyword.id}
            keywordLabel={currentKeyword.label}
            onComplete={handleLessonComplete}
            onSkip={handleLessonSkip}
          />
        )}

        {/* ─── Review: flashcard entry (read-only) ──────────────────────── */}
        {inReview && reviewEntry?.kind === "flashcard" && (() => {
          const entry = reviewEntry;
          return (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-neutral-200 text-neutral-600">
                  Read-only · Flashcard
                </span>
              </div>
              {/* Show both faces of the card so the student can re-read it. */}
              <div className="space-y-3">
                <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-brand-xs">
                  <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">Front</p>
                  <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                    <MathText>{entry.card.front}</MathText>
                  </p>
                </div>
                <div className="bg-brand-50 rounded-xl border border-brand-100 p-5">
                  <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-2">Back</p>
                  <p className="text-sm text-neutral-700 leading-relaxed">
                    <MathText>{entry.card.back}</MathText>
                  </p>
                </div>
              </div>
            </>
          );
        })()}

        {/* ─── Review: lesson entry (read-only re-display) ──────────────── */}
        {inReview && reviewEntry?.kind === "lesson" && sessionId && (() => {
          const entry = reviewEntry;
          return (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-neutral-200 text-neutral-600">
                  Read-only · Lesson
                </span>
              </div>
              {/* Re-render the lesson view read-only (no complete/skip callbacks while inReview). */}
              <LessonView
                sessionId={sessionId}
                keywordId={entry.keywordId}
                keywordLabel={entry.keywordLabel}
                onComplete={() => { /* read-only: do nothing */ }}
                onSkip={() => { /* read-only: do nothing */ }}
              />
            </>
          );
        })()}

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

        {/* ─── Live practice / Revealed / Review (question entry) ──────── */}
        {(isInPracticePhase || (inReview && reviewEntry?.kind === "question")) &&
          (inReview ? (reviewEntry?.kind === "question" ? reviewEntry : null) : question) && (() => {
          // When in review, render the historical question entry READ-ONLY.
          const qEntry = inReview ? (reviewEntry as Extract<TimelineEntry, { kind: "question" }>) : null;
          const dispQuestion = (inReview ? qEntry!.question : question)!;
          const dispSelected = inReview ? qEntry!.selectedChoice : selectedChoice;
          const dispRevealed = inReview ? qEntry!.revealed : phase === "revealed";
          return (
          <>
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
                <MathText>{dispQuestion.stem}</MathText>
              </p>
            </div>

            {/* Action bar — quick refresher / see lesson (POPUP) / prioritize.
                Keyed to the SERVED question's keyword so see-lesson corresponds (3,7). */}
            {!inReview && (
              <QuestionToolbar
                system="mcat"
                keywordId={servedKeywordId ?? currentKeyword?.id ?? null}
                sessionId={sessionId || null}
                questionId={dispQuestion.id}
                contentType="question"
                resetSignal={dispQuestion.id}
                answerSignal={phase === "revealed" ? dispQuestion.id : undefined}
                onStateChange={() => bufferRef.current?.clear()}
              />
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

            {/* Affirmation banner — live reveal only */}
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

            {/* Lesson recommendations now surface as a closeable POPUP (LessonModal,
                rendered near the page root), not an inline bottom offer. */}

            {/* Feedback + Continue — live only (review is navigated via Back/Forward) */}
            {!inReview && phase === "revealed" && (
              <>
                <FeedbackWidget
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

        {/* ─── Mini-quiz ───────────────────────────────────────────────────── */}
        {(phase === "mini_quiz" || phase === "mini_quiz_revealed") && currentQuizQuestion && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                Checkpoint
              </span>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-brand-xs">
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{currentQuizQuestion.stem}</MathText>
              </p>
            </div>
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

            {/* Affirmation banner — quiz reveal */}
            {phase === "mini_quiz_revealed" && (
              <AnswerAffirmation correct={lastAnswerCorrect} streak={combo} />
            )}

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

      </main>

      {/* See-lesson POPUP — opened from the toolbar, the "Learn this" header
          button, the after-problem offer, and auto-surfaced on repeated misses
          (8). Keyed to the served keyword so it corresponds to the item (7). */}
      {lessonModal && (
        <LessonModal
          system="mcat"
          keywordId={lessonModal.keywordId}
          label={lessonModal.label}
          sessionId={sessionId || null}
          onClose={() => setLessonModal(null)}
        />
      )}

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
