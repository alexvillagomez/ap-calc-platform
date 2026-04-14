"use client";

import katex from "katex";
import { SlopeField } from "@/components/SlopeField";
import { FunctionGraph } from "@/components/FunctionGraph";
import { parsePoints, parseRangePair, parseVizSegments } from "@/lib/parseVizSegments";

interface PreviewProps {
  latexContent: string;
  className?: string;
}

type ContentSegment =
  | { type: "text"; value: string }
  | { type: "inline"; value: string }
  | { type: "display"; value: string };

function splitMath(content: string): ContentSegment[] {
  const result: ContentSegment[] = [];
  let i = 0;
  const len = content.length;
  while (i < len) {
    if (content.slice(i, i + 2) === "$$") {
      const end = content.indexOf("$$", i + 2);
      if (end === -1) { result.push({ type: "text", value: content.slice(i) }); break; }
      const math = content.slice(i + 2, end).trim();
      if (math) result.push({ type: "display", value: math });
      i = end + 2;
      continue;
    }
    if (content[i] === "$") {
      const rest = content.slice(i + 1);
      const next = rest.indexOf("$");
      if (next === -1) { result.push({ type: "text", value: content.slice(i) }); break; }
      result.push({ type: "inline", value: rest.slice(0, next) });
      i += 1 + next + 1;
      continue;
    }
    let textEnd = len;
    const nd = content.indexOf("$$", i), ni = content.indexOf("$", i);
    if (nd !== -1 && (ni === -1 || nd <= ni)) textEnd = Math.min(textEnd, nd);
    if (ni !== -1) textEnd = Math.min(textEnd, ni);
    const text = content.slice(i, textEnd);
    if (text) result.push({ type: "text", value: text });
    i = textEnd;
  }
  return result;
}

/** Model output sometimes splits one expression across two $...$ blocks (e.g. "...6t +$" and "$4$"). Merge those so KaTeX stays one unbreakable unit. */
function mergeAdjacentInlineMath(segs: ContentSegment[]): ContentSegment[] {
  const out: ContentSegment[] = [];
  let i = 0;
  while (i < segs.length) {
    const cur = segs[i];
    if (cur.type !== "inline") {
      out.push(cur);
      i++;
      continue;
    }
    let merged = cur.value;
    let j = i + 1;
    while (j < segs.length) {
      if (segs[j].type === "text" && /^[\s\n]*$/.test(segs[j].value)) {
        j++;
        continue;
      }
      if (segs[j].type === "inline" && shouldMergeSplitInline(merged, segs[j].value)) {
        merged = `${merged.trimEnd()}${segs[j].value.trimStart()}`;
        j++;
      } else {
        break;
      }
    }
    if (j > i + 1) {
      out.push({ type: "inline", value: merged });
      i = j;
    } else {
      out.push(cur);
      i++;
    }
  }
  return out;
}

function shouldMergeSplitInline(a: string, b: string): boolean {
  const left = a.trimEnd();
  const right = b.trimStart();
  if (!left || !right) return false;
  /* dangling operator at end of first chunk → same expression continued in next $...$ */
  if (/[-+*/=^]\s*$/.test(left)) return true;
  if (/[-+]\s*$/.test(left) && /^[\d.]+$/.test(right)) return true;
  return false;
}

function isUndelimited(trimmed: string) {
  return /^\\begin\{(aligned|array|matrix|gathered|cases|pmatrix|bmatrix|split)\b/.test(trimmed);
}
function looksRaw(trimmed: string) { return /\\/.test(trimmed); }
function normalizeAlignedBreaks(latex: string) { return latex.replace(/\\{3,}(?=\[)/g, "\\\\"); }
function inlineContainsText(latex: string) { return /\\text\s*\{/.test(latex); }




function renderMath(latex: string, display: boolean): string {
  try {
    return katex.renderToString(normalizeAlignedBreaks(latex), { displayMode: display, throwOnError: false });
  } catch {
    return latex.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}

export function Preview({ latexContent, className = "" }: PreviewProps) {
  const topLevel = parseVizSegments(latexContent);
  const nodes: React.ReactNode[] = [];
  let k = 0;

  for (const seg of topLevel) {
    if (seg.type === "slopeField") {
      nodes.push(<SlopeField key={k++} equation={seg.equation} rangeX={parseRangePair(seg.rangeX, [-3, 3])} rangeY={parseRangePair(seg.rangeY, [-3, 3])} />);
      continue;
    }
    if (seg.type === "functionGraph") {
      nodes.push(<FunctionGraph key={k++} equation={seg.equation} rangeX={parseRangePair(seg.rangeX, [-3, 3])} rangeY={parseRangePair(seg.rangeY, [-3, 3])} points={parsePoints(seg.points ?? "")} />);
      continue;
    }

    for (const para of seg.value.split(/\n\s*\n/)) {
      const trimmed = para.trim();
      const segs = mergeAdjacentInlineMath(splitMath(para));
      const paraNodes: React.ReactNode[] = [];

      if (trimmed && segs.length === 1 && segs[0].type === "text" && (isUndelimited(trimmed) || looksRaw(trimmed))) {
        if (inlineContainsText(trimmed)) {
          // Render as a single inline KaTeX block so everything uses KaTeX fonts.
          // Force .katex-html to display:block + max-width:100% so it is bounded by the
          // card, then white-space:normal on .katex lets \text{} content wrap naturally.
          paraNodes.push(
            <div key={k++}
              className="my-2 max-w-full min-w-0 text-left [overflow-wrap:break-word] [&_.katex]:!whitespace-normal [&_.katex]:!text-[1em] [&_.katex-html]:!block [&_.katex-html]:!max-w-full"
              dangerouslySetInnerHTML={{ __html: renderMath(trimmed, false) }}
            />
          );
        } else {
          // Pure LaTeX (no \text{}) — render as display math.
          paraNodes.push(<div key={k++} className="katex-display my-2 max-w-full min-w-0 text-left" dangerouslySetInnerHTML={{ __html: renderMath(trimmed, true) }} />);
        }
      } else {
        for (const cs of segs) {
          if (cs.type === "text") {
            if (!cs.value) continue;
            paraNodes.push(
              <span key={k++} className="[overflow-wrap:break-word] [word-break:normal]">
                {cs.value}
              </span>
            );
          } else if (cs.type === "inline") {
            const inlineClass = inlineContainsText(cs.value)
              ? "katex-inline katex-inline-text"
              : "katex-inline katex-inline-math";
            paraNodes.push(<span key={k++} className={inlineClass} dangerouslySetInnerHTML={{ __html: renderMath(cs.value, false) }} />);
          } else {
            paraNodes.push(<div key={k++} className="katex-display my-2 max-w-full min-w-0 text-left" dangerouslySetInnerHTML={{ __html: renderMath(cs.value, true) }} />);
          }
        }
      }
      if (paraNodes.length > 0) {
        nodes.push(
          <div key={k++} className="block mb-4 min-w-0 max-w-full text-pretty [overflow-wrap:break-word]">
            {paraNodes}
          </div>
        );
      } else if (!trimmed) {
        nodes.push(<div key={k++} className="block h-4" aria-hidden />);
      }
    }
  }

  return (
    <div
      className={`ap-calc-preview w-full min-w-0 max-w-full text-left text-[17px] leading-relaxed text-pretty [overflow-wrap:break-word] ${className}`}
      style={{ fontFamily: "KaTeX_Main, 'Times New Roman', serif" }}
    >
      {nodes}
    </div>
  );
}
