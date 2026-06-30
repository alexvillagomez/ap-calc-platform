"use client";

import { useEffect, useState, type CSSProperties } from "react";
import MathText from "@/components/mcat/MathText";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, XIcon } from "./icons";
import type { McatMicroStep } from "../api";

interface LessonViewProps {
  steps: McatMicroStep[];
  /** Eyebrow (keyword label, uppercased). */
  eyebrow: string;
  /** Per-step short title; defaults to "Step n" when none derivable. */
  title: string;
  step: number; // 1-based
  loading: boolean;
  onBack: () => void;
  onNext: () => void;
  onTryQuestion: () => void;
  /** Read-only re-view of a past lesson (no advance-to-practice). */
  readOnly?: boolean;
}

/** Inline lesson surface rendered centered in the workspace. */
export function LessonView({ steps, eyebrow, title, step, loading, onBack, onNext, onTryQuestion, readOnly = false }: LessonViewProps) {
  const total = Math.max(1, steps.length);
  const data = steps[step - 1];
  const isLast = step >= total;

  // In-lesson understanding-check for THIS page — a comprehension quiz shipped
  // inside the lesson (NOT the generation pipeline). "Try a question" opens it;
  // a wrong answer returns you to the page to re-read.
  const check = data?.check_question;
  const hasCheck = !!(data?.has_check && check && check.choices?.length === 4);
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkChoice, setCheckChoice] = useState<number | null>(null);
  const checkRevealed = checkChoice !== null;
  const checkCorrect = checkRevealed && checkChoice === check?.correct_index;
  useEffect(() => {
    setCheckOpen(false);
    setCheckChoice(null);
  }, [step, eyebrow]);

  function closeCheck() {
    setCheckOpen(false);
    setCheckChoice(null);
  }
  function continueFromCheck() {
    closeCheck();
    if (isLast) onTryQuestion();
    else onNext();
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 760,
        alignSelf: "center",
        background: "#fff",
        border: "1px solid #e5e5e5",
        borderRadius: 18,
        boxShadow: "0 2px 8px 0 rgba(59,130,246,.10)",
        padding: "26px 34px",
      }}
    >
      <LessonHeader eyebrow={eyebrow} title={title} />
      <LessonProgress step={step} total={total} />
      {loading || !data ? (
        <LessonSkeleton />
      ) : (
        <>
          <div className="ld-serif" style={{ fontSize: 16, lineHeight: 1.65, color: "#171717" }}>
            <MathText>{data.explanation_latex}</MathText>
          </div>
          {data.example_latex ? <LessonExample example={data.example_latex} /> : null}
        </>
      )}

      {/* In-lesson quiz check (only on pages that carry one) */}
      {hasCheck && !checkOpen && (
        <button type="button" onClick={() => setCheckOpen(true)} style={tryBtn}>
          Try a question
        </button>
      )}
      {hasCheck && checkOpen && check && (
        <div style={checkBox}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".07em", color: "#4f46e5", marginBottom: 10 }}>
            CHECK YOUR UNDERSTANDING
          </div>
          <div className="ld-serif" style={{ fontSize: 15.5, lineHeight: 1.55, color: "#171717", marginBottom: 14 }}>
            <MathText>{check.latex_content}</MathText>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {check.choices.map((c, i) => {
              const chosen = checkChoice === i;
              const showCorrect = checkRevealed && i === check.correct_index;
              const showWrong = checkRevealed && chosen && i !== check.correct_index;
              let rowStyle: CSSProperties = { ...checkChoiceRow };
              if (showCorrect) rowStyle = { ...rowStyle, border: "1px solid #10b981", background: "#ecfdf5" };
              else if (showWrong) rowStyle = { ...rowStyle, border: "1px solid #f43f5e", background: "#fff1f2" };
              else if (checkRevealed) rowStyle = { ...rowStyle, opacity: 0.5 };
              return (
                <button key={i} type="button" disabled={checkRevealed} onClick={() => setCheckChoice(i)} style={rowStyle}>
                  <span style={checkBadge}>{String.fromCharCode(65 + i)}</span>
                  <span className="ld-serif" style={{ flex: 1, fontSize: 15, color: "#171717" }}>
                    <MathText>{c}</MathText>
                  </span>
                  {showCorrect && <CheckIcon size={18} stroke="#10b981" />}
                  {showWrong && <XIcon size={18} stroke="#f43f5e" />}
                </button>
              );
            })}
          </div>

          {checkRevealed && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: checkCorrect ? "#047857" : "#be123c", marginBottom: 6 }}>
                {checkCorrect ? "Correct!" : "Not quite — give the page another read."}
              </div>
              {check.solution_latex ? (
                <div className="ld-serif" style={{ fontSize: 14.5, lineHeight: 1.6, color: "#404040", marginBottom: 14 }}>
                  <MathText>{check.solution_latex}</MathText>
                </div>
              ) : null}
              {checkCorrect ? (
                <button type="button" onClick={continueFromCheck} style={nextBtn}>
                  {isLast ? "Finish" : "Continue"}
                  <ArrowRightIcon size={16} />
                </button>
              ) : (
                <button type="button" onClick={closeCheck} style={backBtn}>
                  <ArrowLeftIcon size={16} />
                  Review the page
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
        <button type="button" onClick={onBack} disabled={step <= 1} style={{ ...backBtn, opacity: step <= 1 ? 0.45 : 1 }}>
          <ArrowLeftIcon size={16} />
          Back
        </button>
        {isLast ? (
          readOnly ? (
            <span />
          ) : (
            <button type="button" onClick={onTryQuestion} style={finishBtn}>
              Finish
              <CheckIcon size={16} stroke="currentColor" strokeWidth={2.4} />
            </button>
          )
        ) : (
          <button type="button" onClick={onNext} style={nextBtn}>
            Next
            <ArrowRightIcon size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

const checkBox: CSSProperties = {
  marginTop: 20,
  border: "1px solid #dbeafe",
  background: "#f8faff",
  borderRadius: 14,
  padding: "18px 20px",
};

const checkChoiceRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  padding: "11px 14px",
  border: "1px solid #e5e5e5",
  background: "#fff",
  borderRadius: 12,
  textAlign: "left",
  cursor: "pointer",
};

const checkBadge: CSSProperties = {
  flexShrink: 0,
  width: 26,
  height: 26,
  borderRadius: 9999,
  border: "2px solid #d4d4d4",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 700,
  color: "#737373",
};

export function LessonHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".07em", color: "#4f46e5" }}>{eyebrow}</span>
      <span style={{ color: "#d4d4d4", fontSize: 12 }}>·</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#525252" }}>{title}</span>
    </div>
  );
}

