"use client";

import { useState } from "react";
import { KatexPlaygroundPreview } from "@/components/KatexPlaygroundPreview";

const DEFAULT_CONTENT = `A particle moves along the x-axis. Its velocity at time $t$ seconds is $v(t) = 3t^2 - 6t + 4$ m/s.

(a) Find the acceleration function $a(t)$.

(b) At what time $t > 0$ is the particle momentarily at rest?

(c) Evaluate $\\int_0^2 v(t)\\,dt$ and interpret the result.`;

export function KatexRenderToStringPreview() {
  const [src, setSrc] = useState(DEFAULT_CONTENT);
  const [useProblemTypography, setUseProblemTypography] = useState(true);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-medium">KaTeX input</div>
        <textarea
          className="mt-3 h-56 w-full resize-none rounded-md border bg-background p-3 font-mono text-sm leading-5"
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Rendered output</div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={useProblemTypography}
              onChange={(e) => setUseProblemTypography(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Problem fonts (Times New Roman)
          </label>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Supports <code className="rounded bg-muted px-1 py-0.5">$…$</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5">$$…$$</code>, plain prose, and{" "}
          <code className="rounded bg-muted px-1 py-0.5">&lt;SlopeField /&gt;</code> /{" "}
          <code className="rounded bg-muted px-1 py-0.5">&lt;FunctionGraph /&gt;</code> tags.
        </p>
        <div className="mt-3">
          <KatexPlaygroundPreview latexContent={src} useProblemTypography={useProblemTypography} />
        </div>
      </div>
    </div>
  );
}
