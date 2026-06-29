"use client";

/**
 * CourseCardsMode — the UNIVERSAL flashcard walk engine.
 *
 * Plays small per-keyword decks as ONE continuous spaced stream. Driven by a
 * deck-plan (ordered list of in_depth keyword decks for the scope), it:
 *   - walks keyword decks IN CURRICULUM ORDER (order_index), one keyword at a
 *     time, lazily loading each keyword's deck as the frontier advances;
 *   - GLOSSES OVER already-mastered decks — a keyword the student already knows
 *     (mastered in auto / prior study, via the SHARED *_student_keyword_states)
 *     is skipped in the in-order walk, so they're never re-drilled on what they
 *     know;
 *   - INTERLEAVES due reviews on an expanding-interval (Leitner) schedule — the
 *     per-card SRS shared with every surface via /api/{system}/flashcard-attempt
 *     (and the *_flashcard_srs tables);
 *   - once everything in scope has been introduced, shifts to MORE RANDOM with
 *     EMPHASIS ON LESSER-KNOWN cards (weighted by how far from memorized).
 *
 * Scope:
 *   - no scope  → whole-course stream (all in_depth keywords, course order).
 *   - scope.categoryId            → that category's keyword decks, in order.
 *   - scope.umbrellaId + category → that umbrella's keyword decks, in order.
 *   - scope.keywordId + category  → just that keyword's deck.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
import { Button } from "@/components/ui/Button";
import { LoadingPanel } from "@/components/mcat/LoadingPanel";
import { GrindMeter } from "@/components/gamification/GrindMeter";
import { NavMenu } from "@/components/nav/NavMenu";
import { StreakBadge } from "@/components/gamification/StreakBadge";
import { useStreakTouchOnce } from "@/components/gamification/useStreakTouchOnce";
import { comboReducer, onCorrectAnswer, onIncorrectAnswer } from "@/lib/gamification";
import { nextSrsState, MEMORIZED_BOX, type SrsState } from "@/lib/flashcardSrs";
import FlipCard from "@/components/cards/FlipCard";
import QuestionToolbar from "@/components/practice/QuestionToolbar";
import { primaryKeywordId } from "@/lib/primaryKeyword";
import { getOrCreateMcatSession } from "@/lib/mcatSession";
import { getOrCreateMathSession } from "@/lib/mathSession";
import { awardFlashcard } from "@/lib/points";

// Cards pulled per keyword deck (a whole small deck — complete-mode caps at 30).
const DECK_BATCH = 30;

type System = "math" | "mcat";
type Result = "got_it" | "missed_it" | "dont_know";
type PagePhase = "loading" | "study" | "caught_up" | "error";

interface NormalizedCard {
  id: string;
  front: string;
  back: string;
  keyword_weights: Record<string, number>;
  box?: number;
}

/** One keyword deck in the ordered walk plan. */
interface PlanKeyword {
  id: string;
  label: string;
  category_id: string;
  category_label: string;
  score: number;
  mastered: boolean;
  card_count: number;
}

/** A card in the pool, with its live SRS + scheduling state. */
interface PoolEntry extends SrsState {
  card: NormalizedCard;
  kwIdx: number;
  score: number;
  dueAt: number | null;
  introduced: boolean;
}

export interface CardsScope {
  categoryId?: string;
  umbrellaId?: string;
  keywordId?: string;
  /** Display label for the scope (topic/umbrella/keyword name). */
  label?: string;
}

interface CourseCardsModeProps {
  system: System;
  /** Required for math (precalc | calc_ab); ignored for mcat. */
  course?: string;
  /** Course label shown in the header (e.g. "AP Calculus AB", "MCAT Biology"). */
  courseLabel: string;
  /** Where the "exit" / home link points. */
  homeHref: string;
  /** Optional scope — omit for the whole-course stream. */
  scope?: CardsScope;
  /**
   * MCAT section filter — "biology" | "psych_soc". When provided (and system
   * is "mcat"), the whole-course deck-plan walk is scoped to that section only.
   * Defaults to "biology" so existing Biology behavior is unchanged.
   */
  section?: string;
}

