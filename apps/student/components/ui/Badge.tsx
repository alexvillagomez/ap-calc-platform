/**
 * Lodera Badge — small pill label.
 * Includes YieldBadge variant: takes a 0–1 yield number, renders with
 * a cold (blue) → warm (green) → hot (amber) color ramp.
 */
import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// ── Generic Badge ─────────────────────────────────────────────────────────────

export type BadgeVariant =
  | "default"
  | "brand"
  | "success"
  | "error"
  | "warning"
  | "neutral";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-neutral-100 text-neutral-600",
  brand:   "bg-brand-100  text-brand-700",
  success: "bg-success-100 text-success-600",
  error:   "bg-error-100  text-error-600",
  warning: "bg-amber-100  text-amber-700",
  neutral: "bg-neutral-100 text-neutral-500",
};

export function Badge({
  variant = "default",
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

// ── YieldBadge ────────────────────────────────────────────────────────────────

/**
 * Renders a 0–1 yield score as a colored badge.
 * Cold → Warm → Hot color ramp:
 *   0.0–0.39  blue  (cold / untested)
 *   0.4–0.59  amber (warming up)
 *   0.6–0.79  lime  (getting there)
 *   0.8–1.0   green (hot / mastered)
 */
interface YieldBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** 0–1 yield score */
  value: number;
  /** Show percentage instead of decimal, e.g. "85%" */
  asPercent?: boolean;
}

function yieldClasses(value: number): string {
  if (value >= 0.8)  return "bg-success-100 text-success-600";
  if (value >= 0.6)  return "bg-lime-100    text-lime-700";
  if (value >= 0.4)  return "bg-amber-100   text-amber-700";
  return                    "bg-brand-100   text-brand-600";
}

export function YieldBadge({ value, asPercent = false, className, ...props }: YieldBadgeProps) {
  const clamped = Math.min(1, Math.max(0, value));
  const label   = asPercent ? `${Math.round(clamped * 100)}%` : clamped.toFixed(2);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        yieldClasses(clamped),
        className
      )}
      aria-label={`Yield: ${label}`}
      {...props}
    >
      {label}
    </span>
  );
}

export default Badge;
