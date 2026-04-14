"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Preview } from "@/components/Preview";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Topic {
  id: string;
  name: string;
  description: string;
  unit_name: string;
}

interface Problem {
  id: string;
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
  difficulty: number;
  topic_weights: Record<string, number>;
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

export default function PracticePage() {
  const router = useRouter();
  const sessionIdRef = useRef<string>("");
  const [loggedInUsername, setLoggedInUsername] = useState<string | null>(null);
  const [strengths, setStrengths] = useState<Record<string, number>>({});

  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsByUnit, setTopicsByUnit] = useState<Map<string, Topic[]>>(new Map());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [topicsLoaded, setTopicsLoaded] = useState(false);

  const [problem, setProblem] = useState<Problem | null>(null);
  const [phase, setPhase] = useState<PracticePhase>("idle");
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [loadingProblem, setLoadingProblem] = useState(false);
  const [wasGenerated, setWasGenerated] = useState(false);

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Auth guard
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    if (!accountId) {
      router.replace("/login");
      return;
    }
    const storedUsername = localStorage.getItem(USERNAME_KEY);
    setLoggedInUsername(storedUsername);

    // Use the session stored at login; fall back to creating a new one
    const storedSession = localStorage.getItem(SESSION_KEY);
    sessionIdRef.current = storedSession || generateSessionId();
    if (!storedSession) localStorage.setItem(SESSION_KEY, sessionIdRef.current);

    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionIdRef.current }),
    })
      .then((r) => r.json())
      .then((data: { strengths?: Record<string, number> }) => {
        if (data.strengths) setStrengths(data.strengths);
      })
      .catch(() => {});

    fetch("/api/topics")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (!Array.isArray(data)) return;
        const raw = data as Record<string, unknown>[];
        const normalized: Topic[] = raw.map((t) => {
          const id = String(t.id ?? "");
          const unitNum = id.split("_")[0];
          const unit_name = unitNum && /^\d+$/.test(unitNum) ? `Unit ${unitNum}` : "Other";
          return {
            id,
            name: String(t.name ?? ""),
            description: String(t.description ?? ""),
            unit_name,
          };
        }).filter((t) => t.id);
        normalized.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        setTopics(normalized);

        const byUnit = new Map<string, Topic[]>();
        for (const t of normalized) {
          const u = t.unit_name || "Other";
          if (!byUnit.has(u)) byUnit.set(u, []);
          byUnit.get(u)!.push(t);
        }
        setTopicsByUnit(byUnit);
        setSelectedIds(new Set(normalized.map((t) => t.id)));
        setTopicsLoaded(true);
      })
      .catch(() => toast.error("Could not load topics"));
  }, []);

  // ── Topic selection ─────────────────────────────────────────────────────────

  const toggleTopic = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleUnit = (unit: string, allSelected: boolean) => {
    const unitTopics = topicsByUnit.get(unit) ?? [];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const t of unitTopics) allSelected ? next.delete(t.id) : next.add(t.id);
      return next;
    });
  };

  // ── Problem flow ────────────────────────────────────────────────────────────

  const loadNextProblem = useCallback(async () => {
    if (selectedIds.size === 0) { toast.error("Select at least one topic first"); return; }
    setLoadingProblem(true);
    setProblem(null);
    setPhase("idle");
    setSelectedChoice(null);
    setRating(null);
    setWasGenerated(false);

    try {
      const res = await fetch("/api/next-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current, selectedTopicIds: [...selectedIds] }),
      });
      const data = (await res.json()) as { problem?: Problem; generated?: boolean; error?: string };
      if (!res.ok || !data.problem) {
        toast.error(data.error ?? "No problems available for these topics.");
        return;
      }
      setProblem(data.problem);
      setPhase("answering");
      setWasGenerated(data.generated ?? false);
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
          topicWeights: problem.topic_weights,
        }),
      });
      const data = (await res.json()) as { strengths?: Record<string, number> };
      if (data.strengths) setStrengths(data.strengths);
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
          topicWeights: problem.topic_weights,
          rating: stars,
        }),
      });
    } catch {}
  };

  // ── Auth ────────────────────────────────────────────────────────────────────

  const handleLogout = () => {
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(SESSION_KEY);
    router.push("/login");
  };

  // ── Sorted units ────────────────────────────────────────────────────────────

  const sortedUnits = [...topicsByUnit.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Left sidebar: topic selector ──────────────────────────────────── */}
      <aside className="w-72 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white">
        <div className="px-4 py-4 border-b border-gray-200">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-sm font-semibold text-gray-900">AP Calculus AB</h1>
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
            {selectedIds.size} / {topics.length} selected
          </span>
          <div className="flex gap-2">
            <button className="text-xs text-blue-600 hover:underline" onClick={() => setSelectedIds(new Set(topics.map((t) => t.id)))}>All</button>
            <button className="text-xs text-gray-400 hover:underline" onClick={() => setSelectedIds(new Set())}>None</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {!topicsLoaded ? (
            <div className="p-4 text-xs text-gray-400">Loading topics…</div>
          ) : (
            sortedUnits.map((unit) => {
              const unitTopics = topicsByUnit.get(unit) ?? [];
              const allSelected = unitTopics.every((t) => selectedIds.has(t.id));
              const someSelected = !allSelected && unitTopics.some((t) => selectedIds.has(t.id));
              return (
                <div key={unit}>
                  {/* Unit row */}
                  <button
                    className="w-full flex items-center gap-2 px-4 py-1.5 text-left hover:bg-gray-50"
                    onClick={() => toggleUnit(unit, allSelected)}
                  >
                    <span className={cn(
                      "w-3.5 h-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center",
                      allSelected ? "bg-blue-600 border-blue-600" : someSelected ? "bg-blue-200 border-blue-400" : "border-gray-300"
                    )}>
                      {allSelected && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      {someSelected && <span className="w-1.5 h-0.5 bg-blue-600 rounded-full" />}
                    </span>
                    <span className="text-xs font-semibold text-gray-600 truncate">{unit}</span>
                  </button>

                  {/* Topic rows */}
                  {unitTopics.map((t) => {
                    const s = strengths[t.id] ?? 0.5;
                    const selected = selectedIds.has(t.id);
                    return (
                      <button
                        key={t.id}
                        className={cn("w-full flex items-start gap-2 px-4 py-1.5 pl-8 text-left hover:bg-gray-50 transition-opacity", !selected && "opacity-40")}
                        onClick={() => toggleTopic(t.id)}
                      >
                        <span className={cn(
                          "mt-0.5 w-3 h-3 flex-shrink-0 rounded-sm border",
                          selected ? "bg-blue-600 border-blue-600" : "border-gray-300"
                        )}>
                          {selected && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-700 leading-tight line-clamp-2">{t.name || t.id}</span>
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
          <button
            className={cn(
              "w-full py-2.5 rounded-lg text-sm font-medium transition-colors",
              loadingProblem || selectedIds.size === 0
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
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
                Select the topics you want to work on, then click <strong>Start Practice</strong>.
                Problems are chosen based on where you need the most growth.
              </p>
            </div>
          </div>
        )}

        {loadingProblem && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-3">
              <svg className="w-8 h-8 animate-spin text-blue-500 mx-auto" viewBox="0 0 24 24" fill="none">
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
              {wasGenerated && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                  Newly Generated
                </span>
              )}
              {Object.entries(problem.topic_weights)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map(([tid]) => {
                  const t = topics.find((x) => x.id === tid);
                  return (
                    <span key={tid} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                      {t?.name ?? tid}
                    </span>
                  );
                })}
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
                      state === "default" && phase === "answering" && "bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50",
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

            {/* Rating */}
            {phase === "revealed" && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex items-center gap-4">
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
                  <span className="text-xs text-gray-400 ml-1">
                    {["", "Poor", "Fair", "OK", "Good", "Excellent"][rating]}
                  </span>
                )}
              </div>
            )}

            {/* Next problem */}
            {phase === "revealed" && (
              <button
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-sm"
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
