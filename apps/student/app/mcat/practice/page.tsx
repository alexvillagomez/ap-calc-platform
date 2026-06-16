"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import { LoadingPanel } from "@/components/mcat/LoadingPanel";
import FeedbackWidget from "@/components/mcat/FeedbackWidget";
import MathText from "@/components/mcat/MathText";
import QuestionToolbar from "@/components/practice/QuestionToolbar";
import { primaryKeywordId } from "@/lib/primaryKeyword";
import { getOrCreateMcatSession } from "@/lib/mcatSession";

// ── Types ────────────────────────────────────────────────────────────────────

interface InDepthChild {
  id: string;
  label: string;
  description: string;
  score: number | null;
  total_attempts: number;
  needs_lesson: boolean;
}

interface TaxonomyUmbrella {
  id: string;
  label: string;
  description: string;
  score: number | null;
  implied_score: number | null;
  total_attempts: number;
  children: InDepthChild[];
}

interface TaxonomyCategory {
  id: string;
  label: string;
  description: string;
  umbrellas?: TaxonomyUmbrella[];
}

interface Question {
  id: string;
  stem: string;
  choices: string[];
  correct_index: number;
  explanation: string;
  keyword_weights: Record<string, number>;
  /** Authoritative toolbar keyword (embedding-matched); falls back to max-weight. */
  primary_keyword_id?: string | null;
  difficulty: number;
  parent_question_id: string | null;
}

type PagePhase = "select" | "practice";
type QuestionPhase =
  | "answering"
  | "revealed"
  | "loading-next"
  | "loading-similar"
  | "error";

interface SessionStats {
  answered: number;
  correct: number;
}

// ── Taxonomy helpers ──────────────────────────────────────────────────────────

/**
 * Collect every selectable leaf id from a category.
 * If an umbrella has no children, the umbrella itself is treated as the leaf.
 */
function categoryLeafIds(cat: TaxonomyCategory): string[] {
  const ids: string[] = [];
  for (const u of cat.umbrellas ?? []) {
    if (u.children.length > 0) {
      for (const c of u.children) ids.push(c.id);
    } else {
      ids.push(u.id);
    }
  }
  return ids;
}

function umbrellaLeafIds(u: TaxonomyUmbrella): string[] {
  if (u.children.length > 0) return u.children.map((c) => c.id);
  return [u.id];
}

/** Returns "all" | "some" | "none" */
function selectionState(
  leafIds: string[],
  selected: Set<string>
): "all" | "some" | "none" {
  if (leafIds.length === 0) return "none";
  const count = leafIds.filter((id) => selected.has(id)).length;
  if (count === 0) return "none";
  if (count === leafIds.length) return "all";
  return "some";
}

function umbrellaDisplayScore(u: TaxonomyUmbrella): number | null {
  if (u.implied_score !== null) return Math.round(u.implied_score * 100);
  if (u.score !== null) return Math.round(u.score * 100);
  return null;
}

