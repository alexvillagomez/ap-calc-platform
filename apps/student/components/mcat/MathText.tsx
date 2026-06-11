"use client";

import katex from "katex";

/**
 * Lightweight inline math renderer for MCAT content. Generated questions,
 * flashcards, and lessons contain `$...$` (and rarely `$$...$$`) LaTeX —
 * pH, pKa, H^+, charges, ratios. This renders those segments with KaTeX while
 * leaving the surrounding prose in the parent's normal (sans-serif) styling and
 * preserving line breaks. Plain text with no `$` renders as-is (fast path).
 */

type Seg = { type: "text" | "inline" | "display"; value: string };

function split(content: string): Seg[] {
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
  const text = children ?? "";

  // Fast path: no math delimiters → plain text, preserving newlines.
  if (!text.includes("$")) {
    return <span className={`whitespace-pre-line ${className}`}>{text}</span>;
  }

  const segs = split(text);
  return (
    <span className={`whitespace-pre-line ${className}`}>
      {segs.map((s, i) => {
        if (s.type === "text") return <span key={i}>{s.value}</span>;
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
