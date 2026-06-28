"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Deterministic 2D molecular-structure renderer.
 *
 * Renders an accurate skeletal formula from a SMILES string using SmilesDrawer
 * (pure client-side JS, no API call, no AI image generation). The SMILES string
 * is a verifiable chemical FACT — the same SMILES always renders the same
 * structure. Invalid SMILES fail soft (we show the raw string as a caption-style
 * fallback rather than crashing the surrounding content).
 *
 * Used via the `<Molecule smiles="..." caption="..."/>` viz-tag intercepted in
 * MathText, so it renders wherever content renders (problems AND quiz questions).
 */
export function MoleculeStructure({
  smiles,
  caption,
  width = 240,
  height = 180,
}: {
  smiles: string;
  caption?: string;
  width?: number;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const el = svgRef.current;
    if (!el || !smiles) return;
    // SmilesDrawer ships a browser IIFE bundle that registers `window.SmiDrawer`
    // (and `window.SmilesDrawer`) as a SIDE EFFECT — it has no module export. So we
    // import it for the side effect, then read the constructor off `window`.
    import("smiles-drawer")
      .then(() => {
        if (cancelled || !svgRef.current) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = window as any;
          const SmiDrawer = w.SmiDrawer ?? w.SmilesDrawer?.SmiDrawer;
          if (typeof SmiDrawer !== "function") {
            setFailed(true);
            return;
          }
          const drawer = new SmiDrawer(
            { width, height, padding: 12, compactDrawing: false, terminalCarbons: true },
            {},
          );
          // Clear any prior render (e.g. on prop change / HMR).
          while (svgRef.current.firstChild) svgRef.current.removeChild(svgRef.current.firstChild);
          drawer.draw(
            smiles.trim(),
            svgRef.current,
            "light",
            () => {},
            () => {
              if (!cancelled) setFailed(true);
            },
          );
          setFailed(false);
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
  }, [smiles, width, height]);

  if (failed) {
    // Graceful fallback: never break the page on a bad SMILES.
    return (
      <div className="my-2 inline-block rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500">
        Structure: <code className="font-mono">{smiles}</code>
        {caption ? <span className="block text-xs">{caption}</span> : null}
      </div>
    );
  }

  return (
    <div className="my-2 flex flex-col items-center">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        data-smiles={smiles}
        className="max-w-full"
        role="img"
        aria-label={caption ? `Molecular structure: ${caption}` : `Molecular structure for SMILES ${smiles}`}
      />
      {caption ? (
        <span className="mt-1 text-center text-xs text-neutral-500">{caption}</span>
      ) : null}
    </div>
  );
}

export default MoleculeStructure;
