"use client";

import katex from "katex";
import { FunctionGraph } from "@/components/FunctionGraph";
import { SlopeField } from "@/components/SlopeField";
import { parsePoints, parseRangePair, parseVizSegments } from "@/lib/parseVizSegments";

interface PreviewProps {
  /** LaTeX string to render in real-time; may contain `$`/`$$` math and `<SlopeField />` / `<FunctionGraph />` tags */
  latexContent: string;
  /** Optional className for the container */
  className?: string;
  /**
   * When true (default), use the same Times-based `preview-times` styling as `/generate`.
   * When false, inherit surrounding typography so KaTeX uses its default fonts (e.g. playground).
   */
  useProblemTypography?: boolean;
}

type ContentSegment =
  | { type: "text"; value: string }
  | { type: "inline"; value: string }
  | { type: "display"; value: string };

/**
 * Single-pass tokenizer: find $$ and $ in order so each character belongs to
 * exactly one segment. Prefer $$ over $ when both could match at the same position.
 * Ensures math is fully removed from text segments (no ghost text).
 */
function splitMath(content: string): ContentSegment[] {
  const result: ContentSegment[] = [];
  let i = 0;
  const len = content.length;
  while (i < len) {
    if (content.slice(i, i + 2) === "$$") {
      const end = content.indexOf("$$", i + 2);
      if (end === -1) {
        result.push({ type: "text", value: content.slice(i) });
        break;
      }
      const math = content.slice(i + 2, end).trim();
      if (math) result.push({ type: "display", value: math });
      i = end + 2;
      continue;
    }
    if (content[i] === "$") {
      const rest = content.slice(i + 1);
      const nextDollar = rest.indexOf("$");
      if (nextDollar === -1) {
        result.push({ type: "text", value: content.slice(i) });
        break;
      }
      const math = rest.slice(0, nextDollar);
      result.push({ type: "inline", value: math });
      i += 1 + nextDollar + 1;
      continue;
    }
    let textEnd = len;
    const nextDisplay = content.indexOf("$$", i);
    const nextInline = content.indexOf("$", i);
    if (nextDisplay !== -1 && (nextInline === -1 || nextDisplay <= nextInline))
      textEnd = Math.min(textEnd, nextDisplay);
    if (nextInline !== -1) textEnd = Math.min(textEnd, nextInline);
    const text = content.slice(i, textEnd);
    if (text) result.push({ type: "text", value: text });
    i = textEnd;
  }
  return result;
}

/** Paragraph is display math with no `$…$` / `$$…$$` delimiters (e.g. KaTeX playground input). */
function isUndelimitedDisplayEnvironment(trimmed: string): boolean {
  return /^\\begin\{(aligned|array|matrix|gathered|cases|pmatrix|bmatrix|split)\b/.test(trimmed);
}

/** Raw LaTeX with no `$…$` wrappers (legacy playground: whole string passed to KaTeX). */
function looksLikeRawLatex(trimmed: string): boolean {
  return /\\/.test(trimmed);
}

/** Extra `\` before `\[0.5em]` breaks KaTeX (`\[` parsed as display math). */
function normalizeAlignedLinebreakSpacing(latex: string): string {
  return latex.replace(/\\{3,}(?=\[)/g, "\\\\");
}

function renderMath(latex: string, displayMode: boolean): string {
  const normalized = normalizeAlignedLinebreakSpacing(latex);
  try {
    return katex.renderToString(normalized, {
      displayMode,
      throwOnError: false,
    });
  } catch {
    return escapeHtml(normalized);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function Preview({
  latexContent,
  className = "",
  useProblemTypography = true,
}: PreviewProps) {
  const topLevel = parseVizSegments(latexContent);

  const nodes: React.ReactNode[] = [];
  let keyIndex = 0;

  for (const seg of topLevel) {
    if (seg.type === "slopeField") {
      const rangeX = parseRangePair(seg.rangeX, [-3, 3]);
      const rangeY = parseRangePair(seg.rangeY, [-3, 3]);
      nodes.push(
        <SlopeField
          key={`preview-${keyIndex++}`}
          equation={seg.equation || "y + x"}
          rangeX={rangeX}
          rangeY={rangeY}
        />
      );
      continue;
    }

    if (seg.type === "functionGraph") {
      const rangeX = parseRangePair(seg.rangeX, [-3, 3]);
      const rangeY = parseRangePair(seg.rangeY, [-3, 3]);
      const pts = parsePoints(seg.points ?? "");
      nodes.push(
        <FunctionGraph
          key={`preview-${keyIndex++}`}
          equation={seg.equation || "x"}
          rangeX={rangeX}
          rangeY={rangeY}
          points={pts}
        />
      );
      continue;
    }

    const paragraphs = seg.value.split(/\n\s*\n/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      const contentSegments = splitMath(para);
      const paraNodes: React.ReactNode[] = [];

      if (
        trimmed &&
        contentSegments.length === 1 &&
        contentSegments[0].type === "text" &&
        isUndelimitedDisplayEnvironment(trimmed)
      ) {
        const html = renderMath(trimmed, true);
        paraNodes.push(
          <div
            key={`preview-${keyIndex++}`}
            className="katex-display overflow-x-auto my-2 text-left"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
        nodes.push(
          <div
            key={`preview-para-${keyIndex++}`}
            className={useProblemTypography ? "block mb-6" : "block mb-4"}
          >
            {paraNodes}
          </div>
        );
        continue;
      }

      if (
        trimmed &&
        contentSegments.length === 1 &&
        contentSegments[0].type === "text" &&
        looksLikeRawLatex(trimmed)
      ) {
        const html = renderMath(trimmed, true);
        paraNodes.push(
          <div
            key={`preview-${keyIndex++}`}
            className="katex-display overflow-x-auto my-2 text-left"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
        nodes.push(
          <div
            key={`preview-para-${keyIndex++}`}
            className={useProblemTypography ? "block mb-6" : "block mb-4"}
          >
            {paraNodes}
          </div>
        );
        continue;
      }

      for (const cs of contentSegments) {
        if (cs.type === "text") {
          if (!cs.value) continue;
          paraNodes.push(
            <span key={`preview-${keyIndex++}`} style={{ whiteSpace: "pre-wrap" }}>
              {cs.value}
            </span>
          );
        } else if (cs.type === "inline") {
          const html = renderMath(cs.value, false);
          paraNodes.push(
            <span
              key={`preview-${keyIndex++}`}
              className="katex-inline"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } else {
          const html = renderMath(cs.value, true);
          paraNodes.push(
            <div
              key={`preview-${keyIndex++}`}
              className="katex-display overflow-x-auto my-2 text-left"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
      }
      if (paraNodes.length > 0) {
        nodes.push(
          <div
            key={`preview-para-${keyIndex++}`}
            className={useProblemTypography ? "block mb-6" : "block mb-4"}
          >
            {paraNodes}
          </div>
        );
      } else if (para.trim() === "") {
        nodes.push(
          <div key={`preview-para-${keyIndex++}`} className="block h-6" aria-hidden />
        );
      }
    }
  }

  return (
    <div
      className={`max-w-none text-left ${useProblemTypography ? "preview-times" : "preview-katex-plain"} ${className}`}
      style={
        useProblemTypography
          ? {
              fontFamily: "'Times New Roman', Times, serif",
              fontSize: "18px",
              lineHeight: "1.5",
            }
          : undefined
      }
    >
      {nodes}
    </div>
  );
}
