"use client";

import katex from "katex";
import { stripControlChars } from "@/lib/parseModelJson";
import { normalizeScienceNotation } from "@/lib/scienceNotation";
import { parseVizSegments, parseRangePair, parsePoints } from "@/lib/parseVizSegments";
import { FunctionGraph } from "@/components/FunctionGraph";
import { SlopeField } from "@/components/SlopeField";

/**
 * Lightweight inline math renderer for MCAT content. Generated questions,
 * flashcards, and lessons contain `$...$` (and rarely `$$...$$`) LaTeX —
 * pH, pKa, H^+, charges, ratios. This renders those segments with KaTeX while
 * leaving the surrounding prose in the parent's normal (sans-serif) styling and
 * preserving line breaks. Plain text with no `$` renders as-is (fast path).
 */

type Seg = { type: "text" | "inline" | "display"; value: string };

/**
 * Some generated math content (notably solution_latex and lesson example_latex)
 * arrives as BARE LaTeX — e.g. `\frac{d}{dx}(x+3)^4`, `\int_0^2 3\,dt`,
 * `\begin{aligned}…\end{aligned}`, or \text{...} prose with \dfrac — but with no
 * $ delimiters. Without detection it falls through to the plain-text fast path
 * and dumps raw backslash commands. Generators are prompted to always wrap math
 * in $…$/$$…$$; this is the render-side safety net for stored/missed rows.
 *
 * The detector is intentionally broad: ANY backslash-led command (`\` + letters),
 * a LaTeX line break (`\\`), or `\(`/`\[` math delimiters. Math content rarely
 * contains a literal backslash for non-math reasons, so this is safe here.
 */
const BARE_LATEX_RE = /\\[a-zA-Z]+|\\\\|\\[([]/;

function splitBareLatex(content: string): Seg[] {
  // Render each paragraph as display math; KaTeX handles \text{} prose fine.
  return content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({
      type: BARE_LATEX_RE.test(p) ? ("display" as const) : ("text" as const),
      value: p,
    }));
}

function split(content: string): Seg[] {
  if (!content.includes("$") && BARE_LATEX_RE.test(content)) {
    return splitBareLatex(content);
  }
  const out: Seg[] = [];
  let i = 0;
  const len = content.length;
  while (i < len) {
    if (content.slice(i, i + 2) === "$$") {
      const end = content.indexOf("$$", i + 2);
      if (end === -1) {
        out.push({ type: "text", value: content.slice(i) });
        break;
      }
      const m = content.slice(i + 2, end).trim();
      if (m) out.push({ type: "display", value: m });
      i = end + 2;
      continue;
    }
    if (content[i] === "$") {
      const rest = content.slice(i + 1);
      const next = rest.indexOf("$");
      if (next === -1) {
        out.push({ type: "text", value: content.slice(i) });
        break;
      }
      out.push({ type: "inline", value: rest.slice(0, next) });
      i += 1 + next + 1;
      continue;
    }
    let end = len;
    const nd = content.indexOf("$$", i);
    const ni = content.indexOf("$", i);
    if (nd !== -1) end = Math.min(end, nd);
    if (ni !== -1) end = Math.min(end, ni);
    const t = content.slice(i, end);
    if (t) out.push({ type: "text", value: t });
    i = end;
  }
  return out;
}

function render(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode: display, throwOnError: false });
  } catch {
    return latex.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}

/** Detect if content contains a viz tag — only incur parse cost when needed. */
const VIZ_TAG_RE = /<(FunctionGraph|SlopeField)\s/i;

/** Render a single latex-only text string (no viz tags). */
function renderLatexString(text: string, className: string) {
  const segs = split(text);
  return (
    <span className={`whitespace-pre-line ${className}`}>
      {segs.map((s, i) => {
        if (s.type === "text") {
          if (BARE_LATEX_RE.test(s.value)) {
            return (
              <span
                key={i}
                className="katex-inline"
                dangerouslySetInnerHTML={{ __html: render(s.value, false) }}
              />
            );
          }
          return <span key={i}>{s.value}</span>;
        }
        return (
          <span
            key={i}
            className={s.type === "display" ? "katex-display-inline" : "katex-inline"}
            dangerouslySetInnerHTML={{ __html: render(s.value, s.type === "display") }}
          />
        );
      })}
    </span>
  );
}

export default function MathText({
  children,
  className = "",
}: {
  children: string | null | undefined;
  className?: string;
}) {
  // Harden against legacy rows that were stored with ANSI/control-char
  // corruption (ESC sequences → box glyphs). Stripping them here means already-
  // cached content renders cleanly without waiting for regeneration.
  const stripped = stripControlChars(children ?? "");

  // Render-side safety net for stored ASCII science notation.
  // Only runs when there are no existing delimiters/LaTeX — avoids double-processing
  // properly-formatted content.
  const text =
    !stripped.includes("$") && !BARE_LATEX_RE.test(stripped)
      ? normalizeScienceNotation(stripped)
      : stripped;

  // ── Viz-segment branch: content contains <FunctionGraph .../> or <SlopeField .../>
  if (VIZ_TAG_RE.test(text)) {
    const vizSegs = parseVizSegments(text);
    return (
      <span className={`whitespace-pre-line ${className}`}>
        {vizSegs.map((seg, i) => {
          if (seg.type === "latex") {
            // Render the latex portion using the normal split/render path.
            const latexText = !seg.value.includes("$") && !BARE_LATEX_RE.test(seg.value)
              ? normalizeScienceNotation(seg.value)
              : seg.value;
            if (!latexText.includes("$") && !BARE_LATEX_RE.test(latexText)) {
              return <span key={i}>{latexText}</span>;
            }
            return <span key={i}>{renderLatexString(latexText, "")}</span>;
          }
          if (seg.type === "functionGraph") {
            try {
              const rangeX = parseRangePair(seg.rangeX, [-5, 5]);
              const rangeY = parseRangePair(seg.rangeY, [-5, 5]);
              const pts = parsePoints(seg.points);
              const eq = (seg.equation ?? "").trim();
              if (!eq) return null;
              return (
                <span key={i} className="block">
                  <FunctionGraph
                    equation={eq}
                    rangeX={rangeX}
                    rangeY={rangeY}
                    points={pts}
                    equalScale={seg.equalScale !== "false"}
                  />
                </span>
              );
            } catch {
              // Defensive: invalid expression → skip graph
              return null;
            }
          }
          if (seg.type === "slopeField") {
            try {
              const rangeX = parseRangePair(seg.rangeX, [-3, 3]);
              const rangeY = parseRangePair(seg.rangeY, [-3, 3]);
              const eq = (seg.equation ?? "").trim();
              if (!eq) return null;
              return (
                <span key={i} className="block">
                  <SlopeField
                    equation={eq}
                    rangeX={rangeX}
                    rangeY={rangeY}
                  />
                </span>
              );
            } catch {
              return null;
            }
          }
          return null;
        })}
      </span>
    );
  }

  // Fast path: no math delimiters AND no bare LaTeX → plain text, keeping newlines.
  // (Bare-LaTeX-without-$ must NOT short-circuit here, or split()'s bare-LaTeX
  //  branch is never reached and raw commands leak into the page.)
  if (!text.includes("$") && !BARE_LATEX_RE.test(text)) {
    return <span className={`whitespace-pre-line ${className}`}>{text}</span>;
  }

  return renderLatexString(text, className);
}
