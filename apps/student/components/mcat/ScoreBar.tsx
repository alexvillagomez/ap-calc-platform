/**
 * ScoreBar — thin mastery bar using Lodera ProgressBar colors.
 * Wired to the success/warning/error semantic ramp.
 */
import { cn } from "@/lib/cn";

interface ScoreBarProps {
  pct: number; // 0–100
  className?: string;
}

export function ScoreBar({ pct, className = "" }: ScoreBarProps) {
  const clamped = Math.min(100, Math.max(0, pct));

  const fillCls =
    clamped >= 80
      ? "bg-gradient-to-r from-success-400 to-success-500"
      : clamped >= 50
      ? "bg-gradient-to-r from-amber-300 to-amber-400"
      : "bg-gradient-to-r from-error-400 to-error-500";

  return (
    <div
      className={cn(
        "h-1.5 bg-neutral-100 rounded-full overflow-hidden",
        className
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", fillCls)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
