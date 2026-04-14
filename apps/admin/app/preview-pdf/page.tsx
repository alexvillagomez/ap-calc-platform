"use client";

import { Preview } from "@/components/Preview";

const DEMO = `$$
\\begin{aligned}
&\\textbf{Problem.}\\ \\text{The slope field below corresponds to the differential equation }\\frac{dy}{dx}=y+x.\\\\[0.75em]
&\\text{(a) Use the slope field to estimate }\\left.\\frac{dy}{dx}\\right|_{(1,2)}.\\\\[0.5em]
&\\text{(b) Is the solution increasing or decreasing at }(1,2)\\text{? Explain.}\\\\[0.75em]
&\\text{(c) Evaluate:}\\\\[0.5em]
&\\qquad \\displaystyle\\int_{0}^{1} (3x^2+2x+1)\\,dx.
\\end{aligned}
$$

<SlopeField equation="y + x" rangeX="-3,3" rangeY="-3,3" />

$$
\\textbf{Answer.}\\ \\left.\\frac{dy}{dx}\\right|_{(1,2)}=3\\quad\\text{and the solution is increasing at }(1,2)\\text{ since }y+x>0.
$$
`;

export default function PreviewPdfPage() {
  return (
    <main className="min-h-screen p-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">Slope field + KaTeX demo</h1>
        <p className="text-sm text-muted-foreground">
          This uses the <code>&lt;SlopeField /&gt;</code> component together with KaTeX-rendered math in the same
          preview.
        </p>
      </section>

      <section className="border rounded-lg overflow-auto bg-muted p-4">
        <Preview latexContent={DEMO} />
      </section>
    </main>
  );
}
