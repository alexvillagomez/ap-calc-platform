"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/LoginGate";
import { ChoiceButton } from "@/components/mcat/ChoiceButton";
import MathText from "@/components/mcat/MathText";
import MathFeedbackWidget from "@/components/math/MathFeedbackWidget";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { ComboMeter } from "@/components/gamification/ComboMeter";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { CorrectPulse } from "@/components/ui/CorrectPulse";
import { useStreakTouchOnce } from "@/components/gamification/useStreakTouchOnce";
import { comboReducer, onCorrectAnswer, onIncorrectAnswer } from "@/lib/gamification";
import { getOrCreateMathSession } from "@/lib/mathSession";
import {
  MathQuestion,
  MathCategory,
  MathTaxonomyResponse,
  MathUmbrella,
  MathInDepthChild,
  umbrellaDisplayScore,
  diffLabel,
  scoreColor,
  COURSE_LABELS,
} from "@/components/math/mathUiTypes";
import type { MathCourse } from "@/lib/mathTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

type PagePhase = "select" | "practice";
type QuestionPhase = "answering" | "revealed" | "loading-next" | "error";

// ─── Selection helpers ─────────────────────────────────────────────────────────

function umbrellaLeafIds(u: MathUmbrella): string[] {
  return u.children.length > 0 ? u.children.map((c) => c.id) : [u.id];
}

function categoryLeafIds(cat: MathCategory): string[] {
  const ids: string[] = [];
  for (const u of cat.umbrellas) {
    for (const id of umbrellaLeafIds(u)) ids.push(id);
  }
  return ids;
}

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

function umbrellaScore(u: MathUmbrella): number | null {
  return umbrellaDisplayScore(u);
}

