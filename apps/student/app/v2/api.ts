"use client";

/**
 * /v2 — thin API client + shared types for the real MCAT "Custom Practice"
 * workflow. Mirrors the payloads/shapes used by app/mcat/practice/page.tsx.
 * Biology section only. Every call is a plain fetch against an existing route.
 */

// ── Taxonomy ──────────────────────────────────────────────────────────────────

export interface InDepthChild {
  id: string;
  label: string;
  description: string;
  score: number | null;
  total_attempts: number;
  needs_lesson: boolean;
}

export interface TaxonomyUmbrella {
  id: string;
  label: string;
  description: string;
  score: number | null;
  implied_score: number | null;
  total_attempts: number;
  children: InDepthChild[];
}

export interface TaxonomyCategory {
  id: string;
  label: string;
  description: string;
  section?: string;
  order_index?: number;
  umbrellas?: TaxonomyUmbrella[];
}

// ── Content ───────────────────────────────────────────────────────────────────

export interface Question {
  id: string;
  stem: string;
  choices: string[];
  correct_index: number;
  explanation: string;
  keyword_weights: Record<string, number>;
  primary_keyword_id?: string | null;
  difficulty: number;
  parent_question_id: string | null;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  keyword_weights: Record<string, number>;
}

/** The in-lesson understanding-check carried by a lesson page (when has_check). */
export interface McatLessonCheck {
  latex_content: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
}

export interface McatMicroStep {
  step_index: number;
  has_check: boolean;
  explanation_latex: string;
  example_latex: string;
  /** Present when has_check — the inline comprehension quiz for this page. */
  check_question?: McatLessonCheck;
  hint_latex?: string;
}

export interface Lesson {
  id: string;
  keyword_id: string;
  keyword_label: string | null;
  micro_steps: McatMicroStep[];
}

export interface Refresher {
  keyword_id: string;
  rule_latex: string | null;
  example_latex: string | null;
}

export interface SearchResult {
  keyword_id: string;
  label: string;
  category_id: string | null;
  score: number;
}