export function LessonProgress({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
      <div style={{ flex: 1, height: 4, borderRadius: 9999, background: "#f0f0f0", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${(step / total) * 100}%`,
            borderRadius: 9999,
            background: "linear-gradient(to right,#60a5fa,#4f46e5)",
          }}
        />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#a3a3a3", whiteSpace: "nowrap" }}>
        {step} / {total}
      </span>
    </div>
  );
}

export function LessonExample({ example }: { example: string }) {
  return (
    <div style={{ marginTop: 18, border: "1px solid #dbeafe", background: "#f5f9ff", borderRadius: 13, padding: "15px 17px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".07em", color: "#4f46e5", marginBottom: 7 }}>EXAMPLE</div>
      <div className="ld-serif" style={{ fontSize: 15.5, lineHeight: 1.6, color: "#1e293b" }}>
        <MathText>{example}</MathText>
      </div>
    </div>
  );
}

/** On-brand skeleton shown while a lesson generates (can take a few seconds). */
export function LessonSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: "6px 0 4px" }}>
      {[100, 96, 88, 70].map((w, i) => (
        <div
          key={i}
          style={{
            height: 13,
            width: `${w}%`,
            borderRadius: 6,
            background: "linear-gradient(90deg,#f1f1f1,#e8e8e8,#f1f1f1)",
            backgroundSize: "200% 100%",
            animation: "ldShimmer 1.3s ease infinite",
          }}
        />
      ))}
    </div>
  );
}

const tryBtn = {
  marginTop: 20,
  display: "flex" as const,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  gap: 8,
  width: "100%",
  height: 46,
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 13,
  boxShadow: "0 2px 8px 0 rgba(59,130,246,.28)",
  cursor: "pointer" as const,
};

const backBtn = {
  display: "inline-flex" as const,
  alignItems: "center" as const,
  gap: 7,
  height: 42,
  padding: "0 16px",
  border: "1px solid #e5e5e5",
  background: "#fff",
  color: "#525252",
  fontSize: 13.5,
  fontWeight: 600,
  borderRadius: 12,
  cursor: "pointer" as const,
};

const nextBtn = {
  display: "inline-flex" as const,
  alignItems: "center" as const,
  gap: 8,
  height: 42,
  padding: "0 20px",
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 12,
  boxShadow: "0 2px 8px 0 rgba(59,130,246,.28)",
  cursor: "pointer" as const,
};

const finishBtn = {
  display: "inline-flex" as const,
  alignItems: "center" as const,
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
  cursor: "pointer" as const,
};
