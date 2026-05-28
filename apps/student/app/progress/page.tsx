"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

const SESSION_KEY = "ap_calc_student_session_id";
const TOPIC_TO_CATEGORY: Record<string, string> = {
  exponent_rules: "exponents_and_radicals",
  functions: "functions",
  function_transformations: "function_transformations",
  inverse_functions: "inverse_functions",
  piecewise_functions: "piecewise_functions",
  polynomials: "polynomials",
  rational_functions: "rational_functions",
  exponential_and_logarithmic_functions: "exponential_and_logarithmic_functions",
  trigonometry: "trigonometry",
};
const CATEGORY_TO_TOPIC = Object.fromEntries(
  Object.entries(TOPIC_TO_CATEGORY).map(([k, v]) => [v, k])
);

type KeywordEntry = {
  id: string;
  label: string;
  state: string;
  in_depth_score: number;
  total_attempts: number;
  spaced_review_due_at: string | null;
};

type CategoryGroup = {
  category_id: string;
  category_name: string;
  keywords: KeywordEntry[];
  mastered_count: number;
  total_count: number;
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

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-400 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 tabular-nums w-10 text-right">
        {value}/{max}
      </span>
    </div>
  );
}

export default function ProgressPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      router.push("/precalc");
      return;
    }
    fetch(`/api/learn/progress?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((data: { categories?: CategoryGroup[]; summary?: Summary; error?: string }) => {
        if (data.error) { setError(data.error); return; }
        setCategories(data.categories ?? []);
        setSummary(data.summary ?? null);
        // Auto-expand all categories that have some data
        setExpanded(new Set((data.categories ?? []).map((c) => c.category_id)));
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
            onClick={() => router.push("/precalc")}
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
              onClick={() => router.push("/precalc")}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Start studying →
            </button>
          </div>
        )}

        {/* Category groups */}
        {categories.map((group) => {
          const topicId = CATEGORY_TO_TOPIC[group.category_id] ?? group.category_id;
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
                <ProgressBar value={group.mastered_count} max={group.total_count} />
              </button>

              {/* Keyword list */}
              {isOpen && (
                <div className="border-t border-gray-50">
                  {group.keywords
                    .slice()
                    .sort((a, b) => {
                      const order = ["needs_lesson", "needs_refresher", "needs_practice", "in_progress", "not_started", "mastered"];
                      return order.indexOf(a.state) - order.indexOf(b.state);
                    })
                    .map((kw, i, arr) => {
                      const cfg = getStateConfig(kw.state);
                      return (
                        <div
                          key={kw.id}
                          className={cn(
                            "flex items-center gap-3 px-5 py-3",
                            i < arr.length - 1 && "border-b border-gray-50"
                          )}
                        >
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
                      );
                    })}

                  {/* Continue studying link */}
                  <div className="px-5 py-3 border-t border-gray-50">
                    <button
                      onClick={() => router.push(`/learn?topic=${topicId}`)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Continue studying →
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
