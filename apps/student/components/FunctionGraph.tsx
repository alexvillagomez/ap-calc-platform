"use client";

import { useMemo } from "react";
import { parseFunctionEquation } from "@/lib/safeExpression";

export interface FunctionGraphProps {
  equation: string;
  rangeX: [number, number];
  rangeY: [number, number];
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number; label?: string }>;
}

export function FunctionGraph({ equation, rangeX, rangeY, width = 420, height = 320, points = [] }: FunctionGraphProps) {
  const fn = useMemo(() => parseFunctionEquation(equation), [equation]);
  const pad = 28;
  const xMin = rangeX[0], xMax = rangeX[1], yMin = rangeY[0], yMax = rangeY[1];
  const xSpan = xMax - xMin || 1, ySpan = yMax - yMin || 1;
  const plotWidth = width - 2 * pad, plotHeight = height - 2 * pad;

  const toSvgX = (x: number) => pad + ((x - xMin) / xSpan) * plotWidth;
  const toSvgY = (y: number) => pad + (1 - (y - yMin) / ySpan) * plotHeight;

  const approxStep = Math.max(xSpan, ySpan) / 8;
  const niceSteps = [0.25, 0.5, 1, 2, 5, 10];
  const gridStep = niceSteps.reduce((b, s) => Math.abs(s - approxStep) < Math.abs(b - approxStep) ? s : b, 1);

  const gridLines: React.ReactNode[] = [];
  for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax + 1e-9; x += gridStep) {
    if (Math.abs(x) > 1e-10) gridLines.push(<line key={`v${x}`} x1={toSvgX(x)} y1={pad} x2={toSvgX(x)} y2={height - pad} stroke="#e5e7eb" strokeWidth="0.5" />);
  }
  for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax + 1e-9; y += gridStep) {
    if (Math.abs(y) > 1e-10) gridLines.push(<line key={`h${y}`} x1={pad} y1={toSvgY(y)} x2={width - pad} y2={toSvgY(y)} stroke="#e5e7eb" strokeWidth="0.5" />);
  }

  const samples = 260;
  let d = "";
  let penDown = false;
  for (let i = 0; i <= samples; i++) {
    const x = xMin + (i / samples) * xSpan;
    const y = fn(x);
    const ok = Number.isFinite(y) && y >= yMin - ySpan * 0.25 && y <= yMax + ySpan * 0.25;
    if (!ok) { penDown = false; continue; }
    const sx = toSvgX(x).toFixed(2), sy = toSvgY(y).toFixed(2);
    d += penDown ? `L ${sx} ${sy} ` : `M ${sx} ${sy} `;
    penDown = true;
  }

  return (
    <div className="my-4 flex justify-center overflow-x-auto w-full">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-full">
        {gridLines}
        {xMin <= 0 && xMax >= 0 && <line x1={toSvgX(0)} y1={pad} x2={toSvgX(0)} y2={height - pad} stroke="#9ca3af" strokeWidth="1" />}
        {yMin <= 0 && yMax >= 0 && <line x1={pad} y1={toSvgY(0)} x2={width - pad} y2={toSvgY(0)} stroke="#9ca3af" strokeWidth="1" />}
        <path d={d} fill="none" stroke="#111827" strokeWidth="1.5" />
        {points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p, i) => (
          <g key={i}>
            <circle cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={3.2} fill="#111827" />
            {p.label && <text x={toSvgX(p.x) + 6} y={toSvgY(p.y) - 6} fontSize="12" fill="#111827">{p.label}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}
