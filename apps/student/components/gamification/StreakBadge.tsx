"use client";

/**
 * StreakBadge — compact header chip showing the user's current daily streak.
 *
 * - Hidden when logged out (streak === null).
 * - On streak extension: brief celebrate state (scale pop + playStreak + "+1" float).
 * - Absolutely-positioned floating "+1" so the chip itself never shifts.
 * - SSR-safe: no reads of localStorage at module scope.
 *
 * Usage:
 *   <StreakBadge />   — fetches /api/auth/me on mount; handles 401 silently.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { onStreakExtended } from "@/lib/gamification";

interface StreakData {
  current_streak: number;
  longest_streak: number;
}

// 4-point sparkle — same geometry as brand mark
const STAR_PATH =
  "M4 4 C3.67 3.17 3.4 1.83 4 0 C4.6 1.83 4.33 3.17 4 4 M4 4 C4.83 4.33 6.17 4.6 8 4 C6.17 3.4 4.83 3.67 4 4 M4 4 C4.33 4.83 4.6 6.17 4 8 C3.4 6.17 3.67 4.83 4 4 M4 4 C3.17 3.67 1.83 3.4 0 4 C1.83 4.6 3.17 4.33 4 4";

interface StreakBadgeProps {
  className?: string;
}

export function StreakBadge({ className }: StreakBadgeProps) {
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const celebrateKey = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return; // 401 or error → stay hidden
        const data = await res.json() as { streak?: StreakData };
        if (cancelled) return;
        if (data?.streak) setStreak(data.streak);
      } catch {
        // Fail silent
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Listen for streak-extension events dispatched by useStreakTouchOnce
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<StreakData & { extended_today: boolean }>).detail;
      setStreak({ current_streak: detail.current_streak, longest_streak: detail.longest_streak });
      if (detail.extended_today) {
        celebrateKey.current += 1;
        setCelebrating(true);
        onStreakExtended();
        setTimeout(() => setCelebrating(false), 1600);
      }
    };
    window.addEventListener("lodera-streak-update", handler);
    return () => window.removeEventListener("lodera-streak-update", handler);
  }, []);

  // Hidden when streak is unknown. Also hidden at 0 — a dead "0" chip is noise
  // for new users; the badge first appears with the day-1 celebration instead.
  if (!streak || (streak.current_streak === 0 && !celebrating)) return null;

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <div
        key={celebrating ? `pop-${celebrateKey.current}` : "idle"}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1",
          "bg-brand-50 border border-brand-200 text-brand-700",
          "text-xs font-semibold select-none",
          celebrating && "lodera-correct-pop"
        )}
        aria-label={`${streak.current_streak}-day streak`}
        title={`Current streak: ${streak.current_streak} days · Longest: ${streak.longest_streak} days`}
      >
        {/* Brand 4-point star */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 8 8"
          aria-hidden="true"
          className="shrink-0"
        >
          <defs>
            <linearGradient id="streak-star-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          <path d={STAR_PATH} fill="url(#streak-star-grad)" />
        </svg>
        <span className="tabular-nums">{streak.current_streak}</span>
      </div>

      {/* Floating "+1" that animates up then disappears */}
      {celebrating && (
        <span
          key={`plus1-${celebrateKey.current}`}
          aria-hidden="true"
          className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold text-brand-500 pointer-events-none motion-safe:animate-[lodera-float-up_800ms_ease-out_forwards]"
        >
          +1
        </span>
      )}
    </div>
  );
}

export default StreakBadge;
