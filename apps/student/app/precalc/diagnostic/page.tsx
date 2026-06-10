"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Preview } from "@/components/Preview";
import {
  applyAnswerToScores,
} from "@/lib/diagnosticScoring";
import type { Answer, KeywordScores } from "@/lib/diagnosticScoring";
import { cn } from "@/lib/cn";

const SESSION_KEY = "ap_calc_student_session_id";
const ACCOUNT_KEY = "ap_calc_account_id";
const DRAFT_KEY_PREFIX = "ap_calc_diagnostic_draft_";
const LABELS = ["A", "B", "C", "D"];

type DiagnosticDraft = {
  phase: "diagnostic";
  answers: (Answer & { problem_id: string })[];
  umbrellaScores: KeywordScores;
  inDepthScores: KeywordScores;
  currentQuestion: DBQuestion;
};

const ALL_TOPIC_IDS = [
  "exponent_rules",
  "functions",
  "function_transformations",
  "inverse_functions",
  "piecewise_functions",
  "polynomials",
  "rational_functions",
  "exponential_and_logarithmic_functions",
  "trigonometry",
];

const TOPIC_LABELS: Record<string, string> = {
  exponent_rules: "Exponent Rules",
  functions: "Functions",
  function_transformations: "Function Transformations",
  inverse_functions: "Inverse Functions",
  piecewise_functions: "Piecewise Functions",
  polynomials: "Polynomials",
  rational_functions: "Rational Functions",
  exponential_and_logarithmic_functions: "Exponential & Log",
  trigonometry: "Trigonometry",
};

const GENERAL_DIAGNOSTIC_MIN = 15;
const GENERAL_DIAGNOSTIC_MAX = 30;

type Phase = "loading" | "error" | "diagnostic" | "results";

type DBQuestion = {
  id: string;
  latex_content: string;
  choices: string[];
  correct_index: number;
  difficulty: number;
  umbrella_keywords: Record<string, number>;
  in_depth_keywords: Record<string, number>;
  topic_id?: string;
};

type TopicResult = {
  route: string;
  umbrellaScore: number;
  weakestSkills: string[];
  verdict: string;
};

function routeBadge(route: string, score: number): { label: string; color: string } {
  if (route === "skip" || score >= 0.75) return { label: "Strong", color: "bg-green-100 text-green-800" };
  if (route === "refresher" || score >= 0.5) return { label: "Review", color: "bg-yellow-100 text-yellow-800" };
  if (route === "targeted" || score >= 0.35) return { label: "Needs Practice", color: "bg-orange-100 text-orange-800" };
  return { label: "Needs Lesson", color: "bg-red-100 text-red-800" };
}

