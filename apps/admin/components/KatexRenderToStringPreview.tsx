"use client";

import { useState } from "react";
import { KatexPlaygroundPreview } from "@/components/KatexPlaygroundPreview";

export function KatexRenderToStringPreview() {
  const [src, setSrc] = useState(
    String.raw`\begin{aligned}
&\textbf{Problem.}\ \text{The slope field below corresponds to the differential equation }\frac{dy}{dx}=y+x.\\[0.75em]
&\text{(a) Use the slope field to estimate }\left.\frac{dy}{dx}\right|_{(1,2)}.\\[0.5em]
&\text{(b) Is the solution increasing or decreasing at }(1,2)\text{? Explain.}\\[0.75em]
&\text{(c) Evaluate:}\\[0.5em]
&\qquad \displaystyle\int_{0}^{1} (3x^2+2x+1)\,dx.
\end{aligned}

<SlopeField equation="y + x" rangeX="-3,3" rangeY="-3,3" />`
  );

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
        <div className="text-sm font-medium">Rendered output</div>
        <p className="mt-1 text-xs text-muted-foreground">
          KaTeX default fonts; <code className="rounded bg-muted px-1 py-0.5">&lt;SlopeField /&gt;</code> and{" "}
          <code className="rounded bg-muted px-1 py-0.5">&lt;FunctionGraph /&gt;</code> use the same renderer as{" "}
          <code className="rounded bg-muted px-1 py-0.5">/preview-json</code> and{" "}
          <code className="rounded bg-muted px-1 py-0.5">/generate</code>.
        </p>
        <div className="mt-3">
          <KatexPlaygroundPreview latexContent={src} />
        </div>
      </div>
    </div>
  );
}
