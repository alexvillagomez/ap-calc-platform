"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Preview } from "@/components/Preview";
import { ContentFeedback } from "@/components/ContentFeedback";
import { cn } from "@/lib/cn";

interface Problem {
  id: string;
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
  difficulty: number;
  keyword_weights?: Record<string, number> | null;
  avg_rating: number | null;
  feedback_content_type?: "problem" | "rag_example";
}

type Phase = "loading" | "answering" | "revealed";

const SESSION_KEY = "ap_calc_student_session_id";
const ACCOUNT_KEY = "ap_calc_account_id";
const USERNAME_KEY = "ap_calc_username";
const CHOICE_LABELS = ["A", "B", "C", "D"];
function difficultyLabel(d: number): string {
  if (d < 0.3) return "Easy";
  if (d < 0.5) return "Medium-Easy";
  if (d < 0.7) return "Medium";
  if (d < 0.9) return "Medium-Hard";
  return "Hard";
}

function generateSessionId(): string {
  try {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  } catch {
    return `s-${Date.now()}`;
  }
}

export default function PrecalcPracticePage() {
  const router = useRouter();
  const sessionIdRef = useRef<string>("");
  const [loggedInUsername, setLoggedInUsername] = useState<string | null>(null);
  const [keywordStrengths, setKeywordStrengths] = useState<Record<string, number>>({});

  const [problem, setProblem] = useState<Problem | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  const loadNextProblem = useCallback(async () => {
    setPhase("loading");
    setProblem(null);
    setSelectedChoice(null);
    setLoadingSimilar(false);

    try {
      const res = await fetch("/api/precalc/next-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      });
      const data = (await res.json()) as { problem?: Problem; error?: string };
      if (!res.ok || !data.problem) {
        toast.error(data.error ?? "No problems available.");
        setPhase("loading");
        return;
      }
      setProblem(data.problem);
      setPhase("answering");
    } catch {
      toast.error("Failed to load problem");
    }
  }, []);

  // Init: auth guard + load session + first problem
  useEffect(() => {
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    if (!accountId) { router.replace("/demo"); return; }

    setLoggedInUsername(localStorage.getItem(USERNAME_KEY));

    const storedSession = localStorage.getItem(SESSION_KEY);
    sessionIdRef.current = storedSession || generateSessionId();
    if (!storedSession) localStorage.setItem(SESSION_KEY, sessionIdRef.current);

    // Load topic_strengths then fetch first problem
    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionIdRef.current }),
    })
      .then(r => r.json())
      .then((data: { topic_strengths?: Record<string, number> }) => {
        setKeywordStrengths(data.topic_strengths ?? {});
      })
      .catch(() => {})
      .finally(() => { void loadNextProblem(); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAnswer = async (choiceIndex: number) => {
    if (!problem || phase !== "answering") return;
    const correct = choiceIndex === problem.correct_index;
    setSelectedChoice(choiceIndex);
    setPhase("revealed");

    if (correct) toast.success("Correct!");
    else toast.error("Incorrect — review the solution below.");

    try {
      const res = await fetch("/api/record-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          problemId: problem.id,
          selectedIndex: choiceIndex,
          correct,
          keywordWeights: problem.keyword_weights ?? undefined,
        }),
      });
      const data = (await res.json()) as { topic_strengths?: Record<string, number> };
      if (data.topic_strengths) setKeywordStrengths(data.topic_strengths);
    } catch {}
  };

  const handleSimilarProblem = async () => {
    if (!problem || loadingSimilar) return;
    setLoadingSimilar(true);
    try {
      const res = await fetch("/api/similar-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemId: problem.id, sessionId: sessionIdRef.current }),
      });
      const data = await res.json() as { problem?: Problem };
      if (data.problem) {
        setProblem(data.problem);
        setPhase("answering");
        setSelectedChoice(null);
      }
    } catch {}
    finally { setLoadingSimilar(false); }
  };

  // Derive the top 2 weakest keyword labels to show as context
  const weakestKeywords = Object.entries(keywordStrengths)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([id]) => id.replace(/_/g, " "));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/demo")}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Back"
            >
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <div>
              <h1 className="text-sm font-semibold text-gray-900">Free Practice</h1>
              {loggedInUsername && <p className="text-xs text-gray-400">{loggedInUsername}</p>}
            </div>
          </div>
          {weakestKeywords.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-xs text-gray-400">Focusing on:</span>
              {weakestKeywords.map(label => (
                <span key={label} className="text-xs bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-full">
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        {/* Loading */}
        {phase === "loading" && (
          <div className="flex flex-col items-center justify-center py-32 gap-3">
            <svg className="w-8 h-8 animate-spin text-violet-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm text-gray-500">Finding your next problem…</p>
          </div>
        )}

        {problem && phase !== "loading" && (
          <>
            {/* Problem stem */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <Preview latexContent={problem.latex_content} />
            </div>

            {/* Choices */}
            <div className="space-y-2">
              {(problem.choices ?? []).map((choice, i) => {
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
                      state === "default" && phase === "answering" && "bg-white border-gray-200 hover:border-violet-400 hover:bg-violet-50",
                      state === "default" && phase === "revealed" && "bg-white border-gray-200",
                      state === "correct" && "bg-green-50 border-green-400",
                      state === "wrong" && "bg-red-50 border-red-400",
                      phase === "revealed" && "cursor-default"
                    )}
                  >
                    <span className={cn(
                      "flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold mt-0.5",
                      state === "default" && "border-gray-300 text-gray-500",
                      state === "correct" && "bg-green-500 border-green-500 text-white",
                      state === "wrong" && "bg-red-500 border-red-500 text-white",
                    )}>
                      {state === "correct" ? "✓" : state === "wrong" ? "✗" : CHOICE_LABELS[i]}
                    </span>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <Preview latexContent={choice} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Solution */}
            {phase === "revealed" && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Solution</h3>
                </div>
                <div className="p-6">
                  {problem.solution_latex
                    ? <Preview latexContent={problem.solution_latex} />
                    : <p className="text-sm text-gray-400 italic">No solution available for this problem.</p>
                  }
                </div>
              </div>
            )}

            {/* Rating + Flag */}
            {phase === "revealed" && (
              <ContentFeedback
                key={problem.id}
                sessionId={sessionIdRef.current}
                contentType={problem.feedback_content_type ?? "problem"}
                contentId={problem.id}
                label="Rate this problem"
              />
            )}

            {/* Similar problem */}
            {phase === "revealed" && (
              <button
                onClick={handleSimilarProblem}
                disabled={loadingSimilar}
                className="w-full py-3 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 text-sm font-medium transition-colors"
              >
                {loadingSimilar ? "Generating…" : "Similar problem →"}
              </button>
            )}

            {/* Next problem */}
            {phase === "revealed" && (
              <button
                className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors shadow-sm"
                onClick={loadNextProblem}
              >
                Next Problem →
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
