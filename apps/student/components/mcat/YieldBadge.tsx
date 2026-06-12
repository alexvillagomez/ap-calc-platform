/**
 * YieldBadge — MCAT yield-level chip, Lodera-styled.
 * Maps high/medium/low to the warm/neutral/cool ramp from brand.md.
 */
import { cn } from "@/lib/cn";

type YieldLevel = "high" | "medium" | "low";

interface YieldBadgeProps {
  level: YieldLevel | null | undefined;
  className?: string;
}

const styles: Record<YieldLevel, string> = {
  high:   "bg-amber-100   text-amber-700  border-amber-200",
  medium: "bg-neutral-100 text-neutral-600 border-neutral-200",
  low:    "bg-neutral-50  text-neutral-400 border-neutral-100",
};

const labels: Record<YieldLevel, string> = {
  high:   "High yield",
  medium: "Med yield",
  low:    "Low yield",
};

export function YieldBadge({ level, className }: YieldBadgeProps) {
  if (!level) return null;

  return (
    <span
      title={level}
      className={cn(
        "inline-flex items-center text-xs px-1.5 py-0.5 rounded-full border shrink-0 font-medium",
        styles[level],
        className
      )}
    >
      {labels[level]}
    </span>
  );
}
