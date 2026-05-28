import katex from "katex";

function evalPieceAt(expr: string, x: number): number | null {
  try {
    const jsExpr = expr.replace(/\^/g, "**");
    // eslint-disable-next-line no-new-func
    return new Function("x", `return (${jsExpr})`)(x) as number;
  } catch {
    return null;
  }
}

export function correctFunctionGraphHoles(latex: string): string {
  return latex.replace(/<FunctionGraph\b([^>]*?)\/>/g, (match, attrs: string) => {
    const piecesAttr = /pieces="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const holesAttr = /holes="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const dotsAttr = /dots="([^"]*)"/.exec(attrs)?.[1] ?? "";
    if (!piecesAttr || (!holesAttr && !dotsAttr)) return match;

    const pieces = piecesAttr
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => {
        const [expr, range] = p.split("|");
        const [a, b] = (range ?? "").split(",").map(Number);
        return { expr: expr?.trim() ?? "", start: a ?? NaN, end: b ?? NaN };
      });

    function correctCoords(coordStr: string): string {
      return coordStr
        .split(";")
        .map((s) => {
          const parts = s.trim().split(",");
          if (parts.length < 2) return s;
          const x = parseFloat(parts[0]!);
          if (isNaN(x)) return s;
          const piece = pieces.find(
            (p) => !isNaN(p.start) && !isNaN(p.end) && p.start <= x + 1e-9 && x - 1e-9 <= p.end
          );
          if (!piece) return s;
          const y = evalPieceAt(piece.expr, x);
          if (y === null || !isFinite(y)) return s;
          const yStr = Number.isInteger(y)
            ? String(y)
            : y.toFixed(4).replace(/\.?0+$/, "");
          return `${parts[0]},${yStr}`;
        })
        .join("; ");
    }

    let newAttrs = attrs;
    if (holesAttr)
      newAttrs = newAttrs.replace(
        `holes="${holesAttr}"`,
        `holes="${correctCoords(holesAttr)}"`
      );
    if (dotsAttr)
      newAttrs = newAttrs.replace(
        `dots="${dotsAttr}"`,
        `dots="${correctCoords(dotsAttr)}"`
      );
    return `<FunctionGraph${newAttrs}/>`;
  });
}

function extractMathBlocks(latex: string): Array<{ math: string; display: boolean }> {
  const blocks: Array<{ math: string; display: boolean }> = [];
  let i = 0;
  while (i < latex.length) {
    if (latex[i] === "<") {
      const close = latex.indexOf(">", i);
      if (close !== -1) { i = close + 1; continue; }
    }
    if (latex.slice(i, i + 2) === "$$") {
      const end = latex.indexOf("$$", i + 2);
      if (end !== -1) {
        const math = latex.slice(i + 2, end).trim();
        if (math) blocks.push({ math, display: true });
        i = end + 2;
      } else { i++; }
      continue;
    }
    if (latex[i] === "$") {
      const end = latex.indexOf("$", i + 1);
      if (end !== -1) {
        const math = latex.slice(i + 1, end).trim();
        if (math) blocks.push({ math, display: false });
        i = end + 1;
      } else { i++; }
      continue;
    }
    i++;
  }
  return blocks;
}

export function checkKatexErrors(latex: string): string[] {
  const errors: string[] = [];
  for (const { math, display } of extractMathBlocks(latex)) {
    try {
      katex.renderToString(math, { displayMode: display, throwOnError: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] ?? e.message : String(e);
      const preview = math.length > 50 ? math.slice(0, 50) + "…" : math;
      errors.push(`${display ? "Display" : "Inline"} block \`${preview}\`: ${msg}`);
    }
  }
  return errors;
}
