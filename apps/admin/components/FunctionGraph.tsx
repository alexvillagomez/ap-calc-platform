"use client";

import { useMemo } from "react";
import { parseFunctionEquation } from "@/lib/safeExpression";

export interface FunctionGraphProps {
  /** Expression for y=f(x), e.g. "x^2 - 3x + 1". Use cos, sin, exp, sqrt. */
  equation: string;
  /** x range [min, max] */
  rangeX: [number, number];
  /** y range [min, max] */
  rangeY: [number, number];
  /** SVG width (default 420) */
  width?: number;
  /** SVG height (default 320) */
  height?: number;
  /** Optional points to mark */
  points?: Array<{ x: number; y: number; label?: string }>;
}

export function FunctionGraph({
  equation,
  rangeX,
  rangeY,
  width = 420,
  height = 320,
  points = [],
}: FunctionGraphProps) {
  const fn = useMemo(() => parseFunctionEquation(equation), [equation]);

  const padding = 28;
  const xMin = rangeX[0];
  const xMax = rangeX[1];
  const yMin = rangeY[0];
  const yMax = rangeY[1];
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const plotWidth = width - 2 * padding;
  const plotHeight = height - 2 * padding;

  function toSvgX(x: number) {
    return padding + ((x - xMin) / xSpan) * plotWidth;
  }
  function toSvgY(y: number) {
    return padding + (1 - (y - yMin) / ySpan) * plotHeight;
  }

  // Choose a reasonable grid step based on span
  const approxStep = Math.max(xSpan, ySpan) / 8;
  const niceSteps = [0.25, 0.5, 1, 2, 5, 10];
  const gridStep = niceSteps.reduce(
    (best, s) => (Math.abs(s - approxStep) < Math.abs(best - approxStep) ? s : best),
    1
  );

  const gridLines: React.ReactNode[] = [];
  for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax + 1e-9; x += gridStep) {
    if (Math.abs(x) < 1e-10) continue;
    gridLines.push(
      <line
        key={`v-${x}`}
        x1={toSvgX(x)}
        y1={padding}
        x2={toSvgX(x)}
        y2={height - padding}
        stroke="#e5e7eb"
        strokeWidth="0.5"
      />
    );
  }
  for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax + 1e-9; y += gridStep) {
    if (Math.abs(y) < 1e-10) continue;
    gridLines.push(
      <line
        key={`h-${y}`}
        x1={padding}
        y1={toSvgY(y)}
        x2={width - padding}
        y2={toSvgY(y)}
        stroke="#e5e7eb"
        strokeWidth="0.5"
      />
    );
  }

  const axes: React.ReactNode[] = [];
  if (xMin <= 0 && xMax >= 0) {
    axes.push(
      <line
        key="y-axis"
        x1={toSvgX(0)}
        y1={padding}
        x2={toSvgX(0)}
        y2={height - padding}
        stroke="#9ca3af"
        strokeWidth="1"
      />
    );
  }
  if (yMin <= 0 && yMax >= 0) {
    axes.push(
      <line
        key="x-axis"
        x1={padding}
        y1={toSvgY(0)}
        x2={width - padding}
        y2={toSvgY(0)}
        stroke="#9ca3af"
        strokeWidth="1"
      />
    );
  }

  // Sample curve
  const samples = 260;
  const pts: Array<{ x: number; y: number; ok: boolean }> = [];
  for (let i = 0; i <= samples; i++) {
    const x = xMin + (i / samples) * xSpan;
    const y = fn(x);
    const ok = Number.isFinite(y) && y >= yMin - ySpan * 0.25 && y <= yMax + ySpan * 0.25;
    pts.push({ x, y, ok });
  }

  let d = "";
  let penDown = false;
  for (const p of pts) {
    if (!p.ok) {
      penDown = false;
      continue;
    }
    const sx = toSvgX(p.x);
    const sy = toSvgY(p.y);
    if (!penDown) {
      d += `M ${sx.toFixed(2)} ${sy.toFixed(2)} `;
      penDown = true;
    } else {
      d += `L ${sx.toFixed(2)} ${sy.toFixed(2)} `;
    }
  }

  const pointNodes = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p, i) => (
      <g key={`pt-${i}`}>
        <circle cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={3.2} fill="#111827" />
        {p.label ? (
          <text x={toSvgX(p.x) + 6} y={toSvgY(p.y) - 6} fontSize="12" fill="#111827">
            {p.label}
          </text>
        ) : null}
      </g>
    ));

  return (
    <div className="my-6 py-4 flex justify-center overflow-x-auto w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="max-w-full"
      >
        {gridLines}
        {axes}
        <path d={d} fill="none" stroke="#111827" strokeWidth="1.5" />
        {pointNodes}
      </svg>
    </div>
  );
}

