"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Preview } from "@/components/Preview";
import { FeedbackReport, type StudentStrengths } from "@/components/FeedbackReport";
import { updateStrengths, updateStrengthsDiagnostic, normalizeDifficulty, scoreProblemByKeyword, selectProblem, propagateEvidence, buildGraphFromProblems, type ScoredProblem } from "@/lib/practiceAlgorithm";

// Prerequisites are not their own dimension — a correct answer nudges each
// prerequisite keyword's topic strength up slightly; a wrong answer leaves it untouched.
const PREREQ_LEARNING_RATE = 0.15;
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DemoProblem {
  id: string;
  topic_id: string | null;
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
  difficulty: number | null;
  keyword_weights: Record<string, number> | null;
  action_weights: Record<string, number> | null;
  representation_weights: Record<string, number> | null;
  prerequisite_weights: Record<string, number> | null;
  avg_rating: number | null;
  rating_count: number;
  report_count?: number;
  created_at: string;
  course?: string;
}

type Phase = "idle" | "loading" | "answering" | "revealed" | "done" | "empty";

type UmbrellaInfo = { id: string; label: string };

const CHOICE_LABELS = ["A", "B", "C", "D"];
const ACCOUNT_KEY = "ap_calc_account_id";
const SESSION_KEY = "ap_calc_student_session_id";
const DIAGNOSTIC_STATE_KEY = "demo_diagnostic_state";
const DIAG_DONE_KEY = "ap_calc_diagnostic_done";

// ─── Diagnostic persistence helpers ──────────────────────────────────────────

interface SavedDiagnosticState {
  accountId: string;
  answeredCount: number;
  keywordStrengths: Record<string, number>;
  actionStrengths: Record<string, number>;
  reprStrengths: Record<string, number>;
  umbrellaTouchCounts: Record<string, number>;
  touched: string[];
  seenIds: string[];
}

function loadSavedState(accountId: string): SavedDiagnosticState | null {
  try {
    const raw = localStorage.getItem(DIAGNOSTIC_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedDiagnosticState;
    if (parsed.accountId !== accountId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDiagnosticState(state: SavedDiagnosticState): void {
  try {
    localStorage.setItem(DIAGNOSTIC_STATE_KEY, JSON.stringify(state));
  } catch { /* storage full or unavailable — silent */ }
}

function clearDiagnosticState(): void {
  try {
    localStorage.removeItem(DIAGNOSTIC_STATE_KEY);
  } catch { /* silent */ }
}

// The demo is currently scoped to Polynomials only — this is how many attempts
// an umbrella keyword needs before we consider it "well tested" and can stop.
const UMBRELLA_WELL_TESTED_THRESHOLD = 3;
// Hard ceiling so the diagnostic can't loop forever if some umbrellas never converge.
const DEMO_DIAGNOSTIC_MAX_QUESTIONS = 25;
// If an umbrella's average in-depth keyword strength exceeds this, we treat it
// as well-tested immediately — strong students don't need 3 mechanical touches.
const UMBRELLA_MASTERY_STRENGTH_GATE = 0.72;

// The demo ties keyword weights to the student's account, so it reuses the
// account's session id rather than minting a separate anonymous one.
function getOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `demo-${Date.now()}`;
  }
}

function formatKeywordLabel(id: string): string {
  return id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Maps average keyword strength [0,1] to a target difficulty on the 1–5 scale
// used by problem.difficulty, so weaker students see easier problems and the
// target rises smoothly as strengths converge toward mastery.
function computeDemoTargetDifficulty(strengths: Record<string, number>): number {
  const vals = Object.values(strengths);
  if (vals.length === 0) return 3;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.min(5, Math.max(1, 1 + avg * 4));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ─── Star rating widget ───────────────────────────────────────────────────────

function StarRating({
  currentAvg,
  ratingCount,
  onRate,
  rated,
}: {
  currentAvg: number | null;
  ratingCount: number;
  onRate: (stars: number, note: string) => Promise<void>;
  rated: boolean;
}) {
  const [hovered, setHovered] = useState(0);
  const [done, setDone] = useState(rated);

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className="text-yellow-500">★</span>
        <span>
          {currentAvg !== null ? currentAvg.toFixed(1) : "—"}
          <span className="text-gray-400 ml-1">({ratingCount})</span>
        </span>
        <span className="text-green-600 text-xs font-medium ml-1">✓ Rated</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => { void onRate(star, ""); setDone(true); }}
          className="text-xl leading-none transition-colors"
          style={{ color: star <= hovered ? "#f59e0b" : "#d1d5db" }}
        >
          ★
        </button>
      ))}
      {currentAvg !== null && (
        <span className="ml-2 text-xs text-gray-400">
          avg {currentAvg.toFixed(1)} ({ratingCount})
        </span>
      )}
    </div>
  );
}