function categoryDisplayScore(cat: MathCategory): number | null {
  const scores = cat.umbrellas
    .map((u) => umbrellaScore(u))
    .filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────

function Checkbox({
  state,
  onClick,
}: {
  state: "all" | "some" | "none";
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
        state === "all"
          ? "border-brand-500 bg-brand-500"
          : state === "some"
          ? "border-brand-400 bg-brand-100"
          : "border-neutral-300 bg-white hover:border-brand-400"
      }`}
      aria-label={state === "all" ? "Deselect" : "Select"}
    >
      {state === "all" && (
        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10" stroke="currentColor" strokeWidth={2.5}>
          <path d="M1.5 5l2.5 2.5 4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === "some" && <span className="w-2 h-0.5 bg-brand-500 rounded-full block" />}
    </button>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
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

// ─── Child row ─────────────────────────────────────────────────────────────────

function ChildRow({
  child,
  selected,
  onToggle,
}: {
  child: MathInDepthChild;
  selected: boolean;
  onToggle: () => void;
}) {
  const pct = child.score !== null ? Math.round(child.score * 100) : null;
  return (
    <div className="flex items-center gap-2 py-2 border-t border-neutral-50 first:border-0">
      <Checkbox state={selected ? "all" : "none"} onClick={(e) => { e.stopPropagation(); onToggle(); }} />
      <span className="flex-1 text-xs text-neutral-700 min-w-0 truncate">{child.label}</span>
      {pct !== null ? (
        <span className={`text-xs font-medium shrink-0 ${scoreColor(pct)}`}>{pct}%</span>
      ) : (
        <span className="text-xs text-neutral-400 shrink-0">—</span>
      )}
    </div>
  );
}

// ─── Umbrella row ──────────────────────────────────────────────────────────────

function UmbrellaRow({
  umbrella,
  selected,
  expandedUmbrellas,
  onToggle,
  onChildToggle,
  onExpandToggle,
}: {
  umbrella: MathUmbrella;
  selected: Set<string>;
  expandedUmbrellas: Set<string>;
  onToggle: (leafIds: string[]) => void;
  onChildToggle: (id: string) => void;
  onExpandToggle: (id: string) => void;
}) {
  const leafIds = umbrellaLeafIds(umbrella);
  const state = selectionState(leafIds, selected);
  const displayScore = umbrellaScore(umbrella);
  const expanded = expandedUmbrellas.has(umbrella.id);
  const hasChildren = umbrella.children.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 py-2.5">
        <Checkbox state={state} onClick={(e) => { e.stopPropagation(); onToggle(leafIds); }} />
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onExpandToggle(umbrella.id)}
            className="shrink-0 w-4 h-4 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-colors"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronIcon expanded={expanded} />
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
              <span className={`text-xs font-medium ${scoreColor(displayScore)}`}>
                {displayScore}%
              </span>
              <div className="w-12">
                <ProgressBar value={displayScore} size="xs" color={displayScore >= 80 ? "success" : "brand"} />
              </div>
            </>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          )}
        </div>
      </div>
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

// ─── Category accordion ────────────────────────────────────────────────────────

function CategoryAccordion({
  cat,
  selected,
  expandedUmbrellas,
  onCategoryToggle,
  onUmbrellaToggle,
  onChildToggle,
  onUmbrellaExpandToggle,
}: {
  cat: MathCategory;
  selected: Set<string>;
  expandedUmbrellas: Set<string>;
  onCategoryToggle: (leafIds: string[]) => void;
  onUmbrellaToggle: (leafIds: string[]) => void;
  onChildToggle: (id: string) => void;
  onUmbrellaExpandToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const leafIds = categoryLeafIds(cat);
  const state = selectionState(leafIds, selected);
  const displayScore = categoryDisplayScore(cat);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-brand-xs overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <Checkbox state={state} onClick={(e) => { e.stopPropagation(); onCategoryToggle(leafIds); }} />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          <ChevronIcon expanded={open} />
          <span className="flex-1 text-sm font-semibold text-neutral-900 truncate">
            {cat.label}
          </span>
          {displayScore !== null ? (
            <span className={`text-xs font-medium shrink-0 ${scoreColor(displayScore)}`}>
              {displayScore}%
            </span>
          ) : (
            <span className="text-xs text-neutral-400 shrink-0">Not started</span>
          )}
        </button>
      </div>
      {open && cat.umbrellas.length > 0 && (
        <div className="border-t border-neutral-100 px-4 py-1 divide-y divide-neutral-50">
          {cat.umbrellas.map((u) => (
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

// ─── Main ─────────────────────────────────────────────────────────────────────

function MathGeneralPracticeInner({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = use(params);
  const courseLabel = COURSE_LABELS[course] ?? course;

  const [sessionId, setSessionId] = useState("");
  const [categories, setCategories] = useState<MathCategory[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedUmbrellas, setExpandedUmbrellas] = useState<Set<string>>(new Set());
  const [pagePhase, setPagePhase] = useState<PagePhase>("select");

  // Practice state
  const [question, setQuestion] = useState<MathQuestion | null>(null);
  const [questionPhase, setQuestionPhase] = useState<QuestionPhase>("loading-next");
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState(false);
  const [combo, setCombo] = useState(0);
  const [stats, setStats] = useState({ answered: 0, correct: 0 });
  const [excludeIds, setExcludeIds] = useState<string[]>([]);

  useStreakTouchOnce();

  // Load taxonomy
  useEffect(() => {
    (async () => {
      setTaxonomyLoading(true);
      try {
        const sid = await getOrCreateMathSession();
        setSessionId(sid);
        const r = await fetch(
          `/api/math/taxonomy?session_id=${encodeURIComponent(sid)}&course=${encodeURIComponent(course)}`
        );
        if (r.ok) {
          const d = (await r.json()) as MathTaxonomyResponse;
          const cats = d.categories ?? [];
          setCategories(cats);
          // Pre-select all
          const allLeafs = new Set<string>();
          for (const cat of cats) {
            for (const id of categoryLeafIds(cat)) allLeafs.add(id);
          }
          setSelected(allLeafs);
        }
      } catch { /* non-fatal */ }
      finally { setTaxonomyLoading(false); }
    })();
  }, [course]); // intentional: only re-run when course changes

  // Selection handlers
  const toggleSet = (ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleChild = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleUmbrellaExpand = (id: string) => {
    setExpandedUmbrellas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Fetch next question
  const fetchNextQuestion = useCallback(
    async (sid: string, keywordIds: string[], excl: string[]) => {
      setQuestionPhase("loading-next");
      setShowHint(false);
      setSelectedChoice(null);
      setErrorMsg("");
      setLastAnswerCorrect(false);

      try {
        const body: Record<string, unknown> = {
          session_id: sid,
          keyword_ids: keywordIds,
          exclude_ids: excl,
          course: course as MathCourse,
        };
        const res = await fetch("/api/math/next-question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => "Unknown error");
          setErrorMsg(msg);
          setQuestionPhase("error");
          return;
        }
        const data = (await res.json()) as { question: MathQuestion };
        setQuestion(data.question);
        setExcludeIds((prev) => [...prev, data.question.id]);
        setQuestionPhase("answering");
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to load question");
        setQuestionPhase("error");
      }
    },
    [course]
  );

  const handleStart = () => {
    if (selected.size === 0) return;
    setStats({ answered: 0, correct: 0 });
    setExcludeIds([]);
    setCombo(0);
    setPagePhase("practice");
    fetchNextQuestion(sessionId, [...selected], []);
  };

  const handleChoice = async (idx: number) => {
    if (!question || questionPhase !== "answering") return;
    setSelectedChoice(idx);
    setQuestionPhase("revealed");
    const correct = idx === question.correct_index;
    setLastAnswerCorrect(correct);
    setCombo((prev) => {
      const next = comboReducer({ count: prev }, correct ? "correct" : "incorrect").count;
      if (correct) onCorrectAnswer(next);
      else onIncorrectAnswer();
      return next;
    });
    setStats((s) => ({ answered: s.answered + 1, correct: s.correct + (correct ? 1 : 0) }));

    fetch("/api/math/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: question.id,
        selected_index: idx,
        context: "practice",
        course: course as MathCourse,
      }),
    }).catch(() => {});
  };

  const handleDontKnow = () => {
    if (!question || questionPhase !== "answering") return;
    setSelectedChoice(null);
    setQuestionPhase("revealed");
    setLastAnswerCorrect(false);
    setCombo((prev) => comboReducer({ count: prev }, "incorrect").count);
    onIncorrectAnswer();
    setStats((s) => ({ answered: s.answered + 1, correct: s.correct }));
    fetch("/api/math/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: question.id,
        dont_know: true,
        context: "practice",
        course: course as MathCourse,
      }),
    }).catch(() => {});
  };

  const handleNext = () => {
    if (!question) return;
    fetchNextQuestion(sessionId, [...selected], excludeIds);
  };

  const diff = question ? diffLabel(question.difficulty) : null;

  if (pagePhase === "select") {
    const totalSelected = selected.size;
    const allLeafCount = categories.reduce(
      (s, cat) => s + categoryLeafIds(cat).length,
      0
    );
    return (
      <div className="min-h-screen bg-neutral-50">
        <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Link href={`/math/${course}`} className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0">
                ← {courseLabel}
              </Link>
              <h1 className="font-semibold text-neutral-900 text-sm">General Practice</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StreakBadge />
              <SoundToggle />
            </div>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          {taxonomyLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-neutral-500">Loading topics…</p>
            </div>
          ) : (
            <>
              {/* Selection summary + start */}
              <div className="bg-white rounded-xl border border-neutral-200 shadow-brand-xs p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    {totalSelected === allLeafCount
                      ? "All topics selected"
                      : `${totalSelected} of ${allLeafCount} keywords selected`}
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {totalSelected === 0
                      ? "Select at least one keyword to start"
                      : "Weakness-first ordering · adaptive difficulty"}
                  </p>
                </div>
                <button
                  onClick={handleStart}
                  disabled={totalSelected === 0}
                  className="shrink-0 px-4 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Start
                </button>
              </div>

              {/* Select all / deselect all */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const all = new Set<string>();
                    for (const cat of categories)
                      for (const id of categoryLeafIds(cat)) all.add(id);
                    setSelected(all);
                  }}
                  className="text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2"
                >
                  Select all
                </button>
                <span className="text-xs text-neutral-300">·</span>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2"
                >
                  Deselect all
                </button>
              </div>

              {/* Category accordions */}
              <div className="space-y-2">
                {categories.map((cat) => (
                  <CategoryAccordion
                    key={cat.id}
                    cat={cat}
                    selected={selected}
                    expandedUmbrellas={expandedUmbrellas}
                    onCategoryToggle={toggleSet}
                    onUmbrellaToggle={toggleSet}
                    onChildToggle={toggleChild}
                    onUmbrellaExpandToggle={toggleUmbrellaExpand}
                  />
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    );
  }

  // ── Practice phase ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setPagePhase("select")}
              className="text-xs text-neutral-400 hover:text-neutral-600 shrink-0"
            >
              ← Topics
            </button>
            <p className="font-semibold text-neutral-900 text-sm truncate">
              General Practice
            </p>
            {stats.answered > 0 && (
              <span className="shrink-0 text-xs text-neutral-500">
                {stats.correct}/{stats.answered}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StreakBadge />
            <SoundToggle />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Loading */}
        {questionPhase === "loading-next" && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Finding your next question…</p>
            <p className="text-xs text-neutral-400">Can take 5–30 seconds</p>
          </div>
        )}

        {/* Error */}
        {questionPhase === "error" && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center space-y-3">
            <p className="text-sm text-error-600">{errorMsg || "Failed to load question"}</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={handleNext}
                className="px-4 py-2 rounded-lg bg-error-600 text-white text-sm font-medium hover:bg-error-700 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => setPagePhase("select")}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-sm font-medium hover:bg-neutral-50 transition-colors"
              >
                Back to topics
              </button>
            </div>
          </div>
        )}

        {/* Question */}
        {(questionPhase === "answering" || questionPhase === "revealed") && question && (
          <>
            {diff && (
              <div className="flex">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${diff.cls}`}>
                  {diff.label}
                </span>
              </div>
            )}

            <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-brand-xs">
              <p className="text-sm font-medium text-neutral-900 leading-relaxed">
                <MathText>{question.stem_latex}</MathText>
              </p>
            </div>

            {questionPhase === "answering" && question.hint_latex && (
              <div className="flex justify-center">
                {!showHint ? (
                  <button
                    onClick={() => setShowHint(true)}
                    className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2"
                  >
                    Show hint
                  </button>
                ) : (
                  <div className="bg-amber-50 rounded-xl border border-amber-100 p-3 w-full text-left">
                    <p className="text-xs font-semibold text-amber-700 mb-1">Hint</p>
                    <p className="text-sm text-neutral-700 leading-relaxed">
                      <MathText>{question.hint_latex}</MathText>
                    </p>
                  </div>
                )}
              </div>
            )}

            <ComboMeter combo={combo} />

            <CorrectPulse
              trigger={questionPhase === "revealed" && lastAnswerCorrect}
              className="block w-full"
            >
              <div className="space-y-2">
                {question.choices.map((choice, i) => {
                  let state: "default" | "selected" | "correct" | "wrong" | "dimmed" = "default";
                  if (questionPhase === "revealed") {
                    if (i === question.correct_index) state = "correct";
                    else if (i === selectedChoice) state = "wrong";
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
            </CorrectPulse>

            {questionPhase === "answering" && (
              <div className="flex justify-center">
                <button
                  onClick={handleDontKnow}
                  className="text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2"
                >
                  I don&apos;t know
                </button>
              </div>
            )}

            {questionPhase === "revealed" && question.solution_latex && (
              <div className="bg-brand-50 rounded-xl border border-brand-100 p-4">
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-1.5">
                  Solution
                </p>
                <p className="text-sm text-neutral-700 leading-relaxed">
                  <MathText>{question.solution_latex}</MathText>
                </p>
              </div>
            )}

            {questionPhase === "revealed" && (
              <>
                <MathFeedbackWidget
                  sessionId={sessionId}
                  contentType="question"
                  contentId={question.id}
                  className="px-1"
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={() => setPagePhase("select")}
                    className="flex-1 py-3 rounded-xl border border-neutral-200 bg-white text-neutral-600 text-sm font-medium hover:bg-neutral-50 transition-colors"
                  >
                    Change topics
                  </button>
                  <button
                    onClick={handleNext}
                    className="flex-1 py-3 rounded-xl bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-700 transition-colors"
                  >
                    Next question
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function MathGeneralPracticePage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  return (
    <LoginGate prompt="Sign in to practice math.">
      <MathGeneralPracticeInner params={params} />
    </LoginGate>
  );
}
