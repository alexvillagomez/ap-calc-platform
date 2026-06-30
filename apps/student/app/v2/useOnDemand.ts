"use client";

/**
 * /v2 — on-demand content for the current keyword: lesson, refresher, related
 * topics (pgvector search), and prioritize toggle. Keyed off the active keyword
 * + label so the right panel and modals always reflect the item on screen.
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
}) {
  const { sessionId, keywordId, keywordLabel } = args;

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [refresher, setRefresher] = useState<Refresher | null>(null);
  const [refresherLoading, setRefresherLoading] = useState(false);
  const [related, setRelated] = useState<SearchResult[]>([]);
  const [prioritized, setPrioritized] = useState(false);

  // Cache lessons/refreshers per keyword within the session.
  const lessonCache = useRef<Map<string, Lesson>>(new Map());
  const refresherCache = useRef<Map<string, Refresher>>(new Map());

  // Reset lesson/refresher/prioritize state when the keyword changes.
  useEffect(() => {
    setLesson(keywordId ? lessonCache.current.get(keywordId) ?? null : null);
    setRefresher(keywordId ? refresherCache.current.get(keywordId) ?? null : null);
    setPrioritized(false);
  }, [keywordId]);

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
        const l = await fetchLesson(id);
        lessonCache.current.set(id, l);
        setLesson(l);
        return l;
      } catch {
        return null;
      } finally {
        setLessonLoading(false);
      }
    },
    [keywordId]
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
        const r = await fetchRefresher(id);
        refresherCache.current.set(id, r);
        setRefresher(r);
        return r;
      } catch {
        return null;
      } finally {
        setRefresherLoading(false);
      }
    },
    [keywordId]
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