export interface MeUser {
  id: string;
  email?: string | null;
  username?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface MeResponse {
  user: MeUser;
  streak?: { current_streak?: number; longest_streak?: number } | null;
}

/** Per-keyword state map returned by attempt routes. */
export type KwStates = Record<
  string,
  { score?: number; state?: string; needs_lesson?: boolean }
>;

// ── Persisted serve queue (cross-session boot cache) ──────────────────────────

/** One already-built item the serve loop will show next. Structurally mirrors
 *  useMcatPractice's ActiveItem so a restored entry drops straight into state. */
export type SavedItem =
  | { kind: "question"; data: Question }
  | { kind: "flashcard"; data: Flashcard }
  | { kind: "lesson"; data: Lesson };

export interface SavedQueueItem {
  item: SavedItem;
  keywordId: string | null;
}

// ── Fetch helpers ───────────────────────────────────────────────────────────────

export async function fetchTaxonomy(sessionId: string): Promise<TaxonomyCategory[]> {
  // section=biology + lean: the route returns ONLY Biology, drops keyword
  // descriptions + the duplicate flat keywords array → ~3 MB down to a fraction.
  // The app reads only the umbrella tree + scores; descriptions load on demand.
  const res = await fetch(`/api/mcat/taxonomy?session_id=${sessionId}&section=biology&lean=1`);
  if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load taxonomy"));
  const data = (await res.json()) as { categories?: TaxonomyCategory[] };
  return data.categories ?? [];
}

export async function fetchNextQuestion(args: {
  sessionId: string;
  categoryId?: string;
  keywordId: string;
  difficulty: "easy" | "medium" | "hard";
  excludeIds?: string[];
}): Promise<Question> {
  const res = await fetch("/api/mcat/next-question", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: args.sessionId,
      category_id: args.categoryId,
      keyword_id: args.keywordId,
      difficulty: args.difficulty,
      exclude_ids: args.excludeIds?.length ? args.excludeIds : undefined,
    }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load question"));
  const data = (await res.json()) as { question: Question };
  return data.question;
}

export async function fetchFlashcardsForKeyword(args: {
  sessionId: string;
  categoryId?: string;
  keywordId: string;
}): Promise<Flashcard[]> {
  const res = await fetch("/api/mcat/flashcards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: args.sessionId,
      category_id: args.categoryId,
      keyword_id: args.keywordId,
    }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { flashcards?: Flashcard[] };
  return data.flashcards ?? [];
}

export async function postAttempt(args: {
  sessionId: string;
  questionId: string;
  selectedIndex?: number;
  dontKnow?: boolean;
  usedRefresher?: boolean;
}): Promise<KwStates | null> {
  const res = await fetch("/api/mcat/attempt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: args.sessionId,
      question_id: args.questionId,
      selected_index: args.selectedIndex,
      dont_know: args.dontKnow,
      context: "practice",
      usedRefresher: args.usedRefresher,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { keyword_states?: KwStates };
  return data.keyword_states ?? null;
}

export async function postFlashcardAttempt(args: {
  sessionId: string;
  flashcardId: string;
  result: "got_it" | "missed_it" | "dont_know";
}): Promise<KwStates | null> {
  const res = await fetch("/api/mcat/flashcard-attempt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: args.sessionId,
      flashcard_id: args.flashcardId,
      result: args.result,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { keyword_states?: KwStates };
  return data.keyword_states ?? null;
}

export async function fetchSimilar(args: {
  sessionId: string;
  questionId: string;
}): Promise<Question> {
  const res = await fetch("/api/mcat/similar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: args.sessionId, question_id: args.questionId }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load similar question"));
  const data = (await res.json()) as { question: Question };
  return data.question;
}

export async function fetchLesson(keywordId: string): Promise<Lesson> {
  const res = await fetch(`/api/mcat/lesson/${encodeURIComponent(keywordId)}`);
  if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load lesson"));
  return (await res.json()) as Lesson;
}

export async function fetchRefresher(keywordId: string): Promise<Refresher> {
  const res = await fetch(`/api/mcat/refresher/${encodeURIComponent(keywordId)}`);
  // Refresher route is fail-soft 200.
  const data = (await res.json().catch(() => ({}))) as Partial<Refresher>;
  return {
    keyword_id: data.keyword_id ?? keywordId,
    rule_latex: data.rule_latex ?? null,
    example_latex: data.example_latex ?? null,
  };
}

export async function searchKeywords(query: string): Promise<SearchResult[]> {
  try {
    const res = await fetch("/api/mcat/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = (await res.json().catch(() => ({}))) as { results?: SearchResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function setPriority(args: {
  sessionId: string;
  keywordId: string;
  on: boolean;
}): Promise<boolean> {
  try {
    if (args.on) {
      const res = await fetch("/api/priority", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: args.sessionId,
          system: "mcat",
          keyword_id: args.keywordId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      return data.ok ?? res.ok;
    }
    const res = await fetch(
      `/api/priority?session_id=${encodeURIComponent(args.sessionId)}&system=mcat&keyword_id=${encodeURIComponent(args.keywordId)}`,
      { method: "DELETE" }
    );
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return data.ok ?? res.ok;
  } catch {
    return false;
  }
}

/** Read the persisted upcoming queue for this session (uid). Fail-soft to []. */
export async function fetchQueue(sessionId: string): Promise<SavedQueueItem[]> {
  try {
    const res = await fetch(`/api/mcat/v2-queue?session_id=${encodeURIComponent(sessionId)}`);
    if (!res.ok) return [];
    const data = (await res.json().catch(() => ({}))) as { queue?: SavedQueueItem[] };
    return Array.isArray(data.queue) ? data.queue : [];
  } catch {
    return [];
  }
}

/** Persist the upcoming queue. `keepalive` lets it fire during pagehide/unload.
 *  Fully fail-soft — saving the boot cache must never disrupt the session. */
export async function saveQueue(
  sessionId: string,
  queue: SavedQueueItem[],
  opts?: { keepalive?: boolean }
): Promise<void> {
  try {
    await fetch("/api/mcat/v2-queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, queue }),
      keepalive: opts?.keepalive ?? false,
    });
  } catch {
    /* ignore — boot cache is best-effort */
  }
}

export async function fetchMe(): Promise<MeResponse | null> {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    return (await res.json()) as MeResponse;
  } catch {
    return null;
  }
}
