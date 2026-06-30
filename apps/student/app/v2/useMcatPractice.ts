"use client";

/**
 * /v2 — useMcatPractice: the real MCAT "Custom Practice" data/logic layer.
 *
 * Mirrors app/mcat/practice/page.tsx exactly (session bootstrap, controlled-
 * randomness serve loop, adaptive flashcard-vs-quiz, difficulty tiers, missed-
 * item review queue, points + grind), but exposes plain data + handlers so the
 * pixel-perfect /v2 design renders it WITHOUT any markup change.
 *
 * Open-and-start: a sensible default selection is chosen on load and the first
 * item is served immediately (no "select topics first" phase). Topic toggles
 * update the live pool for subsequent serves; if everything is deselected the
 * pool falls back to all Biology leaves.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getOrCreateMcatSession } from "@/lib/mcatSession";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { awardFlashcard, awardQuiz } from "@/lib/points";
import { recordFlashcardSeen, recordQuizAnswer } from "@/lib/grindMeter";
import { pickKeyword, pickContentKind, type KeywordPick } from "@/lib/courseEngine/generalPractice";
import { tierForMastery, MASTERY_ADVANCE } from "@/lib/courseEngine/adaptive";
import {
  fetchTaxonomy,
  fetchNextQuestion,
  fetchFlashcardsForKeyword,
  postAttempt,
  postFlashcardAttempt,
  fetchSimilar,
  fetchLesson,
  fetchMe,
  fetchQueue,
  saveQueue,
  type TaxonomyCategory,
  type TaxonomyUmbrella,
  type Question,
  type Flashcard,
  type Lesson,
  type KwStates,
  type MeResponse,
  type SavedQueueItem,
} from "./api";

const MCAT_SECTION = "biology";

/** Depth of the look-ahead buffer — keep this many items ready so "Next" is
 *  instant and we're always working ~2 steps ahead (generating eagerly on a
 *  miss). The first buffered item is what the NEXT session restores into. */
const BUFFER_TARGET = 2;

/** Only mix a lesson into the rotation when the keyword isn't mastered yet —
 *  i.e. its mastery is BELOW this ceiling. Mastered topics skip the lesson and
 *  go straight to spaced practice. Tune here. */
const LESSON_SCORE_CEILING = MASTERY_ADVANCE; // 0.70

// ── Active item ───────────────────────────────────────────────────────────────

export type ActiveItem =
  | { kind: "question"; data: Question }
  | { kind: "flashcard"; data: Flashcard }
  | { kind: "lesson"; data: Lesson };

export type ItemPhase =
  | "answering"
  | "revealed"
  | "loading-next"
  | "loading-similar"
  | "error";

// ── History (the navigable dots) ──────────────────────────────────────────────

/** How a served item resolved — drives the dot color. */
export type Outcome = "pending" | "correct" | "wrong" | "skipped" | "neutral";

export interface HistoryEntry {
  item: ActiveItem;
  keywordId: string | null;
  outcome: Outcome;
  /** Question only: the chosen index (for read-only re-view). */
  selectedIndex: number | null;
  dontKnow: boolean;
}

// ── Review queue ──────────────────────────────────────────────────────────────

type ReviewEntry =
  | { kind: "flashcard"; card: Flashcard; keywordId: string | null; dueAt: number; misses: number }
  | { kind: "question"; sourceQuestionId: string; keywordId: string | null; dueAt: number; misses: number };

// ── Taxonomy → leaf helpers (mirror the reference) ───────────────────────────────

function umbrellaLeafIds(u: TaxonomyUmbrella): string[] {
  if (u.children.length > 0) return u.children.map((c) => c.id);
  return [u.id];
}

function categoryLeafIds(cat: TaxonomyCategory): string[] {
  const ids: string[] = [];
  for (const u of cat.umbrellas ?? []) ids.push(...umbrellaLeafIds(u));
  return ids;
}

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

/** Validate a restored queue blob — drop anything malformed so a bad/old cache
 *  can never crash the boot. Items must be a known kind with an id-bearing data
 *  payload. Returns the typed, ready-to-apply entries. */
