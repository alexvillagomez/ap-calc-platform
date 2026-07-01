/**
 * /v2 — inline SVG icons + Lodera logo, lifted verbatim from the design source.
 *
 * All glyphs are 24×24 viewBox, `currentColor` stroke (unless a fixed color is
 * required by the design), 2px stroke, round caps/joins — Lucide-equivalent.
 */
import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Override stroke color (defaults to currentColor). */
  stroke?: string;
  strokeWidth?: number;
}

function base(size: number, stroke?: string, strokeWidth = 2) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: stroke ?? "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function LoderaLogo({ width = 120, height = 28 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 103 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Lodera">
      <defs>
        <linearGradient id="ld-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <path
        d="M12 12 C11 9.5 10.2 5.5 12 1 C13.8 5.5 13 9.5 12 12 M12 12 C14.5 13 18.5 13.8 23 12 C18.5 10.2 14.5 11 12 12 M12 12 C13 14.5 13.8 18.5 12 23 C10.2 18.5 11 14.5 12 12 M12 12 C9.5 11 5.5 10.2 1 12 C5.5 13.8 9.5 13 12 12"
        fill="url(#ld-logo-grad)"
      />
      <text
        x="31"
        y="17.5"
        fontFamily="-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',system-ui,sans-serif"
        fontSize="15"
        fontWeight="600"
        letterSpacing="-0.4"
        fill="#171717"
      >
        Lodera
      </text>
    </svg>
  );
}

export function BarChartIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} aria-hidden>
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="10" />
    </svg>
  );
}

export function SearchIcon({ size = 15, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function ChevronsLeftIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} aria-hidden>
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  );
}

export function ChevronsRightIcon({ size = 19, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} aria-hidden>
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 15, className, style, stroke }: IconProps) {
  return (
    <svg {...base(size, stroke)} className={className} style={style} aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 15, className, style, stroke }: IconProps) {
  return (
    <svg {...base(size, stroke)} className={className} style={style} aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function CheckIcon({ size = 20, className, style, stroke, strokeWidth = 2.4 }: IconProps) {
  return (
    <svg {...base(size, stroke, strokeWidth)} className={className} style={style} aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function XIcon({ size = 20, className, style, stroke, strokeWidth = 2.4 }: IconProps) {
  return (
    <svg {...base(size, stroke, strokeWidth)} className={className} style={style} aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function LightbulbIcon({ size = 17, className, style, stroke }: IconProps) {
  return (
    <svg {...base(size, stroke)} className={className} style={style} aria-hidden>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z" />
    </svg>
  );
}

export function BookIcon({ size = 17, className, style, stroke }: IconProps) {
  return (
    <svg {...base(size, stroke)} className={className} style={style} aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export function EyeIcon({ size = 17, className, style, stroke }: IconProps) {
  return (
    <svg {...base(size, stroke)} className={className} style={style} aria-hidden>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} aria-hidden>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 17, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export function RotateCcwIcon({ size = 14, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} aria-hidden>
      <path d="M3 12a9 9 0 1 0 9-9" />
      <polyline points="3 3 3 9 9 9" />
    </svg>
  );
}

export function StarIcon({ size = 22, filled, className, style }: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "#4f46e5" : "none"}
      stroke={filled ? "#4f46e5" : "#d4d4d4"}
      strokeWidth={filled ? 1.5 : 1.8}
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function FlagIcon({ size = 15, className, style, stroke }: IconProps) {
  return (
    <svg {...base(size, stroke)} className={className} style={style} aria-hidden>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

export function GridIcon({ size = 16, className, style, stroke }: IconProps) {
  return (
    <svg {...base(size, stroke)} className={className} style={style} aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function UserIcon({ size = 16, className, style, stroke }: IconProps) {
  return (
    <svg {...base(size, stroke)} className={className} style={style} aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function SettingsIcon({ size = 16, className, style, stroke }: IconProps) {
  return (
    <svg {...base(size, stroke)} className={className} style={style} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function LogOutIcon({ size = 16, className, style, stroke }: IconProps) {
  return (
    <svg {...base(size, stroke)} className={className} style={style} aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function HelpCircleIcon({ size = 19, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
