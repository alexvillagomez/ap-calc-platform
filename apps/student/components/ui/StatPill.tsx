/**
 * Lodera StatPill — compact label + value stat chip.
 * Good for inline stats like "12/20 correct", "85% mastery", etc.
 */
import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface StatPillProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  /** Accent the value in brand color */
  accent?: boolean;
}

export function StatPill({ label, value, accent = false, className, ...props }: StatPillProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-neutral-200",
        "bg-white px-3 py-1 text-xs shadow-brand-xs",
        className
      )}
      {...props}
    >
      <span className="text-neutral-500">{label}</span>
      <span className={cn("font-semibold tabular-nums", accent ? "text-brand-600" : "text-neutral-800")}>
        {value}
      </span>
    </div>
  );
}

export default StatPill;
