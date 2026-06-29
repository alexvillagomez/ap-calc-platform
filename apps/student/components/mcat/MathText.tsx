"use client";

import katex from "katex";
// Side-effect import: registers the `\ce{...}` chemistry macro on KaTeX so
// reaction equations (`$\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}$`) typeset inline.
import "katex/contrib/mhchem";
import { stripControlChars } from "@/lib/parseModelJson";
import { normalizeScienceNotation } from "@/lib/scienceNotation";
import { restoreBareGreekMath } from "@/lib/latexRichMathNormalize";
import {
  parseFigureSegments,
  hasFigureContent,
  parseRangePair,
  parsePoints,
} from "@/lib/parseVizSegments";
import { FunctionGraph } from "@/components/FunctionGraph";
import { SlopeField } from "@/components/SlopeField";
import { MoleculeStructure } from "@/components/figures/MoleculeStructure";
import { MermaidDiagram } from "@/components/figures/MermaidDiagram";
import { DataTable } from "@/components/figures/DataTable";

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

/**
 * Apply the full LaTeX-corruption-repair + science-notation pipeline to a string.
 * Extracted so it can run on the WHOLE string (text-only content) OR per-latex
 * segment in the figure path — figure payloads (SMILES, Mermaid DSL, table cells)
 * must NOT pass through here, since backslashes/`\n` in a SMILES or DSL string
 * would be mangled by the LaTeX repairs.
 */
