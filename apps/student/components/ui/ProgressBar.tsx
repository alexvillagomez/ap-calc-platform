/**
 * Lodera ProgressBar — smooth animated fill using CSS custom property.
 * Accessible: role="progressbar" with aria-valuenow.
 */
import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  /** 0–100 */
  value: number;
  /** Track height variant */
  size?: "xs" | "sm" | "md";
  /** Optional label for aria */
  label?: string;
  /** Color override; defaults to brand gradient */
  color?: "brand" | "success" | "error";
}

const sizeClasses = {
  xs: "h-1",
  sm: "h-1.5",
  md: "h-2.5",
};

const fillClasses: Record<NonNullable<ProgressBarProps["color"]>, string> = {
  brand:   "bg-gradient-to-r from-brand-400 to-brand-600",
  success: "bg-gradient-to-r from-success-400 to-success-600",
  error:   "bg-gradient-to-r from-error-400 to-error-600",
};

export function ProgressBar({
  value,
  size = "sm",
  label,
  color = "brand",
  className,
  ...props
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        "w-full rounded-full overflow-hidden bg-neutral-100",
        sizeClasses[size],
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out lodera-bar-fill",
          fillClasses[color]
        )}
        style={
          {
            "--progress-pct": `${clamped}%`,
            width: `${clamped}%`,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

export default ProgressBar;
