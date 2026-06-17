"use client";

import katex from "katex";
import { stripControlChars } from "@/lib/parseModelJson";
import { normalizeScienceNotation } from "@/lib/scienceNotation";

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

  // Fast path: no math delimiters AND no bare LaTeX → plain text, keeping newlines.
  // (Bare-LaTeX-without-$ must NOT short-circuit here, or split()'s bare-LaTeX
  //  branch is never reached and raw commands leak into the page.)
  if (!text.includes("$") && !BARE_LATEX_RE.test(text)) {
    return <span className={`whitespace-pre-line ${className}`}>{text}</span>;
  }

  const segs = split(text);
  return (
    <span className={`whitespace-pre-line ${className}`}>
      {segs.map((s, i) => {
        if (s.type === "text") {
          // Safety net: a text segment that still looks like bare LaTeX (e.g. a
          // \frac/\int/\begin sitting outside $…$ in otherwise-delimited content)
          // gets routed through KaTeX instead of dumped as literal backslashes.
          if (BARE_LATEX_RE.test(s.value)) {
            return (
              <span
                key={i}
                className="katex-inline"
                // eslint-disable-next-line react/no-danger
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
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: render(s.value, s.type === "display") }}
          />
        );
      })}
    </span>
  );
}
