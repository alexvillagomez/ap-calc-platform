"use client";

import { Preview } from "@/components/Preview";
import { cn } from "@/lib/utils";

/**
 * Same shell as the preview-katex “Rendered output” pane: default KaTeX fonts
 * (`useProblemTypography={false}`) inside `overflow-x-auto rounded-md border bg-background p-3`.
 */
export function KatexPlaygroundPreview({
  latexContent,
  className,
  useProblemTypography = false,
}: {
  latexContent: string;
  className?: string;
  useProblemTypography?: boolean;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-md border bg-background p-3", className)}>
      <Preview latexContent={latexContent} useProblemTypography={useProblemTypography} />
    </div>
  );
}
