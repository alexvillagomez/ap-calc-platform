/**
 * LoderaLogo — geometric 4-point star (north-star / sparkle mark) + optional wordmark.
 * Single-file SVG, no external deps.
 * Crisp at 16px (icon-only) through 160px (full lockup).
 */

interface LoderaLogoProps {
  /** Total height in px. Width scales proportionally. */
  size?: number;
  /** Render the "Lodera" wordmark beside the mark. */
  withWordmark?: boolean;
  className?: string;
}

export function LoderaLogo({
  size = 32,
  withWordmark = false,
  className,
}: LoderaLogoProps) {
  // Mark is 24×24 logical units; wordmark adds ~72 units of width
  const markSize = 24;
  const gap = 7;
  const wordmarkWidth = 72;
  const totalWidth = withWordmark ? markSize + gap + wordmarkWidth : markSize;
  const totalHeight = markSize;

  // Scale factor so mark fills `size` height
  const scale = size / markSize;

  return (
    <svg
      width={totalWidth * scale}
      height={size}
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Lodera"
      role="img"
      className={className}
    >
      <defs>
        <linearGradient id="lodera-star-grad" x1="0" y1="0" x2="1" y2="1">
          {/* sky-400 → indigo-500 */}
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      {/*
        4-point sparkle / north-star mark.
        Built from 4 elongated diamond lobes meeting at center (12,12).
        The vertical axis is taller (primary), the horizontal axis slightly shorter.
        Each lobe is a quadratic-bezier diamond for a clean, tapered look.
      */}
      <path
        d={[
          /* top lobe */
          "M12 12 C11 9.5 10.2 5.5 12 1",
          "C13.8 5.5 13 9.5 12 12",
          /* right lobe */
          "M12 12 C14.5 13 18.5 13.8 23 12",
          "C18.5 10.2 14.5 11 12 12",
          /* bottom lobe */
          "M12 12 C13 14.5 13.8 18.5 12 23",
          "C10.2 18.5 11 14.5 12 12",
          /* left lobe */
          "M12 12 C9.5 11 5.5 10.2 1 12",
          "C5.5 13.8 9.5 13 12 12",
        ].join(" ")}
        fill="url(#lodera-star-grad)"
      />

      {/* Wordmark */}
      {withWordmark && (
        <text
          x={markSize + gap}
          y={17.5}
          fontFamily="-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif"
          fontSize={15}
          fontWeight="600"
          letterSpacing="-0.4"
          fill="currentColor"
        >
          Lodera
        </text>
      )}
    </svg>
  );
}

export default LoderaLogo;
