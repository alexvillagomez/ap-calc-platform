"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

export function Slider({ min, max, step = 1, value, onChange, className }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn("relative flex items-center w-full h-5", className)}>
      <div className="relative w-full h-1.5 rounded-full bg-muted overflow-visible">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
      />
      {/* Thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full border-2 border-primary bg-background shadow pointer-events-none"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}