function prepareText(input: string): string {
  // Repair LaTeX-command corruption from JSON single-escaping: a model that
  // emitted `\frac`/`\theta`/`\tan` with ONE backslash inside a JSON string has
  // its `\f`/`\t`/`\b`/`\r` parsed into the literal control chars FF/TAB/BS/CR,
  // dropping the backslash (e.g. `\frac` → `<FF>rac` → renders as "rac"). Map
  // those control chars back to `\f`/`\t`/`\b`/`\r` so the command renders.
  // Newlines (\n) are legitimate (step breaks) and left intact.
  const repaired = input
    .replace(/\x08/g, "\\b")
    .replace(/\t/g, "\\t")
    .replace(/\f/g, "\\f")
    .replace(/\r/g, "\\r")
    // Repair MISSING-BACKSLASH fraction commands the model sometimes emits as
    // literal text (`dfrac{`/`frac{` with no leading `\`, which render as the
    // word "dfrac"). Only fix when not already preceded by a backslash so a
    // correct `\frac`/`\dfrac` is left untouched.
    .replace(/(^|[^\\])\b(d?frac)\{/g, "$1\\$2{")
    // Repair LEAKED LITERAL ESCAPE SEQUENCES: the model sometimes writes the two
    // characters backslash-n/t/r in prose (e.g. "...1 hour.\nIts rate...") where a
    // real line break was intended; without this they render as raw "\n" text and
    // run words together. Convert to real whitespace, but NEVER touch genuine
    // LaTeX commands (\nu \neq \nabla \ne \nmid \theta \times \tan \text \to \tau …)
    // — only convert when NOT followed by a lowercase letter.
    .replace(/\\n(?![a-z])/g, "\n")
    .replace(/\\t(?![a-z])/g, " ")
    .replace(/\\r(?![a-z])/g, "")
    // Repair operator-name corruption from JSON escaping: `\lim` → newline+"lim"
    // when the model emitted a single-backslash inside a JSON string. Only fix when
    // the operator is immediately followed by a subscript/bound char to avoid touching prose.
    .replace(/(?:\n|\\n)(lim|sin|cos|tan|cot|sec|csc|log|ln|max|min|sup|inf|exp|det|deg|arg|gcd)(?=[_^{(])/g, "\\$1")
    // Repair bare (backslash-stripped) math operators the model emits in $...$ (e.g. `lim_{`→`\lim_{`, `pprox`→`\approx`).
    .replace(/(^|[^\\A-Za-z])(lim|log|ln|exp|max|min|sup|inf|det|deg|arg|gcd)(?=[_^{(])/g, "$1\\$2")
    .replace(/(^|[^\\A-Za-z])(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh)(?=[(^])/g, "$1\\$2")
    .replace(/\bpprox\b/g, "\\approx")
    .replace(/(^|[^\\A-Za-z])infty\b/g, "$1\\infty")
    // Repair \boldsymbol corruption: the model emits `\boldsymbol{…}` but JSON
    // single-escape parsing strips `\b` → control char BS (0x08) which may then
    // be further stripped to nothing, leaving the literal token "oldsymbol".
    // The \x08 case above already handles the survive-as-BS path; this handles
    // the fully-lossy path (backspace stripped → bare "oldsymbol" in the text).
    // "oldsymbol" NEVER appears legitimately in this content — it is always corruption.
    .replace(/(?<![\\A-Za-z])oldsymbol(?=\{)/g, "\\boldsymbol");

  // Harden against legacy rows stored with ANSI/ESC corruption (→ box glyphs).
  // Also restore bare Greek math tokens ($alpha$ → $\alpha$) the model emits,
  // which otherwise render as the italic product a·l·p·h·a instead of α.
  const stripped = restoreBareGreekMath(stripControlChars(repaired));

  // Render-side safety net for stored ASCII science notation.
  // Only runs when there are no existing delimiters/LaTeX — avoids double-processing
  // properly-formatted content.
  const out =
    !stripped.includes("$") && !BARE_LATEX_RE.test(stripped)
      ? normalizeScienceNotation(stripped)
      : stripped;

  // UNIVERSAL line-break spacing: every line break renders as a full blank-line
  // gap (paragraph spacing), whether the source used one newline or two. Collapse
  // any run of newlines (and the spaces around them) to exactly two, then trim the
  // ends. Figure payloads (SMILES/Mermaid/tables) never reach here, so they're safe.
  return out
    .replace(/[^\S\n]*\n(?:[^\S\n]*\n)*[^\S\n]*/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Render an already-prepared latex segment as inline React. */
function renderPreparedLatexSegment(value: string, key: number) {
  // Apply prepareText to prose/latex segments only (figures handled separately).
  const latexText = prepareText(value);
  if (!latexText.includes("$") && !BARE_LATEX_RE.test(latexText)) {
    // No math — still honor markdown **bold** (e.g. emphasized table-cell labels).
    return <span key={key}>{renderInlineText(latexText, key)}</span>;
  }
  return <span key={key}>{renderLatexString(latexText, "")}</span>;
}

/**
 * Render a plain-text run (NO math), turning markdown **bold** into <strong>.
 * Used only on segments with no $...$ math (the component fast path / figure prose).
 */
function renderInlineText(text: string, keyBase: number | string) {
  if (!text.includes("**")) return text;
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    /^\*\*[^*\n]+\*\*$/.test(part) ? (
      <strong key={`${keyBase}-${i}`} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );
}

/** Split a string into math/text segments and render each to React nodes. */
function renderSegmentNodes(text: string, keyPrefix: string) {
  return split(text).map((s, i) => {
    if (s.type === "text") {
      if (BARE_LATEX_RE.test(s.value)) {
        return (
          <span
            key={`${keyPrefix}-${i}`}
            className="katex-inline"
            dangerouslySetInnerHTML={{ __html: render(s.value, false) }}
          />
        );
      }
      return <span key={`${keyPrefix}-${i}`}>{s.value}</span>;
    }
    return (
      <span
        key={`${keyPrefix}-${i}`}
        className={s.type === "display" ? "katex-display-inline" : "katex-inline"}
        dangerouslySetInnerHTML={{ __html: render(s.value, s.type === "display") }}
      />
    );
  });
}

/**
 * Render a single latex-only text string (no viz tags). Markdown **bold** is split
 * FIRST (a bold run may wrap inline $...$ math, e.g. "**$f'(a)$ is the slope.**"),
 * then each run is rendered through the math pipeline and wrapped in <strong>.
 */
function renderLatexString(text: string, className: string) {
  if (!text.includes("**")) {
    return (
      <span className={`whitespace-pre-line ${className}`}>{renderSegmentNodes(text, "s")}</span>
    );
  }
  // Non-greedy so each **…** pairs with its own closing markers; [\s\S] lets a bold
  // run contain math/newlines.
  const runs = text.split(/(\*\*[\s\S]+?\*\*)/g);
  return (
    <span className={`whitespace-pre-line ${className}`}>
      {runs.map((run, i) => {
        const m = /^\*\*([\s\S]+?)\*\*$/.exec(run);
        if (m) {
          return (
            <strong key={`b-${i}`} className="font-semibold">
              {renderSegmentNodes(m[1], `b-${i}`)}
            </strong>
          );
        }
        return <span key={`r-${i}`}>{renderSegmentNodes(run, `r-${i}`)}</span>;
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
  const raw = children ?? "";

  // ── Figure-aware branch: content contains a viz tag (FunctionGraph, SlopeField,
  // Molecule, Mermaid) or a markdown pipe table. Figure payloads are kept RAW
  // (not passed through prepareText, which would mangle SMILES/Mermaid/table text);
  // only the prose/latex segments get the repair + science-notation pipeline.
  if (hasFigureContent(raw)) {
    const segs = parseFigureSegments(raw);
    return (
      <div className={`whitespace-pre-line ${className}`}>
        {segs.map((seg, i) => {
          if (seg.type === "latex") {
            return renderPreparedLatexSegment(seg.value, i);
          }
          if (seg.type === "functionGraph") {
            try {
              const eq = (seg.equation ?? "").trim();
              if (!eq) return null;
              return (
                <span key={i} className="block">
                  <FunctionGraph
                    equation={eq}
                    rangeX={parseRangePair(seg.rangeX, [-5, 5])}
                    rangeY={parseRangePair(seg.rangeY, [-5, 5])}
                    points={parsePoints(seg.points)}
                    holes={parsePoints(seg.holes)}
                    equalScale={seg.equalScale !== "false"}
                  />
                </span>
              );
            } catch {
              return null;
            }
          }
          if (seg.type === "slopeField") {
            try {
              const eq = (seg.equation ?? "").trim();
              if (!eq) return null;
              return (
                <span key={i} className="block">
                  <SlopeField
                    equation={eq}
                    rangeX={parseRangePair(seg.rangeX, [-3, 3])}
                    rangeY={parseRangePair(seg.rangeY, [-3, 3])}
                  />
                </span>
              );
            } catch {
              return null;
            }
          }
          if (seg.type === "molecule") {
            const smiles = (seg.smiles ?? "").trim();
            if (!smiles) return null;
            return <MoleculeStructure key={i} smiles={smiles} caption={seg.caption?.trim() || undefined} />;
          }
          if (seg.type === "mermaid") {
            const diagram = (seg.diagram ?? "").trim();
            if (!diagram) return null;
            return <MermaidDiagram key={i} diagram={diagram} />;
          }
          if (seg.type === "table") {
            if (!seg.rows.length) return null;
            return (
              <DataTable
                key={i}
                rows={seg.rows}
                hasHeader={seg.hasHeader}
                renderCell={(cell) => renderPreparedLatexSegment(cell, 0)}
              />
            );
          }
          return null;
        })}
      </div>
    );
  }

  const text = prepareText(raw);

  // Fast path: no math delimiters AND no bare LaTeX → plain text, keeping newlines.
  // (Bare-LaTeX-without-$ must NOT short-circuit here, or split()'s bare-LaTeX
  //  branch is never reached and raw commands leak into the page.)
  if (!text.includes("$") && !BARE_LATEX_RE.test(text)) {
    return <span className={`whitespace-pre-line ${className}`}>{renderInlineText(text, "ft")}</span>;
  }

  return renderLatexString(text, className);
}
