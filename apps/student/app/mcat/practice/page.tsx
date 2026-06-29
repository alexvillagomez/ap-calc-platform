"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { NavMenu } from "@/components/nav/NavMenu";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import { LoadingPanel } from "@/components/mcat/LoadingPanel";
import FeedbackWidget from "@/components/mcat/FeedbackWidget";
import MathText from "@/components/mcat/MathText";
import QuestionToolbar from "@/components/practice/QuestionToolbar";
import FlipCard, { type FlipResult } from "@/components/cards/FlipCard";
import LessonModal from "@/components/practice/LessonModal";
import { primaryKeywordId } from "@/lib/primaryKeyword";
import { getOrCreateMcatSession } from "@/lib/mcatSession";
import { groupCategoriesBySection } from "@/lib/mcatSection";
import { awardFlashcard, awardQuiz } from "@/lib/points";
import {
  pickKeyword,
  pickContentKind,
  shouldShowLesson,
  type EnabledTypes,
  type KeywordPick,
} from "@/lib/courseEngine/generalPractice";
import { tierForMastery } from "@/lib/courseEngine/adaptive";

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
  section?: string;
  order_index?: number;
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

interface Flashcard {
  id: string;
  front: string;
  back: string;
  keyword_weights: Record<string, number>;
}

/** The active practice item — a quiz question or a memorization flashcard. */
type ActiveItem =
  | { kind: "question"; data: Question }
  | { kind: "flashcard"; data: Flashcard };

/** Shape of the per-keyword state map returned by the attempt routes. */
type KwStates = Record<
  string,
  { score?: number; state?: string; needs_lesson?: boolean }
>;

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

/**
 * Index the loaded taxonomy into two leaf maps: leafId → mastery-score and
 * leafId → category id (the question/flashcard routes need the category to load
 * their pools). Each in-depth child uses its own score; a childless umbrella
 * uses its (implied) score. Unknown scores default to 0.5.
 */
