"use client";

import { useId, useMemo } from "react";
import { parseSlopeEquation } from "@/lib/safeExpression";

export interface SlopeFieldProps {
  equation: string;
  rangeX: [number, number];
  rangeY: [number, number];
  gridStep?: number;
  segmentLength?: number;
  width?: number;
  height?: number;
}

export function SlopeField({
  equation, rangeX, rangeY,
  gridStep = 0.5, segmentLength = 0.15,
  width = 400, height = 300,
}: SlopeFieldProps) {
  const slopeFn = useMemo(() => parseSlopeEquation(equation), [equation]);
  const clipId = `sf_${useId().replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const padL = 46, padR = 22, padT = 20, padB = 40;
  const xMin = rangeX[0], xMax = rangeX[1], yMin = rangeY[0], yMax = rangeY[1];
  const xSpan = xMax - xMin || 1, ySpan = yMax - yMin || 1;
  const plotWidth = width - padL - padR, plotHeight = height - padT - padB;

  const toSvgX = (x: number) => padL + ((x - xMin) / xSpan) * plotWidth;
  const toSvgY = (y: number) => padT + (1 - (y - yMin) / ySpan) * plotHeight;

  function intTicks(min: number, max: number): number[] {
    const lo = Math.ceil(min), hi = Math.floor(max);
    if (hi < lo) return [];
    const count = hi - lo + 1;
    let step = 1;
    if (count > 18) step = count > 32 ? 10 : count > 12 ? 5 : 2;
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    return [...new Set(ticks)];
  }

  const xTicks = intTicks(xMin, xMax), yTicks = intTicks(yMin, yMax);
  const labelColor = "#4b5563", labelSize = 11, bottomLabelY = height - padB / 2 + 4;

  const gridLines: React.ReactNode[] = [];
  for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax; x += gridStep) {
    if (Math.abs(x) > 1e-10) gridLines.push(<line key={`v${x}`} x1={toSvgX(x)} y1={padT} x2={toSvgX(x)} y2={height - padB} stroke="#e5e7eb" strokeWidth="0.5" />);
  }
  for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax; y += gridStep) {
    if (Math.abs(y) > 1e-10) gridLines.push(<line key={`h${y}`} x1={padL} y1={toSvgY(y)} x2={width - padR} y2={toSvgY(y)} stroke="#e5e7eb" strokeWidth="0.5" />);
  }

  const segments: React.ReactNode[] = [];
  for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax; x += gridStep) {
    for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax; y += gridStep) {
      let m: number;
      try { m = slopeFn(x, y); } catch { continue; }
      if (!Number.isFinite(m)) continue;
      const dx = segmentLength / Math.sqrt(1 + m * m), dy = m * dx;
      segments.push(
        <line key={`${x}_${y}`} x1={toSvgX(x - dx)} y1={toSvgY(y - dy)} x2={toSvgX(x + dx)} y2={toSvgY(y + dy)} stroke="#111827" strokeWidth="1" strokeLinecap="round" />
      );
    }
  }

  return (
    <div className="my-4 flex justify-center overflow-x-auto w-full">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-full">
        <defs><clipPath id={clipId}><rect x={padL} y={padT} width={plotWidth} height={plotHeight} /></clipPath></defs>
        <g clipPath={`url(#${clipId})`}>
          {gridLines}
          {xMin <= 0 && xMax >= 0 && <line x1={toSvgX(0)} y1={padT} x2={toSvgX(0)} y2={height - padB} stroke="#9ca3af" strokeWidth="1" />}
          {yMin <= 0 && yMax >= 0 && <line x1={padL} y1={toSvgY(0)} x2={width - padR} y2={toSvgY(0)} stroke="#9ca3af" strokeWidth="1" />}
          {segments}
        </g>
        {xTicks.map((v) => <text key={`xl${v}`} x={toSvgX(v)} y={bottomLabelY} textAnchor="middle" dominantBaseline="middle" fontSize={labelSize} fill={labelColor} fontFamily="system-ui,sans-serif">{v}</text>)}
        {yTicks.map((v) => <text key={`yl${v}`} x={padL - 10} y={toSvgY(v)} textAnchor="end" dominantBaseline="middle" fontSize={labelSize} fill={labelColor} fontFamily="system-ui,sans-serif">{v}</text>)}
      </svg>
    </div>
  );
}
