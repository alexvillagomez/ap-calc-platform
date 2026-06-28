/**
 * practiceBuffer — a tiny, page-agnostic client engine for serving the next
 * practice item FAST. Shared by the math and MCAT auto pages (their serve loops
 * are structurally identical).
 *
 * The problem it solves: deciding "what's next" is cheap, but each item used to
 * be fetched via a blocking round-trip fired only when the student clicked
 * Continue. This engine separates the slow part (fetch) from the instant parts
 * (decide + apply) so:
 *
 *   - DECIDE (the page) produces a `ServeDescriptor` — keyword, category, kind
 *     (question | flashcard), difficulty, review flag.
 *   - BUFFER (here) keeps the extra items the server hands back with each fetch
 *     (`buffer` field) and serves the next matching descriptor from memory with
 *     ZERO network. One fetch therefore covers several questions.
 *   - PREFETCH (here) runs the fetch during the answer-reveal window, so the item
 *     is already in hand when Continue is clicked.
 *   - APPLY (the page) is the ONLY place that mutates the page's seen/exclude/
 *     recent refs. `take`/`prefetch` are side-effect-free w.r.t. the page, so a
 *     prefetch that is never applied (e.g. the student advances instead) leaks
 *     nothing — the unused question stays `active` and re-servable.
 *
 * The actual network calls are injected by the page (`fetchQuestionBatch` /
 * `fetchFlashcards`) so all system/course-specific request building stays there.
 */

export type ItemKind = "question" | "flashcard";

export type ServeDescriptor<RK = unknown> = {
  sessionId: string;
  keywordId: string;
  categoryId: string;
  kind: ItemKind;
  /** Question difficulty tier (also the fallback tier if a flashcard is empty). */
  difficulty?: "easy" | "medium" | "hard";
  /** True when this item is an interleaved spaced-review item. */
  forReview?: boolean;
  /** Opaque review-keyword object passed straight back to the page. */
  reviewKeyword?: RK;
};

export type ReadyItem<Q, FC, RK = unknown> =
  | { ok: true; kind: "question"; question: Q; descriptor: ServeDescriptor<RK> }
  | { ok: true; kind: "flashcard"; flashcards: FC[]; descriptor: ServeDescriptor<RK> }
  | { ok: false; descriptor: ServeDescriptor<RK>; error: string; status?: number };

export type QuestionBatchResult<Q> =
  | { head: Q; extras: Q[] }
  | { error: string; status?: number };

export type FlashcardResult<FC> =
  | { flashcards: FC[] }
  | { error: string; status?: number };

export type PracticeBufferConfig<Q, FC, RK = unknown> = {
  /** Fetch a question + its buffered extras for the descriptor. */
  fetchQuestionBatch: (d: ServeDescriptor<RK>) => Promise<QuestionBatchResult<Q>>;
  /** Fetch flashcard(s) for the descriptor (not buffered — usually count 1). */
  fetchFlashcards: (d: ServeDescriptor<RK>) => Promise<FlashcardResult<FC>>;
};

export type PracticeBuffer<Q, FC, RK = unknown> = {
  /** Serve the descriptor: from the buffer if possible, else fetch (and refill). */
  take: (d: ServeDescriptor<RK>) => Promise<ReadyItem<Q, FC, RK>>;
  /** Start `take` now and stash the promise for a later `consume`. */
  prefetch: (d: ServeDescriptor<RK>) => void;
  /** Hand back the pending prefetch (once), with whether it has already settled. */
  consume: () => { promise: Promise<ReadyItem<Q, FC, RK>>; settled: boolean } | null;
  /** Drop the buffer + any pending prefetch (call on keyword advance / state change). */
  clear: () => void;
  /** Total buffered question count (debug / tests). */
  size: () => number;
};

export function createPracticeBuffer<Q extends { id: string }, FC, RK = unknown>(
  cfg: PracticeBufferConfig<Q, FC, RK>
): PracticeBuffer<Q, FC, RK> {
  // Buffered question extras keyed by keyword id — the unit the decision pulls by.
  const qBuffer = new Map<string, Q[]>();
  let pending: Promise<ReadyItem<Q, FC, RK>> | null = null;
  let pendingSettled = false;

  async function take(d: ServeDescriptor<RK>): Promise<ReadyItem<Q, FC, RK>> {
    if (d.kind === "flashcard") {
      const r = await cfg.fetchFlashcards(d);
      if (!("error" in r) && r.flashcards.length > 0) {
        return { ok: true, kind: "flashcard", flashcards: r.flashcards, descriptor: d };
      }
      // No card available (or error) → never stall; serve a question for the same
      // keyword instead, carrying the descriptor's fallback difficulty + review flag.
      return take({ ...d, kind: "question" });
    }

    // Question — serve a buffered extra for this keyword if we have one (no network).
    const buffered = qBuffer.get(d.keywordId);
    if (buffered && buffered.length > 0) {
      const head = buffered.shift()!;
      if (buffered.length === 0) qBuffer.delete(d.keywordId);
      return { ok: true, kind: "question", question: head, descriptor: d };
    }

    const r = await cfg.fetchQuestionBatch(d);
    if ("error" in r) {
      return { ok: false, descriptor: d, error: r.error, status: r.status };
    }
    if (r.extras.length > 0) {
      const existing = qBuffer.get(d.keywordId) ?? [];
      existing.push(...r.extras);
      qBuffer.set(d.keywordId, existing);
    }
    return { ok: true, kind: "question", question: r.head, descriptor: d };
  }

  function prefetch(d: ServeDescriptor<RK>): void {
    pendingSettled = false;
    const p = take(d);
    pending = p;
    // Track settlement so the page can skip the loading spinner when it's already
    // resolved (the common case: the student spent seconds reading the solution).
    void p.then(
      () => { if (pending === p) pendingSettled = true; },
      () => { if (pending === p) pendingSettled = true; }
    );
  }

  function consume() {
    if (!pending) return null;
    const out = { promise: pending, settled: pendingSettled };
    pending = null;
    pendingSettled = false;
    return out;
  }

  function clear(): void {
    qBuffer.clear();
    pending = null;
    pendingSettled = false;
  }

  function size(): number {
    let n = 0;
    for (const v of qBuffer.values()) n += v.length;
    return n;
  }

  return { take, prefetch, consume, clear, size };
}
