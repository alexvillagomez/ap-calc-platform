import { normalizeEmbeddedVizTags } from "@/lib/embedVizTags";

/**
 * KaTeX has no `itemize`. Models often emit it in stems — convert to `aligned` rows.
 */
export function convertItemizeToAligned(src: string): string {
  return src.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_, inner) => {
    const items = inner.split(/\\item/).filter((x: string) => x.trim());
    if (items.length === 0) return "";
    const rows = items.map((it: string) => `&${it.trim()}\\\\`).join("\n");
    return `\\begin{aligned}\n${rows}\n\\end{aligned}`;
  });
}

type InlineSegment = { math: boolean; content: string };

/** Split on `\\(` … `\\)` pairs; leftover text or an unmatched `\\)` stays as text. */
export function splitInlineMathDelimiters(src: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let i = 0;
  const str = src;
  while (i < str.length) {
    const open = str.indexOf("\\(", i);
    if (open === -1) {
      if (i < str.length) segments.push({ math: false, content: str.slice(i) });
      break;
    }
    if (open > i) {
      segments.push({ math: false, content: str.slice(i, open) });
    }
    const close = str.indexOf("\\)", open + 2);
    if (close === -1) {
      segments.push({ math: false, content: str.slice(open) });
      break;
    }
    segments.push({ math: true, content: str.slice(open + 2, close) });
    i = close + 2;
  }
  return segments;
}

/** Remove extra trailing `\\)` when there are more closes than `\\(` in one fragment. */
/**
 * Inside `\\begin{aligned}` (etc.) KaTeX is already in math mode; `\\(` / `\\)` are invalid.
 * Replace each `\\( … \\)` with the inner expression only.
 */
export function stripInlineParenPairsInMathMode(tex: string): string {
  return tex.replace(/\\\(([\s\S]*?)\\\)/g, "$1");
}

export function stripStrayInlineMathCloseDelimiters(src: string): string {
  let s = src;
  const opens = (s.match(/\\\(/g) || []).length;
  const closes = (s.match(/\\\)/g) || []).length;
  let extra = closes - opens;
  while (extra > 0) {
    const next = s.replace(/\\\)\s*$/, "").trimEnd();
    if (next === s) break;
    s = next;
    extra -= 1;
  }
  return s;
}

/**
 * Replace macros KaTeX does not support (or that models hallucinate) with safe equivalents.
 */
export function sanitizeKatexUnsafeMacros(tex: string): string {
  let s = tex;
  s = s.replace(/\\emph\{/g, "\\text{");
  s = s.replace(/\\xbar\b/g, "\\overline{x}");
  s = s.replace(/``/g, "''");
  return s;
}

/**
 * Split mixed stems: prose and `\\(...\\)` blocks, then `\\begin{aligned}...\\end{aligned}`.
 * Feeding both in one KaTeX call often fails; rendering each chunk separately fixes red error output.
 */
export function splitIntoAlignedChunks(src: string): string[] {
  const trimmed = src.trim();
  if (!trimmed) return [];
  const out: string[] = [];
  const re = /\\begin\{aligned\}[\s\S]*?\\end\{aligned\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    if (m.index > last) {
      const before = trimmed.slice(last, m.index).trim();
      if (before) out.push(before);
    }
    out.push(m[0].trim());
    last = m.index + m[0].length;
  }
  if (last < trimmed.length) {
    const tail = trimmed.slice(last).trim();
    if (tail) out.push(tail);
  }
  if (out.length === 0) out.push(trimmed);
  return out;
}

/**
 * Strip unmatched closing braces that models hallucinate (e.g. `t.}` at end of aligned rows).
 * Tracks brace depth character-by-character; skips any `}` that would go negative.
 * Escaped sequences like `\{` and `\}` are passed through unchanged.
 */
export function removeStrayClosingBraces(latex: string): string {
  let depth = 0;
  let result = "";
  let i = 0;
  while (i < latex.length) {
    if (latex[i] === "\\" && i + 1 < latex.length) {
      result += latex[i] + latex[i + 1];
      i += 2;
      continue;
    }
    if (latex[i] === "{") {
      depth++;
      result += latex[i];
    } else if (latex[i] === "}") {
      if (depth > 0) {
        depth--;
        result += latex[i];
      }
      // else: stray } with no matching { — drop it
    } else {
      result += latex[i];
    }
    i++;
  }
  return result;
}

/**
 * Full normalize for problem LaTeX / saved JSON: fix viz tags, itemize, ready for KaTeX.
 */
export function normalizeRichMathSource(src: string): string {
  let s = normalizeEmbeddedVizTags(src);
  s = convertItemizeToAligned(s);
  s = sanitizeKatexUnsafeMacros(s);
  s = removeStrayClosingBraces(s);
  return s;
}
