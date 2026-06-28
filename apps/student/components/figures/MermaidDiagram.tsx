"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Deterministic pathway / flow-diagram renderer.
 *
 * Renders a Mermaid DSL string (glycolysis, the electron transport chain, signal
 * cascades, enzyme-regulation loops, decision trees) into clean SVG, client-side,
 * with NO AI image generation. The diagram structure is exactly what the generator
 * (or author) specified — labels and arrows cannot hallucinate. Invalid DSL fails
 * soft: Mermaid throws on a parse error and we show a small fallback instead of
 * crashing the page.
 *
 * Used via the `<Mermaid>...DSL...</Mermaid>` block viz-tag intercepted in MathText,
 * so it renders wherever content renders (problems AND quiz questions).
 */

let mermaidInit = false;
let idCounter = 0;

export function MermaidDiagram({ diagram }: { diagram: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  // Stable per-instance id (no Math.random — render must be deterministic/SSR-safe).
  const idRef = useRef<string>("");
  if (!idRef.current) idRef.current = `mermaid-${++idCounter}`;

  useEffect(() => {
    let cancelled = false;
    const code = (diagram ?? "").trim();
    if (!code) return;
    import("mermaid")
      .then(async (mod) => {
        const mermaid = (mod as { default?: unknown }).default ?? mod;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = mermaid as any;
        if (!mermaidInit) {
          m.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "neutral",
            fontFamily: "inherit",
          });
          mermaidInit = true;
        }
        try {
          const { svg } = await m.render(idRef.current, code);
          if (!cancelled && ref.current) {
            ref.current.innerHTML = svg;
            setFailed(false);
          }
        } catch {
          if (!cancelled) setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [diagram]);

  if (failed) {
    return (
      <span className="my-2 block rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500">
        Diagram unavailable
      </span>
    );
  }

  return <div ref={ref} className="mermaid-figure my-3 flex justify-center overflow-x-auto" aria-label="diagram" />;
}

export default MermaidDiagram;