function GeneralDiagnosticInner() {
  const router = useRouter();
  const sessionId = typeof window !== "undefined" ? (localStorage.getItem(SESSION_KEY) ?? "") : "";

  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState<DBQuestion | null>(null);
  const [fetchingNext, setFetchingNext] = useState(false);
  const [answers, setAnswers] = useState<(Answer & { problem_id: string })[]>([]);
  const [umbrellaScores, setUmbrellaScores] = useState<KeywordScores>({});
  const [inDepthScores, setInDepthScores] = useState<KeywordScores>({});
  const [results, setResults] = useState<Record<string, TopicResult> | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  const draftKey = sessionId ? `${DRAFT_KEY_PREFIX}${sessionId}` : "";

  function clearDraft() {
    if (!draftKey) return;
    try { localStorage.removeItem(draftKey); } catch {}
  }

  // Persist a resumable snapshot any time the in-progress diagnostic state changes
  useEffect(() => {
    if (!draftKey || phase !== "diagnostic" || !currentQuestion) return;
    const draft: DiagnosticDraft = { phase: "diagnostic", answers, umbrellaScores, inDepthScores, currentQuestion };
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, phase, currentQuestion, answers, umbrellaScores, inDepthScores]);

  // Require an account before serving diagnostic questions
  useEffect(() => {
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    if (!accountId) { router.replace("/login"); return; }

    if (draftKey) {
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          const draft = JSON.parse(raw) as DiagnosticDraft;
          if (draft.phase === "diagnostic" && draft.currentQuestion) {
            setAnswers(draft.answers);
            setUmbrellaScores(draft.umbrellaScores);
            setInDepthScores(draft.inDepthScores);
            setCurrentQuestion(draft.currentQuestion);
            setPhase("diagnostic");
            return;
          }
        }
      } catch {}
    }

    fetchNextQuestion([], {}, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchNextQuestion(answeredIds: string[], keywordScores: KeywordScores, answerCount: number) {
    setFetchingNext(true);
    try {
      const res = await fetch("/api/learn/diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_ids: ALL_TOPIC_IDS, answeredIds, keywordScores }),
      });
      const data = await res.json() as { problem?: DBQuestion; done?: boolean; error?: string };
      if (data.error && !data.problem) {
        setErrorMsg(data.error);
        setPhase("error");
        return;
      }
      // Stop if API signals done and we've hit the minimum
      if (data.done === true && answerCount >= GENERAL_DIAGNOSTIC_MIN) {
        await finalize();
        return;
      }
      if (!data.problem) {
        // No more questions, finalize
        await finalize(answeredIds.length > 0 ? undefined : []);
        return;
      }
      setCurrentQuestion(data.problem);
      setPhase("diagnostic");
    } catch {
      setErrorMsg("Failed to load diagnostic questions");
      setPhase("error");
    } finally {
      setFetchingNext(false);
    }
  }

  async function finalize(finalAnswers?: (Answer & { problem_id: string })[]) {
    const allAnswers = finalAnswers ?? answers;
    setClassifying(true);
    try {
      const res = await fetch("/api/learn/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, topic_ids: ALL_TOPIC_IDS, answers: allAnswers }),
      });
      const data = await res.json() as { results?: Record<string, TopicResult> };
      setResults(data.results ?? {});
    } catch {
      setResults({});
    } finally {
      clearDraft();
      setClassifying(false);
      setPhase("results");
    }
  }

  async function handleAnswer(idx: number) {
    if (!currentQuestion || fetchingNext) return;
    const q = currentQuestion;
    const correct = idx === q.correct_index;
    const answer: Answer & { problem_id: string } = {
      questionId: q.id,
      problem_id: q.id,
      selectedIndex: idx,
      flaggedForgotten: false,
      flaggedNeverSeen: false,
      flaggedDontKnow: false,
      correct,
    };

    const { umbrellaScores: newU, inDepthScores: newI } = applyAnswerToScores(
      umbrellaScores, inDepthScores, q.umbrella_keywords, q.in_depth_keywords, answer
    );
    const nextAnswers = [...answers, answer];

    setUmbrellaScores(newU);
    setInDepthScores(newI);
    setAnswers(nextAnswers);

    // Check stopping condition: stop at max, or let fetchNextQuestion handle done+min
    const shouldStop = nextAnswers.length >= GENERAL_DIAGNOSTIC_MAX;

    if (shouldStop) {
      await finalize(nextAnswers);
      return;
    }

    await fetchNextQuestion(nextAnswers.map(a => a.problem_id), newI, nextAnswers.length);
  }

  async function handleForgotten() {
    if (!currentQuestion || fetchingNext) return;
    const q = currentQuestion;
    const answer: Answer & { problem_id: string } = {
      questionId: q.id, problem_id: q.id, selectedIndex: null,
      flaggedForgotten: true, flaggedNeverSeen: false, flaggedDontKnow: false, correct: false,
    };
    const { umbrellaScores: newU, inDepthScores: newI } = applyAnswerToScores(
      umbrellaScores, inDepthScores, q.umbrella_keywords, q.in_depth_keywords, answer
    );
    const nextAnswers = [...answers, answer];
    setUmbrellaScores(newU); setInDepthScores(newI); setAnswers(nextAnswers);
    const shouldStop = nextAnswers.length >= GENERAL_DIAGNOSTIC_MAX;
    if (shouldStop) { await finalize(nextAnswers); return; }
    await fetchNextQuestion(nextAnswers.map(a => a.problem_id), newI, nextAnswers.length);
  }

  async function handleFlag(problemId: string) {
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

  async function handleNeverSeen() {
    if (!currentQuestion || fetchingNext) return;
    const q = currentQuestion;
    const answer: Answer & { problem_id: string } = {
      questionId: q.id, problem_id: q.id, selectedIndex: null,
      flaggedForgotten: false, flaggedNeverSeen: true, flaggedDontKnow: false, correct: null,
    };
    const { umbrellaScores: newU, inDepthScores: newI } = applyAnswerToScores(
      umbrellaScores, inDepthScores, q.umbrella_keywords, q.in_depth_keywords, answer
    );
    const nextAnswers = [...answers, answer];
    setUmbrellaScores(newU); setInDepthScores(newI); setAnswers(nextAnswers);
    const shouldStop = nextAnswers.length >= GENERAL_DIAGNOSTIC_MAX;
    if (shouldStop) { await finalize(nextAnswers); return; }
    await fetchNextQuestion(nextAnswers.map(a => a.problem_id), newI, nextAnswers.length);
  }

  async function handleDontKnow() {
    if (!currentQuestion || fetchingNext) return;
    const q = currentQuestion;
    const answer: Answer & { problem_id: string } = {
      questionId: q.id, problem_id: q.id, selectedIndex: null,
      flaggedForgotten: false, flaggedNeverSeen: false, flaggedDontKnow: true, correct: false,
    };
    const { umbrellaScores: newU, inDepthScores: newI } = applyAnswerToScores(
      umbrellaScores, inDepthScores, q.umbrella_keywords, q.in_depth_keywords, answer
    );
    const nextAnswers = [...answers, answer];
    setUmbrellaScores(newU); setInDepthScores(newI); setAnswers(nextAnswers);
    const shouldStop = nextAnswers.length >= GENERAL_DIAGNOSTIC_MAX;
    if (shouldStop) { await finalize(nextAnswers); return; }
    await fetchNextQuestion(nextAnswers.map(a => a.problem_id), newI, nextAnswers.length);
  }

  // ── Loading / Error ──

  if (phase === "loading" || fetchingNext) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <svg className="w-8 h-8 animate-spin text-blue-500 mx-auto" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm text-gray-400">{classifying ? "Analyzing results…" : "Loading…"}</p>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-3">
          <p className="text-sm text-red-600">{errorMsg}</p>
          <button onClick={() => router.push("/demo")} className="text-sm text-blue-600 underline">Back to portal</button>
        </div>
      </div>
    );
  }

  // ── Diagnostic ──

  if (phase === "diagnostic" && currentQuestion) {
    const q = currentQuestion;
    const topicLabel = q.topic_id ? (TOPIC_LABELS[q.topic_id] ?? q.topic_id) : null;
    const progressPct = Math.min(100, (answers.length / GENERAL_DIAGNOSTIC_MAX) * 100);

    return (
      <div className="flex flex-col items-center min-h-screen bg-gray-50 px-4 py-10">
        {/* Progress */}
        <div className="w-full max-w-2xl mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-500">
              Question {answers.length + 1} of ~{GENERAL_DIAGNOSTIC_MAX}
            </span>
            <button onClick={() => router.push("/demo")} className="text-xs text-gray-400 hover:text-gray-600">
              ← Exit
            </button>
          </div>
          <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {topicLabel && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800">
                {topicLabel}
              </span>
            </div>
          )}
        </div>

        {/* Question card */}
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <div className="text-base leading-relaxed">
            <Preview latexContent={q.latex_content} />
          </div>

          <div className="space-y-2">
            {q.choices.map((choice, i) => (
              <button
                key={i}
                onClick={() => handleAnswer(i)}
                disabled={fetchingNext}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left",
                  "border-gray-200 hover:border-teal-400 hover:bg-teal-50",
                  "transition-colors text-sm font-normal disabled:opacity-50"
                )}
              >
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-600">
                  {LABELS[i]}
                </span>
                <span className="flex-1 min-w-0 break-words overflow-hidden">
                  <Preview latexContent={choice} />
                </span>
              </button>
            ))}
          </div>

          <div className="border-t border-gray-100" />

          <div className="flex flex-col gap-2">
            <button
              onClick={handleForgotten}
              disabled={fetchingNext}
              className="text-sm text-gray-500 hover:text-gray-800 underline underline-offset-2 text-center transition-colors disabled:opacity-50"
            >
              I&apos;ve learned this but don&apos;t remember it
            </button>
            <button
              onClick={handleNeverSeen}
              disabled={fetchingNext}
              className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2 text-center transition-colors disabled:opacity-50"
            >
              I&apos;ve never seen this
            </button>
            <button
              onClick={handleDontKnow}
              disabled={fetchingNext}
              className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2 text-center transition-colors disabled:opacity-50"
            >
              I don&apos;t know how to do this
            </button>
            <div className="flex justify-end pt-1">
              <button
                onClick={() => handleFlag(q.id)}
                disabled={flaggedIds.has(q.id)}
                className={cn(
                  "flex items-center gap-1 text-xs transition-colors",
                  flaggedIds.has(q.id)
                    ? "text-orange-400 cursor-default"
                    : "text-gray-300 hover:text-orange-400"
                )}
              >
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 2a.5.5 0 0 1 .5-.5h.535c.127 0 .25.05.34.14L4.5 2.75l.625-.11A8.4 8.4 0 0 1 6.5 2.5c1.2 0 2.1.3 3 .6.9.3 1.8.6 3 .6a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5c-1.2 0-2.1-.3-3-.6-.9-.3-1.8-.6-3-.6-.48 0-.93.04-1.375.11L4.5 8.75 3.375 7.64A.5.5 0 0 0 3 7.5H2.5V14a.5.5 0 0 1-1 0V2.5A.5.5 0 0 1 2 2z" />
                </svg>
                {flaggedIds.has(q.id) ? "Reported" : "Report"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Results ──

  if (phase === "results" && results) {
    const topicEntries = ALL_TOPIC_IDS
      .filter(tid => TOPIC_LABELS[tid])
      .map(tid => ({
        id: tid,
        label: TOPIC_LABELS[tid]!,
        result: results[tid],
        score: results[tid]?.umbrellaScore ?? 0.5,
        route: results[tid]?.route ?? "full_lesson",
      }))
      .sort((a, b) => a.score - b.score);

    const weakestTopic = topicEntries[0];

    return (
      <div className="min-h-screen bg-gray-50 px-4 py-10">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Your Precalc Overview</h1>
            <p className="text-sm text-gray-500 mt-1">Based on {answers.length} questions across all topics</p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">
            {topicEntries.map(({ id, label, score, route }) => {
              const badge = routeBadge(route, score);
              return (
                <div key={id} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium text-gray-900">{label}</span>
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", badge.color)}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.round(score * 100)}%`,
                          backgroundColor: score >= 0.75 ? "#22c55e" : score >= 0.5 ? "#f59e0b" : score >= 0.35 ? "#f97316" : "#ef4444",
                        }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => router.push(`/learn?topic=${id}`)}
                    className="flex-shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors whitespace-nowrap"
                  >
                    {route === "skip" ? "Practice →" : "Start →"}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-3">
            {weakestTopic && (
              <button
                onClick={() => router.push(`/learn?topic=${weakestTopic.id}`)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
              >
                Start with your weakest topic: {weakestTopic.label} →
              </button>
            )}
            <button
              onClick={() => router.push("/precalc/practice")}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium py-3 rounded-xl transition-colors"
            >
              Go to practice →
            </button>
            <button
              onClick={() => router.push("/demo")}
              className="w-full text-sm text-gray-400 hover:text-gray-600 underline"
            >
              Back to portal
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function GeneralDiagnosticPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    }>
      <GeneralDiagnosticInner />
    </Suspense>
  );
}
