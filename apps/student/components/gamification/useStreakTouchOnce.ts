"use client";

/**
 * useStreakTouchOnce — module-level latch that ensures /api/streak/touch
 * is called at most once per page-load across all consumers.
 *
 * On success, dispatches a "lodera-streak-update" CustomEvent so StreakBadge
 * can react without an additional fetch.
 *
 * Usage (call at the top of any answer-flow component):
 *   useStreakTouchOnce();
 */

import { useEffect } from "react";
import { touchStreak } from "@/lib/gamification";

// Module-level latch — persists across React re-renders / StrictMode double-invocations.
let _touched = false;
let _inFlight = false;

export function useStreakTouchOnce(): void {
  useEffect(() => {
    if (_touched || _inFlight) return;
    _inFlight = true;
    touchStreak().then((result) => {
      _inFlight = false;
      _touched = true;
      if (!result) return; // logged-out or error → stay silent
      window.dispatchEvent(
        new CustomEvent("lodera-streak-update", { detail: result })
      );
    }).catch(() => {
      _inFlight = false;
    });
  }, []);
}