function categoryDisplayScore(cat: TaxonomyCategory): number | null {
  const umbrellas = cat.umbrellas ?? [];
  const scores = umbrellas
    .map((u) => umbrellaDisplayScore(u))
    .filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// ── Checkbox UI helper ────────────────────────────────────────────────────────

function Checkbox({
  state,
  onClick,
}: {
  state: "all" | "some" | "none";
  onClick: (e: React.MouseEvent) => void;
}) {
  const isAll = state === "all";
  const isSome = state === "some";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
        isAll
          ? "border-brand-500 bg-brand-500"
          : isSome
          ? "border-brand-400 bg-brand-100"
          : "border-neutral-300 bg-white hover:border-brand-400"
      }`}
      aria-label={isAll ? "Deselect" : "Select"}
    >
      {isAll && (
        <svg
          className="w-2.5 h-2.5 text-white"
          fill="none"
          viewBox="0 0 10 10"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            d="M1.5 5l2.5 2.5 4.5-4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {isSome && (
        <span className="w-2 h-0.5 bg-brand-500 rounded-full block" />
      )}
    </button>
  );
}

// ── Chevron ───────────────────────────────────────────────────────────────────

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 12 12"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── In-depth child row ────────────────────────────────────────────────────────

function ChildRow({
  child,
  selected,
  onToggle,
}: {
  child: InDepthChild;
  selected: boolean;
  onToggle: () => void;
}) {
  const pct =
    child.score !== null ? Math.round(child.score * 100) : null;

  return (
    <div className="flex items-center gap-2 py-2 border-t border-neutral-50 first:border-0">
      <Checkbox
        state={selected ? "all" : "none"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      />
      <span className="flex-1 text-xs text-neutral-700 min-w-0 truncate">
        {child.label}
      </span>
      {pct !== null ? (
        <span
          className={`text-xs font-medium shrink-0 ${
            pct >= 80
              ? "text-success-500"
              : pct >= 50
              ? "text-amber-600"
              : "text-error-500"
          }`}
        >
          {pct}%
        </span>
      ) : (
        <span className="text-xs text-neutral-400 shrink-0">—</span>
      )}
    </div>
  );
}

// ── Umbrella row ──────────────────────────────────────────────────────────────

function UmbrellaRow({
  umbrella,
  selected,
  expandedUmbrellas,
  onToggle,
  onChildToggle,
  onExpandToggle,
}: {
  umbrella: TaxonomyUmbrella;
  selected: Set<string>;
  expandedUmbrellas: Set<string>;
  onToggle: (leafIds: string[]) => void;
  onChildToggle: (id: string) => void;
  onExpandToggle: (id: string) => void;
}) {
  const leafIds = umbrellaLeafIds(umbrella);
  const state = selectionState(leafIds, selected);
  const displayScore = umbrellaDisplayScore(umbrella);
  const expanded = expandedUmbrellas.has(umbrella.id);
  const hasChildren = umbrella.children.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 py-2.5">
        <Checkbox
          state={state}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(leafIds);
          }}
        />
        {/* Expand button */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onExpandToggle(umbrella.id)}
            className="shrink-0 w-4 h-4 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-colors"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <Chevron expanded={expanded} />
          </button>
        ) : (
          <span className="shrink-0 w-4 h-4" />
        )}
        <span
          className="flex-1 text-sm font-medium text-neutral-800 min-w-0 truncate cursor-pointer select-none"
          onClick={() => hasChildren && onExpandToggle(umbrella.id)}
        >
          {umbrella.label}
        </span>
        <div className="shrink-0 flex flex-col items-end gap-0.5 min-w-[52px]">
          {displayScore !== null ? (
            <>
              <span
                className={`text-xs font-medium ${
                  displayScore >= 80
                    ? "text-success-500"
                    : displayScore >= 50
                    ? "text-amber-600"
                    : "text-error-500"
                }`}
              >
                {displayScore}%
              </span>
              <ProgressBar value={displayScore} size="xs" color={displayScore >= 80 ? "success" : displayScore >= 50 ? "brand" : "error"} label={umbrella.label} className="w-12" />
            </>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="pl-8 border-l-2 border-brand-100 ml-2 mb-1">
          {umbrella.children.map((child) => (
            <ChildRow
              key={child.id}
              child={child}
              selected={selected.has(child.id)}
              onToggle={() => onChildToggle(child.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Category row ──────────────────────────────────────────────────────────────

function CategoryRow({
  cat,
  selected,
  expandedCategories,
  expandedUmbrellas,
  onCategoryToggle,
  onUmbrellaToggle,
  onChildToggle,
  onCategoryExpandToggle,
  onUmbrellaExpandToggle,
}: {
  cat: TaxonomyCategory;
  selected: Set<string>;
  expandedCategories: Set<string>;
  expandedUmbrellas: Set<string>;
  onCategoryToggle: (leafIds: string[]) => void;
  onUmbrellaToggle: (leafIds: string[]) => void;
  onChildToggle: (id: string) => void;
  onCategoryExpandToggle: (id: string) => void;
  onUmbrellaExpandToggle: (id: string) => void;
}) {
  const leafIds = categoryLeafIds(cat);
  const state = selectionState(leafIds, selected);
  const displayScore = categoryDisplayScore(cat);
  const expanded = expandedCategories.has(cat.id);
  const hasUmbrellas = (cat.umbrellas ?? []).length > 0;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-brand-xs overflow-hidden">
      {/* Category header */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Checkbox
            state={state}
            onClick={(e) => {
              e.stopPropagation();
              onCategoryToggle(leafIds);
            }}
          />
          {hasUmbrellas ? (
            <button
              type="button"
              onClick={() => onCategoryExpandToggle(cat.id)}
              className="shrink-0 w-4 h-4 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-colors"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              <Chevron expanded={expanded} />
            </button>
          ) : (
            <span className="shrink-0 w-4 h-4" />
          )}
          <span
            className="flex-1 text-sm font-semibold text-neutral-900 min-w-0 truncate cursor-pointer select-none"
            onClick={() => hasUmbrellas && onCategoryExpandToggle(cat.id)}
          >
            {cat.label}
          </span>
          {displayScore !== null ? (
            <span
              className={`shrink-0 text-xs font-semibold ${
                displayScore >= 80
                  ? "text-success-500"
                  : displayScore >= 50
                  ? "text-amber-600"
                  : "text-error-500"
              }`}
            >
              {displayScore}%
            </span>
          ) : (
            <span className="shrink-0 text-xs text-neutral-400">Not started</span>
          )}
        </div>
      </div>

      {/* Umbrella list */}
      {hasUmbrellas && expanded && (
        <div className="px-4 pb-2 border-t border-neutral-100 divide-y-0">
          {(cat.umbrellas ?? []).map((u) => (
            <UmbrellaRow
              key={u.id}
              umbrella={u}
              selected={selected}
              expandedUmbrellas={expandedUmbrellas}
              onToggle={onUmbrellaToggle}
              onChildToggle={onChildToggle}
              onExpandToggle={onUmbrellaExpandToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function McatPracticePage() {
  const [sessionId, setSessionId] = useState("");
  const [categories, setCategories] = useState<TaxonomyCategory[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [catsError, setCatsError] = useState<string | null>(null);

  // ── Selection state (single source of truth: a Set of in-depth leaf ids) ──
  const [selectedLeafs, setSelectedLeafs] = useState<Set<string>>(new Set());

  // ── Expand state ──
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );
  const [expandedUmbrellas, setExpandedUmbrellas] = useState<Set<string>>(
    new Set()
  );

  // ── Practice phase ──
  const [pagePhase, setPagePhase] = useState<PagePhase>("select");
  const [questionPhase, setQuestionPhase] =
    useState<QuestionPhase>("loading-next");
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [dontKnow, setDontKnow] = useState(false);
  const [revealCorrect, setRevealCorrect] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<string>("");
  const [usedRefresher, setUsedRefresher] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [stats, setStats] = useState<SessionStats>({ answered: 0, correct: 0 });

  useEffect(() => {
    (async () => {
      const sid = await getOrCreateMcatSession();
      setSessionId(sid);
      await loadCategories(sid);
    })();
  }, []); // loadCategories is defined below; intentional once-on-mount

  const loadCategories = async (sid: string) => {
    setLoadingCats(true);
    setCatsError(null);
    try {
      const res = await fetch(`/api/mcat/taxonomy?session_id=${sid}`);
      if (!res.ok) throw new Error(await res.text().catch(() => "Unknown error"));
      const data = (await res.json()) as { categories: TaxonomyCategory[] };
      setCategories(data.categories ?? []);
    } catch (e) {
      setCatsError((e as Error).message ?? "Failed to load categories");
    } finally {
      setLoadingCats(false);
    }
  };

  // ── Selection helpers ─────────────────────────────────────────────────────

  /**
   * Toggle a set of leaf ids.
   * If all are already selected → deselect all. Otherwise → select all.
   */
  const toggleLeafs = useCallback((leafIds: string[]) => {
    setSelectedLeafs((prev) => {
      const allSelected = leafIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of leafIds) next.delete(id);
      } else {
        for (const id of leafIds) next.add(id);
      }
      return next;
    });
  }, []);

  const toggleLeaf = useCallback((id: string) => {
    setSelectedLeafs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpandCategory = useCallback((id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpandUmbrella = useCallback((id: string) => {
    setExpandedUmbrellas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allLeafIds = categories.flatMap(categoryLeafIds);

  const toggleSelectAll = () => {
    if (selectedLeafs.size === allLeafIds.length && allLeafIds.length > 0) {
      setSelectedLeafs(new Set());
    } else {
      setSelectedLeafs(new Set(allLeafIds));
    }
  };

  // ── Summary line ──────────────────────────────────────────────────────────

  // Count how many distinct topic "categories" have at least one selected leaf
  const topicsWithSelection = categories.filter(
    (cat) => categoryLeafIds(cat).some((id) => selectedLeafs.has(id))
  ).length;

  // ── Build API payload from selection ─────────────────────────────────────

  /**
   * If the entire selection is made up of one-or-more whole categories (every
   * leaf in those categories is selected, and no partial categories are
   * included), send category_ids only. Otherwise send keyword_ids explicitly.
   */
  function buildApiPayload(): {
    category_ids?: string[];
    keyword_ids?: string[];
  } {
    // Categorise each category: "all" | "partial" | "none"
    const wholeCatIds: string[] = [];
    let hasPartial = false;

    for (const cat of categories) {
      const leafIds = categoryLeafIds(cat);
      const state = selectionState(leafIds, selectedLeafs);
      if (state === "all") wholeCatIds.push(cat.id);
      if (state === "some") hasPartial = true;
    }

    if (!hasPartial && wholeCatIds.length > 0) {
      // Pure whole-category selection → use category_ids (smaller payload)
      return { category_ids: wholeCatIds };
    }

    // Any partial selection → enumerate all keyword ids explicitly
    return { keyword_ids: Array.from(selectedLeafs) };
  }

  // ── Practice loop ─────────────────────────────────────────────────────────

  const startPractice = () => {
    setPagePhase("practice");
    setExcludeIds([]);
    setStats({ answered: 0, correct: 0 });
    fetchNextQuestion([]);
  };

  const fetchNextQuestion = async (currentExclude: string[]) => {
    setQuestionPhase("loading-next");
    setCurrentQuestion(null);
    setSelectedChoice(null);
    setDontKnow(false);
    setRevealCorrect(null);
    setExplanation("");
    setUsedRefresher(false);
    setErrorMsg("");

    try {
      const payload = buildApiPayload();
      const res = await fetch("/api/mcat/next-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          ...payload,
          exclude_ids:
            currentExclude.length > 0 ? currentExclude : undefined,
        }),
      });
      if (!res.ok)
        throw new Error(await res.text().catch(() => "Unknown error"));
      const data = (await res.json()) as {
        question: Question;
        generated: boolean;
      };
      setCurrentQuestion(data.question);
      setQuestionPhase("answering");
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Failed to fetch question");
      setQuestionPhase("error");
    }
  };

  const handleDontKnow = async () => {
    if (!currentQuestion || questionPhase !== "answering") return;
    setDontKnow(true);

    fetch("/api/mcat/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: currentQuestion.id,
        dont_know: true,
        context: "practice",
        usedRefresher,
      }),
    }).catch(() => {});

    const newExclude = [...excludeIds, currentQuestion.id];
    setExcludeIds(newExclude);
    setRevealCorrect(currentQuestion.correct_index);
    setExplanation(currentQuestion.explanation);
    setStats((s) => ({ ...s, answered: s.answered + 1 }));
    setQuestionPhase("revealed");
  };

  const handleChoice = async (idx: number) => {
    if (!currentQuestion || questionPhase !== "answering") return;
    setSelectedChoice(idx);

    fetch("/api/mcat/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: currentQuestion.id,
        selected_index: idx,
        context: "practice",
        usedRefresher,
      }),
    }).catch(() => {});

    const isCorrect = idx === currentQuestion.correct_index;
    const newExclude = [...excludeIds, currentQuestion.id];
    setExcludeIds(newExclude);
    setRevealCorrect(currentQuestion.correct_index);
    setExplanation(currentQuestion.explanation);
    setStats((s) => ({
      answered: s.answered + 1,
      correct: s.correct + (isCorrect ? 1 : 0),
    }));
    setQuestionPhase("revealed");
  };

  const handleSimilar = async () => {
    if (!currentQuestion) return;
    setQuestionPhase("loading-similar");

    try {
      const res = await fetch("/api/mcat/similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          question_id: currentQuestion.id,
        }),
      });
      if (!res.ok)
        throw new Error(await res.text().catch(() => "Unknown error"));
      const data = (await res.json()) as { question: Question };
      const newQ = data.question;
      const newExclude = [...excludeIds];
      if (!newExclude.includes(newQ.id)) newExclude.push(newQ.id);
      setExcludeIds(newExclude);
      setCurrentQuestion(newQ);
      setSelectedChoice(null);
      setDontKnow(false);
      setRevealCorrect(null);
      setExplanation("");
      setUsedRefresher(false);
      setQuestionPhase("answering");
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Failed to fetch similar question");
      setQuestionPhase("error");
    }
  };

  const handleNext = () => {
    fetchNextQuestion(excludeIds);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/mcat" className="shrink-0">
              <LoderaLogo size={22} />
            </Link>
            <Link
              href="/mcat"
              className="text-xs text-neutral-400 hover:text-brand-600 shrink-0 transition-colors"
            >
              ← MCAT
            </Link>
            <p className="font-semibold text-neutral-900 text-sm truncate">
              General Practice
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {pagePhase === "practice" && (
              <>
                <span className="text-xs text-neutral-500 shrink-0">
                  {stats.correct}/{stats.answered} correct
                </span>
                <button
                  onClick={() => setPagePhase("select")}
                  className="text-xs text-brand-600 hover:text-brand-800 shrink-0"
                >
                  Change topics
                </button>
              </>
            )}
            <StreakBadge />
            <SoundToggle />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* ── Phase 1: Topic select ──────────────────────────────────────── */}
        {pagePhase === "select" && (
          <>
            <div>
              <h2 className="text-base font-semibold text-neutral-900 mb-1">
                Choose topics to practice
              </h2>
              <p className="text-sm text-neutral-500">
                Select categories, umbrellas, or individual keywords.
              </p>
            </div>

            {loadingCats && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="relative w-10 h-10">
                  <div className="w-10 h-10 rounded-full border-4 border-brand-100" />
                  <div className="absolute inset-0 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
                </div>
                <p className="text-sm text-neutral-500">Loading categories…</p>
              </div>
            )}

            {!loadingCats && catsError && (
              <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center">
                <p className="text-sm text-error-600 mb-3">{catsError}</p>
                <Button variant="primary" size="sm" onClick={() => loadCategories(sessionId)}>
                  Try again
                </Button>
              </div>
            )}

            {!loadingCats && !catsError && (
              <>
                {/* Toolbar: select all + summary */}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-neutral-500">
                    {selectedLeafs.size > 0 ? (
                      <>
                        <span className="font-medium text-neutral-700">
                          {selectedLeafs.size}
                        </span>{" "}
                        keyword{selectedLeafs.size !== 1 ? "s" : ""} selected
                        {topicsWithSelection > 0 && (
                          <>
                            {" "}
                            across{" "}
                            <span className="font-medium text-neutral-700">
                              {topicsWithSelection}
                            </span>{" "}
                            topic{topicsWithSelection !== 1 ? "s" : ""}
                          </>
                        )}
                      </>
                    ) : (
                      "No keywords selected"
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-xs font-medium text-brand-600 hover:text-brand-800 shrink-0"
                  >
                    {selectedLeafs.size === allLeafIds.length &&
                    allLeafIds.length > 0
                      ? "Clear"
                      : "Select all"}
                  </button>
                </div>

                {/* Category tree */}
                <div className="space-y-3">
                  {categories.map((cat) => (
                    <CategoryRow
                      key={cat.id}
                      cat={cat}
                      selected={selectedLeafs}
                      expandedCategories={expandedCategories}
                      expandedUmbrellas={expandedUmbrellas}
                      onCategoryToggle={toggleLeafs}
                      onUmbrellaToggle={toggleLeafs}
                      onChildToggle={toggleLeaf}
                      onCategoryExpandToggle={toggleExpandCategory}
                      onUmbrellaExpandToggle={toggleExpandUmbrella}
                    />
                  ))}
                </div>

                {categories.length === 0 && (
                  <p className="text-sm text-neutral-400 text-center py-8">
                    No categories available yet.
                  </p>
                )}

                {/* Start button */}
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={startPractice}
                  disabled={selectedLeafs.size === 0}
                  className="w-full mt-2"
                >
                  Start practice
                </Button>
              </>
            )}
          </>
        )}

        {/* ── Phase 2: Practice loop ─────────────────────────────────────── */}
        {pagePhase === "practice" && (
          <>
            {/* Loading next question */}
            {questionPhase === "loading-next" && (
              <LoadingPanel
                message="Generating a question… can take ~20s"
                sub="Finding the best question for your selected topics"
              />
            )}

            {/* Loading similar question */}
            {questionPhase === "loading-similar" && (
              <LoadingPanel
                message="Generating a similar question…"
                sub="This can take ~20s"
              />
            )}

            {/* Error */}
            {questionPhase === "error" && (
              <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center">
                <p className="text-sm text-error-600 mb-3">
                  {errorMsg || "Failed to load question"}
                </p>
                <Button variant="primary" size="sm" onClick={() => fetchNextQuestion(excludeIds)}>
                  Try again
                </Button>
              </div>
            )}

            {/* Active question */}
            {(questionPhase === "answering" ||
              questionPhase === "revealed") &&
              currentQuestion && (
                <>
                  {/* Stem */}
                  <Card>
                    <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                      <MathText>{currentQuestion.stem}</MathText>
                    </p>
                  </Card>

                  <QuestionToolbar
                    system="mcat"
                    keywordId={
                      currentQuestion.primary_keyword_id ??
                      primaryKeywordId(currentQuestion.keyword_weights)
                    }
                    sessionId={sessionId}
                    questionId={currentQuestion.id}
                    contentType="question"
                    resetSignal={currentQuestion.id}
                    onRefresherUsed={() => setUsedRefresher(true)}
                  />

                  {/* Choices */}
                  <div className="space-y-2">
                    {currentQuestion.choices.map((choice, i) => {
                      let state: "default" | "correct" | "wrong" | "dimmed" =
                        "default";
                      if (questionPhase === "revealed") {
                        if (i === revealCorrect) state = "correct";
                        else if (!dontKnow && i === selectedChoice)
                          state = "wrong";
                        else state = "dimmed";
                      }
                      return (
                        <ChoiceButton
                          key={i}
                          index={i}
                          text={choice}
                          state={state}
                          disabled={questionPhase === "revealed"}
                          onClick={() => handleChoice(i)}
                        />
                      );
                    })}
                  </div>

                  {/* I don't know — only before answering */}
                  {questionPhase === "answering" && (
                    <div className="flex justify-center">
                      <button
                        onClick={handleDontKnow}
                        className="text-xs text-neutral-400 hover:text-neutral-600 underline"
                      >
                        I don&apos;t know
                      </button>
                    </div>
                  )}

                  {/* Post-answer reveal */}
                  {questionPhase === "revealed" && (
                    <>
                      {/* Result pill */}
                      <div className="flex justify-center">
                        {dontKnow ? (
                          <span className="px-3 py-1 rounded-full bg-neutral-100 text-neutral-600 text-xs font-medium">
                            Skipped — correct answer highlighted above
                          </span>
                        ) : selectedChoice === revealCorrect ? (
                          <span className="px-3 py-1 rounded-full bg-success-100 text-success-600 text-xs font-semibold">
                            Correct!
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded-full bg-error-100 text-error-600 text-xs font-semibold">
                            Incorrect
                          </span>
                        )}
                      </div>

                      {/* Explanation */}
                      {explanation && (
                        <div className="bg-brand-50 rounded-xl px-4 py-3 border border-brand-100">
                          <p className="text-xs font-semibold text-brand-600 mb-1 uppercase tracking-wide">
                            Explanation
                          </p>
                          <p className="text-sm text-brand-800 leading-relaxed">
                            <MathText>{explanation}</MathText>
                          </p>
                        </div>
                      )}

                      {/* Feedback widget */}
                      <FeedbackWidget
                        sessionId={sessionId}
                        contentType="question"
                        contentId={currentQuestion.id}
                        className="px-1"
                      />

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <Button variant="secondary" size="lg" onClick={handleSimilar} className="flex-1">
                          Similar question
                        </Button>
                        <Button variant="primary" size="lg" onClick={handleNext} className="flex-1">
                          Next question →
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
          </>
        )}
      </main>
    </div>
  );
}
