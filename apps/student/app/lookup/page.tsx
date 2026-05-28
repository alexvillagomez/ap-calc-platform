"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Preview } from "@/components/Preview";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

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

type Phase = "idle" | "searching" | "answering" | "revealed";

const SESSION_KEY = "ap_calc_student_session_id";
const ACCOUNT_KEY = "ap_calc_account_id";
const CHOICE_LABELS = ["A", "B", "C", "D"];
const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Easy",
  2: "Medium-Easy",
  3: "Medium",
  4: "Medium-Hard",
  5: "Hard",
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function LookupPage() {
  const router = useRouter();
  const sessionIdRef = useRef<string>("");

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [matchedKeyword, setMatchedKeyword] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);

  // ── Init / auth guard ───────────────────────────────────────────────────────

  useEffect(() => {
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    if (!accountId) {
      router.replace("/precalc");
      return;
    }
    const storedSession = localStorage.getItem(SESSION_KEY);
    sessionIdRef.current = storedSession || generateSessionId();
    if (!storedSession) localStorage.setItem(SESSION_KEY, sessionIdRef.current);
  }, [router]);

  // ── Search ──────────────────────────────────────────────────────────────────

  const search = useCallback(
    async (searchQuery: string, currentExcludeIds: string[]) => {
      if (!searchQuery.trim()) return;
      setPhase("searching");
      setProblem(null);
      setSelectedChoice(null);

      try {
        const res = await fetch("/api/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: searchQuery.trim(),
            sessionId: sessionIdRef.current,
            excludeIds: currentExcludeIds,
          }),
        });
        const data = (await res.json()) as {
          problem?: Problem;
          matched_keyword_label?: string;
          error?: string;
        };

        if (!data.problem) {
          toast.error(data.error ?? "No problems found for that topic.");
          setPhase("idle");
          return;
        }

        setProblem(data.problem);
        setMatchedKeyword(data.matched_keyword_label ?? null);
        setPhase("answering");
      } catch {
        toast.error("Search failed. Please try again.");
        setPhase("idle");
      }
    },
    []
  );

  const handleSearch = () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    // Reset excludeIds if this is a new query
    let newExcludeIds = excludeIds;
    if (trimmed !== submittedQuery) {
      newExcludeIds = [];
      setExcludeIds([]);
    }

    setSubmittedQuery(trimmed);
    void search(trimmed, newExcludeIds);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  // ── Answer ──────────────────────────────────────────────────────────────────

  const handleAnswer = async (choiceIndex: number) => {
    if (!problem || phase !== "answering") return;
    const correct = choiceIndex === problem.correct_index;
    setSelectedChoice(choiceIndex);
    setPhase("revealed");

    try {
      await fetch("/api/record-attempt", {
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
    } catch {}

    if (correct) toast.success("Correct!");
    else toast.error("Incorrect — review the solution below.");
  };

  // ── Next similar problem ─────────────────────────────────────────────────────

  const handleNextSimilar = () => {
    if (!problem) return;
    const newExcludeIds = [...excludeIds, problem.id];
    setExcludeIds(newExcludeIds);
    void search(submittedQuery, newExcludeIds);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => router.push("/precalc/practice")}
            className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
            aria-label="Back to practice"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
          </button>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Problem Lookup</h1>
            <p className="text-xs text-gray-400">Search by topic or concept</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Search bar */}
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the type of problem… e.g. simplifying exponents with negative powers"
            className="flex-1 px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent shadow-sm"
            disabled={phase === "searching"}
          />
          <button
            onClick={handleSearch}
            disabled={phase === "searching" || !query.trim()}
            className={cn(
              "px-5 py-3 rounded-xl text-sm font-medium transition-colors shadow-sm flex-shrink-0",
              phase === "searching" || !query.trim()
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-violet-600 hover:bg-violet-700 text-white"
            )}
          >
            {phase === "searching" ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Searching…
              </span>
            ) : (
              "Search"
            )}
          </button>
        </div>

        {/* Matched keyword chip */}
        {matchedKeyword && phase !== "idle" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Showing problems about:</span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-100">
              {matchedKeyword}
            </span>
          </div>
        )}

        {/* Idle state */}
        {phase === "idle" && (
          <div className="flex flex-col items-center justify-center text-center py-20">
            <div className="text-5xl mb-5">🔍</div>
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Find problems by topic</h2>
            <p className="text-sm text-gray-500 leading-relaxed max-w-sm">
              Type a description of the math concept you want to practice. For example: <em>&ldquo;negative exponents&rdquo;</em>, <em>&ldquo;rational functions with holes&rdquo;</em>, or <em>&ldquo;inverse function notation&rdquo;</em>.
            </p>
          </div>
        )}

        {/* Searching spinner */}
        {phase === "searching" && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-8 h-8 animate-spin text-violet-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm text-gray-500">Finding a matching problem…</p>
          </div>
        )}

        {/* Problem card */}
        {problem && (phase === "answering" || phase === "revealed") && (
          <div className="space-y-4">
            {/* Difficulty badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                  problem.difficulty <= 2
                    ? "bg-green-100 text-green-800"
                    : problem.difficulty === 3
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-red-100 text-red-800"
                )}
              >
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
                      "w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors",
                      state === "default" && phase === "answering" &&
                        "bg-white border-gray-200 hover:border-violet-400 hover:bg-violet-50",
                      state === "default" && phase === "revealed" && "bg-white border-gray-200",
                      state === "correct" && "bg-green-50 border-green-400",
                      state === "wrong" && "bg-red-50 border-red-400",
                      phase === "revealed" && "cursor-default"
                    )}
                  >
                    <span
                      className={cn(
                        "flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold",
                        state === "default" && "border-gray-300 text-gray-500",
                        state === "correct" && "bg-green-500 border-green-500 text-white",
                        state === "wrong" && "bg-red-500 border-red-500 text-white"
                      )}
                    >
                      {state === "correct" ? "✓" : state === "wrong" ? "✗" : CHOICE_LABELS[i]}
                    </span>
                    <div className="flex-1 min-w-0">
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
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Solution
                  </h3>
                </div>
                <div className="p-6">
                  <Preview latexContent={problem.solution_latex} />
                </div>
              </div>
            )}

            {/* Next similar problem button */}
            {phase === "revealed" && (
              <button
                className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors shadow-sm"
                onClick={handleNextSimilar}
              >
                Next similar problem →
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
