"use client";

/**
 * CorrectPulse — wraps children with a correct-answer animation:
 *   1. Scale-pop + soft green glow ring on the wrapped element
 *   2. 3 star-sparkle particles that fly outward
 *
 * Usage:
 *   <CorrectPulse trigger={isCorrect}>
 *     <ChoiceButton … />
 *   </CorrectPulse>
 *
 * The animation re-triggers whenever `trigger` flips to true.
 * Star particles use the Lodera 4-point SVG path, no canvas/deps.
 */
import { useEffect, useRef, useState, ReactNode } from "react";
import { cn } from "@/lib/cn";

// 4-point sparkle path (same geometry as LoderaLogo, scaled to 8×8 viewport)
const STAR_PATH = "M4 4 C3.67 3.17 3.4 1.83 4 0 C4.6 1.83 4.33 3.17 4 4 M4 4 C4.83 4.33 6.17 4.6 8 4 C6.17 3.4 4.83 3.67 4 4 M4 4 C4.33 4.83 4.6 6.17 4 8 C3.4 6.17 3.67 4.83 4 4 M4 4 C3.17 3.67 1.83 3.4 0 4 C1.83 4.6 3.17 4.33 4 4";

// Three particles: directions in (tx, ty) as px offsets
const PARTICLES: Array<{ tx: string; ty: string; color: string; delay: string }> = [
  { tx: "-14px", ty: "-16px", color: "#10b981", delay: "0ms"   },
  { tx:  "16px", ty: "-10px", color: "#3b82f6", delay: "40ms"  },
  { tx:   "2px", ty:  "18px", color: "#6366f1", delay: "20ms"  },
];

interface CorrectPulseProps {
  /** When this flips to true, the animation fires. */
  trigger: boolean;
  children: ReactNode;
  className?: string;
}

export function CorrectPulse({ trigger, children, className }: CorrectPulseProps) {
  const [animKey, setAnimKey] = useState(0);
  const prevTrigger = useRef(false);

  useEffect(() => {
    if (trigger && !prevTrigger.current) {
      setAnimKey((k) => k + 1);
    }
    prevTrigger.current = trigger;
  }, [trigger]);

  const isAnimating = trigger && animKey > 0;

  return (
    <div className={cn("relative inline-block", className)}>
      {/* Wrapped element with pop animation */}
      <div
        key={isAnimating ? `pop-${animKey}` : "idle"}
        className={cn(isAnimating && "lodera-correct-pop")}
      >
        {children}
      </div>

      {/* Sparkle particles */}
      {isAnimating &&
        PARTICLES.map((p, i) => (
          <svg
            key={`${animKey}-${i}`}
            className="lodera-sparkle"
            style={
              {
                "--tx": p.tx,
                "--ty": p.ty,
                animationDelay: p.delay,
                top: "50%",
                left: "50%",
                marginTop: "-4px",
                marginLeft: "-4px",
              } as React.CSSProperties
            }
            viewBox="0 0 8 8"
            fill={p.color}
            aria-hidden="true"
          >
            <path d={STAR_PATH} />
          </svg>
        ))}
    </div>
  );
}

export default CorrectPulse;
