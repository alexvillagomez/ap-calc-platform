"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Preview } from "@/components/Preview";
import { cn } from "@/lib/cn";

// ─── Position persistence ─────────────────────────────────────────────────────

interface SavedPosition {
  keywordId: string | null;
  phase: string | null;
  lessonStepIdx: number | null;
  problemId: string | null;
  updatedAt?: string | null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type KeywordState =
  | "needs_lesson"
  | "needs_practice"
  | "in_progress"
  | "mastered"
  | "not_started";

interface KeywordEntry {
  id: string;
  label: string;
  state: KeywordState;
  in_depth_score: number | null;
  tested: boolean;
  total_attempts: number;
  low_sample: boolean;
}

interface UmbrellaGroup {
  id: string;
  label: string;
  keywords: KeywordEntry[];
}

interface CategoryGroup {
  category_id: string;
  category_name: string;
  umbrellas: UmbrellaGroup[];
}

interface PracticeProblem {
  id: string;
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
  difficulty: number;
}

interface PracticeNextResponse {
  problem: PracticeProblem;
  targetDifficulty: number;
  servedKeywordId: string;
  phase: string;
}

interface AttemptResponse {
  state: string;
  in_depth_score: number;
  consecutive_correct: number;
  show_tip: boolean;
  offer_mastery_quiz: boolean;
  mastery_achieved: boolean;
}

interface CheckQuestion {
  latex_content: string;
  question_latex?: string;
  choices: string[];
  correct_index: number;
  hint_latex?: string;
}

interface MicroStep {
  step_index: number;
  has_check?: boolean;
  explanation_latex: string;
  example_latex: string;
  check_question: CheckQuestion;
  hint_latex: string;
}

interface LessonData {
  id: string;
  keyword_id: string;
  micro_steps: MicroStep[];
}

interface RefresherData {
  id: string;
  keyword_id: string;
  rule_latex: string;
  example_latex: string;
  check_question: CheckQuestion;
}

type Phase =
  | "loading"
  | "hub"
  | "practicing"
  | "revealed"
  | "lesson"
  | "refresher"
  | "done"
  | "transition";

const CHOICE_LABELS = ["A", "B", "C", "D"];
const SESSION_KEY = "ap_calc_student_session_id";
const ACCOUNT_KEY = "ap_calc_account_id";
const MAX_KEYWORDS = 8;

const STATE_PRIORITY: Record<KeywordState, number> = {
  needs_lesson: 0,
  needs_practice: 1,
  in_progress: 2,
  not_started: 3,
  mastered: 99,
};

function stateBadge(state: KeywordState): { label: string; className: string } {
  switch (state) {
    case "needs_lesson":
      return { label: "Needs lesson", className: "bg-orange-100 text-orange-700" };
    case "needs_practice":
      return { label: "Needs practice", className: "bg-blue-100 text-blue-700" };
    case "in_progress":
      return { label: "In progress", className: "bg-blue-100 text-blue-600" };
    case "not_started":
      return { label: "Not started", className: "bg-gray-100 text-gray-500" };
    case "mastered":
      return { label: "Mastered", className: "bg-green-100 text-green-700" };
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DemoPracticePage() {
  const router = useRouter();

  // Auth
  const [sessionId, setSessionId] = useState<string>("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Page phase
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);

  // Keyword queue
  const [queue, setQueue] = useState<KeywordEntry[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);

  // Current keyword
  const currentKeyword = queue[queueIndex] ?? null;

  // Practice problem
  const [problem, setProblem] = useState<PracticeProblem | null>(null);
  const [problemLoading, setProblemLoading] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const excludedIdsRef = useRef<string[]>([]);
  const answerStartTimeRef = useRef<number>(Date.now());

  // Consecutive tracking
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);
  const [consecutiveWrong, setConsecutiveWrong] = useState(0);

  // Lesson
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonStepIdx, setLessonStepIdx] = useState(0);
  const [lessonCheckAnswer, setLessonCheckAnswer] = useState<number | null>(null);
  const [lessonShowHint, setLessonShowHint] = useState(false);

  // Refresher
  const [refresher, setRefresher] = useState<RefresherData | null>(null);
  const [refresherLoading, setRefresherLoading] = useState(false);
  const [refresherAnswer, setRefresherAnswer] = useState<number | null>(null);

  // Transition message
  const [transitionMsg, setTransitionMsg] = useState("");

  // Resume-on-mount guard: set to true when a saved position was successfully
  // restored so the hub auto-start effect does not double-fire.
  const resumedRef = useRef(false);

  // Auto-advance countdown (practice revealed phase)
  const [countdownPaused, setCountdownPaused] = useState(false);
  const countdownStartRef = useRef<number | null>(null);
  const countdownRafRef = useRef<number | null>(null);
  const [countdownProgress, setCountdownProgress] = useState(1); // 1 = full bar, 0 = empty

  // Auto-advance countdown (lesson non-check steps)
  const [lessonCountdownProgress, setLessonCountdownProgress] = useState(1);
  const lessonCountdownStartRef = useRef<number | null>(null);
  const lessonCountdownRafRef = useRef<number | null>(null);

  // ── Persist position (fire-and-forget) ─────────────────────────────────────
  // Accepts optional overrides so callers can pass the *new* values before React
  // state has settled (state updates are async).
  const savePosition = useCallback(
    (overrides: {
      keywordId?: string | null;
      phase?: Phase;
      lessonStepIdx?: number;
      problemId?: string | null;
    } = {}) => {
      const sid = localStorage.getItem(SESSION_KEY);
      if (!sid) return;
      const resolvedPhase = overrides.phase ?? phase;
      // Never persist "done" — nothing to resume from
      if (resolvedPhase === "done") return;
      const body = {
        sessionId: sid,
        keywordId: overrides.keywordId !== undefined
          ? overrides.keywordId
          : (currentKeyword?.id ?? null),
        phase: resolvedPhase,
        lessonStepIdx: overrides.lessonStepIdx !== undefined
          ? overrides.lessonStepIdx
          : lessonStepIdx,
        problemId: overrides.problemId !== undefined
          ? overrides.problemId
          : (problem?.id ?? null),
      };
      fetch("/api/demo-practice/position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
    [phase, currentKeyword, lessonStepIdx, problem]
  );

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    if (!accountId) {
      router.replace("/login");
      return;
    }
    const sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      router.replace("/login");
      return;
    }
    setSessionId(sid);
  }, [router]);

