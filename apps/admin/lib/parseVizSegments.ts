import { normalizeRichMathSource } from "@/lib/latexRichMathNormalize";

export type VizSegment =
  | { type: "latex"; value: string }
  | { type: "slopeField"; equation: string; rangeX: string; rangeY: string }
  | {
      type: "functionGraph";
      equation: string;
      rangeX: string;
      rangeY: string;
      points: string;
    };

/**
 * Split raw problem text into LaTeX chunks and embedded <SlopeField /> / <FunctionGraph /> tags.
 * Used by Preview (including /generate and preview-katex) and any renderer that must match that behavior.
 */
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
      segments.push({
        type: "slopeField",
        equation: attrs.equation ?? "",
        rangeX: attrs.rangex ?? "",
        rangeY: attrs.rangey ?? "",
      });
    } else {
      segments.push({
        type: "functionGraph",
        equation: attrs.equation ?? "",
        rangeX: attrs.rangex ?? "",
        rangeY: attrs.rangey ?? "",
        points: attrs.points ?? "",
      });
    }

    lastEnd = m.index + m[0].length;
  }

  const tail = normalized.slice(lastEnd);
  if (tail.trim()) segments.push({ type: "latex", value: tail.trim() });
  if (segments.length === 0) segments.push({ type: "latex", value: normalized.trim() });
  return segments;
}

export function parseRangePair(range: string, fallback: [number, number]): [number, number] {
  const parts = range.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 2) return fallback;
  const a = parts[0];
  const b = parts[1];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return fallback;
  return [a, b];
}

export function parsePoints(points: string): Array<{ x: number; y: number; label?: string }> {
  const out: Array<{ x: number; y: number; label?: string }> = [];
  const parts = points
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    const inner = p.replace(/^\(/, "").replace(/\)$/, "");
    const items = inner.split(",").map((s) => s.trim());
    if (items.length < 2) continue;
    const x = parseFloat(items[0]);
    const y = parseFloat(items[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const label = items.slice(2).join(",") || undefined;
    out.push({ x, y, label });
  }
  return out;
}
