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
  /** Optional points to mark (filled dots) */
  points?: Array<{ x: number; y: number; label?: string }>;
  /** Optional removable-discontinuity points to mark as OPEN circles (holes). */
  holes?: Array<{ x: number; y: number; label?: string }>;
  /** Enforce equal (1:1) scaling between x- and y-axis units (default true). Set false when the
   *  ranges are too lopsided for 1:1 to be readable (e.g. rangeX=[-10,10], rangeY=[-2,2]). */
  equalScale?: boolean;
}

const SERIF = "KaTeX_Main, 'Times New Roman', serif";

/** Choose a "nice" step (1, 2, 5, 10, ...) so roughly `target` ticks fit in `span`. */
function niceStep(span: number, target = 8): number {
  const raw = span / target;
  const niceSteps = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
  return niceSteps.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), 1);
}

function formatTick(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function FunctionGraph({
  equation,
  rangeX,
  rangeY,
  width = 420,
  height = 320,
  points = [],
  holes = [],
  equalScale = true,
}: FunctionGraphProps) {
  const fn = useMemo(() => parseFunctionEquation(equation), [equation]);

  // Asymmetric gutters leave room for tick numbers, axis-name labels, and arrowheads.
  const padL = 46;
  const padR = 28;
  const padT = 26;
  const padB = 40;

  const xMin = rangeX[0];
  const xMax = rangeX[1];
  const yMin = rangeY[0];
  const yMax = rangeY[1];
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const availW = width - padL - padR;
  const availH = height - padT - padB;

  // Enforce a 1:1 (equal) scale by default: one data-unit is the same number of pixels on
  // both axes. When equalScale is false, stretch independently to fill the available box —
  // useful when the ranges are too lopsided for 1:1 to be readable.
  const unitScaleX = equalScale ? Math.min(availW / xSpan, availH / ySpan) : availW / xSpan;
  const unitScaleY = equalScale ? unitScaleX : availH / ySpan;
  const plotWidth = unitScaleX * xSpan;
  const plotHeight = unitScaleY * ySpan;
  // Center the (possibly smaller) plot rectangle within the padded box.
  const left = padL + (availW - plotWidth) / 2;
  const top = padT + (availH - plotHeight) / 2;
  const right = left + plotWidth;
  const bottom = top + plotHeight;

  function toSvgX(x: number) {
    return left + ((x - xMin) / xSpan) * plotWidth;
  }
  function toSvgY(y: number) {
    return top + (1 - (y - yMin) / ySpan) * plotHeight;
  }

  const gridStep = niceStep(Math.max(xSpan, ySpan));

  const gridLines: React.ReactNode[] = [];
  for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax + 1e-9; x += gridStep) {
    if (Math.abs(x) < 1e-10) continue;
    gridLines.push(
      <line key={`v-${x}`} x1={toSvgX(x)} y1={top} x2={toSvgX(x)} y2={bottom} stroke="#e5e7eb" strokeWidth="0.5" />
    );
  }
  for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax + 1e-9; y += gridStep) {
    if (Math.abs(y) < 1e-10) continue;
    gridLines.push(
      <line key={`h-${y}`} x1={left} y1={toSvgY(y)} x2={right} y2={toSvgY(y)} stroke="#e5e7eb" strokeWidth="0.5" />
    );
  }

  const showXAxis = yMin <= 0 && yMax >= 0;
  const showYAxis = xMin <= 0 && xMax >= 0;
  const arrow = 7; // arrowhead length/width in px
  const tick = 4.5; // tick mark half-length in px

  const axes: React.ReactNode[] = [];
  const ticks: React.ReactNode[] = [];
  const labels: React.ReactNode[] = [];

  if (showXAxis) {
    const y0 = toSvgY(0);
    const xStart = left - arrow * 0.6;
    const xEnd = right + arrow * 0.6;
    axes.push(
      <line key="x-axis" x1={xStart} y1={y0} x2={xEnd} y2={y0} stroke="#374151" strokeWidth="1.25" />
    );
    axes.push(
      <polygon
        key="x-arrow"
        points={`${xEnd + arrow},${y0} ${xEnd - 1},${y0 - arrow / 2} ${xEnd - 1},${y0 + arrow / 2}`}
        fill="#374151"
      />
    );
    labels.push(
      <text key="x-label" x={xEnd + arrow + 8} y={y0 + 4} fontFamily={SERIF} fontStyle="italic" fontSize={15} fill="#111827">
        x
      </text>
    );
    for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax + 1e-9; x += gridStep) {
      if (Math.abs(x) < 1e-10) continue; // origin labeled separately as "O"
      const sx = toSvgX(x);
      ticks.push(<line key={`xt-${x}`} x1={sx} y1={y0 - tick} x2={sx} y2={y0 + tick} stroke="#374151" strokeWidth="1" />);
      labels.push(
        <text key={`xtl-${x}`} x={sx} y={y0 + tick + 14} fontFamily={SERIF} fontSize={12} fill="#374151" textAnchor="middle">
          {formatTick(x)}
        </text>
      );
    }
  }

  if (showYAxis) {
    const x0 = toSvgX(0);
    const yStart = bottom + arrow * 0.6;
    const yEnd = top - arrow * 0.6;
    axes.push(
      <line key="y-axis" x1={x0} y1={yStart} x2={x0} y2={yEnd} stroke="#374151" strokeWidth="1.25" />
    );
    axes.push(
      <polygon
        key="y-arrow"
        points={`${x0},${yEnd - arrow} ${x0 - arrow / 2},${yEnd + 1} ${x0 + arrow / 2},${yEnd + 1}`}
        fill="#374151"
      />
    );
    labels.push(
      <text key="y-label" x={x0 + 8} y={yEnd - arrow - 4} fontFamily={SERIF} fontStyle="italic" fontSize={15} fill="#111827">
        y
      </text>
    );
    for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax + 1e-9; y += gridStep) {
      if (Math.abs(y) < 1e-10) continue; // origin labeled separately as "O"
      const sy = toSvgY(y);
      ticks.push(<line key={`yt-${y}`} x1={x0 - tick} y1={sy} x2={x0 + tick} y2={sy} stroke="#374151" strokeWidth="1" />);
      labels.push(
        <text key={`ytl-${y}`} x={x0 - tick - 6} y={sy + 4} fontFamily={SERIF} fontSize={12} fill="#374151" textAnchor="end">
          {formatTick(y)}
        </text>
      );
    }
  }

  if (showXAxis && showYAxis) {
    labels.push(
      <text key="origin" x={toSvgX(0) - 10} y={toSvgY(0) + 16} fontFamily={SERIF} fontSize={13} fill="#374151" textAnchor="end">
        O
      </text>
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
    .map((p, i) => {
      const text = p.label ?? `(${formatTick(p.x)}, ${formatTick(p.y)})`;
      return (
        <g key={`pt-${i}`}>
          <circle cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={3.2} fill="#111827" />
          <text x={toSvgX(p.x) + 7} y={toSvgY(p.y) - 7} fontFamily={SERIF} fontSize={12} fill="#111827">
            {text}
          </text>
        </g>
      );
    });

  // Holes = removable discontinuities: an OPEN circle (white fill, dark ring)
  // sitting on the curve to show f is undefined / not equal there.
  const holeNodes = holes
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p, i) => {
      const text = p.label ?? `(${formatTick(p.x)}, ${formatTick(p.y)})`;
      return (
        <g key={`hole-${i}`}>
          <circle cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={3.6} fill="#ffffff" stroke="#111827" strokeWidth="1.5" />
          <text x={toSvgX(p.x) + 8} y={toSvgY(p.y) - 7} fontFamily={SERIF} fontSize={12} fill="#111827">
            {text}
          </text>
        </g>
      );
    });

  return (
    <div className="my-4 flex justify-center overflow-x-auto w-full">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-full">
        {gridLines}
        {axes}
        {ticks}
        {labels}
        <path d={d} fill="none" stroke="#111827" strokeWidth="1.5" />
        {pointNodes}
        {holeNodes}
      </svg>
    </div>
  );
}