  // ── Load progress and build queue ──────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;

    async function loadProgress() {
      setPhase("loading");
      setError(null);
      try {
        const res = await fetch(`/api/learn/progress?sessionId=${encodeURIComponent(sessionId)}`);
        if (!res.ok) throw new Error(`Progress fetch failed: ${res.status}`);
        const data = (await res.json()) as { categories: CategoryGroup[] };

        // Filter to polynomials category
        const polyCategory = data.categories.find(
          (c) => c.category_id === "polynomials"
        );

        // Collect all in_depth keywords from all umbrellas
        let allKeywords: KeywordEntry[] = [];
        const source = polyCategory
          ? polyCategory.umbrellas
          : data.categories.flatMap((c) => c.umbrellas);

        for (const umbrella of source) {
          for (const kw of umbrella.keywords) {
            allKeywords.push(kw);
          }
        }

        // Sort by priority, skip mastered
        allKeywords = allKeywords
          .filter((kw) => kw.state !== "mastered")
          .sort((a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state]);

        // Take top 8
        const topKeywords = allKeywords.slice(0, MAX_KEYWORDS);

        if (topKeywords.length === 0) {
          // No keywords to practice — go to done
          setQueue([]);
          setPhase("done");
          return;
        }

        // ── Try to restore a saved position ──────────────────────────────────
        // Fetch saved position before deciding the initial phase so the hub
        // auto-start effect cannot race it.  If the GET fails or returns no
        // saved keyword we fall through to the normal hub → queue[0] path.
        let savedPos: SavedPosition = { keywordId: null, phase: null, lessonStepIdx: null, problemId: null };
        try {
          const sid = localStorage.getItem(SESSION_KEY) ?? sessionId;
          const posRes = await fetch(
            `/api/demo-practice/position?sessionId=${encodeURIComponent(sid)}`
          );
          if (posRes.ok) {
            savedPos = (await posRes.json()) as SavedPosition;
          }
        } catch {
          // GET failed — degrade gracefully, fall through to hub
        }

        const resumablePhases: Phase[] = ["practicing", "lesson", "refresher"];
        const savedPhase =
          savedPos.phase && (resumablePhases as string[]).includes(savedPos.phase)
            ? (savedPos.phase as Phase)
            : null;

        const savedKwIndex = savedPos.keywordId != null
          ? topKeywords.findIndex((kw) => kw.id === savedPos.keywordId)
          : -1;

        const canResume = savedKwIndex !== -1 && savedPhase !== null;

        setQueue(topKeywords);

        if (canResume) {
          // Mark as resumed BEFORE setting phase so the hub effect guard is
          // already in place by the time React processes the state update.
          resumedRef.current = true;
          setQueueIndex(savedKwIndex);
          const kw = topKeywords[savedKwIndex]!;

          if (savedPhase === "lesson") {
            // loadLesson resets lessonStepIdx to 0 internally; await it so we
            // can restore the saved step index afterward.
            const clampedStep = Math.max(0, savedPos.lessonStepIdx ?? 0);
            await loadLesson(kw.id);
            if (clampedStep > 0) {
              setLessonStepIdx(clampedStep);
            }
          } else if (savedPhase === "practicing") {
            // Load a fresh problem for the correct keyword.  We cannot cheaply
            // replay the exact saved problemId through the existing API (it uses
            // POST /next which serves the next unserved problem), so we accept a
            // fresh problem — correct keyword + phase is the priority per spec.
            loadPracticeProblem(kw.id);
          } else if (savedPhase === "refresher") {
            loadRefresher(kw.id);
          }
        } else {
          // No valid saved position — normal flow
          setQueueIndex(0);
          setPhase("hub");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load progress");
        setPhase("loading"); // keep spinner up, error shown below
      }
    }

    loadProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Auto-advance from hub after 1.5s ───────────────────────────────────────
  useEffect(() => {
    // If a saved position was restored, loadProgress already called startKeyword
    // (or loadLesson/loadRefresher) directly and set phase to the restored value,
    // so phase will never be "hub" in that case.  The resumedRef guard is a
    // belt-and-suspenders safety net in case React batches things unexpectedly.
    if (phase !== "hub" || queue.length === 0 || resumedRef.current) return;
    const t = setTimeout(() => {
      startKeyword(queue[0]!);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, queue]);

  // ── Auto-advance after practice answer revealed (3s countdown) ─────────────
  useEffect(() => {
    if (phase !== "revealed") {
      // Clean up if phase changes away
      if (countdownRafRef.current !== null) {
        cancelAnimationFrame(countdownRafRef.current);
        countdownRafRef.current = null;
      }
      countdownStartRef.current = null;
      setCountdownProgress(1);
      setCountdownPaused(false);
      return;
    }

    const DURATION = 3000; // ms
    countdownStartRef.current = performance.now();
    setCountdownProgress(1);
    setCountdownPaused(false);

    const tick = (now: number) => {
      if (countdownStartRef.current === null) return;
      const elapsed = now - countdownStartRef.current;
      const remaining = Math.max(0, 1 - elapsed / DURATION);
      setCountdownProgress(remaining);
      if (remaining > 0) {
        countdownRafRef.current = requestAnimationFrame(tick);
      } else {
        countdownRafRef.current = null;
        handleNext();
      }
    };

    countdownRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (countdownRafRef.current !== null) {
        cancelAnimationFrame(countdownRafRef.current);
        countdownRafRef.current = null;
      }
    };
    // handleNext is stable enough — we intentionally omit it to avoid restart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Pause / resume the practice countdown when countdownPaused changes
  useEffect(() => {
    if (phase !== "revealed") return;

    if (countdownPaused) {
      // Cancel the running animation frame; freeze the bar at its current value
      if (countdownRafRef.current !== null) {
        cancelAnimationFrame(countdownRafRef.current);
        countdownRafRef.current = null;
      }
      return;
    }

    // Resume: re-anchor start time so the remaining fraction continues from now
    const DURATION = 3000;
    const resumeFrom = performance.now();
    const elapsedEquivalent = (1 - countdownProgress) * DURATION;
    countdownStartRef.current = resumeFrom - elapsedEquivalent;

    const tick = (now: number) => {
      if (countdownStartRef.current === null) return;
      const elapsed = now - countdownStartRef.current;
      const remaining = Math.max(0, 1 - elapsed / DURATION);
      setCountdownProgress(remaining);
      if (remaining > 0) {
        countdownRafRef.current = requestAnimationFrame(tick);
      } else {
        countdownRafRef.current = null;
        handleNext();
      }
    };

    countdownRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (countdownRafRef.current !== null) {
        cancelAnimationFrame(countdownRafRef.current);
        countdownRafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownPaused]);

  // ── Auto-advance lesson non-check steps (4s countdown) ────────────────────
  // We derive whether the current lesson step is a non-check step inside the
  // effect so we don't need the step object as a dependency primitive.
  const isNonCheckLessonStep =
    phase === "lesson" &&
    lesson !== null &&
    !lessonLoading &&
    (() => {
      const step = lesson.micro_steps[lessonStepIdx];
      if (!step) return false;
      return (
        step.has_check === false ||
        !step.check_question.choices.some((c) => c.trim() !== "")
      );
    })();

  useEffect(() => {
    if (!isNonCheckLessonStep) {
      if (lessonCountdownRafRef.current !== null) {
        cancelAnimationFrame(lessonCountdownRafRef.current);
        lessonCountdownRafRef.current = null;
      }
      lessonCountdownStartRef.current = null;
      setLessonCountdownProgress(1);
      return;
    }

    const DURATION = 4000;
    lessonCountdownStartRef.current = performance.now();
    setLessonCountdownProgress(1);

    const tick = (now: number) => {
      if (lessonCountdownStartRef.current === null) return;
      const elapsed = now - lessonCountdownStartRef.current;
      const remaining = Math.max(0, 1 - elapsed / DURATION);
      setLessonCountdownProgress(remaining);
      if (remaining > 0) {
        lessonCountdownRafRef.current = requestAnimationFrame(tick);
      } else {
        lessonCountdownRafRef.current = null;
        handleLessonNext();
      }
    };

    lessonCountdownRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (lessonCountdownRafRef.current !== null) {
        cancelAnimationFrame(lessonCountdownRafRef.current);
        lessonCountdownRafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNonCheckLessonStep, lessonStepIdx]);

  // ── Start a keyword (auto-route to lesson if score is very low) ─────────────
  const startKeyword = useCallback(
    (kw: KeywordEntry) => {
      const shouldLesson =
        kw.state === "needs_lesson" ||
        (kw.in_depth_score !== null && kw.in_depth_score < 0.35);

      if (shouldLesson) {
        savePosition({ keywordId: kw.id, phase: "lesson", lessonStepIdx: 0, problemId: null });
        loadLesson(kw.id);
      } else {
        savePosition({ keywordId: kw.id, phase: "practicing", problemId: null });
        loadPracticeProblem(kw.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savePosition]
  );

  // ── Load next practice problem ──────────────────────────────────────────────
  // NOTE: reads sessionId from localStorage at call time so this function is
  // stable ([] deps) and never holds a stale empty sessionId from the first render.
  // startKeyword has [] deps and would otherwise capture the initial empty sessionId.
  const loadPracticeProblem = useCallback(
    async (keywordId: string) => {
      const currentSessionId = localStorage.getItem(SESSION_KEY) ?? "";
      if (!currentSessionId) return;
      setProblemLoading(true);
      setProblem(null);
      setSelectedChoice(null);
      setPhase("practicing");
      setError(null);
      try {
        const res = await fetch("/api/learn/practice/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: currentSessionId,
            keyword_id: keywordId,
            excludeIds: excludedIdsRef.current,
          }),
        });
        if (!res.ok) throw new Error(`Practice fetch failed: ${res.status}`);
        const data = (await res.json()) as PracticeNextResponse;
        setProblem(data.problem);
        excludedIdsRef.current = [...excludedIdsRef.current, data.problem.id];
        answerStartTimeRef.current = Date.now();
        // Persist position with the newly loaded problem
        savePosition({ phase: "practicing", problemId: data.problem.id });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load problem");
      } finally {
        setProblemLoading(false);
      }
    },
    [savePosition] // savePosition is stable between renders; reads sessionId from localStorage
  );

  // ── Handle answer selection ─────────────────────────────────────────────────
  const handleAnswer = useCallback(
    async (choiceIndex: number) => {
      if (!problem || !currentKeyword || phase !== "practicing") return;
      setSelectedChoice(choiceIndex);
      setPhase("revealed");

      const correct = choiceIndex === problem.correct_index;
      const timeSpentMs = Date.now() - answerStartTimeRef.current;

      // Record attempt (fire and don't block UI)
      fetch("/api/learn/practice/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          keyword_id: currentKeyword.id,
          topic_id: "polynomials",
          correct,
          time_spent_ms: timeSpentMs,
        }),
      }).catch(() => {});

      if (correct) {
        setConsecutiveCorrect((n) => n + 1);
        setConsecutiveWrong(0);
      } else {
        setConsecutiveWrong((n) => n + 1);
        setConsecutiveCorrect(0);
      }
    },
    [problem, currentKeyword, phase, sessionId]
  );

  // ── Handle "I don't know this" ──────────────────────────────────────────────
  const handleDontKnow = useCallback(() => {
    if (!currentKeyword) return;
    loadLesson(currentKeyword.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKeyword]);

  // ── Handle "Next →" from revealed ──────────────────────────────────────────
  const handleNext = useCallback(() => {
    if (!currentKeyword) return;

    if (consecutiveCorrect >= 3) {
      // Advance to next keyword
      advanceKeyword();
      return;
    }

    if (consecutiveWrong >= 2) {
      // Too many wrong — show lesson
      loadLesson(currentKeyword.id);
      return;
    }

    // Continue with next problem for same keyword
    loadPracticeProblem(currentKeyword.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKeyword, consecutiveCorrect, consecutiveWrong, loadPracticeProblem]);

  // ── Advance to next keyword ─────────────────────────────────────────────────
  const advanceKeyword = useCallback(() => {
    const nextIndex = queueIndex + 1;
    if (nextIndex >= queue.length) {
      setPhase("done");
      return;
    }

    const nextKw = queue[nextIndex]!;
    setTransitionMsg(`Great! Moving to "${nextKw.label}"…`);
    setPhase("transition");

    setQueueIndex(nextIndex);
    setConsecutiveCorrect(0);
    setConsecutiveWrong(0);
    excludedIdsRef.current = [];
    // Persist the keyword we're transitioning to
    savePosition({ keywordId: nextKw.id, phase: "transition", problemId: null });

    setTimeout(() => {
      startKeyword(nextKw);
    }, 1200);
  }, [queueIndex, queue, startKeyword, savePosition]);

  // ── Load lesson ─────────────────────────────────────────────────────────────
  const loadLesson = useCallback(async (keywordId: string) => {
    setLessonLoading(true);
    setLesson(null);
    setLessonStepIdx(0);
    setLessonCheckAnswer(null);
    setLessonShowHint(false);
    setPhase("lesson");
    setError(null);
    // Persist: entering lesson at step 0
    savePosition({ keywordId, phase: "lesson", lessonStepIdx: 0, problemId: null });
    try {
      const res = await fetch(`/api/learn/lesson/${encodeURIComponent(keywordId)}`);
      if (!res.ok) throw new Error(`Lesson fetch failed: ${res.status}`);
      const data = (await res.json()) as LessonData;
      setLesson(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lesson");
    } finally {
      setLessonLoading(false);
    }
  }, [savePosition]);

  // ── Lesson step navigation ──────────────────────────────────────────────────
  const handleLessonCheckAnswer = useCallback(
    (choiceIndex: number) => {
      if (lessonCheckAnswer !== null) return;
      setLessonCheckAnswer(choiceIndex);
      const step = lesson?.micro_steps[lessonStepIdx];
      if (!step) return;
      if (choiceIndex !== step.check_question.correct_index) {
        setLessonShowHint(true);
      }
    },
    [lesson, lessonStepIdx, lessonCheckAnswer]
  );

  const handleLessonNext = useCallback(() => {
    if (!lesson || !currentKeyword) return;
    const nextStep = lessonStepIdx + 1;
    if (nextStep >= lesson.micro_steps.length) {
      // Lesson complete — back to practice
      setConsecutiveCorrect(0);
      setConsecutiveWrong(0);
      loadPracticeProblem(currentKeyword.id);
    } else {
      setLessonStepIdx(nextStep);
      setLessonCheckAnswer(null);
      setLessonShowHint(false);
      // Persist the new lesson step
      savePosition({ keywordId: currentKeyword.id, phase: "lesson", lessonStepIdx: nextStep, problemId: null });
    }
  }, [lesson, lessonStepIdx, currentKeyword, loadPracticeProblem, savePosition]);

  const handleLessonTryAgain = useCallback(() => {
    setLessonCheckAnswer(null);
    setLessonShowHint(false);
  }, []);

  const handleSkipLesson = useCallback(() => {
    if (!currentKeyword) return;
    loadPracticeProblem(currentKeyword.id);
  }, [currentKeyword, loadPracticeProblem]);

  // ── Load refresher ──────────────────────────────────────────────────────────
  const loadRefresher = useCallback(async (keywordId: string) => {
    setRefresherLoading(true);
    setRefresher(null);
    setRefresherAnswer(null);
    setPhase("refresher");
    setError(null);
    // Persist: entering refresher
    savePosition({ keywordId, phase: "refresher", problemId: null });
    try {
      const res = await fetch(`/api/learn/refresher/${encodeURIComponent(keywordId)}`);
      if (!res.ok) throw new Error(`Refresher fetch failed: ${res.status}`);
      const data = (await res.json()) as RefresherData;
      setRefresher(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load refresher");
    } finally {
      setRefresherLoading(false);
    }
  }, [savePosition]);

  const handleRefresherAnswer = useCallback(
    (choiceIndex: number) => {
      if (refresherAnswer !== null) return;
      setRefresherAnswer(choiceIndex);
    },
    [refresherAnswer]
  );

  const handleRefresherDone = useCallback(() => {
    if (!currentKeyword) return;
    loadPracticeProblem(currentKeyword.id);
  }, [currentKeyword, loadPracticeProblem]);

  // ─── Render ────────────────────────────────────────────────────────────────

  const handleResetEverything = async () => {
    setShowResetConfirm(false);
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    const sid = localStorage.getItem(SESSION_KEY) ?? sessionId;
    try {
      await fetch("/api/demo/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, sessionId: sid }),
      });
    } catch { /* best-effort */ }
    try { localStorage.removeItem("ap_calc_diagnostic_done"); } catch {}
    router.push("/demo");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Reset confirmation — warns that restarting erases all progress */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Restart diagnostic?</h3>
            <p className="text-sm text-gray-600">
              This will <span className="font-medium text-gray-900">erase all your progress</span> —
              your diagnostic results, skill scores, and practice position — and start over from the
              first question. This can&apos;t be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetEverything}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
              >
                Reset everything
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Top bar with logout */}
      <div className="max-w-2xl mx-auto px-6 pt-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(ACCOUNT_KEY);
            localStorage.removeItem("ap_calc_diagnostic_done");
            router.replace("/");
          }}
          className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2 transition-colors"
        >
          Log out
        </button>
      </div>
      <div className="max-w-2xl mx-auto px-6 py-4 space-y-6">
        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── Loading ── */}
        {phase === "loading" && (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm text-gray-400 animate-pulse">Loading your practice plan…</p>
          </div>
        )}

        {/* ── Hub ── */}
        {phase === "hub" && queue.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Your Polynomials Practice Plan</h1>
              <p className="text-sm text-gray-500 mt-1">
                Based on your diagnostic, we&apos;ve picked up to {MAX_KEYWORDS} skills to work on.
              </p>
            </div>

            <div className="space-y-2">
              {queue.map((kw, i) => {
                const badge = stateBadge(kw.state);
                return (
                  <div
                    key={kw.id}
                    className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-gray-100 bg-gray-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-medium text-gray-400 w-4 flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-sm text-gray-800 truncate">{kw.label}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                      {kw.in_depth_score !== null && (
                        <span className="text-xs text-gray-400">
                          {Math.round(kw.in_depth_score * 100)}%
                        </span>
                      )}
                      <span
                        className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          badge.className
                        )}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-sm text-gray-500 animate-pulse text-center">
              Starting with &ldquo;{queue[0]?.label}&rdquo;…
            </p>
          </div>
        )}

