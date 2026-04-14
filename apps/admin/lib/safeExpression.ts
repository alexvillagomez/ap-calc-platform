import { Parser, type Value } from "expr-eval";

/** Whitelist of math functions for slope equations (expr-eval compatible) */
const MATH_SCOPE: Record<string, Value> = {
  cos: ((a: Value) => (typeof a === "number" ? Math.cos(a) : 0)) as Value,
  sin: ((a: Value) => (typeof a === "number" ? Math.sin(a) : 0)) as Value,
  tan: ((a: Value) => (typeof a === "number" ? Math.tan(a) : 0)) as Value,
  exp: ((a: Value) => (typeof a === "number" ? Math.exp(a) : 0)) as Value,
  sqrt: ((a: Value) => (typeof a === "number" ? Math.sqrt(a) : 0)) as Value,
  abs: ((a: Value) => (typeof a === "number" ? Math.abs(a) : 0)) as Value,
  log: ((a: Value) => (typeof a === "number" ? Math.log(a) : 0)) as Value,
  ln: ((a: Value) => (typeof a === "number" ? Math.log(a) : 0)) as Value,
  pow: ((a: Value, b: Value) =>
    typeof a === "number" && typeof b === "number" ? Math.pow(a, b) : 0) as Value,
  atan: ((a: Value) => (typeof a === "number" ? Math.atan(a) : 0)) as Value,
  atan2: ((a: Value, b: Value) =>
    typeof a === "number" && typeof b === "number" ? Math.atan2(a, b) : 0) as Value,
  min: ((a: Value, b: Value) =>
    typeof a === "number" && typeof b === "number" ? Math.min(a, b) : 0) as Value,
  max: ((a: Value, b: Value) =>
    typeof a === "number" && typeof b === "number" ? Math.max(a, b) : 0) as Value,
  PI: Math.PI,
  E: Math.E,
};

/**
 * Safely parses a slope equation string (e.g. "0.5*(y-1)*cos(x/2)")
 * into a function (x, y) => number for use in SlopeField.
 * Uses expr-eval with a whitelist of x, y, and math functions (cos, sin, etc.).
 * Use cos(x), sin(x), exp(x), sqrt(x) in the equation—not Math.cos.
 */
export function parseSlopeEquation(equation: string): (x: number, y: number) => number {
  const trimmed = (equation ?? "").trim();
  if (!trimmed) {
    return (_x: number, _y: number) => 0;
  }
  const parser = new Parser();
  let expr;
  try {
    expr = parser.parse(trimmed);
  } catch {
    // LaTeX (e.g. \frac) or other non–expr-eval syntax from generated content
    return (_x: number, _y: number) => 0;
  }
  return (x: number, y: number) => {
    try {
      const value = expr.evaluate({ x, y, ...MATH_SCOPE });
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  };
}

/**
 * Safely parses a single-variable function expression (e.g. "x^2 - 3x + 1")
 * into a function (x) => number for graphing.
 */
export function parseFunctionEquation(equation: string): (x: number) => number {
  const trimmed = (equation ?? "").trim();
  if (!trimmed) {
    return (_x: number) => 0;
  }
  const parser = new Parser();
  let expr;
  try {
    expr = parser.parse(trimmed);
  } catch {
    return (_x: number) => 0;
  }
  return (x: number) => {
    try {
      const value = expr.evaluate({ x, ...MATH_SCOPE });
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  };
}
