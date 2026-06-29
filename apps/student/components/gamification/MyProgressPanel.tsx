"use client";

/**
 * MyProgressPanel — the points breakdown shown both in the header popup (off
 * home) and on the full /progress page (from home). Reads the persistent points
 * store and live-updates as points are awarded.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import {
  getPoints,
  subscribePoints,
  POINTS_FLASHCARD,
  POINTS_QUIZ,
  type PointsSummary,
} from "@/lib/points";

const ZERO: PointsSummary = { today: 0, week: 0, month: 0, total: 0 };

export default function MyProgressPanel({ className }: { className?: string }) {
  const [pts, setPts] = useState<PointsSummary>(ZERO);

  useEffect(() => {
    setPts(getPoints());
    return subscribePoints(setPts);
  }, []);

  const rows: { label: string; value: number; accent?: boolean }[] = [
    { label: "Today", value: pts.today, accent: true },
    { label: "This week", value: pts.week },
    { label: "This month", value: pts.month },
    { label: "All time", value: pts.total },
  ];

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Points</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          +{POINTS_FLASHCARD} per flashcard you get right, +{POINTS_QUIZ} per quiz
          question.
        </p>
      </div>

      {/* Small score squares — one compact tile per timeframe. */}
      <div className="grid grid-cols-4 gap-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className={cn(
              "flex aspect-square flex-col items-center justify-center rounded-lg border px-1 text-center",
              r.accent
                ? "border-brand-200 bg-brand-50"
                : "border-neutral-200 bg-white"
            )}
          >
            <p
              className={cn(
                "text-lg font-bold leading-none tabular-nums",
                r.accent ? "text-brand-700" : "text-neutral-900"
              )}
            >
              {r.value.toLocaleString()}
            </p>
            <p className="mt-1 text-[10px] font-medium leading-tight text-neutral-500">
              {r.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