        {/* ── Transition ── */}
        {phase === "transition" && (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm text-gray-500 animate-pulse">{transitionMsg}</p>
          </div>
        )}

        {/* ── Practicing / Revealed ── */}
        {(phase === "practicing" || phase === "revealed") && currentKeyword && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
                  {currentKeyword.label}
                </p>
              </div>
              {/* Streak indicator: 3 dots showing consecutive-correct progress */}
              <div className="flex items-center gap-1.5" title="Get 3 correct in a row to advance">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      "w-2.5 h-2.5 rounded-full border-2 transition-colors",
                      i < consecutiveCorrect
                        ? "bg-green-500 border-green-500"
                        : "bg-transparent border-gray-300"
                    )}
                  />
                ))}
                <span className="text-xs text-gray-400 ml-1">streak</span>
              </div>
            </div>

            {problemLoading && (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-gray-400 animate-pulse">Loading problem…</p>
              </div>
            )}

            {problem && (
              <>
                {/* Problem stem */}
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                  <Preview latexContent={problem.latex_content} />
                </div>

                {/* Choices */}
                <div className="space-y-2">
                  {problem.choices.map((choice, i) => {
                    let state: "default" | "correct" | "wrong" = "default";
                    if (phase === "revealed") {
                      if (i === problem.correct_index) state = "correct";
                      else if (i === selectedChoice) state = "wrong";
                    }
                    return (
                      <button
                        key={i}
                        disabled={phase === "revealed"}
                        onClick={() => handleAnswer(i)}
                        className={cn(
                          "w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-colors",
                          state === "default" &&
                            phase === "practicing" &&
                            "bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50",
                          state === "default" &&
                            phase === "revealed" &&
                            "bg-white border-gray-200 opacity-50",
                          state === "correct" && "bg-green-50 border-green-400",
                          state === "wrong" && "bg-red-50 border-red-400",
                          phase === "revealed" && "cursor-default"
                        )}
                      >
                        <span
                          className={cn(
                            "flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold mt-0.5",
                            state === "default" && "border-gray-300 text-gray-500",
                            state === "correct" && "bg-green-500 border-green-500 text-white",
                            state === "wrong" && "bg-red-500 border-red-500 text-white"
                          )}
                        >
                          {state === "correct" ? "✓" : state === "wrong" ? "✗" : CHOICE_LABELS[i]}
                        </span>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <Preview latexContent={choice} />
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* "I don't know this" */}
                {phase === "practicing" && (
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleDontKnow}
                      className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2 transition-colors"
                    >
                      I don&apos;t know this
                    </button>
                  </div>
                )}

                {/* Revealed: solution + actions */}
                {phase === "revealed" && (
                  <>
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Solution
                        </h3>
                      </div>
                      <div className="p-5">
                        <Preview latexContent={problem.solution_latex} />
                      </div>

                      {/* Countdown bar */}
                      <div className="h-1 bg-gray-100 w-full">
                        <div
                          className={cn(
                            "h-1 transition-none",
                            selectedChoice === problem.correct_index
                              ? "bg-green-500"
                              : "bg-orange-400"
                          )}
                          style={{ width: `${countdownProgress * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setCountdownPaused(true);
                          loadRefresher(currentKeyword.id);
                        }}
                        className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2 transition-colors"
                      >
                        Quick refresher
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          // Cancel countdown and advance immediately
                          if (countdownRafRef.current !== null) {
                            cancelAnimationFrame(countdownRafRef.current);
                            countdownRafRef.current = null;
                          }
                          handleNext();
                        }}
                        className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                      >
                        {consecutiveCorrect >= 2
                          ? queueIndex + 1 >= queue.length
                            ? "Finish →"
                            : "Next keyword →"
                          : "Next →"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ── Lesson ── */}
        {phase === "lesson" && currentKeyword && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">
                Lesson: {currentKeyword.label}
              </h2>
              <button
                type="button"
                onClick={handleSkipLesson}
                className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2 transition-colors"
              >
                Skip lesson
              </button>
            </div>

            {lessonLoading && (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-gray-400 animate-pulse">
                  Generating lesson… (this may take a few seconds)
                </p>
              </div>
            )}

            {lesson && lesson.micro_steps.length > 0 && (() => {
              const step = lesson.micro_steps[lessonStepIdx]!;
              const isCorrect =
                lessonCheckAnswer !== null &&
                lessonCheckAnswer === step.check_question.correct_index;
              const isWrong =
                lessonCheckAnswer !== null &&
                lessonCheckAnswer !== step.check_question.correct_index;

              return (
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-5 min-w-0 overflow-hidden">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                    Step {lessonStepIdx + 1} of {lesson.micro_steps.length}
                  </p>

                  {/* Explanation */}
                  <div className="min-w-0 overflow-x-hidden">
                    <Preview latexContent={step.explanation_latex} />
                  </div>

                  {/* Example */}
                  {step.example_latex && (
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-100 min-w-0 overflow-x-hidden">
                      <p className="text-xs text-gray-500 font-medium mb-2">Example</p>
                      <Preview latexContent={step.example_latex} />
                    </div>
                  )}

                  {/* Check question (only when has_check !== false and there are real choices) */}
                  {step.has_check !== false && step.check_question.choices.some((c) => c.trim() !== "") && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-gray-700">Check your understanding:</p>
                    <div className="mb-2">
                      <Preview latexContent={step.check_question.latex_content ?? step.check_question.question_latex ?? ""} />
                    </div>
                    <div className="space-y-2">
                      {step.check_question.choices.map((choice, i) => {
                        let state: "default" | "correct" | "wrong" = "default";
                        if (lessonCheckAnswer !== null) {
                          if (i === step.check_question.correct_index) state = "correct";
                          else if (i === lessonCheckAnswer) state = "wrong";
                        }
                        return (
                          <button
                            key={i}
                            disabled={lessonCheckAnswer !== null}
                            onClick={() => handleLessonCheckAnswer(i)}
                            className={cn(
                              "w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-colors",
                              state === "default" &&
                                lessonCheckAnswer === null &&
                                "bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50",
                              state === "default" &&
                                lessonCheckAnswer !== null &&
                                "bg-white border-gray-200 opacity-50",
                              state === "correct" && "bg-green-50 border-green-400",
                              state === "wrong" && "bg-red-50 border-red-400",
                              lessonCheckAnswer !== null && "cursor-default"
                            )}
                          >
                            <span
                              className={cn(
                                "flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold mt-0.5",
                                state === "default" && "border-gray-300 text-gray-500",
                                state === "correct" && "bg-green-500 border-green-500 text-white",
                                state === "wrong" && "bg-red-500 border-red-500 text-white"
                              )}
                            >
                              {state === "correct" ? "✓" : state === "wrong" ? "✗" : CHOICE_LABELS[i]}
                            </span>
                            <div className="flex-1 min-w-0 pt-0.5">
                              <Preview latexContent={choice} />
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Hint on wrong */}
                    {isWrong && lessonShowHint && step.hint_latex && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
                        <p className="text-xs font-semibold text-amber-700">Hint</p>
                        <Preview latexContent={step.hint_latex} />
                        <button
                          type="button"
                          onClick={handleLessonTryAgain}
                          className="text-sm text-amber-700 hover:text-amber-900 underline underline-offset-2 transition-colors font-medium"
                        >
                          Try again
                        </button>
                      </div>
                    )}

                    {/* Correct → Next step */}
                    {isCorrect && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-green-600 font-medium">Correct!</span>
                        <button
                          type="button"
                          onClick={handleLessonNext}
                          className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                        >
                          {lessonStepIdx + 1 >= lesson.micro_steps.length
                            ? "Back to practice →"
                            : "Next →"}
                        </button>
                      </div>
                    )}
                  </div>
                  )}

                  {/* For non-check steps: countdown bar + Next button */}
                  {(step.has_check === false || !step.check_question.choices.some((c) => c.trim() !== "")) && (
                    <>
                      {/* Lesson countdown bar */}
                      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-1 bg-blue-400 transition-none"
                          style={{ width: `${lessonCountdownProgress * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            if (lessonCountdownRafRef.current !== null) {
                              cancelAnimationFrame(lessonCountdownRafRef.current);
                              lessonCountdownRafRef.current = null;
                            }
                            handleLessonNext();
                          }}
                          className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                        >
                          {lessonStepIdx + 1 >= lesson.micro_steps.length
                            ? "Back to practice →"
                            : "Next →"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Refresher ── */}
        {phase === "refresher" && currentKeyword && (
          <div className="space-y-5">
            <h2 className="text-base font-semibold text-gray-800">
              Quick Refresher: {currentKeyword.label}
            </h2>

            {refresherLoading && (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-gray-400 animate-pulse">
                  Loading refresher…
                </p>
              </div>
            )}

            {refresher && (
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-5">
                {/* Rule */}
                <div>
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Rule</p>
                  <Preview latexContent={refresher.rule_latex} />
                </div>

                {/* Example */}
                {refresher.example_latex && (
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                    <p className="text-xs text-gray-500 font-medium mb-2">Example</p>
                    <Preview latexContent={refresher.example_latex} />
                  </div>
                )}

                {/* Check question */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-gray-700">Check:</p>
                  <div className="mb-2">
                    <Preview latexContent={refresher.check_question.latex_content ?? refresher.check_question.question_latex ?? ""} />
                  </div>
                  <div className="space-y-2">
                    {refresher.check_question.choices.map((choice, i) => {
                      let state: "default" | "correct" | "wrong" = "default";
                      if (refresherAnswer !== null) {
                        if (i === refresher.check_question.correct_index) state = "correct";
                        else if (i === refresherAnswer) state = "wrong";
                      }
                      return (
                        <button
                          key={i}
                          disabled={refresherAnswer !== null}
                          onClick={() => handleRefresherAnswer(i)}
                          className={cn(
                            "w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-colors",
                            state === "default" &&
                              refresherAnswer === null &&
                              "bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50",
                            state === "default" &&
                              refresherAnswer !== null &&
                              "bg-white border-gray-200 opacity-50",
                            state === "correct" && "bg-green-50 border-green-400",
                            state === "wrong" && "bg-red-50 border-red-400",
                            refresherAnswer !== null && "cursor-default"
                          )}
                        >
                          <span
                            className={cn(
                              "flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold mt-0.5",
                              state === "default" && "border-gray-300 text-gray-500",
                              state === "correct" && "bg-green-500 border-green-500 text-white",
                              state === "wrong" && "bg-red-500 border-red-500 text-white"
                            )}
                          >
                            {state === "correct" ? "✓" : state === "wrong" ? "✗" : CHOICE_LABELS[i]}
                          </span>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <Preview latexContent={choice} />
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {refresherAnswer !== null && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleRefresherDone}
                        className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                      >
                        Back to practice →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Done ── */}
        {phase === "done" && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 shadow-sm text-center space-y-5">
            <div className="text-5xl">🎉</div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Great session!</h1>
              <p className="text-sm text-gray-500 mt-1">
                You worked through {queue.length} Polynomials skill{queue.length !== 1 ? "s" : ""}.
              </p>
            </div>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => router.push("/progress")}
                className="w-full px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
              >
                Here&apos;s your updated Polynomials report →
              </button>
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="w-full px-6 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-sm font-medium transition-colors"
              >
                Restart diagnostic
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