// ─── Flag widget ──────────────────────────────────────────────────────────────

function FlagButton({ onFlag }: { onFlag: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    await onFlag(reason.trim());
    setDone(true);
    setSubmitting(false);
    setOpen(false);
  };

  if (done) return <span className="text-xs text-orange-500 font-medium">⚑ Flagged</span>;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-gray-400 hover:text-orange-500 transition-colors"
      >
        ⚑ Flag issue
      </button>
      {open && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-orange-400"
            autoFocus
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="text-xs px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium disabled:opacity-50 transition-colors"
          >
            {submitting ? "…" : "Report"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}
    </div>
  );
}

// ─── Demo page ────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [problems, setProblems] = useState<DemoProblem[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [accountId, setAccountId] = useState("");
  const queueRef = useRef<DemoProblem[]>([]);
  const queueIdx = useRef(0);
  // Track problem IDs that have already been answered so we can skip them on resume
  const seenIdsRef = useRef<Set<string>>(new Set());

  const [problem, setProblem] = useState<DemoProblem | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);

  // Polynomials-only umbrella tracking — drives the "well tested, show report" stop condition
  const [umbrellas, setUmbrellas] = useState<UmbrellaInfo[]>([]);
  const inDepthToUmbrellaRef = useRef<Record<string, string>>({});
  const graphRef = useRef<ReturnType<typeof buildGraphFromProblems> | null>(null);
  const [umbrellaTouchCounts, setUmbrellaTouchCounts] = useState<Record<string, number>>({});

  // Timing — records when the current problem was presented so we can log time_spent_ms
  const answerStartTimeRef = useRef<number>(Date.now());

  // Auto-scroll: bring the Next button into view after answer is revealed
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  // Per-problem feedback state (reset on next)
  const [currentAvg, setCurrentAvg] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [rated, setRated] = useState(false);

  // keyword_weights tracking (topic dimension for sidebar)
  const [keywordStrengths, setKeywordStrengths] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());

  // All keyword IDs seen across all problems (for sidebar label lookup)
  const [allKeywords, setAllKeywords] = useState<Record<string, string>>({});

  // 4-dimensional strengths for FeedbackReport (prereqs boost the topic dimension, not their own)
  const [actionStrengths, setActionStrengths] = useState<Record<string, number>>({});
  const [reprStrengths, setReprStrengths] = useState<Record<string, number>>({});
  const [prereqIds, setPrereqIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Require an account so the demo's keyword weights are tied to the student's profile.
    const aid = localStorage.getItem(ACCOUNT_KEY);
    if (!aid) { router.replace("/login"); return; }
    setAccountId(aid);
    setSessionId(getOrCreateSessionId());
  }, [router]);

  // Persist diagnostic progress to localStorage whenever key state changes.
  // Only write once the diagnostic has actually started (answeredCount > 0) and
  // while it is still in progress — avoids overwriting a completed session with
  // an empty one if the component re-mounts after the redirect to /demo-practice.
  useEffect(() => {
    if (!accountId || answeredCount === 0 || phase === "idle" || phase === "done" || phase === "empty") return;
    saveDiagnosticState({
      accountId,
      answeredCount,
      keywordStrengths,
      actionStrengths,
      reprStrengths,
      umbrellaTouchCounts,
      touched: [...touched],
      seenIds: [...seenIdsRef.current],
    });
  }, [accountId, answeredCount, keywordStrengths, actionStrengths, reprStrengths, umbrellaTouchCounts, touched, phase]);

  // When the diagnostic completes, clear saved state so a returning user starts fresh.
  useEffect(() => {
    if (phase !== "done") return;
    clearDiagnosticState();
    try { localStorage.setItem(DIAG_DONE_KEY, "1"); } catch {}
    if (accountId) {
      fetch("/api/demo/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      }).catch(() => {});
    }
  }, [phase, accountId]);

  // When the answer is revealed, scroll the Next button smoothly into view so the
  // student doesn't have to manually scroll down to continue.
  useEffect(() => {
    if (phase !== "revealed") return;
    const t = setTimeout(() => {
      nextButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 100);
    return () => clearTimeout(t);
  }, [phase]);

  // All Polynomials umbrella keywords have a confident sample size — time to stop and show the report.
  const umbrellasWellTested = umbrellas.length > 0 && umbrellas.every(
    (u) => (umbrellaTouchCounts[u.id] ?? 0) >= UMBRELLA_WELL_TESTED_THRESHOLD
  );

  const loadNext = useCallback(() => {
    if (umbrellasWellTested || answeredCount >= DEMO_DIAGNOSTIC_MAX_QUESTIONS) {
      setPhase("done");
      return;
    }

    let idx = queueIdx.current;
    if (idx >= queueRef.current.length) {
      // Ran through the bank without every umbrella reaching the threshold yet —
      // reshuffle and keep going so the run can converge.
      queueRef.current = shuffle(problems);
      queueIdx.current = 0;
      idx = 0;
    }
    const queue = queueRef.current;

    // Adaptive selection: score the remaining unseen problems against the
    // student's current keyword strengths and a difficulty target derived from
    // them, then weighted-randomly pick from the top scorers. This converges
    // toward the student's ability as keywordStrengths update each answer.
    const remaining = queue.slice(idx);
    const targetDifficulty = computeDemoTargetDifficulty(keywordStrengths);
    const scored: ScoredProblem[] = remaining.map((p) => ({
      id: p.id,
      difficulty: p.difficulty ?? 3,
      avg_rating: p.avg_rating,
      score: scoreProblemByKeyword(
        { difficulty: p.difficulty ?? 3, estimated_difficulty: null, keyword_weights: p.keyword_weights ?? {}, avg_rating: p.avg_rating },
        keywordStrengths,
        targetDifficulty
      ),
    }));
    const pickedId = selectProblem(scored)?.id;
    const next = remaining.find((p) => p.id === pickedId) ?? remaining[0]!;

    // Swap the picked problem into the current slot so queueIdx still advances correctly
    const pickedPos = queue.findIndex((p) => p.id === next.id);
    if (pickedPos !== idx) {
      [queue[idx], queue[pickedPos]] = [queue[pickedPos]!, queue[idx]!];
    }

    setProblem(next);
    setPhase("answering");
    setSelectedChoice(null);
    setCurrentAvg(next.avg_rating ?? null);
    setRatingCount(next.rating_count ?? 0);
    setRated(false);
    answerStartTimeRef.current = Date.now(); // stamp when problem is presented
  }, [keywordStrengths, problems, umbrellasWellTested, answeredCount]);

  // Internal fetch-and-setup — shared by handleStart (fresh) and resume (restored).
  // When `saved` is provided the strengths/counts are restored from it instead of
  // being initialised to defaults, and already-seen problems are skipped in the queue.
  const fetchAndSetupProblems = useCallback(async (saved?: SavedDiagnosticState) => {
    setPhase("loading");
    try {
      // Ensure a real session row exists (use direct call — sessionId state may not be set yet)
      const sid = getOrCreateSessionId();
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid }),
      });

      const [problemsRes, seenRes] = await Promise.all([
        fetch("/api/demo/problems"),
        fetch(`/api/demo/seen-problems?sessionId=${encodeURIComponent(sid)}`),
      ]);
      const payload = (await problemsRes.json()) as { problems?: DemoProblem[]; umbrellas?: UmbrellaInfo[]; inDepthToUmbrella?: Record<string, string> };
      const data = payload.problems ?? [];
      if (data.length === 0) {
        setPhase("empty");
        return;
      }
      graphRef.current = buildGraphFromProblems(data);
      setUmbrellas(payload.umbrellas ?? []);
      inDepthToUmbrellaRef.current = payload.inDepthToUmbrella ?? {};

      // Build keyword label map from all problems
      const kwMap: Record<string, string> = {};
      const prereqIdSet = new Set<string>();
      for (const p of data) {
        for (const id of Object.keys(p.keyword_weights ?? {})) kwMap[id] = formatKeywordLabel(id);
        for (const id of Object.keys(p.action_weights ?? {})) kwMap[id] = formatKeywordLabel(id);
        for (const id of Object.keys(p.representation_weights ?? {})) kwMap[id] = formatKeywordLabel(id);
        for (const id of Object.keys(p.prerequisite_weights ?? {})) {
          kwMap[id] = formatKeywordLabel(id);
          prereqIdSet.add(id);
        }
      }
      setAllKeywords(kwMap);
      setPrereqIds(prereqIdSet);

      // Fetch DB-persisted seen IDs so problems already answered in a previous
      // session run (or before a page refresh) are excluded from the candidate pool.
      let dbSeenPayload: { seenIds?: string[] } = {};
      try { dbSeenPayload = (await seenRes.json()) as { seenIds?: string[] }; } catch { /* non-fatal */ }
      const dbSeenIds = new Set<string>(dbSeenPayload.seenIds ?? []);

      if (saved) {
        // ── Resume path ──────────────────────────────────────────────────────
        // Restore strength estimates and counts from the saved snapshot.
        setKeywordStrengths(saved.keywordStrengths);
        setActionStrengths(saved.actionStrengths);
        setReprStrengths(saved.reprStrengths);
        setUmbrellaTouchCounts(saved.umbrellaTouchCounts);
        setTouched(new Set(saved.touched));
        setAnsweredCount(saved.answeredCount);
        // Merge localStorage seenIds with DB-persisted ones so we have the full
        // picture regardless of which source is more up-to-date.
        const seenSet = new Set([...saved.seenIds, ...dbSeenIds]);
        seenIdsRef.current = seenSet;
        // Shuffle unseen problems to the front; seen ones go to the back so the
        // queue doesn't exhaust immediately and can wrap around naturally.
        const unseen = shuffle(data.filter((p) => !seenSet.has(p.id)));
        const seen = data.filter((p) => seenSet.has(p.id));
        const ordered = [...unseen, ...seen];
        queueRef.current = ordered;
        queueIdx.current = 0;
        setProblems(ordered);
      } else {
        // ── Fresh start path ─────────────────────────────────────────────────
        // Pre-populate seenIdsRef with any problems answered in a prior run so
        // they are pushed to the back of the queue (not excluded entirely — we
        // still allow wrap-around if the bank is small).
        seenIdsRef.current = new Set(dbSeenIds);
        setUmbrellaTouchCounts({});
        const unseen = shuffle(data.filter((p) => !dbSeenIds.has(p.id)));
        const seen = data.filter((p) => dbSeenIds.has(p.id));
        const ordered = [...unseen, ...seen];
        queueRef.current = ordered;
        queueIdx.current = 0;
        setProblems(ordered);
        setKeywordStrengths(Object.fromEntries(Object.keys(kwMap).map((k) => [k, 0.5])));
      }
    } catch {
      setPhase("empty");
      return;
    }
    // loadNext reads queueRef which is now set
    setTimeout(loadNext, 0);
  }, [loadNext]);

  const handleStart = useCallback(async () => {
    await fetchAndSetupProblems();
  }, [fetchAndSetupProblems]);

  // On mount (after accountId is resolved), check for a saved in-progress session
  // and auto-resume it so a reload doesn't throw the student back to the splash screen.
  useEffect(() => {
    if (!accountId) return;
    const saved = loadSavedState(accountId);
    if (!saved || saved.answeredCount === 0) return;
    // Auto-resume: re-fetch problems and restore state
    void fetchAndSetupProblems(saved);
  // fetchAndSetupProblems changes identity when loadNext changes, which is fine —
  // this effect only fires once when accountId first becomes available.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Mount guard: if the student already completed the diagnostic, redirect to practice.
  useEffect(() => {
    if (!accountId) return;
    if (localStorage.getItem(DIAG_DONE_KEY) === "1") {
      router.replace("/demo-practice");
    }
  }, [accountId, router]);

  // Tally how many times each Polynomials umbrella keyword has been exercised
  // (summed across its in-depth children, mirroring how /api/learn/progress
  // aggregates total_attempts) so we know when it's confidently sampled.
  const recordUmbrellaTouches = (kw: Record<string, number>) => {
    const map = inDepthToUmbrellaRef.current;
    const deltas: Record<string, number> = {};
    for (const id of Object.keys(kw)) {
      const u = map[id];
      if (u) deltas[u] = (deltas[u] ?? 0) + 1;
    }
    if (Object.keys(deltas).length === 0) return;
    setUmbrellaTouchCounts((prev) => {
      const next = { ...prev };
      for (const [u, d] of Object.entries(deltas)) next[u] = (next[u] ?? 0) + d;
      return next;
    });
  };

  // Mastery gate: if an umbrella's average in-depth keyword strength already exceeds
  // UMBRELLA_MASTERY_STRENGTH_GATE, we immediately credit it as well-tested so strong
  // students don't have to wait for 3 mechanical touch counts per umbrella.
  // Called synchronously inside the setKeywordStrengths callback with the freshly
  // computed `next` strengths to avoid stale-closure issues.
  const checkAndCreditMasteredUmbrellas = useCallback((nextStrengths: Record<string, number>) => {
    const map = inDepthToUmbrellaRef.current;

    // Group in-depth keyword IDs by umbrella
    const umbrellaToInDepth: Record<string, string[]> = {};
    for (const [inDepthId, umbrellaId] of Object.entries(map)) {
      if (!umbrellaToInDepth[umbrellaId]) umbrellaToInDepth[umbrellaId] = [];
      umbrellaToInDepth[umbrellaId].push(inDepthId);
    }

    const toCredit: string[] = [];
    for (const [umbrellaId, inDepthIds] of Object.entries(umbrellaToInDepth)) {
      if (inDepthIds.length === 0) continue;
      const strengths = inDepthIds.map((id) => nextStrengths[id] ?? 0.5);
      const avg = strengths.reduce((a, b) => a + b, 0) / strengths.length;
      if (avg > UMBRELLA_MASTERY_STRENGTH_GATE) {
        toCredit.push(umbrellaId);
      }
    }

    if (toCredit.length === 0) return;

    setUmbrellaTouchCounts((prev) => {
      // Only bump umbrellas that aren't already at the threshold — avoids redundant updates
      const shouldUpdate = toCredit.some(
        (id) => (prev[id] ?? 0) < UMBRELLA_WELL_TESTED_THRESHOLD
      );
      if (!shouldUpdate) return prev;
      const next = { ...prev };
      for (const id of toCredit) {
        next[id] = Math.max(next[id] ?? 0, UMBRELLA_WELL_TESTED_THRESHOLD);
      }
      return next;
    });
  }, []);

  const commitAnswer = (correct: boolean, choiceIndex: number | null, heavyPenalty: boolean) => {
    if (!problem || phase !== "answering") return;
    setSelectedChoice(choiceIndex);
    setPhase("revealed");
    // Record this problem as seen so it can be skipped if the session is resumed
    seenIdsRef.current.add(problem.id);

    const kw = problem.keyword_weights ?? {};
    const aw = problem.action_weights ?? {};
    const rw = problem.representation_weights ?? {};
    const pw = problem.prerequisite_weights ?? {};

    const mergedWeights = { ...kw, ...aw, ...rw };
    const touchedIds = [...Object.keys(kw), ...Object.keys(aw), ...Object.keys(rw), ...Object.keys(pw)];

    const nd = normalizeDifficulty(problem.difficulty ?? 3);

    setKeywordStrengths((prev) => {
      let next = updateStrengthsDiagnostic(prev, mergedWeights, correct, nd);
      // Evidence propagation: infer untested skills from tested ones via the co-occurrence
      // graph and umbrella sibling correlation. This is additive and runs before heavyPenalty
      // so an explicit "I don't know" still overrides any propagated estimate on tested keywords.
      // NOTE: the UPSTREAM pass below overlaps conceptually with the per-problem `pw` boost
      // further down (updateStrengths(next, pw, true, PREREQ_LEARNING_RATE)). Both are
      // intentionally kept: the `pw` boost uses per-problem prerequisite_weights (sparser,
      // more precise); this graph-based pass uses the denser co-occurrence graph (broader
      // coverage). The reviewer can evaluate removing one once real prerequisite data is richer.
      if (graphRef.current) {
        next = propagateEvidence(next, mergedWeights, graphRef.current, correct, nd, inDepthToUmbrellaRef.current);
      }
      // "I don't know" → force every touched keyword to exactly 0 (explicit knowledge gap)
      if (heavyPenalty) {
        for (const id of Object.keys(mergedWeights)) {
          if (mergedWeights[id] > 0) next[id] = 0;
        }
      }
      // Prerequisites only ever boost — correct answers nudge each prerequisite keyword's
      // topic strength up slightly; wrong answers leave them untouched.
      if (correct && Object.keys(pw).length > 0) {
        next = updateStrengths(next, pw, true, PREREQ_LEARNING_RATE);
      }
      // Umbrella propagation: when an in-depth skill crosses 0.65 on a correct answer,
      // nudge its umbrella parent upward — knowing the specific skill implies knowing
      // the broader topic area at a moderate level.
      if (correct) {
        const umbrellaMap = inDepthToUmbrellaRef.current;
        for (const [id, strength] of Object.entries(next)) {
          if (strength > 0.65 && kw[id] !== undefined) {
            const umbrellaId = umbrellaMap[id];
            if (umbrellaId) {
              const uPrev = next[umbrellaId] ?? 0.5;
              next[umbrellaId] = Math.min(1, uPrev + 0.10 * (1 - uPrev));
            }
          }
        }
      }
      // Mastery gate: immediately credit umbrellas whose avg in-depth strength
      // has crossed the threshold — short-circuits touch counting for strong students.
      checkAndCreditMasteredUmbrellas(next);

      // fire-and-forget DB write into the real learn_student_keyword_states table
      // problemId is sent so the handler can calibrate rag_examples.estimated_difficulty.
      fetch("/api/demo/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          correct,
          topicId: problem.topic_id ?? "precalc",
          keywordStrengths: next,
          touchedIds,
          problemId: problem.id,
          keywordWeights: kw,
        }),
      }).catch(() => {});
      return next;
    });
    setActionStrengths((prev) => {
      const next = updateStrengthsDiagnostic(prev, aw, correct, nd);
      if (heavyPenalty) {
        for (const id of Object.keys(aw)) {
          if (aw[id] > 0) next[id] = 0;
        }
      }
      return next;
    });
    setReprStrengths((prev) => {
      const next = updateStrengthsDiagnostic(prev, rw, correct, nd);
      if (heavyPenalty) {
        for (const id of Object.keys(rw)) {
          if (rw[id] > 0) next[id] = 0;
        }
      }
      return next;
    });
    setTouched((prev) => {
      const next = new Set(prev);
      touchedIds.forEach((k) => next.add(k));
      return next;
    });
    recordUmbrellaTouches(kw);

    // ── Prerequisite inference ────────────────────────────────────────────────
    // When a correct answer would nudge a prerequisite keyword above the
    // confidence threshold (~0.62), we already know the student understands it —
    // count its umbrella as tested so we don't need to ask an explicit question.
    // This can shorten the diagnostic by 2–4 questions for strong students.
    if (correct && Object.keys(pw).length > 0) {
      const inferredForTouches: Record<string, number> = {};
      for (const [id, w] of Object.entries(pw)) {
        if (w <= 0) continue;
        const prev = keywordStrengths[id] ?? 0.5;
        // Approximate post-boost strength: same EMA step as updateStrengths with PREREQ_LEARNING_RATE
        const estimated = prev + PREREQ_LEARNING_RATE * w * (1 - prev);
        if (estimated >= 0.62) {
          inferredForTouches[id] = w;
        }
      }
      if (Object.keys(inferredForTouches).length > 0) {
        recordUmbrellaTouches(inferredForTouches);
      }
    }

    setAnsweredCount((n) => n + 1);
  };

  const handleAnswer = (choiceIndex: number) => {
    if (!problem) return;
    commitAnswer(choiceIndex === problem.correct_index, choiceIndex, false);
  };

  const handleDontKnow = () => {
    if (!problem) return;
    commitAnswer(false, null, true);
  };

  const handleNext = () => {
    queueIdx.current += 1;
    loadNext();
  };

  const handleRate = useCallback(async (stars: number, note: string) => {
    if (!problem || !sessionId) return;
    try {
      await fetch("/api/content-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          contentType: "rag_example",
          contentId: problem.id,
          rating: stars,
          ...(note ? { reason: note } : {}),
        }),
      });
      setRated(true);
      const newCount = ratingCount + 1;
      const newAvg = ((currentAvg ?? stars) * ratingCount + stars) / newCount;
      setCurrentAvg(Math.round(newAvg * 10) / 10);
      setRatingCount(newCount);
    } catch { /* silent */ }
  }, [problem, sessionId, currentAvg, ratingCount]);

  const handleFlag = useCallback(async (reason: string) => {
    if (!problem || !sessionId) return;
    try {
      await fetch("/api/content-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          contentType: "rag_example",
          contentId: problem.id,
          report: true,
          reason: reason || undefined,
        }),
      });
    } catch { /* silent */ }
  }, [problem, sessionId]);

  // Build StudentStrengths for FeedbackReport.
  // Topic keywords are scoped strictly to Polynomials: only include in-depth keywords
  // that appear in inDepthToUmbrellaRef (i.e. are children of a Polynomials umbrella).
  // parentLabel is set to the umbrella's label so FeedbackReport can group by umbrella.
  const buildStrengths = (): StudentStrengths => {
    const umbrellaLabelMap = new Map(umbrellas.map((u) => [u.id, u.label]));
    const inDepthMap = inDepthToUmbrellaRef.current; // id → umbrella id

    const topicKw = Object.keys(inDepthMap)
      .filter((id) => touched.has(id))
      .map((id) => {
        const umbrellaId = inDepthMap[id]!;
        return {
          id,
          label: allKeywords[id] ?? formatKeywordLabel(id),
          strength: keywordStrengths[id] ?? 0.5,
          parentLabel: umbrellaLabelMap.get(umbrellaId) ?? formatKeywordLabel(umbrellaId),
        };
      });

    const actionKw = Object.entries(actionStrengths)
      .filter(([id]) => touched.has(id))
      .map(([id, strength]) => ({ id, label: allKeywords[id] ?? formatKeywordLabel(id), strength }));

    const reprKw = Object.entries(reprStrengths)
      .filter(([id]) => touched.has(id))
      .map(([id, strength]) => ({ id, label: allKeywords[id] ?? formatKeywordLabel(id), strength }));

    // Prerequisites only shown if they're touched Polynomials in-depth keywords
    const prereqKw = [...prereqIds]
      .filter((id) => touched.has(id) && id in inDepthMap)
      .map((id) => ({ id, label: allKeywords[id] ?? formatKeywordLabel(id), strength: keywordStrengths[id] ?? 0.5 }));

    return { topic: topicKw, action: actionKw, representation: reprKw, prereq: prereqKw };
  };

  const showFeedback = answeredCount >= 5;

  const handleRestart = () => {
    clearDiagnosticState();
    seenIdsRef.current = new Set();
    queueRef.current = shuffle(problems);
    queueIdx.current = 0;
    setAnsweredCount(0);
    setTouched(new Set());
    setKeywordStrengths(Object.fromEntries(Object.keys(allKeywords).map((k) => [k, 0.5])));
    setActionStrengths({});
    setReprStrengths({});
    setUmbrellaTouchCounts({});
    setProblem(null);
    setPhase("idle");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Left sidebar ─────────────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white overflow-y-auto">
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-sm font-semibold text-gray-900">Adaptive diagnostic</h1>
          <p className="text-xs text-gray-400 mt-0.5">Problems from question bank</p>
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs text-gray-500 mb-2">
            {answeredCount} question{answeredCount !== 1 ? "s" : ""} answered
          </p>
          {answeredCount > 0 && problems.length > 0 && (
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 bg-blue-500"
                style={{ width: `${Math.min(100, Math.round(answeredCount / problems.length * 100))}%` }}
              />
            </div>
          )}
        </div>

        <div className="px-4 py-3 flex-1">
          <button
            onClick={() => router.push("/progress")}
            className="w-full text-left px-3 py-2.5 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
          >
            <p className="text-sm font-medium text-gray-800">View your report</p>
            <p className="text-xs text-gray-400 mt-0.5">See your umbrella and individual scores →</p>
          </button>
        </div>

        {/* Logout — pinned to bottom of sidebar */}
        <div className="px-4 py-3 border-t border-gray-100">
          <button
            onClick={() => {
              localStorage.removeItem(SESSION_KEY);
              localStorage.removeItem(ACCOUNT_KEY);
              localStorage.removeItem(DIAG_DONE_KEY);
              router.replace("/");
            }}
            className="w-full text-left text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* ── Main panel ───────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* Idle */}
        {phase === "idle" && (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <div className="max-w-md space-y-4">
              <div className="text-5xl">📊</div>
              <h2 className="text-xl font-semibold text-gray-800">Adaptive diagnostic — Polynomials</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                Work through Polynomials problems from the question bank. We&apos;ll keep going until each Polynomials
                skill area has been sampled enough to give you a confident report, then show you where you&apos;re strong and where to focus.
              </p>
              <button
                className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-sm"
                onClick={handleStart}
              >
                Start diagnostic
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {phase === "loading" && (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-400 animate-pulse">Loading problems…</p>
          </div>
        )}

        {/* Empty */}
        {phase === "empty" && (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 space-y-3">
            <div className="text-4xl">📭</div>
            <p className="text-lg font-semibold text-gray-700">No problems in the database yet</p>
            <p className="text-sm text-gray-400">Add problems via the admin Problem Input page, then come back.</p>
          </div>
        )}

        {/* Done */}
        {phase === "done" && (
          <div className="max-w-lg mx-auto px-6 py-10 space-y-6">
            <div className="text-center space-y-2">
              <div className="text-4xl">✅</div>
              <h2 className="text-xl font-semibold text-gray-800">Polynomials diagnostic complete</h2>
              <p className="text-sm text-gray-500">
                {answeredCount} question{answeredCount !== 1 ? "s" : ""} answered
                {umbrellasWellTested ? " — every skill area sampled" : ""}
              </p>
            </div>
            <FeedbackReport strengths={buildStrengths()} answeredCount={answeredCount} mode="full" />
            <button
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-sm"
              onClick={() => router.push("/demo-practice")}
            >
              Start practice →
            </button>
            <button
              className="w-full py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium transition-colors"
              onClick={handleRestart}
            >
              Restart diagnostic instead
            </button>
          </div>
        )}

        {/* Answering / Revealed */}
        {(phase === "answering" || phase === "revealed") && problem && (
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-5">
            {/* Compact feedback insight */}
            {showFeedback && (
              <FeedbackReport strengths={buildStrengths()} answeredCount={answeredCount} mode="compact" />
            )}

            {/* Problem stem */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <Preview latexContent={problem.latex_content} />
            </div>

            {/* Choices */}
            <div className="space-y-2" data-problem-id={problem.id}>
              {problem.choices.map((choice, i) => {
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
                      state === "default" && phase === "revealed" && "bg-white border-gray-200 opacity-50",
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

            {phase === "answering" && (
              <button
                type="button"
                onClick={handleDontKnow}
                className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2 transition-colors"
              >
                I don&apos;t know how to do this
              </button>
            )}

            {/* Solution + rating + flag + next */}
            {phase === "revealed" && (
              <>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Solution</h3>
                  </div>
                  <div className="p-5">
                    <Preview latexContent={problem.solution_latex} />
                  </div>
                </div>

                {/* Rating + flag */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rate this problem</p>
                  <StarRating
                    key={`rating-${problem.id}`}
                    currentAvg={currentAvg}
                    ratingCount={ratingCount}
                    onRate={handleRate}
                    rated={rated}
                  />
                  <FlagButton key={`flag-${problem.id}`} onFlag={handleFlag} />
                </div>

                <button
                  ref={nextButtonRef}
                  className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-sm"
                  onClick={handleNext}
                >
                  {queueIdx.current + 1 >= queueRef.current.length ? "See results →" : "Next problem →"}
                </button>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