function sanitizeSaved(saved: SavedQueueItem[] | null | undefined): {
  item: ActiveItem;
  keywordId: string | null;
}[] {
  if (!Array.isArray(saved)) return [];
  const out: { item: ActiveItem; keywordId: string | null }[] = [];
  for (const e of saved) {
    const it = e?.item as ActiveItem | undefined;
    const kind = it?.kind;
    const data = it?.data as { id?: string } | undefined;
    if (!data?.id) continue;
    if (kind === "question" || kind === "flashcard" || kind === "lesson") {
      out.push({ item: it as ActiveItem, keywordId: e.keywordId ?? null });
    }
  }
  return out;
}

export interface EnabledTypes {
  /** Mix on-demand lessons into the served rotation (lesson-first per keyword). */
  lessons: boolean;
  flashcards: boolean;
  quizzes: boolean;
}

export function useMcatPractice() {
  const [sessionId, setSessionId] = useState("");
  const [categories, setCategories] = useState<TaxonomyCategory[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  /** True when the visitor isn't signed in — the page shows the LoginModal gate
   *  instead of redirecting to /login. */
  const [authRequired, setAuthRequired] = useState(false);
  /** False until the Supabase getUser() pre-check resolves. The page renders
   *  NOTHING (no study shell, no login) until this is true — auth is the very
   *  first thing decided. */
  const [authChecked, setAuthChecked] = useState(false);

  // Selection — Set of leaf keyword ids (single source of truth).
  const [selectedLeafs, setSelectedLeafs] = useState<Set<string>>(new Set());

  // Enabled content types (driven from the design's mode toggles).
  const [enabled, setEnabled] = useState<EnabledTypes>({ lessons: false, flashcards: true, quizzes: true });
  const enabledRef = useRef<EnabledTypes>(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Active item + per-item state.
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);
  const [itemPhase, setItemPhase] = useState<ItemPhase>("loading-next");
  const [currentKeywordId, setCurrentKeywordId] = useState<string | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [dontKnow, setDontKnow] = useState(false);
  const [revealCorrect, setRevealCorrect] = useState<number | null>(null);
  const [explanation, setExplanation] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // History of served items + a view pointer (the navigable dots). The LAST
  // entry is the frontier (the live item); viewIndex < last = re-viewing a past
  // item read-only. historyLenRef tracks length for synchronous index math.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [viewIndex, setViewIndex] = useState(0);
  const historyLenRef = useRef<number>(0);

  // Serving bookkeeping (refs read inside async flows).
  const scoresRef = useRef<Map<string, number>>(new Map());
  const categoryOfRef = useRef<Map<string, string>>(new Map());
  const recentWrongRef = useRef<Map<string, number>>(new Map());
  const excludeRef = useRef<string[]>([]);
  const seenCardsRef = useRef<Set<string>>(new Set());
  /** Keywords whose lesson has already been served this session (lesson-first:
   *  show a topic's lesson once, then practice it). */
  const seenLessonsRef = useRef<Set<string>>(new Set());
  const servedCountRef = useRef<number>(0);
  const reviewQueueRef = useRef<ReviewEntry[]>([]);
  const missCountRef = useRef<Map<string, number>>(new Map());
  const usedRefresherRef = useRef<boolean>(false);
  /** Live snapshot of selected leaves (so async serve always reads the latest). */
  const selectionRef = useRef<string[]>([]);
  /** Look-ahead buffer of already-built items (target BUFFER_TARGET). serveNext
   *  shifts from the FRONT; refillBuffer tops up the BACK. This is the unit that
   *  gets persisted across sessions (the "next in queue" the user asked for). */
  const bufferRef = useRef<{ item: ActiveItem; keywordId: string | null }[]>([]);
  /** Guards against overlapping buffer refills. */
  const refillingRef = useRef<boolean>(false);
  /** Dedup key (`kind:id`) of the item currently on screen — so the buffer never
   *  warms a copy of what's already showing. */
  const activeKeyRef = useRef<string | null>(null);
  /** Guards against double-serving (e.g. StrictMode double-invoke / fast clicks). */
  const servingRef = useRef<boolean>(false);
  /** True once the taxonomy has loaded (selection pool + category map are ready).
   *  Until then we can SHOW restored/buffered items but cannot COMPUTE new ones. */
  const taxonomyReadyRef = useRef<boolean>(false);
  /** Set when serveNext was asked to run before taxonomy was ready (buffer empty);
   *  the serve loop fires once taxonomy lands. */
  const pendingServeRef = useRef<boolean>(false);
  /** True once the first item (restored or freshly served) has been shown — so
   *  bootstrap doesn't double-serve after taxonomy lands. */
  const servedFirstRef = useRef<boolean>(false);
  /** Live sessionId for async serve flows — the `sessionId` STATE lags one render
   *  behind on bootstrap, so the first serve must read the id from here. */
  const sessionIdRef = useRef<string>("");
  /** Debounce handle for persisting the queue to the server. */
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  // Re-runs after a successful in-page login (see reloadAfterAuth). Returns
  // early WITHOUT redirecting when the visitor is unauthenticated; instead it
  // flips `authRequired` so the page renders the LoginModal gate. Only once a
  // Supabase session exists does it call getOrCreateMcatSession (which would
  // otherwise redirect to /login on a missing session).
  const bootstrap = useCallback(async (signal: { cancelled: boolean }) => {
    // Auth pre-check — avoid getOrCreateMcatSession's redirect-on-missing-session.
    // Wrapped so a thrown/rejected auth client (e.g. missing Supabase config, a
    // network blip) can NEVER leave us on the blank pre-auth screen: any failure
    // falls back to "logged out" → the in-page LoginModal shows. authChecked is
    // ALWAYS set so the page advances past the blank gate.
    let user: { id: string } | null = null;
    try {
      const res = await supabaseBrowser().auth.getUser();
      user = res.data.user;
    } catch {
      user = null;
    }
    if (signal.cancelled) return;
    setAuthChecked(true);
    if (!user) {
      setAuthRequired(true);
      setLoadingCats(false);
      return;
    }
    setAuthRequired(false);

    const sid = await getOrCreateMcatSession();
    if (signal.cancelled) return;
    sessionIdRef.current = sid;
    setSessionId(sid);
    setLoadingCats(true);

    // (A) Restore the persisted queue ASAP — this is a small, fast row, so it
    // typically resolves BEFORE the taxonomy. The moment it does, we show the
    // first saved item (no taxonomy, no generation needed) and stash the rest in
    // the look-ahead buffer. Runs in parallel with the taxonomy fetch below.
    const restorePromise = fetchQueue(sid)
      .then((saved) => {
        if (signal.cancelled) return;
        const valid = sanitizeSaved(saved);
        if (valid.length === 0 || servedFirstRef.current) return;
        servedFirstRef.current = true;
        applyItem(valid[0]!);
        bufferRef.current = valid.slice(1);
      })
      .catch(() => {});

    // (B) Taxonomy in parallel — needed for the topic tree, scores, and to
    // COMPUTE new items (the restored items render without it).
    try {
      const all = await fetchTaxonomy(sid);
      const bio = all.filter((c) => (c.section ?? "biology") === MCAT_SECTION);
      if (signal.cancelled) return;
      seedLeafIndex(bio, scoresRef.current, categoryOfRef.current);
      setCategories(bio);

      // Default selection: the first category's leaves (open-and-start).
      const firstWithLeaves = bio.find((c) => categoryLeafIds(c).length > 0);
      const defaults = firstWithLeaves ? categoryLeafIds(firstWithLeaves) : [];
      const initial = new Set(defaults);
      setSelectedLeafs(initial);
      selectionRef.current =
        initial.size > 0 ? Array.from(initial) : bio.flatMap(categoryLeafIds);
      taxonomyReadyRef.current = true;
    } catch (e) {
      if (!signal.cancelled) setErrorMsg((e as Error).message ?? "Failed to load topics");
    } finally {
      if (!signal.cancelled) setLoadingCats(false);
    }

    // Let the restore settle before deciding whether a fresh serve is needed.
    await restorePromise;
    if (signal.cancelled) return;

    if (!taxonomyReadyRef.current) {
      // Taxonomy failed — nothing to serve from. If a restored item is showing
      // that's still fine; otherwise the error state already rendered.
    } else if (!servedFirstRef.current) {
      // Nothing restored → serve the first item the normal way.
      serveNext(0);
    } else {
      // Restored item already on screen. Honor a serve requested mid-wait, else
      // just top the buffer up to two-deep (the next items, generated eagerly).
      if (pendingServeRef.current) {
        pendingServeRef.current = false;
        serveNext(0);
      } else {
        refillBuffer();
      }
    }
    // Profile (non-blocking).
    fetchMe().then((m) => {
      if (!signal.cancelled) setMe(m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    bootstrap(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [bootstrap]);

  // End-of-session save: flush the upcoming queue when the tab is hidden or the
  // page is unloading, so the NEXT session restores these items first. Uses
  // keepalive so the request survives the unload. (The serve loop also persists
  // on a debounce; this guarantees the latest buffer is saved on the way out.)
  useEffect(() => {
    const onHide = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        flushPersist(true);
      }
    };
    const onPageHide = () => flushPersist(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
    // flushPersist reads only refs, so the render-0 closure is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Sign the user out and drop straight to the in-page login/sign-up popup
   *  (no navigation). Clears the Supabase session, then flips `authRequired` so
   *  page.tsx short-circuits to the LoginModal gate. A successful re-login does a
   *  full reload (reloadAfterAuth), which re-inits all serve-loop state cleanly. */
  const signOut = useCallback(async () => {
    try {
      await supabaseBrowser().auth.signOut();
    } catch {
      /* clearing the session is best-effort — show the gate regardless */
    }
    setActiveItem(null);
    setAuthRequired(true);
    setAuthChecked(true);
  }, []);

  /** Re-run the session/taxonomy bootstrap after a successful in-page login. */
  const reloadAfterAuth = useCallback(() => {
    // The cookie session is now set; a full reload is the simplest correct
    // re-init (resets all serve-loop refs + re-runs bootstrap as authenticated).
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  // Keep selectionRef in sync; fall back to all Biology when nothing is selected.
  useEffect(() => {
    if (selectedLeafs.size > 0) {
      selectionRef.current = Array.from(selectedLeafs);
    } else {
      selectionRef.current = categories.flatMap(categoryLeafIds);
    }
  }, [selectedLeafs, categories]);

  // ── Selection toggles ──────────────────────────────────────────────────────
  const toggleLeafs = useCallback((leafIds: string[]) => {
    setSelectedLeafs((prev) => {
      const allSelected = leafIds.length > 0 && leafIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) for (const id of leafIds) next.delete(id);
      else for (const id of leafIds) next.add(id);
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

  // ── Serve loop helpers ──────────────────────────────────────────────────────
  function buildPool(): KeywordPick[] {
    return selectionRef.current.map((id) => ({ id, score: scoresRef.current.get(id) ?? 0.5 }));
  }

  function applyScores(states?: KwStates | null) {
    if (!states) return;
    for (const [kw, st] of Object.entries(states)) {
      if (typeof st.score === "number") scoresRef.current.set(kw, st.score);
    }
  }

  async function loadQuestion(kwId: string): Promise<Question> {
    const score = scoresRef.current.get(kwId) ?? 0.5;
    const recentlyBad = (recentWrongRef.current.get(kwId) ?? 0) >= 1;
    return fetchNextQuestion({
      sessionId: sessionIdRef.current,
      categoryId: categoryOfRef.current.get(kwId),
      keywordId: kwId,
      difficulty: tierForMastery(score, recentlyBad),
      excludeIds: excludeRef.current,
    });
  }

  async function loadLesson(kwId: string): Promise<Lesson | null> {
    try {
      const lesson = await fetchLesson(kwId);
      return lesson.micro_steps?.length ? lesson : null;
    } catch {
      return null;
    }
  }

  async function loadFlashcard(kwId: string): Promise<Flashcard | null> {
    const deck = await fetchFlashcardsForKeyword({
      sessionId: sessionIdRef.current,
      categoryId: categoryOfRef.current.get(kwId),
      keywordId: kwId,
    });
    if (deck.length === 0) return null;
    return deck.find((c) => !seenCardsRef.current.has(c.id)) ?? deck[0] ?? null;
  }

  /** Compute the next item WITHOUT touching page state (for prefetch + serve). */
  async function computeNext(
    depth = 0
  ): Promise<{ item: ActiveItem; keywordId: string | null } | null> {
    // Due review entry first.
    const now = servedCountRef.current + 1;
    const queue = reviewQueueRef.current;
    const dueIdx = queue.findIndex((e) => e.dueAt <= now);
    if (dueIdx !== -1) {
      const entry = queue.splice(dueIdx, 1)[0]!;
      if (entry.kind === "flashcard") {
        return { item: { kind: "flashcard", data: entry.card }, keywordId: entry.keywordId };
      }
      try {
        const q = await fetchSimilar({ sessionId, questionId: entry.sourceQuestionId });
        if (!excludeRef.current.includes(q.id)) excludeRef.current = [...excludeRef.current, q.id];
        return { item: { kind: "question", data: q }, keywordId: entry.keywordId };
      } catch {
        // fall through to a normal pick
      }
    }

    const kw = pickKeyword(buildPool());
    if (!kw) return null;
    const en = enabledRef.current;
    const practiceEnabled = en.quizzes || en.flashcards;

    // Lesson-first circulation, but ONLY for weak topics: serve a topic's lesson
    // the first time it comes up (or every time, if lessons are the only enabled
    // type) — provided its mastery is still below the lesson ceiling. Mastered
    // topics skip the lesson and go straight to practice.
    const lessonWorthwhile = kw.score < LESSON_SCORE_CEILING;
    if (en.lessons && lessonWorthwhile && (!practiceEnabled || !seenLessonsRef.current.has(kw.id))) {
      const lesson = await loadLesson(kw.id);
      if (lesson) {
        seenLessonsRef.current.add(kw.id);
        return { item: { kind: "lesson", data: lesson }, keywordId: kw.id };
      }
      // No lesson available for this keyword — don't loop forever on it.
      seenLessonsRef.current.add(kw.id);
      if (!practiceEnabled) return depth < 6 ? computeNext(depth + 1) : null;
    }
    if (!practiceEnabled) return depth < 6 ? computeNext(depth + 1) : null;

    const kind = pickContentKind(kw.score, { flashcards: en.flashcards, quizzes: en.quizzes });

    if (kind === "flashcard") {
      const card = await loadFlashcard(kw.id);
      if (card) return { item: { kind: "flashcard", data: card }, keywordId: kw.id };
      if (!en.quizzes && depth < 5) return computeNext(depth + 1);
      const fq = await loadQuestion(kw.id);
      return { item: { kind: "question", data: fq }, keywordId: kw.id };
    }
    const q = await loadQuestion(kw.id);
    return { item: { kind: "question", data: q }, keywordId: kw.id };
  }

  function resetItemState() {
    setSelectedChoice(null);
    setDontKnow(false);
    setRevealCorrect(null);
    setExplanation("");
    setErrorMsg("");
    usedRefresherRef.current = false;
  }

  /** Apply a computed item to page state (the only place served-state mutates). */
  function applyItem(next: { item: ActiveItem; keywordId: string | null }) {
    servedCountRef.current += 1;
    servedFirstRef.current = true;
    activeKeyRef.current = `${next.item.kind}:${next.item.data.id}`;
    resetItemState();
    setCurrentKeywordId(next.keywordId);
    setActiveItem(next.item);
    setItemPhase("answering");
    // Append to history and jump the view pointer to the new frontier.
    const newIndex = historyLenRef.current;
    historyLenRef.current += 1;
    const entry: HistoryEntry = {
      item: next.item,
      keywordId: next.keywordId,
      outcome: next.item.kind === "lesson" ? "neutral" : "pending",
      selectedIndex: null,
      dontKnow: false,
    };
    setHistory((prev) => [...prev, entry]);
    setViewIndex(newIndex);
  }

  /** Update the frontier (last) history entry's outcome after it's resolved. */
  function patchLastEntry(patch: Partial<HistoryEntry>) {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const arr = prev.slice();
      arr[arr.length - 1] = { ...arr[arr.length - 1]!, ...patch };
      return arr;
    });
  }

  /** Dedup key for a built item (so the buffer never holds the same q/card/lesson). */
  function itemKey(e: { item: ActiveItem }): string {
    return `${e.item.kind}:${e.item.data.id}`;
  }

  /** Build the persist payload: the upcoming buffered items (the "next in queue"
   *  the user asked to save), capped small. Restored first on the next session. */
  function buildPersistPayload(): SavedQueueItem[] {
    return bufferRef.current.slice(0, 3).map((b) => ({ item: b.item, keywordId: b.keywordId }));
  }

  /** Persist the queue (debounced) so end-of-session leaves the next items ready. */
  function schedulePersist() {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      const sid = sessionIdRef.current;
      if (sid) saveQueue(sid, buildPersistPayload());
    }, 800);
  }

  /** Flush immediately (page is hiding/unloading — use keepalive). */
  function flushPersist(keepalive = false) {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const sid = sessionIdRef.current;
    if (sid) saveQueue(sid, buildPersistPayload(), { keepalive });
  }

  /** Top the look-ahead buffer up to BUFFER_TARGET, generating eagerly on a miss.
   *  Each computed item is deduped against the active item + what's already
   *  buffered. At most one fill runs at a time. Persists when settled. */
  async function refillBuffer() {
    if (refillingRef.current) return;
    if (!taxonomyReadyRef.current) return; // need the pool before we can compute
    refillingRef.current = true;
    try {
      let attempts = 0;
      while (bufferRef.current.length < BUFFER_TARGET && attempts < BUFFER_TARGET + 4) {
        attempts += 1;
        const next = await computeNext(0);
        if (!next) break;
        const key = itemKey(next);
        if (bufferRef.current.some((b) => itemKey(b) === key) || activeKeyRef.current === key) {
          continue; // skip a duplicate; loop tries again
        }
        // Reserve question ids so the following computeNext won't re-pick them.
        if (next.item.kind === "question" && !excludeRef.current.includes(next.item.data.id)) {
          excludeRef.current = [...excludeRef.current, next.item.data.id];
        }
        bufferRef.current = [...bufferRef.current, next];
      }
    } catch {
      /* a failed look-ahead is non-fatal; serveNext computes on demand */
    } finally {
      refillingRef.current = false;
      schedulePersist();
    }
  }

  const serveNext = useCallback(async (depth = 0) => {
    if (servingRef.current) return;
    servingRef.current = true;

    // Consume a buffered item INSTANTLY when one is ready (the common path).
    const buffered = bufferRef.current.shift();
    if (buffered) {
      applyItem(buffered);
      servingRef.current = false;
      refillBuffer(); // immediately work toward staying two steps ahead
      return;
    }

    // Buffer empty but taxonomy not ready yet (very early boot): defer the serve
    // to when taxonomy lands, instead of erroring on an empty pool.
    if (!taxonomyReadyRef.current) {
      pendingServeRef.current = true;
      setItemPhase("loading-next");
      setActiveItem(null);
      resetItemState();
      servingRef.current = false;
      return;
    }

    setItemPhase("loading-next");
    setActiveItem(null);
    resetItemState();
    try {
      const next = await computeNext(depth);
      if (!next) {
        setErrorMsg("No topics selected.");
        setItemPhase("error");
      } else {
        applyItem(next);
      }
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Failed to load the next item");
      setItemPhase("error");
    } finally {
      servingRef.current = false;
    }
    refillBuffer(); // begin warming the following item right away
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /** Warm the look-ahead buffer in the background (called in the reveal window). */
  function prefetchNext() {
    refillBuffer();
  }

  // ── Answer handlers ─────────────────────────────────────────────────────────
  const answerQuestion = useCallback(
    async (idx: number) => {
      if (!activeItem || activeItem.kind !== "question" || itemPhase !== "answering") return;
      const q = activeItem.data;
      const kwId = currentKeywordId;
      const isCorrect = idx === q.correct_index;

      setSelectedChoice(idx);
      if (kwId) {
        recentWrongRef.current.set(kwId, isCorrect ? 0 : (recentWrongRef.current.get(kwId) ?? 0) + 1);
      }
      awardQuiz();
      recordQuizAnswer(isCorrect);

      postAttempt({
        sessionId,
        questionId: q.id,
        selectedIndex: idx,
        usedRefresher: usedRefresherRef.current,
      }).then(applyScores);

      excludeRef.current = [...excludeRef.current, q.id];
      setRevealCorrect(q.correct_index);
      setExplanation(q.explanation);
      patchLastEntry({ outcome: isCorrect ? "correct" : "wrong", selectedIndex: idx, dontKnow: false });

      if (!isCorrect) {
        const prevMisses = missCountRef.current.get(q.id) ?? 0;
        missCountRef.current.set(q.id, prevMisses + 1);
        reviewQueueRef.current.push({
          kind: "question",
          sourceQuestionId: q.id,
          keywordId: kwId,
          dueAt: servedCountRef.current + Math.min(1 + prevMisses, 5),
          misses: prevMisses + 1,
        });
        reviewQueueRef.current.sort((a, b) => a.dueAt - b.dueAt);
        if (reviewQueueRef.current.length > 20) {
          reviewQueueRef.current.splice(0, reviewQueueRef.current.length - 20);
        }
      }

      setItemPhase("revealed");
      prefetchNext();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeItem, itemPhase, currentKeywordId, sessionId]
  );

  const skipQuestion = useCallback(async () => {
    if (!activeItem || activeItem.kind !== "question" || itemPhase !== "answering") return;
    const q = activeItem.data;
    const kwId = currentKeywordId;
    setDontKnow(true);
    awardQuiz();
    recordQuizAnswer(false);
    if (kwId) recentWrongRef.current.set(kwId, (recentWrongRef.current.get(kwId) ?? 0) + 1);

    postAttempt({
      sessionId,
      questionId: q.id,
      dontKnow: true,
      usedRefresher: usedRefresherRef.current,
    }).then(applyScores);

    excludeRef.current = [...excludeRef.current, q.id];
    setRevealCorrect(q.correct_index);
    setExplanation(q.explanation);
    patchLastEntry({ outcome: "skipped", dontKnow: true });

    const prevMisses = missCountRef.current.get(q.id) ?? 0;
    missCountRef.current.set(q.id, prevMisses + 1);
    reviewQueueRef.current.push({
      kind: "question",
      sourceQuestionId: q.id,
      keywordId: kwId,
      dueAt: servedCountRef.current + Math.min(1 + prevMisses, 5),
      misses: prevMisses + 1,
    });
    reviewQueueRef.current.sort((a, b) => a.dueAt - b.dueAt);

    setItemPhase("revealed");
    prefetchNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem, itemPhase, currentKeywordId, sessionId]);

  /** Footer "Skip" — record the question as skipped and advance WITHOUT
   *  revealing (the dot turns gray; re-viewable later via history). */
  const skipToNext = useCallback(async () => {
    if (!activeItem || activeItem.kind !== "question" || itemPhase !== "answering") return;
    const q = activeItem.data;
    const kwId = currentKeywordId;
    recordQuizAnswer(false);
    if (kwId) recentWrongRef.current.set(kwId, (recentWrongRef.current.get(kwId) ?? 0) + 1);

    postAttempt({
      sessionId,
      questionId: q.id,
      dontKnow: true,
      usedRefresher: usedRefresherRef.current,
    }).then(applyScores);

    excludeRef.current = [...excludeRef.current, q.id];
    patchLastEntry({ outcome: "skipped", dontKnow: true });

    const prevMisses = missCountRef.current.get(q.id) ?? 0;
    missCountRef.current.set(q.id, prevMisses + 1);
    reviewQueueRef.current.push({
      kind: "question",
      sourceQuestionId: q.id,
      keywordId: kwId,
      dueAt: servedCountRef.current + Math.min(1 + prevMisses, 5),
      misses: prevMisses + 1,
    });
    reviewQueueRef.current.sort((a, b) => a.dueAt - b.dueAt);

    // Advance via the buffer (instant when warm); footer skip has no reveal.
    serveNext(0);
  }, [activeItem, itemPhase, currentKeywordId, sessionId, serveNext]);

  const gradeFlashcard = useCallback(
    async (result: "got_it" | "missed_it" | "dont_know") => {
      if (!activeItem || activeItem.kind !== "flashcard") return;
      const card = activeItem.data;
      const kwId = currentKeywordId;
      const gotIt = result === "got_it";

      seenCardsRef.current.add(card.id);
      if (kwId) recentWrongRef.current.set(kwId, gotIt ? 0 : (recentWrongRef.current.get(kwId) ?? 0) + 1);
      awardFlashcard();
      recordFlashcardSeen(1);
      patchLastEntry({ outcome: gotIt ? "correct" : result === "missed_it" ? "wrong" : "skipped" });

      postFlashcardAttempt({ sessionId, flashcardId: card.id, result }).then(applyScores);

      if (!gotIt) {
        const prevMisses = missCountRef.current.get(card.id) ?? 0;
        missCountRef.current.set(card.id, prevMisses + 1);
        reviewQueueRef.current.push({
          kind: "flashcard",
          card,
          keywordId: kwId,
          dueAt: servedCountRef.current + Math.min(1 + prevMisses, 5),
          misses: prevMisses + 1,
        });
        reviewQueueRef.current.sort((a, b) => a.dueAt - b.dueAt);
      }

      // Flashcards have no reveal screen — straight to the next (buffered) item.
      serveNext(0);
    },
    [activeItem, currentKeywordId, sessionId, serveNext]
  );

  const similarQuestion = useCallback(async () => {
    if (!activeItem || activeItem.kind !== "question") return;
    const q = activeItem.data;
    setItemPhase("loading-similar");
    try {
      const newQ = await fetchSimilar({ sessionId, questionId: q.id });
      if (!excludeRef.current.includes(newQ.id)) excludeRef.current = [...excludeRef.current, newQ.id];
      applyItem({ item: { kind: "question", data: newQ }, keywordId: currentKeywordId });
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Failed to fetch similar question");
      setItemPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem, sessionId, currentKeywordId]);

  const next = useCallback(() => {
    serveNext(0);
  }, [serveNext]);

  // ── History navigation (the dots) ───────────────────────────────────────────
  const goToIndex = useCallback((i: number) => {
    setViewIndex(() => Math.max(0, Math.min(historyLenRef.current - 1, i)));
  }, []);
  const goPrev = useCallback(() => {
    setViewIndex((v) => Math.max(0, v - 1));
  }, []);
  const goForward = useCallback(() => {
    setViewIndex((v) => Math.min(historyLenRef.current - 1, v + 1));
  }, []);

  /** Commit a STAGED selection (the left sidebar's "Apply changes" button).
   *  Updates the live serve pool synchronously (so the immediate re-serve reads
   *  the new selection, not the lagged state), then serves a fresh item from it.
   *  An empty selection falls back to all Biology leaves. */
  const commitSelection = useCallback(
    (nextLeafs: Set<string>) => {
      const arr = Array.from(nextLeafs);
      selectionRef.current = arr.length > 0 ? arr : categories.flatMap(categoryLeafIds);
      setSelectedLeafs(new Set(nextLeafs));
      // Pool changed — buffered items may be off-topic now, so drop them and
      // rebuild from the new selection.
      bufferRef.current = [];
      serveNext(0);
    },
    [categories, serveNext]
  );

  const markRefresherUsed = useCallback(() => {
    usedRefresherRef.current = true;
  }, []);

  return {
    // data
    sessionId,
    categories,
    loadingCats,
    me,
    authRequired,
    authChecked,
    reloadAfterAuth,
    signOut,
    selectedLeafs,
    enabled,
    activeItem,
    itemPhase,
    currentKeywordId,
    selectedChoice,
    dontKnow,
    revealCorrect,
    explanation,
    errorMsg,
    scoresRef,
    // history (the dots)
    history,
    viewIndex,
    atFrontier: history.length === 0 ? true : viewIndex >= history.length - 1,
    // setters / handlers
    setEnabled,
    toggleLeafs,
    toggleLeaf,
    commitSelection,
    answerQuestion,
    skipQuestion,
    skipToNext,
    gradeFlashcard,
    similarQuestion,
    next,
    serveNext,
    markRefresherUsed,
    goToIndex,
    goPrev,
    goForward,
  };
}

export { categoryLeafIds, umbrellaLeafIds };
