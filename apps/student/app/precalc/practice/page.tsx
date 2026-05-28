"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Preview } from "@/components/Preview";
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
}

type Phase = "loading" | "answering" | "revealed";

const SESSION_KEY = "ap_calc_student_session_id";
const ACCOUNT_KEY = "ap_calc_account_id";
const USERNAME_KEY = "ap_calc_username";
const CHOICE_LABELS = ["A", "B", "C", "D"];
const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Easy", 2: "Medium-Easy", 3: "Medium", 4: "Medium-Hard", 5: "Hard",
};

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
  const [rating, setRating] = useState<number | null>(null);
  const [flagged, setFlagged] = useState(false);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  const loadNextProblem = useCallback(async () => {
    setPhase("loading");
    setProblem(null);
    setSelectedChoice(null);
    setRating(null);
    setFlagged(false);
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
    if (!accountId) { router.replace("/precalc"); return; }

    setLoggedInUsername(localStorage.getItem(USERNAME_KEY));

    const storedSession = localStorage.getItem(SESSION_KEY);
    sessionIdRef.current = storedSession || generateSessionId();
    if (!storedSession) localStorage.setItem(SESSION_KEY, sessionIdRef.current);

    // Load keyword_strengths then fetch first problem
    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionIdRef.current }),
    })
      .then(r => r.json())
      .then((data: { keyword_strengths?: Record<string, number>; strengths?: Record<string, number> }) => {
        setKeywordStrengths(data.keyword_strengths ?? data.strengths ?? {});
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
      const data = (await res.json()) as { keyword_strengths?: Record<string, number> };
      if (data.keyword_strengths) setKeywordStrengths(data.keyword_strengths);
    } catch {}
  };

  const handleRate = async (stars: number) => {
    if (!problem) return;
    setRating(stars);
    try {
      await fetch("/api/record-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          problemId: problem.id,
          selectedIndex: selectedChoice ?? 0,
          correct: selectedChoice === problem.correct_index,
          rating: stars,
        }),
      });
    } catch {}
  };

  const handleFlag = async () => {
    if (!problem || flagged) return;
    setFlagged(true);
    try {
      await fetch("/api/record-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          problemId: problem.id,
          selectedIndex: selectedChoice ?? 0,
          correct: selectedChoice === problem.correct_index,
          flagged: true,
        }),
      });
    } catch { setFlagged(false); }
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
        setRating(null);
        setFlagged(false);
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
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/precalc")}
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
            {/* Difficulty badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(
                "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                problem.difficulty <= 2 ? "bg-green-100 text-green-800" :
                problem.difficulty === 3 ? "bg-yellow-100 text-yellow-800" :
                "bg-red-100 text-red-800"
              )}>
                {DIFFICULTY_LABELS[problem.difficulty] ?? `Difficulty ${problem.difficulty}`}
              </span>
            </div>

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
              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex items-center gap-4 flex-wrap">
                <span className="text-sm text-gray-600">Rate this problem:</span>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => handleRate(star)}
                      className={cn(
                        "text-2xl transition-all hover:scale-110 leading-none",
                        rating != null && star <= rating ? "text-yellow-400" : "text-gray-200 hover:text-yellow-300"
                      )}
                    >★</button>
                  ))}
                </div>
                {rating && (
                  <span className="text-xs text-gray-400">
                    {["", "Poor", "Fair", "OK", "Good", "Excellent"][rating]}
                  </span>
                )}
                <div className="ml-auto">
                  <button
                    onClick={handleFlag}
                    disabled={flagged}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      flagged
                        ? "bg-orange-50 border-orange-300 text-orange-600 cursor-default"
                        : "border-gray-200 text-gray-400 hover:border-orange-300 hover:text-orange-500 hover:bg-orange-50"
                    )}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M2 2a.5.5 0 0 1 .5-.5h.535c.127 0 .25.05.34.14L4.5 2.75l.625-.11A8.4 8.4 0 0 1 6.5 2.5c1.2 0 2.1.3 3 .6.9.3 1.8.6 3 .6a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5c-1.2 0-2.1-.3-3-.6-.9-.3-1.8-.6-3-.6-.48 0-.93.04-1.375.11L4.5 8.75 3.375 7.64A.5.5 0 0 0 3 7.5H2.5V14a.5.5 0 0 1-1 0V2.5A.5.5 0 0 1 2 2z" />
                    </svg>
                    {flagged ? "Reported" : "Report"}
                  </button>
                </div>
              </div>
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
