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

/** Greek-letter names KaTeX expects with a leading backslash. */
const GREEK_NAMES =
  "alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega";

/**
 * Models (esp. gpt-5.4-mini) frequently write a Greek letter as a bare word
 * inside math — "$alpha$ carbon" — which KaTeX renders as the italic product
 * a·l·p·h·a instead of α. Restore the backslash on a whole-token `$greek$`
 * (and `$greek<sub/super>$` like `$pK_a$`-style is left alone since that is not
 * a bare greek token). Only touches a `$`-delimited token that is EXACTLY a
 * greek name, so prose like "the alpha carbon" is never affected.
 */
export function restoreBareGreekMath(src: string): string {
  return src.replace(
    new RegExp(`\\$\\s*(${GREEK_NAMES})\\s*\\$`, "g"),
    (_m, name) => `$\\${name}$`,
  );
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
  s = restoreBareGreekMath(s);
  s = removeStrayClosingBraces(s);
  return s;
}
