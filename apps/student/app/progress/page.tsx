"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

const SESSION_KEY = "ap_calc_student_session_id";

type KeywordEntry = {
  id: string;
  label: string;
  state: string;
  in_depth_score: number | null;
  tested: boolean;
  total_attempts: number;
  low_sample: boolean;
  spaced_review_due_at: string | null;
};

type UmbrellaGroup = {
  id: string;
  label: string;
  umbrella_score: number | null;
  total_attempts: number;
  low_sample: boolean;
  mastered_count: number;
  total_count: number;
  keywords: KeywordEntry[];
};

type CategoryGroup = {
  category_id: string;
  category_name: string;
  category_score: number | null;
  mastered_count: number;
  total_count: number;
  umbrellas: UmbrellaGroup[];
};

type Summary = {
  total_mastered: number;
  total_attempted: number;
  in_progress: number;
  categories_started: number;
};

type StateConfig = {
  label: string;
  chipClass: string;
  dot: boolean;
};

const STATE_CONFIG: Record<string, StateConfig> = {
  mastered: { label: "Mastered", chipClass: "bg-green-100 text-green-700", dot: false },
  in_progress: { label: "In Progress", chipClass: "bg-blue-100 text-blue-700", dot: true },
  needs_practice: { label: "Needs Practice", chipClass: "bg-blue-100 text-blue-600", dot: true },
  needs_lesson: { label: "Needs Lesson", chipClass: "bg-orange-100 text-orange-700", dot: true },
  needs_refresher: { label: "Needs Refresher", chipClass: "bg-yellow-100 text-yellow-700", dot: true },
  not_started: { label: "Not Started", chipClass: "bg-gray-100 text-gray-400", dot: false },
};

function getStateConfig(state: string): StateConfig {
  return STATE_CONFIG[state] ?? STATE_CONFIG["not_started"]!;
}

