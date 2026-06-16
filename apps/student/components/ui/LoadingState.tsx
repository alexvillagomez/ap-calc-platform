"use client";

/**
 * LoadingState — on-brand, informative loading block.
 *
 * Replaces bare, context-free spinners so slow pages (cold start / live AI
 * generation) communicate that work is happening rather than feeling broken.
 *
 * Props:
 *   message   — primary line (neutral-700), e.g. "Loading Lodera…"
 *   sublabel  — optional secondary line (neutral-500), e.g. timing hint
 *   variant   — "spinner" (default) or "skeleton" (pulsing neutral bars)
 */
import { cn } from "@/lib/cn";

interface LoadingStateProps {
  message?: string;
  sublabel?: string;
  variant?: "spinner" | "skeleton";
}

export function LoadingState({
  message = "Loading…",
  sublabel,
  variant = "spinner",
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-4 py-16 text-center"
    >
      {variant === "skeleton" ? (
        <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-3 w-2/3 rounded-full bg-neutral-200" />
            <div className="h-3 w-full rounded-full bg-neutral-100" />
            <div className="h-3 w-5/6 rounded-full bg-neutral-100" />
          </div>
        </div>
      ) : (
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-100 border-t-brand-500" />
      )}
      <div>
        <p className="text-sm font-medium text-neutral-700">{message}</p>
        {sublabel && <p className="mt-1 text-xs text-neutral-500">{sublabel}</p>}
      </div>
    </div>
  );
}

export default LoadingState;
