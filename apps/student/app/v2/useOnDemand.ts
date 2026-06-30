"use client";

/**
 * /v2 — on-demand content for the current keyword: lesson, refresher, related
 * topics (pgvector search), and prioritize toggle. Keyed off the active keyword
 * + label so the right panel and modals always reflect the item on screen.
 *
 * Lessons + refreshers are warmed SILENTLY in the background whenever a question
 * or flashcard is on screen (pass `prefetchContent`), so the right-panel buttons
 * and modals open instantly. Prefetch + explicit open share one in-flight request
 * per keyword (no double-generation).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLesson,
  fetchRefresher,
  searchKeywords,
  setPriority,
  type Lesson,
  type Refresher,
  type SearchResult,
} from "./api";

export function useOnDemand(args: {
  sessionId: string;
  keywordId: string | null;
  keywordLabel: string | null;
  /** When true (the active item is a question or flashcard), silently warm the
   *  lesson + refresher for `keywordId` so the right panel opens instantly. */
  prefetchContent?: boolean;
}) {
  const { sessionId, keywordId, keywordLabel, prefetchContent = false } = args;

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [refresher, setRefresher] = useState<Refresher | null>(null);
  const [refresherLoading, setRefresherLoading] = useState(false);
  const [related, setRelated] = useState<SearchResult[]>([]);
  const [prioritized, setPrioritized] = useState(false);

  // Cache lessons/refreshers per keyword within the session.
  const lessonCache = useRef<Map<string, Lesson>>(new Map());
  const refresherCache = useRef<Map<string, Refresher>>(new Map());
  // In-flight requests per keyword — so a silent prefetch and an explicit open
  // (or a second prefetch) coalesce into ONE fetch/generation.
  const lessonInflight = useRef<Map<string, Promise<Lesson | null>>>(new Map());
  const refresherInflight = useRef<Map<string, Promise<Refresher | null>>>(new Map());
  // Live keyword id so a slow background fetch only updates VISIBLE state when it
  // still matches what's on screen.
  const keywordIdRef = useRef<string | null>(keywordId);
  useEffect(() => {
    keywordIdRef.current = keywordId;
  }, [keywordId]);

  // Fetch-once helpers: cache hit → resolve; in-flight → share; else fetch, cache,
  // and clear the in-flight slot. Never throw (fail-soft to null).
  const ensureLesson = useCallback((id: string): Promise<Lesson | null> => {
    const cached = lessonCache.current.get(id);
    if (cached) return Promise.resolve(cached);
    const inflight = lessonInflight.current.get(id);
    if (inflight) return inflight;
    const p = fetchLesson(id)
      .then((l) => {
        lessonCache.current.set(id, l);
        return l;
      })
      .catch(() => null)
      .finally(() => {
        lessonInflight.current.delete(id);
      });
    lessonInflight.current.set(id, p);
    return p;
  }, []);

  const ensureRefresher = useCallback((id: string): Promise<Refresher | null> => {
    const cached = refresherCache.current.get(id);
    if (cached) return Promise.resolve(cached);
    const inflight = refresherInflight.current.get(id);
    if (inflight) return inflight;
    const p = fetchRefresher(id)
      .then((r) => {
        refresherCache.current.set(id, r);
        return r;
      })
      .catch(() => null)
      .finally(() => {
        refresherInflight.current.delete(id);
      });
    refresherInflight.current.set(id, p);
    return p;
  }, []);

  // Reset lesson/refresher/prioritize state when the keyword changes (loads from
  // cache when already warmed — the prefetch below fills it in otherwise).
  useEffect(() => {
    setLesson(keywordId ? lessonCache.current.get(keywordId) ?? null : null);
    setRefresher(keywordId ? refresherCache.current.get(keywordId) ?? null : null);
    setPrioritized(false);
  }, [keywordId]);

  // ── Silent background warm ──────────────────────────────────────────────────
  // While a question/flashcard is on screen, generate (and cache) its lesson +
  // refresher in the background. No loading flags are flipped (truly silent);
  // when ready we reflect into visible state IF the keyword is still current.
  useEffect(() => {
    if (!keywordId || !prefetchContent) return;
    let cancelled = false;
    ensureLesson(keywordId).then((l) => {
      if (cancelled || !l) return;
      if (keywordIdRef.current === keywordId) setLesson(l);
    });
    ensureRefresher(keywordId).then((r) => {
      if (cancelled || !r) return;
      if (keywordIdRef.current === keywordId) setRefresher(r);
    });
    return () => {
      cancelled = true;
    };
  }, [keywordId, prefetchContent, ensureLesson, ensureRefresher]);

  // Related topics from pgvector search on the current keyword label.
  useEffect(() => {
    let cancelled = false;
    if (!keywordLabel) {
      setRelated([]);
      return;
    }
    searchKeywords(keywordLabel).then((res) => {
      if (cancelled) return;
      // Drop the current keyword itself; keep top related leaves.
      setRelated(res.filter((r) => r.keyword_id !== keywordId).slice(0, 3));
    });
    return () => {
      cancelled = true;
    };
  }, [keywordLabel, keywordId]);

  const loadLesson = useCallback(
    async (kw?: string | null): Promise<Lesson | null> => {
      const id = kw ?? keywordId;
      if (!id) return null;
      const cached = lessonCache.current.get(id);
      if (cached) {
        setLesson(cached);
        return cached;
      }
      setLessonLoading(true);
      try {
        const l = await ensureLesson(id);
        if (l) setLesson(l);
        return l;
      } finally {
        setLessonLoading(false);
      }
    },
    [keywordId, ensureLesson]
  );

  const loadRefresher = useCallback(
    async (kw?: string | null): Promise<Refresher | null> => {
      const id = kw ?? keywordId;
      if (!id) return null;
      const cached = refresherCache.current.get(id);
      if (cached) {
        setRefresher(cached);
        return cached;
      }
      setRefresherLoading(true);
      try {
        const r = await ensureRefresher(id);
        if (r) setRefresher(r);
        return r;
      } finally {
        setRefresherLoading(false);
      }
    },
    [keywordId, ensureRefresher]
  );

  const togglePriority = useCallback(async () => {
    if (!keywordId) return;
    const nextOn = !prioritized;
    setPrioritized(nextOn); // optimistic
    const ok = await setPriority({ sessionId, keywordId, on: nextOn });
    if (!ok) setPrioritized(!nextOn); // revert on failure (fail-soft)
  }, [keywordId, prioritized, sessionId]);

  return {
    lesson,
    lessonLoading,
    refresher,
    refresherLoading,
    related,
    prioritized,
    loadLesson,
    loadRefresher,
    togglePriority,
  };
}
