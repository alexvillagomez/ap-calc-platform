"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Preview } from "@/components/Preview";
import { DiagnosticQuestionView } from "./components/DiagnosticQuestion";
import { DiagnosticResults } from "./components/DiagnosticResults";
import { FeedbackButtons } from "./components/FeedbackButtons";
import {
  applyAnswerToScores,
  computeRoute,
  DIAGNOSTIC_MIN_QUESTIONS,
  DIAGNOSTIC_MAX_QUESTIONS,
  allKeywordsConfident,
} from "@/lib/diagnosticScoring";
import type {
  Answer,
  DiagnosticResult,
  DiagnosticRoute,
  KeywordScores,
} from "@/lib/diagnosticScoring";
import { cn } from "@/lib/cn";

const SESSION_KEY = "ap_calc_student_session_id";
const LABELS = ["A", "B", "C", "D"];

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | "loading" | "error"
  | "diagnostic" | "results"
  | "lesson_queue"
  | "lesson_loading" | "lesson"
  | "refresher_loading" | "refresher"
  | "quiz_loading" | "mastery_quiz" | "quiz_done";

type StepPhase = "read" | "question" | "correct" | "wrong";

type CheckQuestion = {
  latex_content: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
};

type MicroStep = {
  step_index: number;
  explanation_latex: string;
  example_latex: string;
  check_question: CheckQuestion;
  hint_latex: string;
};

type RefresherData = {
  keyword_id: string;
  rule_latex: string;
  example_latex: string;
  check_question: CheckQuestion;
};

type QuizProblem = {
  id: string;
  latex_content: string;
  choices: string[];
  correct_index: number;
  difficulty: number;
  solution_latex: string;
};

type DBQuestion = {
  id: string;
  latex_content: string;
  choices: string[];
  correct_index: number;
  difficulty: number;
  umbrella_keywords: Record<string, number>;
  in_depth_keywords: Record<string, number>;
};

type LessonQueueItem = {
  keyword_id: string;
  keyword_label: string;
  in_depth_score: number;
  state: string;
  status: "pending" | "in_progress" | "completed";
};

// ─── Component ───────────────────────────────────────────────────────────────

function LearnPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const TOPIC_ID = searchParams.get("topic") ?? "exponent_rules";
  const keywordParam = searchParams.get("keyword");
  const sessionId = typeof window !== "undefined" ? (localStorage.getItem(SESSION_KEY) ?? "") : "";

  // ── Core diagnostic state ──
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState<DBQuestion | null>(null);
  const [fetchingNext, setFetchingNext] = useState(false);
  const [answers, setAnswers] = useState<(Answer & { problem_id: string })[]>([]);
  const [umbrellaScores, setUmbrellaScores] = useState<KeywordScores>({});
  const [inDepthScores, setInDepthScores] = useState<KeywordScores>({});
  const [diagnosticResult, setDiagnosticResult] = useState<DiagnosticResult | null>(null);
  const [targetKeyword, setTargetKeyword] = useState("");
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  // ── Lesson queue state ──
  const [lessonQueue, setLessonQueue] = useState<LessonQueueItem[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [completedKeywords, setCompletedKeywords] = useState<Set<string>>(new Set());
  const [xpTotal, setXpTotal] = useState(0);
  const [showXpAnimation, setShowXpAnimation] = useState(false);
  const [isStartAll, setIsStartAll] = useState(false);
  const [lessonQueueLoaded, setLessonQueueLoaded] = useState(false);

  // ── Lesson state ──
  const [lessonSteps, setLessonSteps] = useState<MicroStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepPhase, setStepPhase] = useState<StepPhase>("read");
  const [showHint, setShowHint] = useState(false);
  const [lessonFeedbackShown, setLessonFeedbackShown] = useState(false);

  // ── Refresher state ──
  const [refresherData, setRefresherData] = useState<RefresherData | null>(null);
  const [refresherPhase, setRefresherPhase] = useState<StepPhase>("read");
  const [refresherShowHint, setRefresherShowHint] = useState(false);
  const [refresherFeedbackShown, setRefresherFeedbackShown] = useState(false);

  // ── Mastery quiz state ──
  const [quizProblems, setQuizProblems] = useState<QuizProblem[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<boolean[]>([]);
  const [quizSelectedIndex, setQuizSelectedIndex] = useState<number | null>(null);

  // ─── On mount: check for existing keyword states, skip diagnostic if found ──

  useEffect(() => {
    if (!sessionId) {
      startFreshDiagnostic();
      return;
    }
    fetch(`/api/learn/keyword-states?topic=${encodeURIComponent(TOPIC_ID)}&sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((data: { hasData?: boolean }) => {
        if (data.hasData) {
          // Existing data — skip diagnostic, load lesson queue directly
          setPhase("lesson_queue");
          loadLessonQueue();
        } else {
          startFreshDiagnostic();
        }
      })
      .catch(() => startFreshDiagnostic());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TOPIC_ID]);

  function startFreshDiagnostic() {
    fetch("/api/learn/diagnostic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic_id: TOPIC_ID, answeredIds: [], keywordScores: {} }),
    })
      .then((r) => r.json())
      .then((data: { problem?: DBQuestion; error?: string }) => {
        if (data.error || !data.problem) {
          setErrorMsg(data.error ?? "No diagnostic problems found — run the seed script first.");
          setPhase("error");
          return;
        }
        setCurrentQuestion(data.problem);
        setPhase("diagnostic");
      })
      .catch(() => { setErrorMsg("Failed to load diagnostic"); setPhase("error"); });
  }

  async function loadLessonQueue() {
    try {
      const res = await fetch("/api/learn/lesson-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, topic_id: TOPIC_ID }),
      });
      const data = await res.json() as { queue?: LessonQueueItem[] };
      setLessonQueue(data.queue ?? []);
      setLessonQueueLoaded(true);
    } catch {
      setLessonQueue([]);
      setLessonQueueLoaded(true);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function fetchAndStartLesson(kw: string) {
    setPhase("lesson_loading");
    try {
      const res = await fetch(`/api/learn/lesson/${kw}`);
      const data = await res.json() as { micro_steps?: MicroStep[]; error?: string };
      if (!res.ok || !data.micro_steps?.length) throw new Error(data.error ?? "No lesson");
      setLessonSteps(data.micro_steps);
      setStepIndex(0);
      setStepPhase("read");
      setShowHint(false);
      setLessonFeedbackShown(false);
      setPhase("lesson");
    } catch {
      setErrorMsg("Could not load lesson — please try again.");
      setPhase("error");
    }
  }

  async function fetchAndStartRefresher(kw: string) {
    setPhase("refresher_loading");
    try {
      const res = await fetch(`/api/learn/refresher/${kw}`);
      const data = await res.json() as RefresherData & { error?: string };
      if (!res.ok || !data.rule_latex) throw new Error(data.error ?? "No refresher");
      setRefresherData(data);
      setRefresherPhase("read");
      setRefresherShowHint(false);
      setRefresherFeedbackShown(false);
      setPhase("refresher");
    } catch {
      setErrorMsg("Could not load refresher — please try again.");
      setPhase("error");
    }
  }

  async function fetchAndStartQuiz(kw: string) {
    setPhase("quiz_loading");
    try {
      const res = await fetch(`/api/learn/mastery-quiz/${kw}`);
      const data = await res.json() as { problems?: QuizProblem[]; error?: string };
      if (!res.ok || !data.problems?.length) throw new Error(data.error ?? "No quiz");
      setQuizProblems(data.problems);
      setQuizIndex(0);
      setQuizAnswers([]);
      setQuizSelectedIndex(null);
      setPhase("mastery_quiz");
    } catch {
      // If quiz fails, go straight to practice
      router.push(`/learn/practice?keyword=${targetKeyword}&topic=${TOPIC_ID}`);
    }
  }

  // ─── Flag handler ─────────────────────────────────────────────────────────

  async function handleFlagQuestion(problemId: string) {
    if (flaggedIds.has(problemId)) return;
    setFlaggedIds(prev => new Set([...prev, problemId]));
    try {
      await fetch("/api/record-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, problemId, selectedIndex: 0, correct: false, flagged: true }),
      });
    } catch {}
  }

  // ─── Diagnostic handlers ───────────────────────────────────────────────────

  async function finalizeDiagnostic(
    nextAnswers: (Answer & { problem_id: string })[],
    newU: KeywordScores,
    newI: KeywordScores
  ) {
    const result = computeRoute(nextAnswers, newU, newI);
    setDiagnosticResult(result);
    if (sessionId) {
      fetch("/api/learn/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, topic_id: TOPIC_ID, answers: nextAnswers }),
      }).catch(() => {});
    }
    setPhase("results");
  }

  async function recordDiagnosticAnswer(answer: Answer & { problem_id: string }) {
    const q = currentQuestion!;
    const { umbrellaScores: newU, inDepthScores: newI } = applyAnswerToScores(
      umbrellaScores, inDepthScores, q.umbrella_keywords, q.in_depth_keywords, answer
    );
    const nextAnswers = [...answers, answer];
    setUmbrellaScores(newU);
    setInDepthScores(newI);
    setAnswers(nextAnswers);

    // Check stopping condition
    const shouldStop =
      nextAnswers.length >= DIAGNOSTIC_MIN_QUESTIONS &&
      (nextAnswers.length >= DIAGNOSTIC_MAX_QUESTIONS ||
        allKeywordsConfident(newI, Object.keys(newI)));

    if (shouldStop) {
      await finalizeDiagnostic(nextAnswers, newU, newI);
      return;
    }

    // Fetch next question
    setFetchingNext(true);
    try {
      const answeredIds = nextAnswers.map((a) => a.problem_id);
      const res = await fetch("/api/learn/diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: TOPIC_ID, answeredIds, keywordScores: newI }),
      });
      const data = await res.json() as { problem?: DBQuestion; error?: string };
      if (!data.problem) {
        // No more questions — finalize
        await finalizeDiagnostic(nextAnswers, newU, newI);
        return;
      }
      setCurrentQuestion(data.problem);
    } catch {
      // On fetch error, finalize with what we have
      await finalizeDiagnostic(nextAnswers, newU, newI);
    } finally {
      setFetchingNext(false);
    }
  }

  function handleDiagnosticMCQ(idx: number) {
    const q = currentQuestion!;
    void recordDiagnosticAnswer({ questionId: q.id, problem_id: q.id, selectedIndex: idx, flaggedForgotten: false, flaggedNeverSeen: false, correct: idx === q.correct_index });
  }
  function handleDiagnosticForgotten() {
    const q = currentQuestion!;
    void recordDiagnosticAnswer({ questionId: q.id, problem_id: q.id, selectedIndex: null, flaggedForgotten: true, flaggedNeverSeen: false, correct: false });
  }
  function handleDiagnosticNeverSeen() {
    const q = currentQuestion!;
    void recordDiagnosticAnswer({ questionId: q.id, problem_id: q.id, selectedIndex: null, flaggedForgotten: false, flaggedNeverSeen: true, correct: null });
  }

  // ─── Results → routing ─────────────────────────────────────────────────────

  async function handleContinueFromResults(route: DiagnosticRoute) {
    const kw = diagnosticResult?.weakestSkills[0] ?? "product_of_powers";
    setTargetKeyword(kw);

    if (route === "skip") { router.push("/precalc/practice"); return; }

    // Route to lesson_queue for all non-skip routes
    setPhase("lesson_queue");
    if (!lessonQueueLoaded) {
      await loadLessonQueue();
    }
  }

  // ─── Lesson queue handlers ─────────────────────────────────────────────────

  async function startLessonFromQueue(keywordId: string) {
    setTargetKeyword(keywordId);
    await fetchAndStartLesson(keywordId);
  }

  async function startAllLessons() {
    setIsStartAll(true);
    const first = lessonQueue.find(item => item.status !== "completed");
    if (first) {
      setCurrentQueueIndex(lessonQueue.indexOf(first));
      setTargetKeyword(first.keyword_id);
      await fetchAndStartLesson(first.keyword_id);
    }
  }

  // ─── Lesson handlers ───────────────────────────────────────────────────────

  function handleLessonStepAnswer(idx: number) {
    const step = lessonSteps[stepIndex]!;
    setStepPhase(idx === step.check_question.correct_index ? "correct" : "wrong");
    setShowHint(false);
  }

  function handleLessonNext() {
    const nextIdx = stepIndex + 1;
    if (nextIdx >= lessonSteps.length) {
      // Save progress then handle queue or go to quiz
      if (sessionId) {
        fetch("/api/learn/lesson/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, keyword_id: targetKeyword, current_step: nextIdx, completed: true }),
        }).catch(() => {});
      }

      // Mark keyword complete in queue
      setCompletedKeywords(prev => new Set([...prev, targetKeyword]));
      // Trigger XP animation
      setXpTotal(prev => prev + 10);
      setShowXpAnimation(true);
      setTimeout(() => setShowXpAnimation(false), 1500);
      // Fire-and-forget queue completion
      fetch(`/api/learn/lesson-queue/${targetKeyword}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, topic_id: TOPIC_ID }),
      }).catch(() => {});

      if (isStartAll) {
        // Find next incomplete lesson in queue
        const nextQueueIdx = lessonQueue.findIndex(
          (item, i) =>
            i > currentQueueIndex &&
            !completedKeywords.has(item.keyword_id) &&
            item.status !== "completed"
        );
        if (nextQueueIdx !== -1) {
          setCurrentQueueIndex(nextQueueIdx);
          setTargetKeyword(lessonQueue[nextQueueIdx]!.keyword_id);
          void fetchAndStartLesson(lessonQueue[nextQueueIdx]!.keyword_id);
          return; // Don't go to quiz, go to next lesson
        }
      }
      void fetchAndStartQuiz(targetKeyword);
    } else {
      setStepIndex(nextIdx);
      setStepPhase("read");
      setShowHint(false);
    }
  }

  // ─── Refresher handlers ────────────────────────────────────────────────────

  function handleRefresherAnswer(idx: number) {
    if (!refresherData) return;
    setRefresherPhase(idx === refresherData.check_question.correct_index ? "correct" : "wrong");
    setRefresherShowHint(false);
  }

  // ─── Mastery quiz handlers ─────────────────────────────────────────────────

  function handleQuizAnswer(idx: number) {
    const prob = quizProblems[quizIndex]!;
    const correct = idx === prob.correct_index;
    setQuizSelectedIndex(idx);
    // Brief reveal then advance
    setTimeout(() => {
      const newAnswers = [...quizAnswers, correct];
      setQuizAnswers(newAnswers);
      setQuizSelectedIndex(null);
      if (quizIndex + 1 >= quizProblems.length) {
        // Grade
        const passed = newAnswers.filter(Boolean).length / newAnswers.length >= 1.0;
        if (sessionId) {
          fetch("/api/learn/mastery-quiz/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              keyword_id: targetKeyword,
              topic_id: TOPIC_ID,
              answers: quizProblems.map((p, i) => ({ problem_id: p.id, correct: newAnswers[i] ?? false })),
            }),
          }).catch(() => {});
        }
        setQuizAnswers(newAnswers);
        setPhase("quiz_done");
      } else {
        setQuizIndex((i) => i + 1);
      }
    }, 800);
  }

  // ─── Shared UI helpers ─────────────────────────────────────────────────────

  function PageShell({ children }: { children: React.ReactNode }) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col px-4 py-10 overflow-x-hidden">
        <div className="max-w-2xl mx-auto w-full space-y-4">{children}</div>
      </div>
    );
  }

  function ProgressBar({ current, total, label, topicLabel }: { current: number; total: number; label: string; topicLabel?: string }) {
    return (
      <div className="w-full mb-2">
        {topicLabel && (
          <div className="mb-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              {topicLabel}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-500">{label}</span>
          <button onClick={() => router.push("/")} className="text-xs text-gray-400 hover:text-gray-600">← Exit</button>
        </div>
        <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${(current / total) * 100}%` }} />
        </div>
      </div>
    );
  }

  function PreviewCard({ label, latex, colorClass = "bg-white border-gray-100" }: { label: string; latex: string; colorClass?: string }) {
    return (
      <div className={`rounded-2xl border shadow-sm p-5 space-y-3 ${colorClass}`}>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
        <div className="ap-calc-preview text-sm leading-relaxed min-w-0 overflow-x-hidden">
          <Preview latexContent={latex} />
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (phase === "loading" || phase === "lesson_loading" || phase === "refresher_loading" || phase === "quiz_loading") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">
          {phase === "lesson_loading" ? "Loading lesson…" :
           phase === "refresher_loading" ? "Loading refresher…" :
           phase === "quiz_loading" ? "Loading quiz…" : "Loading…"}
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-3">
          <p className="text-sm text-red-600">{errorMsg}</p>
          <button onClick={() => router.push("/")} className="text-sm text-blue-600 underline">Go home</button>
        </div>
      </div>
    );
  }

  // ── Diagnostic ──
  if (phase === "diagnostic") {
    if (fetchingNext) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <p className="text-sm text-gray-400">Loading next question…</p>
        </div>
      );
    }
    if (!currentQuestion) return null;
    const q = currentQuestion;
    return (
      <DiagnosticQuestionView
        question={{ id: q.id, latex_content: q.latex_content, solution_latex: "", choices: q.choices, correct_index: q.correct_index, umbrella_keywords: q.umbrella_keywords, in_depth_keywords: q.in_depth_keywords, diagnostic_purpose: "" }}
        questionNumber={answers.length + 1}
        totalQuestions={DIAGNOSTIC_MAX_QUESTIONS}
        onAnswer={handleDiagnosticMCQ}
        onForgotten={handleDiagnosticForgotten}
        onNeverSeen={handleDiagnosticNeverSeen}
        onFlag={() => handleFlagQuestion(q.id)}
        flagged={flaggedIds.has(q.id)}
      />
    );
  }

  // ── Results ──
  if (phase === "results" && diagnosticResult) {
    return (
      <DiagnosticResults
        result={diagnosticResult}
        onContinue={handleContinueFromResults}
        onSkipToPractice={() => router.push("/precalc/practice")}
      />
    );
  }

  // ── Lesson queue ──
  if (phase === "lesson_queue") {
    return (
      <PageShell>
        {/* Overall progress */}
        <div className="w-full mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Your Learning Plan
            </span>
            <button onClick={() => router.push("/precalc")} className="text-xs text-gray-400 hover:text-gray-600">← Back</button>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: lessonQueue.length > 0 ? `${(completedKeywords.size / lessonQueue.length) * 100}%` : "0%" }}
              />
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">{completedKeywords.size} / {lessonQueue.length} completed</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-600 font-semibold">{xpTotal} XP</span>
          </div>
        </div>

        {/* XP animation overlay */}
        {showXpAnimation && (
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50">
            <div className="xp-float text-2xl font-bold text-green-500">+10 XP</div>
          </div>
        )}

        {!lessonQueueLoaded ? (
          <p className="text-sm text-gray-400">Loading your lessons…</p>
        ) : lessonQueue.length === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
            <div className="text-3xl mb-2">🎉</div>
            <p className="font-semibold text-green-800">You already know this material well!</p>
            <button onClick={() => router.push("/precalc/practice")} className="mt-4 w-full bg-blue-600 text-white text-sm font-medium py-3 rounded-xl">
              Go practice →
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {lessonQueue.map((item) => {
                const done = completedKeywords.has(item.keyword_id) || item.status === "completed";
                return (
                  <div
                    key={item.keyword_id}
                    className={cn(
                      "bg-white border rounded-2xl p-4 flex items-center gap-4 transition-all",
                      done ? "border-green-200 opacity-60" : "border-gray-200 hover:border-blue-300"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium", done ? "text-green-700 line-through" : "text-gray-900")}>
                        {item.keyword_label}
                      </p>
                      <div className="mt-1 h-1 w-24 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round(item.in_depth_score * 100)}%`,
                            backgroundColor: item.in_depth_score < 0.4 ? "#ef4444" : item.in_depth_score < 0.65 ? "#f59e0b" : "#22c55e"
                          }}
                        />
                      </div>
                    </div>
                    {done ? (
                      <span className="text-green-500 text-lg">✓</span>
                    ) : (
                      <button
                        onClick={() => startLessonFromQueue(item.keyword_id)}
                        className="text-xs font-medium bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        Start
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {lessonQueue.some(item => !completedKeywords.has(item.keyword_id) && item.status !== "completed") && (
              <button
                onClick={startAllLessons}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-3 rounded-xl transition-colors mt-2"
              >
                Start All Lessons →
              </button>
            )}

            {lessonQueue.every(item => completedKeywords.has(item.keyword_id) || item.status === "completed") && (
              <button
                onClick={() => router.push("/precalc/practice")}
                className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-3 rounded-xl transition-colors mt-2"
              >
                All done! Start practice →
              </button>
            )}
          </>
        )}

        <div className="text-center pt-2">
          <button
            onClick={() => {
              setAnswers([]);
              setUmbrellaScores({});
              setInDepthScores({});
              setDiagnosticResult(null);
              setLessonQueueLoaded(false);
              startFreshDiagnostic();
            }}
            className="text-xs text-gray-400 hover:text-gray-500 underline underline-offset-2"
          >
            Re-take diagnostic
          </button>
        </div>
      </PageShell>
    );
  }

  // ── Shared: derive human-readable label for the current keyword ──
  const keywordLabel = lessonQueue.find(item => item.keyword_id === targetKeyword)?.keyword_label
    ?? targetKeyword.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  // ── Lesson ──
  if (phase === "lesson" && lessonSteps.length > 0) {
    const step = lessonSteps[stepIndex]!;
    const totalSteps = lessonSteps.length;

    if (stepPhase === "question") {
      return (
        <DiagnosticQuestionView
          question={{ id: `step_${stepIndex}`, latex_content: step.check_question.latex_content, solution_latex: step.check_question.solution_latex, choices: step.check_question.choices, correct_index: step.check_question.correct_index, umbrella_keywords: {}, in_depth_keywords: {}, diagnostic_purpose: "" }}
          questionNumber={stepIndex + 1}
          totalQuestions={totalSteps}
          onAnswer={handleLessonStepAnswer}
          onForgotten={() => { setStepPhase("wrong"); setShowHint(true); }}
          onNeverSeen={() => { setStepPhase("wrong"); setShowHint(true); }}
        />
      );
    }

    // After answering: show the question + result instead of explanation + example
    const showingResult = stepPhase === "correct" || stepPhase === "wrong";

    return (
      <PageShell>
        <ProgressBar current={stepIndex} total={totalSteps} label={`Step ${stepIndex + 1} of ${totalSteps}`} topicLabel={keywordLabel} />

        {!showingResult && (
          <>
            <PreviewCard label="Explanation" latex={step.explanation_latex} colorClass="bg-white border-gray-100" />
            <PreviewCard label="Example" latex={step.example_latex} colorClass="bg-gray-50 border-gray-200" />
          </>
        )}

        {showingResult && (
          <PreviewCard label="Question" latex={step.check_question.latex_content} colorClass="bg-white border-gray-100" />
        )}

        {stepPhase === "correct" && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-green-800">✓ Correct!</p>
            <div className="ap-calc-preview text-sm text-green-700 min-w-0">
              <Preview latexContent={step.check_question.solution_latex} />
            </div>
            {!lessonFeedbackShown && (
              <div className="pt-1 border-t border-green-100">
                <FeedbackButtons sessionId={sessionId} contentType="lesson" keywordId={targetKeyword} />
              </div>
            )}
          </div>
        )}

        {stepPhase === "wrong" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-red-800">Not quite.</p>
            {showHint
              ? <div className="ap-calc-preview text-sm text-red-700 min-w-0"><Preview latexContent={step.hint_latex} /></div>
              : <button onClick={() => setShowHint(true)} className="text-xs text-red-600 underline">Show hint</button>
            }
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {stepPhase === "read" && (
            <button onClick={() => setStepPhase("question")} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors">
              Try a question →
            </button>
          )}
          {stepPhase === "correct" && (
            <button onClick={handleLessonNext} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors">
              {stepIndex + 1 >= totalSteps ? "Take mastery quiz →" : "Next step →"}
            </button>
          )}
          {stepPhase === "wrong" && (
            <>
              <button onClick={() => { setStepPhase("question"); setShowHint(false); }} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors">
                Try again
              </button>
              <button onClick={handleLessonNext} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium py-3 rounded-xl transition-colors">
                {stepIndex + 1 >= totalSteps ? "Continue to quiz →" : "Move on →"}
              </button>
            </>
          )}
        </div>
      </PageShell>
    );
  }

  // ── Refresher ──
  if (phase === "refresher" && refresherData) {
    if (refresherPhase === "question") {
      return (
        <DiagnosticQuestionView
          question={{ id: "refresher_check", latex_content: refresherData.check_question.latex_content, solution_latex: refresherData.check_question.solution_latex, choices: refresherData.check_question.choices, correct_index: refresherData.check_question.correct_index, umbrella_keywords: {}, in_depth_keywords: {}, diagnostic_purpose: "" }}
          questionNumber={1}
          totalQuestions={1}
          onAnswer={handleRefresherAnswer}
          onForgotten={() => { setRefresherPhase("wrong"); setRefresherShowHint(true); }}
          onNeverSeen={() => { setRefresherPhase("wrong"); setRefresherShowHint(true); }}
        />
      );
    }

    const refresherShowingResult = refresherPhase === "correct" || refresherPhase === "wrong";

    return (
      <PageShell>
        <ProgressBar current={refresherShowingResult ? 1 : 0} total={1} label="Quick Refresher" topicLabel={keywordLabel} />

        {!refresherShowingResult && (
          <>
            <PreviewCard label="Rule" latex={refresherData.rule_latex} colorClass="bg-white border-gray-100" />
            <PreviewCard label="Example" latex={refresherData.example_latex} colorClass="bg-gray-50 border-gray-200" />
          </>
        )}

        {refresherShowingResult && (
          <PreviewCard label="Question" latex={refresherData.check_question.latex_content} colorClass="bg-white border-gray-100" />
        )}

        {refresherPhase === "correct" && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-green-800">✓ Correct!</p>
            <div className="ap-calc-preview text-sm text-green-700 min-w-0 overflow-x-hidden">
              <Preview latexContent={refresherData.check_question.solution_latex} />
            </div>
            {!refresherFeedbackShown && (
              <div className="pt-1 border-t border-green-100">
                <FeedbackButtons sessionId={sessionId} contentType="refresher" keywordId={targetKeyword} />
              </div>
            )}
          </div>
        )}

        {refresherPhase === "wrong" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-red-800">Not quite — review the rule above and try again.</p>
            {refresherShowHint && (
              <div className="ap-calc-preview text-sm text-red-700 min-w-0 overflow-x-hidden">
                <Preview latexContent={refresherData.check_question.solution_latex} />
              </div>
            )}
            {!refresherShowHint && (
              <button onClick={() => setRefresherShowHint(true)} className="text-xs text-red-600 underline">Show solution</button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {refresherPhase === "read" && (
            <button onClick={() => setRefresherPhase("question")} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors">
              Got it — test me →
            </button>
          )}
          {(refresherPhase === "correct" || refresherPhase === "wrong") && (
            <>
              {refresherPhase === "wrong" && (
                <button onClick={() => { setRefresherPhase("question"); setRefresherShowHint(false); }} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors">
                  Try again
                </button>
              )}
              <button onClick={() => void fetchAndStartQuiz(targetKeyword)} className={cn("w-full text-sm font-medium py-3 rounded-xl transition-colors", refresherPhase === "correct" ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-700")}>
                Continue to quiz →
              </button>
            </>
          )}
        </div>
      </PageShell>
    );
  }

  // ── Mastery quiz ──
  if (phase === "mastery_quiz" && quizProblems.length > 0) {
    const prob = quizProblems[quizIndex]!;
    return (
      <PageShell>
        <ProgressBar current={quizIndex} total={quizProblems.length} label={`Mastery Quiz — Question ${quizIndex + 1} of ${quizProblems.length}`} topicLabel={keywordLabel} />

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="ap-calc-preview text-sm leading-relaxed min-w-0 overflow-x-hidden">
            <Preview latexContent={prob.latex_content} />
          </div>
          <div className="space-y-2">
            {prob.choices.map((choice, i) => {
              const isSelected = quizSelectedIndex === i;
              const isCorrect = i === prob.correct_index;
              const revealed = quizSelectedIndex !== null;
              return (
                <button
                  key={i}
                  onClick={() => !revealed && handleQuizAnswer(i)}
                  disabled={revealed}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm transition-colors",
                    !revealed && "border-gray-200 hover:border-blue-400 hover:bg-blue-50",
                    revealed && isCorrect && "border-green-400 bg-green-50",
                    revealed && isSelected && !isCorrect && "border-red-400 bg-red-50",
                    revealed && !isSelected && !isCorrect && "border-gray-100 bg-gray-50 opacity-50",
                  )}
                >
                  <span className={cn(
                    "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold",
                    !revealed && "bg-gray-100 text-gray-600",
                    revealed && isCorrect && "bg-green-500 text-white",
                    revealed && isSelected && !isCorrect && "bg-red-500 text-white",
                    revealed && !isSelected && !isCorrect && "bg-gray-200 text-gray-400",
                  )}>
                    {revealed && isCorrect ? "✓" : revealed && isSelected && !isCorrect ? "✗" : LABELS[i]}
                  </span>
                  <span className="ap-calc-preview flex-1 min-w-0 overflow-x-hidden">
                    <Preview latexContent={choice} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </PageShell>
    );
  }

  // ── Quiz done ──
  if (phase === "quiz_done") {
    const correct = quizAnswers.filter(Boolean).length;
    const total = quizAnswers.length;
    const passed = correct / total >= 1.0;

    // If in start-all mode and there are more incomplete items, show "Keep going!"
    const nextIncompleteInQueue = isStartAll
      ? lessonQueue.findIndex(
          (item, i) =>
            i > currentQueueIndex &&
            !completedKeywords.has(item.keyword_id) &&
            item.status !== "completed"
        )
      : -1;

    if (isStartAll && nextIncompleteInQueue !== -1) {
      return (
        <PageShell>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center space-y-4">
            <div className="text-4xl">{passed ? "🎉" : "💪"}</div>
            <h2 className="text-lg font-semibold text-gray-900">Keep going!</h2>
            <p className="text-sm text-gray-500">{correct} / {total} correct</p>
            <div className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium",
              passed ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"
            )}>
              {passed ? "✓ Mastered" : "Needs more practice"}
            </div>
            <button
              onClick={() => {
                setCurrentQueueIndex(nextIncompleteInQueue);
                setTargetKeyword(lessonQueue[nextIncompleteInQueue]!.keyword_id);
                void fetchAndStartLesson(lessonQueue[nextIncompleteInQueue]!.keyword_id);
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors"
            >
              Next Lesson →
            </button>
            <button
              onClick={() => setPhase("lesson_queue")}
              className="w-full text-sm text-gray-400 hover:text-gray-600 underline"
            >
              Back to lesson list
            </button>
          </div>
        </PageShell>
      );
    }

    return (
      <PageShell>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center space-y-4">
          <div className="text-4xl">{passed ? "🎉" : "💪"}</div>
          <h2 className="text-lg font-semibold text-gray-900">{passed ? "You passed!" : "Keep going!"}</h2>
          <p className="text-sm text-gray-500">{correct} / {total} correct</p>
          <div className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium",
            passed ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"
          )}>
            {passed ? "✓ Mastered" : "Needs more practice"}
          </div>
          <button
            onClick={() => router.push(`/precalc/practice`)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors"
          >
            Start practice →
          </button>
          <button
            onClick={() => setPhase("lesson_queue")}
            className="w-full text-sm text-gray-400 hover:text-gray-600 underline"
          >
            Back to lesson list
          </button>
          {!passed && (
            <button onClick={() => void fetchAndStartLesson(targetKeyword)} className="w-full text-sm text-gray-400 hover:text-gray-600 underline">
              Review the lesson again
            </button>
          )}
        </div>
      </PageShell>
    );
  }

  return null;
}

export default function LearnPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-sm text-gray-400">Loading…</p></div>}>
      <LearnPageInner />
    </Suspense>
  );
}