function seedLeafIndex(
  cats: TaxonomyCategory[],
  scoreMap: Map<string, number>,
  catMap: Map<string, string>
): void {
  for (const cat of cats) {
    for (const u of cat.umbrellas ?? []) {
      if (u.children.length > 0) {
        for (const c of u.children) {
          scoreMap.set(c.id, c.score ?? 0.5);
          catMap.set(c.id, cat.id);
        }
      } else {
        scoreMap.set(u.id, u.implied_score ?? u.score ?? 0.5);
        catMap.set(u.id, cat.id);
      }
    }
  }
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

function McatPracticePageInner() {
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get("section") ?? null;

  const [sessionId, setSessionId] = useState("");
  const [allCategories, setAllCategories] = useState<TaxonomyCategory[]>([]);
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

  // ── Content-type choices (what the student wants served) ──────────────────
  const [enabled, setEnabled] = useState<EnabledTypes>({
    lessons: true,
    flashcards: true,
    quizzes: true,
  });

  // ── Practice phase ──
  const [pagePhase, setPagePhase] = useState<PagePhase>("select");
  const [itemPhase, setItemPhase] = useState<QuestionPhase>("loading-next");
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);
  const [currentKeywordId, setCurrentKeywordId] = useState<string | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [dontKnow, setDontKnow] = useState(false);
  const [revealCorrect, setRevealCorrect] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<string>("");
  const [usedRefresher, setUsedRefresher] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [stats, setStats] = useState<SessionStats>({ answered: 0, correct: 0 });
  /** Keyword whose lesson is shown inline (null = no lesson open). */
  const [lessonModalKw, setLessonModalKw] = useState<string | null>(null);

  // ── Serving bookkeeping (refs — read inside async serve/answer flows) ─────
  /** Snapshot of the selected leaf ids, frozen when practice starts. */
  const selectionRef = useRef<string[]>([]);
  /** Live per-keyword mastery (seeded from taxonomy, updated from attempts). */
  const scoresRef = useRef<Map<string, number>>(new Map());
  /** leafId → category id (the question/flashcard routes need the category). */
  const categoryOfRef = useRef<Map<string, string>>(new Map());
  /** Per-keyword recent-miss counter → drives easier difficulty when struggling. */
  const recentWrongRef = useRef<Map<string, number>>(new Map());
  /** Keywords whose lesson has already been auto-surfaced this session. */
  const lessonShownRef = useRef<Set<string>>(new Set());
  /** Question ids already served (exclude from the next-question pool). */
  const excludeRef = useRef<string[]>([]);
  /** Flashcard ids already shown this session. */
  const seenCardsRef = useRef<Set<string>>(new Set());

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
      setAllCategories(data.categories ?? []);
      seedLeafIndex(
        data.categories ?? [],
        scoresRef.current,
        categoryOfRef.current
      );
    } catch (e) {
      setCatsError((e as Error).message ?? "Failed to load categories");
    } finally {
      setLoadingCats(false);
    }
  };

  // Filter categories by section when a section param is present; otherwise show all.
  const categories = sectionParam
    ? allCategories.filter((cat) => cat.section === sectionParam)
    : allCategories;

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
  const allSelected =
    allLeafIds.length > 0 && selectedLeafs.size === allLeafIds.length;

  const selectAll = () => setSelectedLeafs(new Set(allLeafIds));
  const deselectAll = () => setSelectedLeafs(new Set());

  // Categories grouped into the four MCAT sections, in curriculum order, so the
  // selection list reads top-to-bottom by course instead of a cross-section mix.
  const sectionGroups = groupCategoriesBySection(categories);

  // ── Summary line ──────────────────────────────────────────────────────────

  // Count how many distinct topic "categories" have at least one selected leaf
  const topicsWithSelection = categories.filter(
    (cat) => categoryLeafIds(cat).some((id) => selectedLeafs.has(id))
  ).length;

  // ── Practice loop (general practice = controlled randomness) ──────────────

  /** The selected keywords with their current mastery, for keyword selection. */
  function buildPool(): KeywordPick[] {
    return selectionRef.current.map((id) => ({
      id,
      score: scoresRef.current.get(id) ?? 0.5,
    }));
  }

  /** Merge fresh per-keyword scores from an attempt response into scoresRef. */
  function applyScores(states?: KwStates | null) {
    if (!states) return;
    for (const [kw, st] of Object.entries(states)) {
      if (typeof st.score === "number") scoresRef.current.set(kw, st.score);
    }
  }

  /** Surface a lesson inline iff a miss left the keyword's mastery low enough. */
  function maybeLesson(
    kwId: string | null,
    wasMiss: boolean,
    states?: KwStates | null
  ) {
    if (!kwId) return;
    const st = states?.[kwId];
    const scoreAfter =
      typeof st?.score === "number"
        ? st.score
        : scoresRef.current.get(kwId) ?? null;
    const serverNeedsLesson =
      st?.needs_lesson === true || st?.state === "needs_lesson";
    if (
      shouldShowLesson({
        enabled,
        wasMiss,
        alreadyShown: lessonShownRef.current.has(kwId),
        scoreAfter,
        serverNeedsLesson,
      })
    ) {
      lessonShownRef.current.add(kwId);
      setLessonModalKw(kwId);
    }
  }

  /** Fetch one quiz question scoped to a single keyword, at a skill-fit difficulty. */
  async function fetchQuestion(kwId: string): Promise<Question> {
    const score = scoresRef.current.get(kwId) ?? 0.5;
    const recentlyBad = (recentWrongRef.current.get(kwId) ?? 0) >= 1;
    const res = await fetch("/api/mcat/next-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        category_id: categoryOfRef.current.get(kwId),
        keyword_id: kwId,
        difficulty: tierForMastery(score, recentlyBad),
        exclude_ids: excludeRef.current.length ? excludeRef.current : undefined,
      }),
    });
    if (!res.ok) throw new Error(await res.text().catch(() => "Unknown error"));
    const data = (await res.json()) as { question: Question };
    return data.question;
  }

  /** Fetch one not-yet-seen flashcard for a keyword (null when none available). */
  async function fetchFlashcard(kwId: string): Promise<Flashcard | null> {
    const res = await fetch("/api/mcat/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        category_id: categoryOfRef.current.get(kwId),
        keyword_id: kwId,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { flashcards?: Flashcard[] };
    const deck = data.flashcards ?? [];
    if (deck.length === 0) return null;
    return deck.find((c) => !seenCardsRef.current.has(c.id)) ?? deck[0] ?? null;
  }

  /**
   * Serve the next item: pick a keyword (60% random / 40% weakness-weighted),
   * then pick flashcard-vs-question adaptively by mastery (within the enabled
   * types), and fetch it. `depth` bounds the no-content retry loop.
   */
  async function serveNext(depth = 0): Promise<void> {
    setItemPhase("loading-next");
    setActiveItem(null);
    setSelectedChoice(null);
    setDontKnow(false);
    setRevealCorrect(null);
    setExplanation("");
    setUsedRefresher(false);
    setErrorMsg("");

    const kw = pickKeyword(buildPool());
    if (!kw) {
      setErrorMsg("No topics selected.");
      setItemPhase("error");
      return;
    }
    setCurrentKeywordId(kw.id);
    const kind = pickContentKind(kw.score, enabled);

    try {
      if (kind === "flashcard") {
        const card = await fetchFlashcard(kw.id);
        if (card) {
          setActiveItem({ kind: "flashcard", data: card });
          setItemPhase("answering");
          return;
        }
        // No flashcard for this keyword → fall back to a question if allowed,
        // otherwise try a different keyword (bounded retries).
        if (enabled.quizzes) {
          const q = await fetchQuestion(kw.id);
          setActiveItem({ kind: "question", data: q });
          setItemPhase("answering");
          return;
        }
        if (depth < 5) return serveNext(depth + 1);
        setErrorMsg("No flashcards available for the selected topics yet.");
        setItemPhase("error");
        return;
      }

      // question (pickContentKind only returns null when neither type is
      // enabled, which the Start button prevents)
      const q = await fetchQuestion(kw.id);
      setActiveItem({ kind: "question", data: q });
      setItemPhase("answering");
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Failed to load the next item");
      setItemPhase("error");
    }
  }

  const startPractice = () => {
    selectionRef.current = Array.from(selectedLeafs);
    excludeRef.current = [];
    seenCardsRef.current = new Set();
    recentWrongRef.current = new Map();
    lessonShownRef.current = new Set();
    setLessonModalKw(null);
    setStats({ answered: 0, correct: 0 });
    setPagePhase("practice");
    serveNext(0);
  };

  // ── Answer handlers ───────────────────────────────────────────────────────

  const handleChoice = async (idx: number) => {
    if (
      !activeItem ||
      activeItem.kind !== "question" ||
      itemPhase !== "answering"
    )
      return;
    const q = activeItem.data;
    const kwId = currentKeywordId;
    setSelectedChoice(idx);
    const isCorrect = idx === q.correct_index;

    if (kwId) {
      recentWrongRef.current.set(
        kwId,
        isCorrect ? 0 : (recentWrongRef.current.get(kwId) ?? 0) + 1
      );
    }
    if (isCorrect) awardQuiz();

    fetch("/api/mcat/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: q.id,
        selected_index: idx,
        context: "practice",
        usedRefresher,
      }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { keyword_states?: KwStates };
        applyScores(data.keyword_states);
        maybeLesson(kwId, !isCorrect, data.keyword_states);
      })
      .catch(() => {});

    excludeRef.current = [...excludeRef.current, q.id];
    setRevealCorrect(q.correct_index);
    setExplanation(q.explanation);
    setStats((s) => ({
      answered: s.answered + 1,
      correct: s.correct + (isCorrect ? 1 : 0),
    }));
    setItemPhase("revealed");
  };

  const handleDontKnow = async () => {
    if (
      !activeItem ||
      activeItem.kind !== "question" ||
      itemPhase !== "answering"
    )
      return;
    const q = activeItem.data;
    const kwId = currentKeywordId;
    setDontKnow(true);
    if (kwId) {
      recentWrongRef.current.set(
        kwId,
        (recentWrongRef.current.get(kwId) ?? 0) + 1
      );
    }

    fetch("/api/mcat/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: q.id,
        dont_know: true,
        context: "practice",
        usedRefresher,
      }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { keyword_states?: KwStates };
        applyScores(data.keyword_states);
        maybeLesson(kwId, true, data.keyword_states);
      })
      .catch(() => {});

    excludeRef.current = [...excludeRef.current, q.id];
    setRevealCorrect(q.correct_index);
    setExplanation(q.explanation);
    setStats((s) => ({ ...s, answered: s.answered + 1 }));
    setItemPhase("revealed");
  };

  const handleGrade = async (result: FlipResult) => {
    if (!activeItem || activeItem.kind !== "flashcard") return;
    const card = activeItem.data;
    const kwId = currentKeywordId;
    const gotIt = result === "got_it";

    seenCardsRef.current.add(card.id);
    if (kwId) {
      recentWrongRef.current.set(
        kwId,
        gotIt ? 0 : (recentWrongRef.current.get(kwId) ?? 0) + 1
      );
    }
    if (gotIt) awardFlashcard();
    setStats((s) => ({
      answered: s.answered + 1,
      correct: s.correct + (gotIt ? 1 : 0),
    }));

    try {
      const res = await fetch("/api/mcat/flashcard-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          flashcard_id: card.id,
          result,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { keyword_states?: KwStates };
        applyScores(data.keyword_states);
        maybeLesson(kwId, !gotIt, data.keyword_states);
      }
    } catch {
      /* non-fatal */
    }

    // Flashcards have no separate reveal screen — advance straight to the next
    // item. A surfaced lesson (if any) overlays on top until dismissed.
    serveNext(0);
  };

  const handleSimilar = async () => {
    if (!activeItem || activeItem.kind !== "question") return;
    const q = activeItem.data;
    setItemPhase("loading-similar");
    try {
      const res = await fetch("/api/mcat/similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, question_id: q.id }),
      });
      if (!res.ok)
        throw new Error(await res.text().catch(() => "Unknown error"));
      const data = (await res.json()) as { question: Question };
      const newQ = data.question;
      if (!excludeRef.current.includes(newQ.id)) {
        excludeRef.current = [...excludeRef.current, newQ.id];
      }
      setActiveItem({ kind: "question", data: newQ });
      setSelectedChoice(null);
      setDontKnow(false);
      setRevealCorrect(null);
      setExplanation("");
      setUsedRefresher(false);
      setItemPhase("answering");
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Failed to fetch similar question");
      setItemPhase("error");
    }
  };

  const handleNext = () => {
    serveNext(0);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-2.5 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link href="/mcat" className="shrink-0">
              <LoderaLogo size={20} />
            </Link>
            <Link
              href="/mcat"
              className="text-xs text-neutral-400 hover:text-brand-600 shrink-0 transition-colors whitespace-nowrap"
            >
              ← MCAT
            </Link>
            <p className="font-semibold text-neutral-900 text-sm truncate min-w-0">
              Custom Practice
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pagePhase === "practice" && stats.answered > 0 && (
              <span className="text-xs text-neutral-500 tabular-nums shrink-0">
                {stats.correct}/{stats.answered}
              </span>
            )}
            {pagePhase === "practice" && (
              <button
                onClick={() => setPagePhase("select")}
                className="hidden sm:inline text-xs text-brand-600 hover:text-brand-800 shrink-0 whitespace-nowrap"
              >
                Change topics
              </button>
            )}
            <StreakBadge />
            <NavMenu />
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
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={selectAll}
                      disabled={allSelected}
                      className="text-xs font-medium text-brand-600 hover:text-brand-800 disabled:text-neutral-300 disabled:hover:text-neutral-300"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={deselectAll}
                      disabled={selectedLeafs.size === 0}
                      className="text-xs font-medium text-neutral-500 hover:text-neutral-700 disabled:text-neutral-300 disabled:hover:text-neutral-300"
                    >
                      Deselect all
                    </button>
                  </div>
                </div>

                {/* What to practice — content-type choices */}
                <div className="rounded-xl border border-neutral-200 bg-white p-3">
                  <p className="mb-2 text-xs font-medium text-neutral-500">
                    What to practice
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["flashcards", "Flashcards"],
                        ["quizzes", "Quizzes"],
                        ["lessons", "Lessons"],
                      ] as const
                    ).map(([key, label]) => {
                      const on = enabled[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            setEnabled((e) => ({ ...e, [key]: !e[key] }))
                          }
                          aria-pressed={on}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                            on
                              ? "border-brand-300 bg-brand-50 text-brand-700"
                              : "border-neutral-200 bg-white text-neutral-400 hover:border-neutral-300"
                          }`}
                        >
                          <span
                            className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                              on
                                ? "border-brand-500 bg-brand-500"
                                : "border-neutral-300 bg-white"
                            }`}
                          >
                            {on && (
                              <svg
                                className="h-2 w-2 text-white"
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
                          </span>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-neutral-400">
                    Flashcards and quizzes adapt to your level for each topic.
                    Lessons only appear when you keep missing one.
                  </p>
                </div>

                {/* Category tree — grouped by the four MCAT sections, each in
                    curriculum order; section header selects/deselects its set. */}
                <div className="space-y-6">
                  {sectionGroups.map((group) => {
                    const groupLeafIds =
                      group.categories.flatMap(categoryLeafIds);
                    const groupState = selectionState(
                      groupLeafIds,
                      selectedLeafs
                    );
                    return (
                      <div key={group.section} className="space-y-2.5">
                        {/* Section header with select-all-in-section */}
                        <div className="flex items-center gap-2 px-1">
                          <Checkbox
                            state={groupState}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLeafs(groupLeafIds);
                            }}
                          />
                          <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                            {group.label}
                          </h3>
                          <span className="text-[11px] text-neutral-400">
                            {group.categories.length}{" "}
                            categor{group.categories.length === 1 ? "y" : "ies"}
                          </span>
                        </div>
                        <div className="space-y-3">
                          {group.categories.map((cat) => (
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
                      </div>
                    );
                  })}
                </div>

                {categories.length === 0 && (
                  <p className="text-sm text-neutral-400 text-center py-8">
                    No categories available yet.
                  </p>
                )}

                {/* Start button */}
                {!enabled.flashcards && !enabled.quizzes && (
                  <p className="text-center text-xs text-amber-600">
                    Pick at least Flashcards or Quizzes — lessons appear
                    automatically when you need them.
                  </p>
                )}
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={startPractice}
                  disabled={
                    selectedLeafs.size === 0 ||
                    (!enabled.flashcards && !enabled.quizzes)
                  }
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
            {/* Loading next item */}
            {itemPhase === "loading-next" && (
              <LoadingPanel
                message="Finding your next item…"
                sub="Questions can take ~20s to generate the first time."
              />
            )}

            {/* Loading similar question */}
            {itemPhase === "loading-similar" && (
              <LoadingPanel
                message="Generating a similar question…"
                sub="This can take ~20s"
              />
            )}

            {/* Error */}
            {itemPhase === "error" && (
              <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center">
                <p className="text-sm text-error-600 mb-3">
                  {errorMsg || "Failed to load the next item"}
                </p>
                <Button variant="primary" size="sm" onClick={() => serveNext(0)}>
                  Try again
                </Button>
              </div>
            )}

            {/* Active flashcard */}
            {itemPhase === "answering" && activeItem?.kind === "flashcard" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                    Flashcard
                  </span>
                  <span className="text-xs text-neutral-400">
                    Recall it, then grade yourself
                  </span>
                </div>
                <FlipCard
                  front={activeItem.data.front}
                  back={activeItem.data.back}
                  onGrade={handleGrade}
                  resetKey={activeItem.data.id}
                />
              </>
            )}

            {/* Active question */}
            {(itemPhase === "answering" || itemPhase === "revealed") &&
              activeItem?.kind === "question" && (
                <>
                  {/* Stem */}
                  <Card>
                    <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                      <MathText>{activeItem.data.stem}</MathText>
                    </p>
                  </Card>

                  <QuestionToolbar
                    system="mcat"
                    keywordId={
                      currentKeywordId ??
                      activeItem.data.primary_keyword_id ??
                      primaryKeywordId(activeItem.data.keyword_weights)
                    }
                    sessionId={sessionId}
                    questionId={activeItem.data.id}
                    contentType="question"
                    resetSignal={activeItem.data.id}
                    answerSignal={itemPhase}
                    onRefresherUsed={() => setUsedRefresher(true)}
                  />

                  {/* Choices */}
                  <div className="space-y-2">
                    {activeItem.data.choices.map((choice, i) => {
                      let state: "default" | "correct" | "wrong" | "dimmed" =
                        "default";
                      if (itemPhase === "revealed") {
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
                          disabled={itemPhase === "revealed"}
                          onClick={() => handleChoice(i)}
                        />
                      );
                    })}
                  </div>

                  {/* I don't know — only before answering */}
                  {itemPhase === "answering" && (
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
                  {itemPhase === "revealed" && (
                    <>
                      {/* Result pill */}
                      <div className="flex justify-center">
                        {dontKnow ? (
                          <span className="px-3 py-1 rounded-full bg-neutral-100 text-neutral-600 text-xs font-medium">
                            Skipped — correct answer highlighted above
                          </span>
                        ) : selectedChoice === revealCorrect ? (
                          <span className="px-3 py-1 rounded-full bg-success-100 text-success-600 text-xs font-semibold">
                            Correct! +2
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
                        contentId={activeItem.data.id}
                        className="px-1"
                      />

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <Button variant="secondary" size="lg" onClick={handleSimilar} className="flex-1">
                          Similar question
                        </Button>
                        <Button variant="primary" size="lg" onClick={handleNext} className="flex-1">
                          Next →
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
          </>
        )}

        {/* Inline lesson — surfaced automatically after a miss on a weak topic */}
        {lessonModalKw && (
          <LessonModal
            system="mcat"
            keywordId={lessonModalKw}
            sessionId={sessionId}
            onClose={() => setLessonModalKw(null)}
          />
        )}
      </main>
    </div>
  );
}

export default function McatPracticePage() {
  return (
    <Suspense>
      <McatPracticePageInner />
    </Suspense>
  );
}
