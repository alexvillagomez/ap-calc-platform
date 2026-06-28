import { normalizeRichMathSource } from "@/lib/latexRichMathNormalize";

export type VizSegment =
  | { type: "latex"; value: string }
  | { type: "slopeField"; equation: string; rangeX: string; rangeY: string }
  | { type: "functionGraph"; equation: string; rangeX: string; rangeY: string; points: string; holes: string; equalScale: string }
  | { type: "molecule"; smiles: string; caption: string }
  | { type: "mermaid"; diagram: string }
  | { type: "table"; rows: string[][]; hasHeader: boolean };

/** Tags whose presence should route content through the figure-aware parser. */
export const FIGURE_TAG_RE = /<(FunctionGraph|SlopeField|Molecule|Mermaid)\b/i;
/** A GitHub-style markdown pipe-table row: starts and ends with `|`. */
const PIPE_ROW_RE = /^\s*\|.*\|\s*$/;
/** The separator row under a table header: cells of dashes (optionally with `:`). */
const PIPE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

/** Does this content contain any renderable figure (viz tag or markdown table)? */
export function hasFigureContent(raw: string): boolean {
  if (FIGURE_TAG_RE.test(raw)) return true;
  return containsPipeTable(raw);
}

function containsPipeTable(raw: string): boolean {
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (PIPE_ROW_RE.test(lines[i]) && PIPE_SEP_RE.test(lines[i + 1])) return true;
  }
  return false;
}

function splitTableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  // Split on unescaped pipes; allow `\|` to embed a literal pipe in a cell.
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

/**
 * Walk a text block and pull out markdown pipe tables, yielding latex segments
 * for the surrounding prose and table segments for each detected table.
 */
function segmentTables(text: string, out: VizSegment[]) {
  const lines = text.split("\n");
  let i = 0;
  let buf: string[] = [];
  const flush = () => {
    const v = buf.join("\n").trim();
    if (v) out.push({ type: "latex", value: v });
    buf = [];
  };
  while (i < lines.length) {
    const isHeader = PIPE_ROW_RE.test(lines[i]) && i + 1 < lines.length && PIPE_SEP_RE.test(lines[i + 1]);
    if (isHeader) {
      flush();
      const rows: string[][] = [splitTableCells(lines[i])];
      i += 2; // skip header + separator
      while (i < lines.length && PIPE_ROW_RE.test(lines[i]) && !PIPE_SEP_RE.test(lines[i])) {
        rows.push(splitTableCells(lines[i]));
        i++;
      }
      out.push({ type: "table", rows, hasHeader: true });
      continue;
    }
    buf.push(lines[i]);
    i++;
  }
  flush();
}

export function parseVizSegments(raw: string): VizSegment[] {
  const normalized = normalizeRichMathSource(raw);
  const segments: VizSegment[] = [];
  const tagRegex = /<(SlopeField|FunctionGraph)\s+([^>]+)\s*\/>/gi;
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRegex.exec(normalized)) !== null) {
    const before = normalized.slice(lastEnd, m.index);
    if (before.trim()) segments.push({ type: "latex", value: before.trim() });

    const tagName = (m[1] ?? "").toLowerCase();
    const attrStr = m[2];
    const attrRegex = /(\w+)\s*=\s*["']([^"']*)["']/g;
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrRegex.exec(attrStr)) !== null) {
      attrs[a[1].toLowerCase()] = a[2];
    }

    if (tagName === "slopefield") {
      segments.push({ type: "slopeField", equation: attrs.equation ?? "", rangeX: attrs.rangex ?? "", rangeY: attrs.rangey ?? "" });
    } else {
      segments.push({ type: "functionGraph", equation: attrs.equation ?? "", rangeX: attrs.rangex ?? "", rangeY: attrs.rangey ?? "", points: attrs.points ?? "", holes: attrs.holes ?? "", equalScale: attrs.equalscale ?? "" });
    }
    lastEnd = m.index + m[0].length;
  }

  const tail = normalized.slice(lastEnd);
  if (tail.trim()) segments.push({ type: "latex", value: tail.trim() });
  if (segments.length === 0) segments.push({ type: "latex", value: normalized.trim() });
  return segments;
}

/**
 * Comprehensive figure-aware parser. Handles, in addition to FunctionGraph /
 * SlopeField:
 *   • `<Mermaid>...DSL...</Mermaid>` block tags (DSL may contain `>` and newlines)
 *   • `<Molecule smiles="..." caption="..."/>` self-closing tags
 *   • GitHub-style markdown pipe tables in the surrounding prose
 * Surrounding prose is emitted as `latex` segments (rendered through MathText's
 * normal $...$ / \ce{...} path). Figure payloads are returned RAW — the caller
 * must NOT run LaTeX-repair on them.
 */