function LowSampleBadge({ show, totalAttempts }: { show: boolean; totalAttempts: number }) {
  if (!show) return null;
  return (
    <span className="text-[10px] text-amber-600 italic ml-1.5 whitespace-nowrap">
      low sample (n={totalAttempts})
    </span>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="text-xs text-gray-400 italic">Not tested yet</span>;
  }
  const pct = Math.round(score * 100);
  const color = score < 0.35 ? "#ef4444" : score < 0.55 ? "#f97316" : score < 0.7 ? "#eab308" : "#22c55e";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs tabular-nums w-10 text-right" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

export default function ProgressPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reportUnlocked, setReportUnlocked] = useState(true);
  const [sampledUmbrellas, setSampledUmbrellas] = useState(0);
  const [totalUmbrellas, setTotalUmbrellas] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedUmbrellas, setExpandedUmbrellas] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      router.push("/demo");
      return;
    }
    fetch(`/api/learn/progress?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((data: {
        categories?: CategoryGroup[];
        summary?: Summary;
        error?: string;
        report_unlocked?: boolean;
        sampled_umbrellas?: number;
        total_umbrellas?: number;
      }) => {
        if (data.error) { setError(data.error); return; }
        const polyCats = (data.categories ?? []).filter((c) => c.category_id === "polynomials");
        setCategories(polyCats);
        setSummary(data.summary ?? null);
        setReportUnlocked(data.report_unlocked ?? true);
        setSampledUmbrellas(data.sampled_umbrellas ?? 0);
        setTotalUmbrellas(data.total_umbrellas ?? 0);
        // Auto-expand the polynomials category
        setExpanded(new Set(polyCats.map((c) => c.category_id)));
      })
      .catch(() => setError("Failed to load progress."))
      .finally(() => setLoading(false));
  }, [router]);

  function toggleCategory(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleUmbrella(id: string) {
    setExpandedUmbrellas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }


  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Your Progress</h1>
            {summary && (
              <p className="text-sm text-gray-500 mt-0.5">
                {summary.total_mastered} keyword{summary.total_mastered !== 1 ? "s" : ""} mastered
                {summary.in_progress > 0 && ` · ${summary.in_progress} in progress`}
              </p>
            )}
          </div>
          <button
            onClick={() => router.push("/demo")}
            className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
          >
            ← Back
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {categories.length === 0 && !error && (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-8 text-center space-y-3">
            <p className="text-sm text-gray-500">No progress yet.</p>
            <button
              onClick={() => router.push("/demo")}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Start studying →
            </button>
          </div>
        )}

        {categories.length > 0 && !reportUnlocked && !error && (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-8 text-center space-y-3">
            <p className="text-sm text-gray-500">
              Keep practicing to unlock your full report — we need a bit more data across your topics
              to give you a confident read.
            </p>
            <p className="text-xs text-gray-400">
              {sampledUmbrellas} of {totalUmbrellas} topics sampled enough so far
            </p>
            <button
              onClick={() => router.push("/demo")}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Keep practicing →
            </button>
          </div>
        )}

        {/* Category groups */}
        {reportUnlocked && categories.map((group) => {
          const isOpen = expanded.has(group.category_id);

          return (
            <div key={group.category_id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(group.category_id)}
                className="w-full px-5 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-900">{group.category_name}</span>
                  <span className={cn(
                    "text-gray-400 text-sm transition-transform duration-200",
                    isOpen && "rotate-90"
                  )}>›</span>
                </div>
                <p className="text-xs text-gray-400 mb-1">Category score</p>
                <ScoreBar score={group.category_score} />
              </button>

              {/* Umbrella keyword list */}
              {isOpen && (
                <div className="border-t border-gray-50">
                  {group.umbrellas.map((umbrella, i, arr) => {
                    const umbrellaOpen = expandedUmbrellas.has(umbrella.id);
                    return (
                      <div
                        key={umbrella.id}
                        className={cn(
                          "bg-gray-50/40",
                          i < arr.length - 1 && "border-b border-gray-50"
                        )}
                      >
                        <button
                          onClick={() => toggleUmbrella(umbrella.id)}
                          className="w-full px-5 py-3 text-left hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-sm font-medium text-gray-800">{umbrella.label}</span>
                            <span className={cn(
                              "text-gray-400 text-sm transition-transform duration-200 flex-shrink-0 ml-2",
                              umbrellaOpen && "rotate-90"
                            )}>›</span>
                          </div>
                          <div className="flex items-center">
                            <div className="flex-1">
                              <ScoreBar score={umbrella.umbrella_score} />
                            </div>
                            <LowSampleBadge show={umbrella.low_sample} totalAttempts={umbrella.total_attempts} />
                          </div>
                        </button>

                        {/* Individual skill list */}
                        {umbrellaOpen && (
                          <div className="border-t border-gray-100 bg-white">
                            {umbrella.keywords
                              .slice()
                              .sort((a, b) => {
                                const order = ["needs_lesson", "needs_refresher", "needs_practice", "in_progress", "not_started", "mastered"];
                                return order.indexOf(a.state) - order.indexOf(b.state);
                              })
                              .map((kw, j, kwArr) => {
                                const cfg = getStateConfig(kw.state);
                                return (
                                  <div
                                    key={kw.id}
                                    className={cn(
                                      "pl-8 pr-5 py-3 space-y-1.5",
                                      j < kwArr.length - 1 && "border-b border-gray-50"
                                    )}
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className={cn(
                                        "flex-shrink-0 w-2 h-2 rounded-full",
                                        cfg.dot ? "bg-gray-400" : "border-2 border-gray-300 bg-white"
                                      )} />
                                      <span className="flex-1 text-sm text-gray-800">{kw.label}</span>
                                      <span className={cn(
                                        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0",
                                        cfg.chipClass
                                      )}>
                                        {cfg.label}
                                      </span>
                                    </div>
                                    <div className="flex items-center pl-5">
                                      <div className="flex-1">
                                        <ScoreBar score={kw.in_depth_score} />
                                      </div>
                                      <LowSampleBadge show={kw.low_sample} totalAttempts={kw.total_attempts} />
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Continue to practice — keeps the user in the demo flow */}
                  <div className="px-5 py-3 border-t border-gray-50 bg-white">
                    <button
                      onClick={() => router.push("/demo-practice")}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Continue to practice →
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
