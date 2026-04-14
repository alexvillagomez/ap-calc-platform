"use client";

import { Preview } from "@/components/Preview";

/** Renders LaTeX + embedded viz tags via `Preview` (default problem typography). `/generate` uses `Preview` with `useProblemTypography={false}` to match preview-katex. */
export function KatexBlock({
  latex,
  className = "",
  displayMode = true,
}: {
  latex: string;
  className?: string;
  displayMode?: boolean;
}) {
  const content =
    displayMode || latex.includes("$") ? latex : `$${latex.replace(/\$/g, "\\$")}$`;
  return <Preview latexContent={content} className={className} />;
}
