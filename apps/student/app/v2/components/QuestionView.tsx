"use client";

import type { CSSProperties } from "react";
import MathText from "@/components/mcat/MathText";
import { CheckIcon, XIcon, ArrowRightIcon, RotateCcwIcon } from "./icons";
import { HistoryNav, ForwardButton } from "./HistoryNav";
import type { Question } from "../api";
import type { Outcome } from "../useMcatPractice";

interface QuestionViewProps {
  question: Question;
  /** Index of the chosen answer (0-based), or null before answering. */
  selectedChoice: number | null;
  /** Correct index, revealed after answering. */
  revealCorrect: number | null;
  dontKnow: boolean;
  /** True once answered (choice picked, skipped, or revealed). */
  answered: boolean;
  explanation: string;
  onPick: (index: number) => void;
  /** Generate a similar question (answered frontier only). */
  onSimilar: () => void;
  /** Skip without answering (unanswered frontier only). */
  onSkip: () => void;
  /** Serve the next NEW item (answered frontier). */
  onNext: () => void;
  /** Move forward through history (when re-viewing a past item). */
  onForward: () => void;
  /** True when this is the live frontier item (vs a read-only past item). */
  atFrontier: boolean;
  // History dots
  entries: { outcome: Outcome }[];
  viewIndex: number;
  onSelectDot: (i: number) => void;
  onPrev: () => void;
  canPrev: boolean;
}

export function QuestionView(props: QuestionViewProps) {
  const {
    question,
    selectedChoice,
    revealCorrect,
    dontKnow,
    answered,
    explanation,
    onPick,
    onSimilar,
    onSkip,
    onNext,
    onForward,
    atFrontier,
    entries,
    viewIndex,
    onSelectDot,
    onPrev,
    canPrev,
  } = props;
  const correctIdx = revealCorrect;
  const isCorrect = answered && !dontKnow && selectedChoice === correctIdx;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e5e5",
        borderRadius: 18,
        boxShadow: "0 2px 8px 0 rgba(59,130,246,.10)",
        padding: "32px 38px",
      }}
    >
      <h2
        className="ld-serif"
        style={{ margin: "0 0 26px", fontSize: 17, lineHeight: 1.5, fontWeight: 400, color: "#000", textWrap: "pretty" }}
      >
        <MathText>{question.stem}</MathText>
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {question.choices.map((choiceText, i) => {
          const badge = String.fromCharCode(65 + i); // A, B, C, D…
          const chosen = selectedChoice === i;
          const showAsCorrect = answered && correctIdx === i;
          const showAsWrong = answered && chosen && !dontKnow && correctIdx !== i;
          const dimmed = answered && !showAsCorrect && !showAsWrong;
          const celebrate = showAsCorrect && chosen && !dontKnow;

          let rowStyle: CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: 13,
            padding: "14px 17px",
            borderRadius: 14,
            border: "1px solid #e5e5e5",
            background: "#fff",
            width: "100%",
            textAlign: "left",
            cursor: answered ? "default" : "pointer",
          };
          let badgeStyle: CSSProperties = {
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: 9999,
            border: "2px solid #d4d4d4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            color: "#737373",
          };
          let textStyle: CSSProperties = { flex: 1, fontSize: 16, color: "#171717" };

          if (showAsCorrect) {
            rowStyle = { ...rowStyle, border: "1px solid #10b981", background: "#ecfdf5" };
            badgeStyle = { ...badgeStyle, background: "#10b981", border: "2px solid #10b981", color: "#fff" };
            textStyle = { ...textStyle, color: "#065f46", fontWeight: 500 };
          } else if (showAsWrong) {
            rowStyle = { ...rowStyle, border: "1px solid #f43f5e", background: "#fff1f2" };
            badgeStyle = { ...badgeStyle, background: "#f43f5e", border: "2px solid #f43f5e", color: "#fff" };
            textStyle = { ...textStyle, color: "#9f1239", fontWeight: 500 };
          } else if (dimmed) {
            rowStyle = { ...rowStyle, opacity: 0.45 };
          }

          if (celebrate) {
            rowStyle = { ...rowStyle, animation: "ldPop .5s ease, ldGlow .85s ease" };
          }

          return (
            <button
              key={i}
              type="button"
              className="ld-choice"
              onClick={() => !answered && onPick(i)}
              disabled={answered}
              style={rowStyle}
            >
              <span style={badgeStyle}>{badge}</span>
              <span className="ld-serif" style={textStyle}>
                <MathText>{choiceText}</MathText>
              </span>
              {showAsCorrect && <CheckIcon size={20} stroke="#10b981" />}
              {showAsWrong && <XIcon size={20} stroke="#f43f5e" />}
            </button>
          );
        })}
      </div>

      {/* Explanation */}
      {answered && (
        <div
          style={{
            marginTop: 18,
            borderRadius: 14,
            padding: "16px 18px",
            display: "flex",
            gap: 13,
            ...(isCorrect
              ? { border: "1px solid #a7f3d0", background: "#ecfdf5" }
              : { border: "1px solid #fecdd3", background: "#fff1f2" }),
          }}
        >
          <div
            style={{
              flexShrink: 0,
              width: 26,
              height: 26,
              borderRadius: 9999,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isCorrect ? "#10b981" : "#f43f5e",
            }}
          >
            {isCorrect ? <CheckIcon size={14} stroke="currentColor" strokeWidth={3} /> : <XIcon size={13} stroke="currentColor" strokeWidth={3} />}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: isCorrect ? "#047857" : "#be123c" }}>
              {isCorrect ? "Correct!" : dontKnow ? "Here's the answer" : "Not quite"}
            </div>
            <div className="ld-serif" style={{ fontSize: 17, lineHeight: 1.5, color: "#404040" }}>
              <MathText>{explanation}</MathText>
            </div>
          </div>
        </div>
      )}

      {/* Footer: ← Previous · history dots · right action cluster */}
      <HistoryNav
        entries={entries}
        viewIndex={viewIndex}
        onSelect={onSelectDot}
        onPrev={onPrev}
        canPrev={canPrev}
        right={
          !atFrontier ? (
            // Re-viewing a past item → move forward through history.
            <ForwardButton onClick={onForward} />
          ) : !answered ? (
            // Live, unanswered → Skip (gray).
            <button type="button" onClick={onSkip} style={skipBtn}>
              Skip
              <ArrowRightIcon size={17} />
            </button>
          ) : (
            // Live, answered → yellow "See similar" + blue "Next question".
            <>
              <button type="button" onClick={onSimilar} style={similarBtn}>
                <RotateCcwIcon size={15} stroke="currentColor" />
                See similar question
              </button>
              <button type="button" onClick={onNext} style={nextBtn}>
                Next question
                <ArrowRightIcon size={17} />
              </button>
            </>
          )
        }
      />
    </div>
  );
}

// Live, unanswered → gray "Skip".
const skipBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 44,
  padding: "0 22px",
  border: "1px solid #e5e5e5",
  background: "#f5f5f5",
  color: "#737373",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 14,
  cursor: "pointer",
};

// Live, answered → yellow "See similar question".
const similarBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 44,
  padding: "0 16px",
  border: "none",
  background: "#f59e0b",
  color: "#fff",
  fontSize: 13.5,
  fontWeight: 600,
  borderRadius: 14,
  boxShadow: "0 2px 8px 0 rgba(245,158,11,.30)",
  cursor: "pointer",
};

// Live, answered → blue "Next question".
const nextBtn: CSSProperties = {
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
