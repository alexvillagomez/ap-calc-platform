"use client";

/**
 * ComboMeter — subtle in-session consecutive-correct indicator.
 *
 * - Appears from combo ≥ 2; invisible below (no layout shift — absolutely positioned).
 * - Milestone combos (3, 5, 10) get a slightly larger pop and brighter color.
 * - Resets quietly on miss (fades out).
 * - Pure client state — no API calls.
 * - SSR-safe (only renders after mount).
 *
 * Usage:
 *   <ComboMeter combo={comboCount} />
 *   where comboCount comes from your local comboReducer state.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { comboLabel, isMilestone } from "@/lib/gamification";

interface ComboMeterProps {
  combo: number;
  className?: string;
}

export function ComboMeter({ combo, className }: ComboMeterProps) {
  const [visible, setVisible] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const prevCombo = useRef(0);

  useEffect(() => {
    if (combo >= 2) {
      setVisible(true);
      if (combo !== prevCombo.current) {
        setAnimKey((k) => k + 1);
      }
    } else {
      // Fade out with a short delay so the reset isn't jarring
      const t = setTimeout(() => setVisible(false), 400);
      return () => clearTimeout(t);
    }
    prevCombo.current = combo;
  }, [combo]);

  const label = comboLabel(combo);
  const milestone = isMilestone(combo);

  if (!visible || combo < 2) {
    // Reserve absolutely-positioned space but show nothing (no layout shift)
    return <div className={cn("h-5", className)} aria-hidden="true" />;
  }

  return (
    <div
      className={cn("flex items-center justify-center h-5", className)}
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        key={`combo-${animKey}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
          "text-xs font-semibold transition-all",
          "motion-safe:animate-[lodera-correct-pop_320ms_cubic-bezier(0.34,1.56,0.64,1)_forwards]",
          milestone
            ? "bg-brand-100 text-brand-700 border border-brand-200"
            : "bg-neutral-100 text-neutral-500 border border-neutral-200",
          milestone && "scale-105"
        )}
      >
        {milestone && (
          <svg width="9" height="9" viewBox="0 0 8 8" aria-hidden="true">
            <defs>
              <linearGradient id="combo-star-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            <path
              d="M4 4 C3.67 3.17 3.4 1.83 4 0 C4.6 1.83 4.33 3.17 4 4 M4 4 C4.83 4.33 6.17 4.6 8 4 C6.17 3.4 4.83 3.67 4 4 M4 4 C4.33 4.83 4.6 6.17 4 8 C3.4 6.17 3.67 4.83 4 4 M4 4 C3.17 3.67 1.83 3.4 0 4 C1.83 4.6 3.17 4.33 4 4"
              fill="url(#combo-star-grad)"
            />
          </svg>
        )}
        {label}
      </span>
    </div>
  );
}

export default ComboMeter;
