"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Preview } from "@/components/Preview";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PrecalcKeyword {
  id: string;
  label: string;
  topic_id: string;
  topic_label: string;
  tier: string;
}

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

type PracticePhase = "idle" | "answering" | "revealed";

const SESSION_KEY = "ap_calc_student_session_id";
const ACCOUNT_KEY = "ap_calc_account_id";
const USERNAME_KEY = "ap_calc_username";
const CHOICE_LABELS = ["A", "B", "C", "D"];
const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Easy", 2: "Medium-Easy", 3: "Medium", 4: "Medium-Hard", 5: "Hard",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSessionId(): string {
  try {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  } catch {
    return `s-${Date.now()}`;
  }
}

function strengthColor(s: number): string {
  if (s < 0.5) return `hsl(${Math.round(s * 2 * 48)}, 80%, 45%)`;
  return `hsl(${Math.round(48 + (s - 0.5) * 2 * 72)}, 65%, 38%)`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PrecalcPracticePage() {
  const router = useRouter();
  const sessionIdRef = useRef<string>("");
  const [loggedInUsername, setLoggedInUsername] = useState<string | null>(null);
  const [keywordStrengths, setKeywordStrengths] = useState<Record<string, number>>({});

  const [keywords, setKeywords] = useState<PrecalcKeyword[]>([]);
  const [keywordsByTopic, setKeywordsByTopic] = useState<Map<string, PrecalcKeyword[]>>(new Map());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [keywordsLoaded, setKeywordsLoaded] = useState(false);

  const [problem, setProblem] = useState<Problem | null>(null);
  const [phase, setPhase] = useState<PracticePhase>("idle");
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [flagged, setFlagged] = useState(false);
  const [loadingProblem, setLoadingProblem] = useState(false);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [siblingProblem, setSiblingProblem] = useState<Problem | null>(null);

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Auth guard — redirect to /precalc (the auth page) if not logged in
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    if (!accountId) {
      router.replace("/precalc");
      return;
    }
    const storedUsername = localStorage.getItem(USERNAME_KEY);
    setLoggedInUsername(storedUsername);

    const storedSession = localStorage.getItem(SESSION_KEY);
    sessionIdRef.current = storedSession || generateSessionId();
    if (!storedSession) localStorage.setItem(SESSION_KEY, sessionIdRef.current);

    // Load keyword strengths from session
    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionIdRef.current }),
    })
      .then((r) => r.json())
      .then((data: { strengths?: Record<string, number>; keyword_strengths?: Record<string, number> }) => {
        // keyword_strengths holds the precalc keyword EMA values
        if (data.keyword_strengths) setKeywordStrengths(data.keyword_strengths);
        else if (data.strengths) setKeywordStrengths(data.strengths);
      })
      .catch(() => {});

    // Load precalc keywords
    fetch("/api/precalc/keywords")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (!Array.isArray(data)) return;
        const raw = data as Record<string, unknown>[];
        const normalized: PrecalcKeyword[] = raw
          .map((k) => ({
            id: String(k.id ?? ""),
            label: String(k.label ?? k.name ?? k.id ?? ""),
            topic_id: String(k.topic_id ?? ""),
            topic_label: String(k.topic_label ?? k.topic_id ?? ""),
            tier: String(k.tier ?? ""),
          }))
          .filter((k) => k.id);

        setKeywords(normalized);

        const byTopic = new Map<string, PrecalcKeyword[]>();
        for (const kw of normalized) {
          const label = kw.topic_label || "Other";
          if (!byTopic.has(label)) byTopic.set(label, []);
          byTopic.get(label)!.push(kw);
        }
        setKeywordsByTopic(byTopic);
        setSelectedIds(new Set(normalized.map((k) => k.id)));
        setKeywordsLoaded(true);
      })
      .catch(() => toast.error("Could not load keywords"));
  }, []);

  // ── Selection changes reset to idle ─────────────────────────────────────────

  useEffect(() => {
    if (!keywordsLoaded) return;
    setPhase("idle");
    setProblem(null);
    setSelectedChoice(null);
    setRating(null);
    setFlagged(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  const toggleKeyword = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleTopic = (topicLabel: string, allSelected: boolean) => {
    const topicKws = keywordsByTopic.get(topicLabel) ?? [];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const kw of topicKws) allSelected ? next.delete(kw.id) : next.add(kw.id);
      return next;
    });
  };

  // ── Problem flow ────────────────────────────────────────────────────────────

  const loadNextProblem = useCallback(async () => {
    if (selectedIds.size === 0) { toast.error("Select at least one keyword first"); return; }
    setLoadingProblem(true);
    setProblem(null);
    setPhase("idle");
    setSelectedChoice(null);
    setRating(null);
    setFlagged(false);
    setLoadingSimilar(false);
    setSiblingProblem(null);

    try {
      const res = await fetch("/api/precalc/next-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          selectedKeywordIds: [...selectedIds],
        }),
      });
      const data = (await res.json()) as { problem?: Problem; error?: string };
      if (!res.ok || !data.problem) {
        toast.error(data.error ?? "No problems available for these keywords.");
        return;
      }
      setProblem(data.problem);
      setPhase("answering");
    } catch {
      toast.error("Failed to load problem");
    } finally {
      setLoadingProblem(false);
    }
  }, [selectedIds]);

  const handleAnswer = async (choiceIndex: number) => {
    if (!problem || phase !== "answering") return;
    const correct = choiceIndex === problem.correct_index;
    setSelectedChoice(choiceIndex);
    setPhase("revealed");

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

    if (correct) toast.success("Correct!");
    else toast.error("Incorrect — review the solution below.");
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
    } catch {
      setFlagged(false);
    }
  };

  const handleSimilarProblem = async () => {
    if (!problem || loadingSimilar) return;
    setLoadingSimilar(true);
    setSiblingProblem(null);
    try {
      const res = await fetch("/api/similar-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemId: problem.id, sessionId: sessionIdRef.current }),
      });
      const data = await res.json() as { problem?: Problem };
      if (data.problem) {
        // Load the sibling problem as the next problem immediately
        setProblem(data.problem);
        setPhase("answering");
        setSelectedChoice(null);
        setRating(null);
        setFlagged(false);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingSimilar(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(SESSION_KEY);
    router.push("/precalc");
  };

  // ── Sorted topic labels ──────────────────────────────────────────────────────

  const sortedTopics = [...keywordsByTopic.keys()].sort((a, b) => a.localeCompare(b));

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Left sidebar: keyword selector ────────────────────────────────── */}
      <aside className="w-72 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white">
        <div className="px-4 py-4 border-b border-gray-200">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-sm font-semibold text-gray-900">Precalc Primer</h1>
              <p className="text-xs text-gray-400 mt-0.5">Practice Portal</p>
            </div>
            <div className="text-right">
              {loggedInUsername && (
                <p className="text-xs text-gray-600 font-medium truncate max-w-[100px]">{loggedInUsername}</p>
              )}
              <button
                onClick={handleLogout}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors mt-0.5"
              >
                Log out
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {selectedIds.size} / {keywords.length} selected
          </span>
          <div className="flex gap-2">
            <button className="text-xs text-violet-600 hover:underline" onClick={() => setSelectedIds(new Set(keywords.map((k) => k.id)))}>All</button>
            <button className="text-xs text-gray-400 hover:underline" onClick={() => setSelectedIds(new Set())}>None</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {!keywordsLoaded ? (
            <div className="p-4 text-xs text-gray-400">Loading keywords…</div>
          ) : (
            sortedTopics.map((topicLabel) => {
              const topicKws = keywordsByTopic.get(topicLabel) ?? [];
              const allSelected = topicKws.every((k) => selectedIds.has(k.id));
              const someSelected = !allSelected && topicKws.some((k) => selectedIds.has(k.id));
              return (
                <div key={topicLabel}>
                  {/* Topic group row */}
                  <button
                    className="w-full flex items-center gap-2 px-4 py-1.5 text-left hover:bg-gray-50"
                    onClick={() => toggleTopic(topicLabel, allSelected)}
                  >
                    <span className={cn(
                      "w-3.5 h-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center",
                      allSelected ? "bg-violet-600 border-violet-600" : someSelected ? "bg-violet-200 border-violet-400" : "border-gray-300"
                    )}>
                      {allSelected && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      {someSelected && <span className="w-1.5 h-0.5 bg-violet-600 rounded-full" />}
                    </span>
                    <span className="text-xs font-semibold text-gray-600 truncate">{topicLabel}</span>
                  </button>

                  {/* Keyword rows */}
                  {topicKws.map((kw) => {
                    const s = keywordStrengths[kw.id] ?? 0.5;
                    const selected = selectedIds.has(kw.id);
                    return (
                      <button
                        key={kw.id}
                        className={cn("w-full flex items-start gap-2 px-4 py-1.5 pl-8 text-left hover:bg-gray-50 transition-opacity", !selected && "opacity-40")}
                        onClick={() => toggleKeyword(kw.id)}
                      >
                        <span className={cn(
                          "mt-0.5 w-3 h-3 flex-shrink-0 rounded-sm border",
                          selected ? "bg-violet-600 border-violet-600" : "border-gray-300"
                        )}>
                          {selected && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-700 leading-tight line-clamp-2">{kw.label}</span>
                          <div className="mt-1 h-0.5 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.round(s * 100)}%`, backgroundColor: strengthColor(s) }}
                            />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t border-gray-200">
          <p className="text-xs text-gray-400 mb-2">Difficulty matched to your current level</p>
          <button
            className={cn(
              "w-full py-2.5 rounded-lg text-sm font-medium transition-colors",
              loadingProblem || selectedIds.size === 0
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-violet-600 hover:bg-violet-700 text-white"
            )}
            onClick={loadNextProblem}
            disabled={loadingProblem || selectedIds.size === 0}
          >
            {loadingProblem ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Loading…
              </span>
            ) : phase === "idle" ? "Start Practice" : "Next Problem"}
          </button>
        </div>
      </aside>

      {/* ── Right panel: problem ───────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-gray-50">
        {phase === "idle" && !loadingProblem && (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <div className="max-w-md">
              <div className="text-5xl mb-5">📐</div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">Ready to practice?</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                Select the keywords you want to work on, then click <strong>Start Practice</strong>.
                Problems are chosen based on where you need the most growth.
              </p>
            </div>
          </div>
        )}

        {loadingProblem && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-3">
              <svg className="w-8 h-8 animate-spin text-violet-500 mx-auto" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-sm text-gray-500">Finding your next problem…</p>
            </div>
          </div>
        )}

        {!loadingProblem && problem && (
          <div className="w-full min-w-0 max-w-full px-4 sm:px-6 py-8 space-y-5">
            {/* Header badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(
                "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                problem.difficulty <= 2 ? "bg-green-100 text-green-800" :
                problem.difficulty === 3 ? "bg-yellow-100 text-yellow-800" :
                "bg-red-100 text-red-800"
              )}>
                {DIFFICULTY_LABELS[problem.difficulty] ?? `Difficulty ${problem.difficulty}`}
              </span>
              {Object.keys(problem.keyword_weights ?? {})
                .slice(0, 2)
                .map((kw) => (
                  <span key={kw} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-100">
                    {kw.replace(/_/g, " ")}
                  </span>
                ))}
            </div>

            {/* Problem stem */}
            <div className="w-full min-w-0 max-w-full bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
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
                  <Preview latexContent={problem.solution_latex} />
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
                    >
                      ★
                    </button>
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
                disabled={loadingProblem}
              >
                Next Problem →
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