export default function CourseCardsMode({
  system,
  course,
  courseLabel,
  homeHref,
  scope,
  section,
}: CourseCardsModeProps) {
  const scopeKey =
    scope?.keywordId ?? scope?.umbrellaId ?? scope?.categoryId ?? "all";
  const frontierStorageKey = `lodera_cards_frontier_${system}_${course ?? "default"}_${scopeKey}`;

  const [sessionId, setSessionId] = useState("");

  // Walk plan + pool + scheduling — kept in refs so the stream logic reads fresh
  // values without re-render churn.
  const poolRef = useRef<Map<string, PoolEntry>>(new Map());
  const planRef = useRef<PlanKeyword[]>([]);
  const frontierRef = useRef(0); // index of the next keyword deck to introduce
  const modeRef = useRef<"order" | "random">("order");
  const sessionIdRef = useRef("");

  const [current, setCurrent] = useState<NormalizedCard | null>(null);
  const [currentIsReview, setCurrentIsReview] = useState(false);
  const [currentKwLabel, setCurrentKwLabel] = useState("");
  const [currentCatLabel, setCurrentCatLabel] = useState("");

  const [pagePhase, setPagePhase] = useState<PagePhase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [history, setHistory] = useState<Result[]>([]);

  const [combo, setCombo] = useState(0);
  const [sessionStart] = useState(() => Date.now());

  useStreakTouchOnce();

  const flashcardsUrl = `/api/${system}/flashcards`;
  const attemptUrl = `/api/${system}/flashcard-attempt`;
  const deckPlanUrl = `/api/${system}/deck-plan`;

  // ── Load one keyword's deck into the pool (curriculum order). Returns # added. ──
  // The flashcards API GENERATES a deck on demand when a keyword has none stored
  // (post-wipe / brand-new subtopic). A cold generation can occasionally return an
  // empty batch (generation lock briefly held by another request, or a slow first
  // gen). Rather than silently skip the keyword — which makes the in-order walk
  // burn through the whole course and dead-end on "no decks" — we RETRY the same
  // keyword a couple of times with a short backoff so the always-generate contract
  // is honored.
  const fetchDeck = useCallback(
    async (kw: PlanKeyword): Promise<RawCard[]> => {
      const res = await fetch(flashcardsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          category_id: kw.category_id,
          keyword_id: kw.id,
          count: DECK_BATCH,
          curriculum_order: true,
          ...(system === "math" ? { course } : {}),
        }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { flashcards?: RawCard[] };
      return data.flashcards ?? [];
    },
    [flashcardsUrl, system, course]
  );

  const loadKeyword = useCallback(
    async (idx: number): Promise<number> => {
      const plan = planRef.current;
      if (idx < 0 || idx >= plan.length) return 0;
      const kw = plan[idx]!;
      try {
        let raw = await fetchDeck(kw);
        // Cold-generation retry: an on-demand deck gen can return empty if a
        // concurrent gen holds the per-keyword lock or the first gen is still
        // warming. Retry the SAME keyword before giving up on it.
        for (let attempt = 0; raw.length === 0 && attempt < 2; attempt++) {
          await new Promise((r) => setTimeout(r, 1800));
          raw = await fetchDeck(kw);
        }
        const loaded = raw.map(normalize);
        const now = Date.now();
        let added = 0;
        for (const c of loaded) {
          if (poolRef.current.has(c.id)) continue;
          const box = c.box && c.box > 0 ? c.box : 0;
          poolRef.current.set(c.id, {
            card: c,
            kwIdx: idx,
            score: kw.score,
            box,
            reps: 0,
            lapses: 0,
            learned: box >= 5,
            // A card with a stored box is a DUE REVIEW from a prior session;
            // brand-new cards are un-introduced (shown in curriculum order).
            dueAt: box > 0 ? now : null,
            introduced: box > 0,
          });
          added++;
        }
        return added;
      } catch {
        return 0;
      }
    },
    [fetchDeck]
  );

  const showEntry = useCallback((entry: PoolEntry, isReview: boolean) => {
    const kw = planRef.current[entry.kwIdx];
    setCurrent(entry.card);
    setCurrentIsReview(isReview);
    setCurrentKwLabel(kw?.label ?? "");
    setCurrentCatLabel(kw?.category_label ?? "");
    setPagePhase("study");
  }, []);

  // ── Pick the next card. ───────────────────────────────────────────────────────
  // due review → next fresh card (in order) → advance frontier (skip mastered) →
  // random-when-known (weakness-weighted) → caught up.
  const pickNextRef = useRef<() => Promise<void>>(async () => {});
  const pickNext = useCallback(async (): Promise<void> => {
    const now = Date.now();
    const entries = [...poolRef.current.values()];

    // 1) Due reviews (expanding-interval): lowest box first, then earliest due.
    const due = entries
      .filter((e) => e.introduced && e.dueAt != null && e.dueAt <= now)
      .sort((a, b) => a.box - b.box || a.dueAt! - b.dueAt!);
    if (due.length > 0) {
      showEntry(due[0]!, true);
      return;
    }

    // 2) In-order intro: next never-seen card (insertion = curriculum order).
    if (modeRef.current === "order") {
      const fresh = entries.find((e) => !e.introduced);
      if (fresh) {
        fresh.introduced = true;
        fresh.dueAt = now;
        showEntry(fresh, false);
        return;
      }

      // 3) Advance the frontier to the next NON-MASTERED keyword (gloss over
      //    already-known decks), loading its deck.
      setLoadingMore(true);
      while (frontierRef.current < planRef.current.length) {
        const idx = frontierRef.current;
        frontierRef.current = idx + 1;
        try {
          window.sessionStorage.setItem(frontierStorageKey, String(frontierRef.current));
        } catch {
          /* ignore */
        }
        // Gloss: skip decks the student has already mastered elsewhere.
        if (planRef.current[idx]!.mastered) continue;
        const added = await loadKeyword(idx);
        if (added > 0) {
          setLoadingMore(false);
          await pickNextRef.current();
          return;
        }
      }
      setLoadingMore(false);
      // Everything in scope introduced → switch to the random-when-known phase.
      modeRef.current = "random";
    }

    // 4) Random-when-known: weakness-weighted random among cards still being
    //    learned (box < MEMORIZED). Emphasis on lesser-known (lower box/score).
    const learning = entries.filter(
      (e) => e.introduced && e.box < MEMORIZED_BOX
    );
    if (learning.length > 0) {
      const weightOf = (e: PoolEntry) =>
        (MEMORIZED_BOX - e.box) + (1 - Math.min(1, e.score)) + 0.3;
      const total = learning.reduce((s, e) => s + weightOf(e), 0);
      let r = (Math.floor(now) % 1000) / 1000 * total; // deterministic-ish jitter
      // mix in a fresh random so it isn't lockstep with the clock
      r = (r + Math.random() * total) / 2;
      let picked = learning[0]!;
      for (const e of learning) {
        r -= weightOf(e);
        if (r <= 0) {
          picked = e;
          break;
        }
      }
      showEntry(picked, picked.reps > 0 || picked.box > 0);
      return;
    }

    // Nothing left being learned → caught up (or error if pool never filled).
    setPagePhase(entries.length > 0 ? "caught_up" : "error");
  }, [showEntry, loadKeyword, frontierStorageKey]);

  useEffect(() => {
    pickNextRef.current = pickNext;
  }, [pickNext]);

  // ── Init: session + deck plan, resume frontier, start the stream. ─────────────
  useEffect(() => {
    (async () => {
      const sid =
        system === "math"
          ? await getOrCreateMathSession()
          : await getOrCreateMcatSession();
      setSessionId(sid);
      sessionIdRef.current = sid;
      try {
        const r = await fetch(deckPlanUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sid,
            category_id: scope?.categoryId,
            umbrella_id: scope?.umbrellaId,
            keyword_id: scope?.keywordId,
            ...(system === "math" ? { course } : {}),
            ...(system === "mcat" && !scope?.categoryId && !scope?.umbrellaId && !scope?.keywordId
              ? { section: section ?? "biology" }
              : {}),
          }),
        });
        if (!r.ok) throw new Error("Could not load the deck plan.");
        const d = (await r.json()) as { keywords?: PlanKeyword[] };
        const plan = d.keywords ?? [];
        if (plan.length === 0) {
          setErrorMsg("No flashcard decks are available here yet.");
          setPagePhase("error");
          return;
        }
        planRef.current = plan;

        // Fresh entry starts at the FIRST keyword; a same-session resume restores
        // the introduction frontier.
        let start = 0;
        try {
          const saved = window.sessionStorage.getItem(frontierStorageKey);
          if (saved !== null)
            start = Math.min(Math.max(0, parseInt(saved, 10) || 0), plan.length - 1);
        } catch {
          /* ignore */
        }
        frontierRef.current = start;
        await pickNextRef.current();
      } catch (e) {
        setErrorMsg((e as Error).message ?? "Failed to start flashcards.");
        setPagePhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gradeCard = (result: Result) => {
    const card = current;
    if (!card) return;
    const entry = poolRef.current.get(card.id);
    if (!entry) return;

    setHistory((h) => [...h, result]);
    awardFlashcard();

    if (result === "got_it") {
      setCombo((prev) => {
        const next = comboReducer({ count: prev }, "correct").count;
        onCorrectAnswer(next);
        return next;
      });
    } else {
      setCombo((prev) => comboReducer({ count: prev }, "incorrect").count);
      onIncorrectAnswer();
    }

    const prevSrs: SrsState | null =
      entry.reps > 0
        ? { box: entry.box, reps: entry.reps, lapses: entry.lapses, learned: entry.learned }
        : null;
    const t = nextSrsState(prevSrs, result);
    entry.box = t.box;
    entry.reps = t.reps;
    entry.lapses = t.lapses;
    entry.learned = t.learned;
    entry.dueAt = Date.parse(t.due_at);
    entry.introduced = true;

    fetch(attemptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        flashcard_id: card.id,
        result,
        ...(system === "math" ? { course } : {}),
      }),
    }).catch(() => {});

    void pickNext();
  };

  const showCard = pagePhase === "study" && current && !loadingMore;
  const headerTitle = currentKwLabel || scope?.label || courseLabel;

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-2.5 space-y-1.5">
          {/* Row 1 — nav controls */}
          <div className="flex items-center gap-2">
            <Link href={homeHref} className="shrink-0" aria-label="Exit flashcards">
              <LoderaLogo size={20} />
            </Link>
            <Link
              href={homeHref}
              className="text-xs text-neutral-400 hover:text-brand-600 shrink-0 transition-colors whitespace-nowrap"
            >
              ← {courseLabel}
            </Link>
            <span className="shrink-0 text-[11px] uppercase tracking-wide text-neutral-400 font-medium">
              Flashcards
            </span>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <StreakBadge />
              <NavMenu />
            </div>
          </div>
          {/* Row 2 — current keyword title gets its own room */}
          <h1 className="font-semibold text-neutral-900 text-base leading-snug flex items-start gap-2">
            <span className="min-w-0 break-words line-clamp-2">{headerTitle}</span>
            {currentIsReview && (
              <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                Review
              </span>
            )}
          </h1>
          {currentCatLabel && currentCatLabel !== headerTitle && (
            <p className="text-[11px] text-neutral-400 truncate">{currentCatLabel}</p>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4 pb-safe-bottom">
        {pagePhase === "loading" && (
          <LoadingPanel message="Preparing your flashcards…" sub="This can take 5–30 seconds" />
        )}

        {pagePhase === "error" && (
          <div className="rounded-xl border border-error-200 bg-error-50 p-6 text-center">
            <p className="text-sm text-error-600 mb-3">
              {errorMsg || "These decks are still being prepared."}
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  // Re-run the whole init (deck plan + first deck generation).
                  try {
                    window.sessionStorage.removeItem(frontierStorageKey);
                  } catch {
                    /* ignore */
                  }
                  window.location.reload();
                }}
              >
                Try again
              </Button>
              <Link href={homeHref}>
                <Button variant="secondary" size="sm">Go back</Button>
              </Link>
            </div>
          </div>
        )}

        {pagePhase === "caught_up" && (
          <div className="text-center py-8 space-y-5">
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-brand-sm p-6">
              <p className="text-3xl mb-2">🎉</p>
              <p className="text-xl font-bold text-neutral-900 mb-1">You&apos;re all caught up!</p>
              <p className="text-xs text-neutral-500">
                You&apos;ve memorized everything due right now. Come back later and your
                spaced reviews will be waiting.
              </p>
            </div>
            <Link href={homeHref}>
              <Button variant="primary" size="lg">Done</Button>
            </Link>
          </div>
        )}

        {/* Loading the next deck mid-stream (brief, only at keyword boundaries). */}
        {pagePhase === "study" && loadingMore && (
          <LoadingPanel message="Loading more cards…" sub="Bringing in the next deck" />
        )}

        {showCard && current && (
          <>
            {/* Grind state still records (hidden), but no big bar up front. */}
            <GrindMeter mode="flashcard" streak={combo} answered={history.length} startedAt={sessionStart} hidden />

            <FlipCard
              front={current.front}
              back={current.back}
              onGrade={gradeCard}
              resetKey={current.id}
            />

            {/* Lesson / refresher access for the current card's topic */}
            <QuestionToolbar
              system={system}
              course={course}
              keywordId={primaryKeywordId(current.keyword_weights)}
              sessionId={sessionId || null}
              questionId={current.id}
              contentType="flashcard"
              resetSignal={current.id}
            />
          </>
        )}
      </main>
    </div>
  );
}

// ── Field adapter: math uses front_latex/back_latex; mcat uses front/back. ──────
interface RawCard {
  id: string;
  front?: string;
  back?: string;
  front_latex?: string;
  back_latex?: string;
  keyword_weights?: Record<string, number>;
  box?: number;
}
function normalize(c: RawCard): NormalizedCard {
  return {
    id: c.id,
    front: c.front ?? c.front_latex ?? "",
    back: c.back ?? c.back_latex ?? "",
    keyword_weights: c.keyword_weights ?? {},
    box: c.box,
  };
}
