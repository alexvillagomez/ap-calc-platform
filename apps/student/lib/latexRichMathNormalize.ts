import { normalizeEmbeddedVizTags } from "@/lib/embedVizTags";

export function convertItemizeToAligned(src: string): string {
  return src.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_, inner) => {
    const items = inner.split(/\\item/).filter((x: string) => x.trim());
    if (items.length === 0) return "";
    const rows = items.map((it: string) => `&${it.trim()}\\\\`).join("\n");
    return `\\begin{aligned}\n${rows}\n\\end{aligned}`;
  });
}

export function sanitizeKatexUnsafeMacros(tex: string): string {
  let s = tex;
  s = s.replace(/\\emph\{/g, "\\text{");
  s = s.replace(/\\xbar\b/g, "\\overline{x}");
  s = s.replace(/``/g, "''");
  return s;
}

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
    } else {
      result += latex[i];
    }
    i++;
  }
  return result;
}

export function normalizeRichMathSource(src: string): string {
  let s = normalizeEmbeddedVizTags(src);
  s = convertItemizeToAligned(s);
  s = sanitizeKatexUnsafeMacros(s);
  s = removeStrayClosingBraces(s);
  return s;
}
