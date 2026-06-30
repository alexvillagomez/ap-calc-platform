"use client";

import MathText from "@/components/mcat/MathText";
import { RotateCcwIcon, XIcon, CheckIcon } from "./icons";
import type { Flashcard } from "../api";

interface FlashcardViewProps {
  card: Flashcard;
  /** Short topic chip shown above the card (current keyword label). */
  tag: string;
  flipped: boolean;
  onFlip: () => void;
  /** Grade + advance to the next item. */
  onGrade?: (result: "got_it" | "missed_it") => void;
  /** Read-only re-view of a past card (no grading). */
  readOnly?: boolean;
}

export function FlashcardView({ card, tag, flipped, onFlip, onGrade, readOnly = false }: FlashcardViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: "100%", maxWidth: 600 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontSize: 12.5, color: "#737373" }}>Flashcard · recall it, then grade yourself</span>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: "#4f46e5",
              background: "#eff6ff",
              border: "1px solid #dbeafe",
              padding: "4px 11px",
              borderRadius: 9999,
            }}
          >
            {tag}
          </span>
        </div>

        <button
          type="button"
          onClick={onFlip}
          style={{
            width: "100%",
            minHeight: 300,
            border: "1px solid #e5e5e5",
            borderRadius: 18,
            boxShadow: "0 2px 8px 0 rgba(59,130,246,.10)",
            background: "#fff",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: "44px 40px",
            textAlign: "center",
          }}
        >
          {!flipped ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", color: "#a3a3a3", animation: "ldFlip .3s ease" }}>
                TERM
              </div>
              <div className="ld-serif" style={{ fontSize: 28, lineHeight: 1.3, color: "#171717", animation: "ldFlip .3s ease" }}>
                <MathText>{card.front}</MathText>
              </div>
              <div style={{ fontSize: 12.5, color: "#a3a3a3", display: "flex", alignItems: "center", gap: 6 }}>
                <RotateCcwIcon size={14} />
                Tap to reveal
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", color: "#4f46e5", animation: "ldFlip .3s ease" }}>
                DEFINITION
              </div>
              <div
                className="ld-serif"
                style={{ fontSize: 20, lineHeight: 1.55, color: "#171717", maxWidth: 460, animation: "ldFlip .3s ease" }}
              >
                <MathText>{card.back}</MathText>
              </div>
            </>
          )}
        </button>

        {!readOnly && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 18 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => onGrade?.("missed_it")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 42,
                padding: "0 18px",
                border: "none",
                background: "#f43f5e",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 12,
                boxShadow: "0 2px 8px 0 rgba(244,63,94,.28)",
                cursor: "pointer",
              }}
            >
              <XIcon size={15} stroke="currentColor" strokeWidth={2.6} />
              Missed it
            </button>
            <button
              type="button"
              onClick={() => onGrade?.("got_it")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                height: 42,
                padding: "0 20px",
                border: "none",
                background: "#10b981",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 12,
                boxShadow: "0 2px 8px 0 rgba(16,185,129,.28)",
                cursor: "pointer",
              }}
            >
              <CheckIcon size={16} stroke="currentColor" strokeWidth={2.4} />
              Got it
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
