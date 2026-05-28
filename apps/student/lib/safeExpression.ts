import { Parser, type Value } from "expr-eval";

const MATH_SCOPE: Record<string, Value> = {
  cos:  ((a: Value) => (typeof a === "number" ? Math.cos(a)  : 0)) as Value,
  sin:  ((a: Value) => (typeof a === "number" ? Math.sin(a)  : 0)) as Value,
  tan:  ((a: Value) => (typeof a === "number" ? Math.tan(a)  : 0)) as Value,
  exp:  ((a: Value) => (typeof a === "number" ? Math.exp(a)  : 0)) as Value,
  sqrt: ((a: Value) => (typeof a === "number" ? Math.sqrt(a) : 0)) as Value,
  abs:  ((a: Value) => (typeof a === "number" ? Math.abs(a)  : 0)) as Value,
  log:  ((a: Value) => (typeof a === "number" ? Math.log(a)  : 0)) as Value,
  ln:   ((a: Value) => (typeof a === "number" ? Math.log(a)  : 0)) as Value,
  pow:  ((a: Value, b: Value) => typeof a === "number" && typeof b === "number" ? Math.pow(a, b)   : 0) as Value,
  atan: ((a: Value) => (typeof a === "number" ? Math.atan(a) : 0)) as Value,
  atan2:((a: Value, b: Value) => typeof a === "number" && typeof b === "number" ? Math.atan2(a, b) : 0) as Value,
  min:  ((a: Value, b: Value) => typeof a === "number" && typeof b === "number" ? Math.min(a, b)   : 0) as Value,
  max:  ((a: Value, b: Value) => typeof a === "number" && typeof b === "number" ? Math.max(a, b)   : 0) as Value,
  PI: Math.PI,
  E:  Math.E,
};

export function parseSlopeEquation(equation: string): (x: number, y: number) => number {
  let trimmed = (equation ?? "").trim();
  if (!trimmed) return () => NaN;
  // Strip common LHS prefixes: "dy/dx = ", "y' = " etc.
  trimmed = trimmed.replace(/^(?:dy\s*\/\s*dx|y'|dydx)\s*=\s*/i, "");
  if (!trimmed) return () => NaN;
  const parser = new Parser();
  let expr;
  try { expr = parser.parse(trimmed); } catch { return () => NaN; }
  return (x: number, y: number) => {
    try {
      const value = expr.evaluate({ x, y, ...MATH_SCOPE });
      return typeof value === "number" && Number.isFinite(value) ? value : NaN;
    } catch { return NaN; }
  };
}

export function parseFunctionEquation(equation: string): (x: number) => number {
  let trimmed = (equation ?? "").trim();
  if (!trimmed) return () => NaN;
  // Strip common LHS prefixes: "y = ", "f(x) = ", "y=" etc.
  trimmed = trimmed.replace(/^[yYfF]\s*(?:\(\s*x\s*\))?\s*=\s*/, "");
  if (!trimmed) return () => NaN;
  const parser = new Parser();
  let expr;
  try { expr = parser.parse(trimmed); } catch { return () => NaN; }
  return (x: number) => {
    try {
      const value = expr.evaluate({ x, ...MATH_SCOPE });
      return typeof value === "number" && Number.isFinite(value) ? value : NaN;
    } catch { return NaN; }
  };
}
