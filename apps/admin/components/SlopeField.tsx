"use client";

import { useId, useMemo } from "react";
import { parseSlopeEquation } from "@/lib/safeExpression";

export interface SlopeFieldProps {
  /** Expression for dy/dx, e.g. "0.5*(y-1)*cos(x/2)". Use cos, sin, exp, sqrt (not Math.cos). */
  equation: string;
  /** x range [min, max] */
  rangeX: [number, number];
  /** y range [min, max] */
  rangeY: [number, number];
  /** Grid step (default 0.5) */
  gridStep?: number;
  /** Half-length of each slope segment in data units (default 0.15) */
  segmentLength?: number;
  /** SVG width (default 400) */
  width?: number;
  /** SVG height (default 300) */
  height?: number;
}

/**
 * Renders a slope field as an SVG grid of line segments.
 * College Board style: light gray grid/axes, black slope segments.
 */
export function SlopeField({
  equation,
  rangeX,
  rangeY,
  gridStep = 0.5,
  segmentLength = 0.15,
  width = 400,
  height = 300,
}: SlopeFieldProps) {
  const slopeFn = useMemo(() => parseSlopeEquation(equation), [equation]);
  const clipId = `sf_${useId().replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  /** Asymmetric margins: extra left/bottom so axis labels sit in gutter, not under segments. */
  const padL = 46;
  const padR = 22;
  const padT = 20;
  const padB = 40;
  const xMin = rangeX[0];
  const xMax = rangeX[1];
  const yMin = rangeY[0];
  const yMax = rangeY[1];
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const plotWidth = width - padL - padR;
  const plotHeight = height - padT - padB;

  function toSvgX(x: number) {
    return padL + ((x - xMin) / xSpan) * plotWidth;
  }
  function toSvgY(y: number) {
    return padT + (1 - (y - yMin) / ySpan) * plotHeight;
  }

  /** Integer tick positions from min..max, with wider steps if the span is crowded. */
  function integerAxisTicks(min: number, max: number): number[] {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (hi < lo) return [];
    const count = hi - lo + 1;
    let step = 1;
    if (count > 18) {
      step = Math.max(1, Math.ceil(count / 16));
      if (step > 1 && step < 4) step = 2;
      else if (step >= 4 && step < 8) step = 5;
      else if (step >= 8) step = 10;
    }
    const ticks: number[] = [];
    const start = Math.ceil(lo / step) * step;
    for (let v = start; v <= hi; v += step) {
      if (v >= lo && v <= hi) ticks.push(v);
    }
    if (ticks.length === 0 || ticks[ticks.length - 1] !== hi) {
      if (hi >= lo && !ticks.includes(hi)) ticks.push(hi);
    }
    ticks.sort((a, b) => a - b);
    return [...new Set(ticks)];
  }

  const xTicks = integerAxisTicks(xMin, xMax);
  const yTicks = integerAxisTicks(yMin, yMax);

  const axisLabels: React.ReactNode[] = [];
  const labelColor = "#4b5563";
  const labelSize = 11;
  const bottomLabelY = height - padB / 2 + 4;
  for (const xv of xTicks) {
    axisLabels.push(
      <text
        key={`xlab-${xv}`}
        x={toSvgX(xv)}
        y={bottomLabelY}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={labelSize}
        fill={labelColor}
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {xv}
      </text>
    );
  }
  for (const yv of yTicks) {
    axisLabels.push(
      <text
        key={`ylab-${yv}`}
        x={padL - 10}
        y={toSvgY(yv)}
        textAnchor="end"
        dominantBaseline="middle"
        fontSize={labelSize}
        fill={labelColor}
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {yv}
      </text>
    );
  }

  const gridLines: React.ReactNode[] = [];
  for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax; x += gridStep) {
    if (Math.abs(x) < 1e-10) continue;
    gridLines.push(
      <line
        key={`v-${x}`}
        x1={toSvgX(x)}
        y1={padT}
        x2={toSvgX(x)}
        y2={height - padB}
        stroke="#e5e7eb"
        strokeWidth="0.5"
      />
    );
  }
  for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax; y += gridStep) {
    if (Math.abs(y) < 1e-10) continue;
    gridLines.push(
      <line
        key={`h-${y}`}
        x1={padL}
        y1={toSvgY(y)}
        x2={width - padR}
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
        y1={padT}
        x2={toSvgX(0)}
        y2={height - padB}
        stroke="#9ca3af"
        strokeWidth="1"
      />
    );
  }
  if (yMin <= 0 && yMax >= 0) {
    axes.push(
      <line
        key="x-axis"
        x1={padL}
        y1={toSvgY(0)}
        x2={width - padR}
        y2={toSvgY(0)}
        stroke="#9ca3af"
        strokeWidth="1"
      />
    );
  }

  const segments: React.ReactNode[] = [];
  const step = gridStep;
  for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
    for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) {
      let m: number;
      try {
        m = slopeFn(x, y);
      } catch {
        continue;
      }
      if (!Number.isFinite(m)) continue;
      const dx = segmentLength / Math.sqrt(1 + m * m);
      const dy = m * dx;
      const x1 = x - dx;
      const y1 = y - dy;
      const x2 = x + dx;
      const y2 = y + dy;
      segments.push(
        <line
          key={`${x}-${y}`}
          x1={toSvgX(x1)}
          y1={toSvgY(y1)}
          x2={toSvgX(x2)}
          y2={toSvgY(y2)}
          stroke="#111827"
          strokeWidth="1"
          strokeLinecap="round"
        />
      );
    }
  }

  return (
    <div className="my-6 py-4 flex justify-center overflow-x-auto w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="max-w-full"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={padL} y={padT} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {gridLines}
          {axes}
          {segments}
        </g>
        {axisLabels}
      </svg>
    </div>
  );
}
