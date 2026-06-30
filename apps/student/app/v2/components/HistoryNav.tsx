"use client";

import type { CSSProperties, ReactNode } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "./icons";
import type { Outcome } from "../useMcatPractice";

/** Dot color by how the past item resolved. */
const DOT_COLOR: Record<Outcome, string> = {
  correct: "#10b981", // green
  wrong: "#f43f5e", // red
  skipped: "#d4d4d4", // gray
  neutral: "#c7d2fe", // lesson (indigo-200)
  pending: "#4f46e5", // current, not yet answered
};

interface HistoryNavProps {
  entries: { outcome: Outcome }[];
  /** Index currently being viewed (the elongated dot). */
  viewIndex: number;
  /** Jump to a past item by index. */
  onSelect: (i: number) => void;
  onPrev: () => void;
  canPrev: boolean;
  /** Right-side action cluster (Skip / Similar+Next / Next→), view-dependent. */
  right?: ReactNode;
}

/** Shared footer: ← Previous · colored navigable dots · right action cluster. */
export function HistoryNav({ entries, viewIndex, onSelect, onPrev, canPrev, right }: HistoryNavProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginTop: 24,
        width: "100%",
      }}
    >
      <button
        type="button"
        onClick={onPrev}
        disabled={!canPrev}
        style={{ ...prevBtn, opacity: canPrev ? 1 : 0.4, cursor: canPrev ? "pointer" : "default" }}
      >
        <ArrowLeftIcon size={16} />
        Previous
      </button>

      <div className="ld-dots" style={dotsWrap}>
        {entries.map((e, i) => {
          const current = i === viewIndex;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              title={`Item ${i + 1}`}
              aria-label={`Go to item ${i + 1}`}
              style={{
                flexShrink: 0,
                width: current ? 22 : 8,
                height: 8,
                borderRadius: 9999,
                border: "none",
                padding: 0,
                cursor: "pointer",
                background: DOT_COLOR[e.outcome],
                opacity: current ? 1 : 0.65,
                transition: "width .15s ease",
              }}
            />
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{right}</div>
    </div>
  );
}

/** Blue "Next →" used to move FORWARD through history (re-viewing past items). */
export function ForwardButton({ onClick, label = "Next" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} style={blueNextBtn}>
      {label}
      <ArrowRightIcon size={17} />
    </button>
  );
}

const prevBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 40,
  padding: "0 16px",
  border: "none",
  background: "transparent",
  color: "#4f46e5",
  fontSize: 13.5,
  fontWeight: 600,
  borderRadius: 12,
  flexShrink: 0,
};

const dotsWrap: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  overflowX: "auto",
  maxWidth: 200,
  padding: "6px 2px",
  scrollbarWidth: "none",
};

const blueNextBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 44,
  padding: "0 22px",
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 14,
  boxShadow: "0 2px 8px 0 rgba(59,130,246,.30)",
  cursor: "pointer",
};