export function parseFigureSegments(raw: string): VizSegment[] {
  const normalized = normalizeRichMathSource(normalizeEmbeddedFigureTags(raw));
  const out: VizSegment[] = [];
  // Match a Mermaid block OR a self-closing FunctionGraph/SlopeField/Molecule tag.
  const tokenRe =
    /<Mermaid\b[^>]*>([\s\S]*?)<\/Mermaid>|<(FunctionGraph|SlopeField|Molecule)\b([^>]*?)\/>/gi;
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  const emitProse = (text: string) => {
    if (text.trim()) segmentTables(text, out);
  };

  while ((m = tokenRe.exec(normalized)) !== null) {
    emitProse(normalized.slice(lastEnd, m.index));

    if (m[1] !== undefined) {
      // Mermaid block
      out.push({ type: "mermaid", diagram: m[1].trim() });
    } else {
      const tagName = (m[2] ?? "").toLowerCase();
      const attrs = parseTagAttrs(m[3] ?? "");
      if (tagName === "slopefield") {
        out.push({ type: "slopeField", equation: attrs.equation ?? "", rangeX: attrs.rangex ?? "", rangeY: attrs.rangey ?? "" });
      } else if (tagName === "molecule") {
        out.push({ type: "molecule", smiles: attrs.smiles ?? "", caption: cleanMoleculeCaption(attrs.caption ?? "") });
      } else {
        out.push({ type: "functionGraph", equation: attrs.equation ?? "", rangeX: attrs.rangex ?? "", rangeY: attrs.rangey ?? "", points: attrs.points ?? "", holes: attrs.holes ?? "", equalScale: attrs.equalscale ?? "" });
      }
    }
    lastEnd = m.index + m[0].length;
  }
  emitProse(normalized.slice(lastEnd));
  if (out.length === 0) out.push({ type: "latex", value: normalized.trim() });
  return stripOrphanPunctuationAfterFigures(out);
}

/**
 * When a figure tag is emitted mid-sentence, the prose AFTER it can begin with an
 * orphaned punctuation mark (e.g. a figure dropped before a clause leaves
 * ". On the MCAT…"). Strip a leading stray `.,;:` (and following space) from any
 * prose segment that immediately follows a figure segment, so the figure doesn't
 * orphan punctuation. Prose-after-prose is left untouched.
 */
function stripOrphanPunctuationAfterFigures(segments: VizSegment[]): VizSegment[] {
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const prev = segments[i - 1];
    if (seg.type === "latex" && prev.type !== "latex") {
      seg.value = seg.value.replace(/^\s*[.,;:]+\s*/, "").trimStart();
    }
  }
  return segments.filter((s) => s.type !== "latex" || s.value.trim().length > 0);
}

const GREEK_TO_UNICODE: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", kappa: "κ",
  lambda: "λ", mu: "μ", pi: "π", sigma: "σ", omega: "ω",
};
const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

/**
 * Molecule captions are rendered as PLAIN text (not through KaTeX), so any
 * `$...$` math the model puts in a caption would leak literally ("$alpha$",
 * "$NH_2$"). Convert a caption to clean Unicode: drop `$` delimiters, turn
 * `\alpha`/bare `alpha` into α, and `_2`/`_{2}` subscripts into ₂. Idempotent
 * and safe on captions that are already plain text.
 */
export function cleanMoleculeCaption(raw: string): string {
  let s = raw.replace(/\$/g, "");
  // \alpha or bare greek word → unicode glyph
  s = s.replace(/\\*\b(alpha|beta|gamma|delta|epsilon|kappa|lambda|mu|pi|sigma|omega)\b/gi, (m, name) => {
    const g = GREEK_TO_UNICODE[(name as string).toLowerCase()];
    return g ?? m;
  });
  // subscripts: _2, _{2}, _12 → unicode subscript digits
  s = s.replace(/_\{?([0-9]+)\}?/g, (_m, digits: string) =>
    digits.split("").map((d) => SUB_DIGITS[Number(d)] ?? d).join(""),
  );
  // leftover TeX spacing / braces
  s = s.replace(/\\[,;]/g, " ").replace(/[{}]/g, "");
  return s.replace(/\s+/g, " ").trim();
}

function parseTagAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /(\w+)\s*=\s*["']([^"']*)["']/g;
  let a: RegExpExecArray | null;
  while ((a = attrRegex.exec(attrStr)) !== null) {
    attrs[a[1].toLowerCase()] = a[2];
  }
  return attrs;
}

/** Light whitespace repair for figure tags emitted by the model (mirrors embedVizTags). */
function normalizeEmbeddedFigureTags(raw: string): string {
  let s = raw;
  s = s.replace(/<\s+(SlopeField|FunctionGraph|Molecule|Mermaid)\b/gi, "<$1");
  s = s.replace(/<\/\s+Mermaid\s*>/gi, "</Mermaid>");
  return s;
}

export function parseRangePair(range: string, fallback: [number, number]): [number, number] {
  const parts = range.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 2) return fallback;
  const a = parts[0], b = parts[1];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return fallback;
  return [a, b];
}

export function parsePoints(points: string): Array<{ x: number; y: number; label?: string }> {
  const out: Array<{ x: number; y: number; label?: string }> = [];
  const parts = points.split(";").map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const inner = p.replace(/^\(/, "").replace(/\)$/, "");
    const items = inner.split(",").map((s) => s.trim());
    if (items.length < 2) continue;
    const x = parseFloat(items[0]), y = parseFloat(items[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x, y, label: items.slice(2).join(",") || undefined });
  }
  return out;
}
