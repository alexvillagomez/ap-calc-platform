"use client";

import type { CSSProperties } from "react";
import { ChevronsRightIcon, ChevronsLeftIcon, BookIcon, LightbulbIcon, StarIcon, FlagIcon, CheckIcon } from "./icons";
import type { StudyView } from "../page";
import type { SearchResult } from "../api";

interface RelatedCard {
  keywordId: string | null;
  eyebrow: string;
  title: string;
  current?: boolean;
}

interface RightPanelProps {
  open: boolean;
  onToggle: () => void;
  /** Open-panel width (px) — driven by the draggable resize handle. */
  width: number;
  view: StudyView;
  /** Current keyword (the active item) + related topics from search. */
  currentLabel: string | null;
  currentKeywordId: string | null;
  related: SearchResult[];
  prioritized: boolean;
  onTogglePriority: () => void;
  rate: number;
  onRate: (n: number) => void;
  reported: boolean;
  onToggleReport: () => void;
  /** Open the lesson modal for a keyword (defaults to the current one). */
  onOpenLesson: (keywordId: string | null) => void;
  /** Open the refresher modal for a keyword (defaults to the current one). */
  onOpenRefresher: (keywordId: string | null) => void;
}

const HEADINGS: Record<StudyView, string> = {
  questions: "LESSONS FOR THIS QUESTION",
  flashcards: "LESSONS FOR THIS FLASHCARD",
  lessons: "RELATED TOPICS",
};

export function RightPanel(props: RightPanelProps) {
  const {
    open,
    onToggle,
    width,
    view,
    currentLabel,
    currentKeywordId,
    related,
    prioritized,
    onTogglePriority,
    rate,
    onRate,
    reported,
    onToggleReport,
    onOpenLesson,
    onOpenRefresher,
  } = props;

  // Build the card list: current keyword first, then related topics.
  const cards: RelatedCard[] = [];
  if (currentLabel) {
    cards.push({
      keywordId: currentKeywordId,
      eyebrow: "CURRENT TOPIC",
      title: currentLabel,
      current: true,
    });
  }
  for (const r of related) {
    cards.push({ keywordId: r.keyword_id, eyebrow: "RELATED", title: r.label });
  }

  if (!open) {
    return (
      <aside
        style={{
          width: 58,
          flexShrink: 0,
          borderLeft: "1px solid #e5e5e5",
          padding: "16px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          background: "#fafafa",
        }}
      >
        <button type="button" onClick={onToggle} className="ld-railicon" title="Show panel" style={railBtn}>
          <ChevronsLeftIcon size={19} />
        </button>
        <div style={{ width: 26, height: 1, background: "#e5e5e5", margin: "4px 0" }} />
        <div
          className="ld-railicon"
          style={{ ...railBtn, color: "#4f46e5", cursor: "pointer" }}
          title="Open lesson"
          onClick={() => onOpenLesson(currentKeywordId)}
        >
          <BookIcon size={18} />
        </div>
        <div
          className="ld-railicon"
          style={{ ...railBtn, cursor: "pointer" }}
          title="Refresher"
          onClick={() => onOpenRefresher(currentKeywordId)}
        >
          <LightbulbIcon size={18} />
        </div>
      </aside>
    );
  }

  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        borderLeft: "1px solid #e5e5e5",
        padding: "18px 18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 13,
        background: "#fff",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".07em", color: "#a3a3a3" }}>{HEADINGS[view]}</div>
        <button
          type="button"
          onClick={onToggle}
          className="ld-iconbtn"
          title="Hide panel"
          style={{
            border: "1px solid #e5e5e5",
            background: "#fff",
            color: "#737373",
            width: 30,
            height: 30,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <ChevronsRightIcon size={17} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {cards.length === 0 && (
          <div style={{ fontSize: 12.5, color: "#a3a3a3", padding: "8px 2px" }}>Loading topics…</div>
        )}
        {cards.map((card, i) => (
          <div
            key={`${card.keywordId ?? "x"}-${i}`}
            style={
              card.current
                ? { border: "1.5px solid #bfdbfe", background: "#f5f9ff", borderRadius: 13, padding: "11px 12px" }
                : { border: "1px solid #e8e8e8", background: "#fff", borderRadius: 13, padding: "11px 12px" }
            }
          >
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".06em",
                color: card.current ? "#4f46e5" : "#a3a3a3",
                marginBottom: 2,
              }}
            >
              {card.eyebrow}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#171717", lineHeight: 1.25, marginBottom: 9 }}>
              {card.title}
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <button
                type="button"
                onClick={() => onOpenLesson(card.keywordId)}
                style={
                  card.current
                    ? { ...miniBtn, border: "none", background: "#3b82f6", color: "#fff" }
                    : { ...miniBtn, border: "1px solid #d8def0", background: "#fff", color: "#4f46e5" }
                }
              >
                <BookIcon size={14} stroke="currentColor" />
                Lesson
              </button>
              <button
                type="button"
                onClick={() => onOpenRefresher(card.keywordId)}
                style={{ ...miniBtn, border: "1px solid #e5e5e5", background: "#fff", color: "#525252" }}
              >
                <LightbulbIcon size={14} stroke="currentColor" />
                Refresher
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Prioritize this topic */}
      {currentKeywordId && (
        <button
          type="button"
          onClick={onTogglePriority}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            height: 36,
            border: prioritized ? "1px solid #c7d2fe" : "1px solid #e5e5e5",
            background: prioritized ? "#eef2ff" : "#fff",
            color: prioritized ? "#4338ca" : "#525252",
            fontSize: 12.5,
            fontWeight: 600,
            borderRadius: 11,
            cursor: "pointer",
          }}
        >
          <StarIcon size={15} filled={prioritized} />
          {prioritized ? "Prioritized" : "Prioritize this topic"}
        </button>
      )}

      {/* pinned bottom */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ height: 1, background: "#f0f0f0" }} />
        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onRate(n)}
              title="Rate this problem"
              style={{ border: "none", background: "transparent", padding: 1, cursor: "pointer", display: "flex" }}
            >
              <StarIcon size={22} filled={n <= rate} />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggleReport}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            height: 38,
            border: reported ? "1px solid #a7f3d0" : "1px solid #e5e5e5",
            background: reported ? "#ecfdf5" : "#fff",
            color: reported ? "#047857" : "#525252",
            fontSize: 12.5,
            fontWeight: 600,
            borderRadius: 11,
            cursor: "pointer",
          }}
        >
          {reported ? (
            <CheckIcon size={15} stroke="#047857" strokeWidth={2.4} />
          ) : (
            <FlagIcon size={15} stroke="#e11d48" />
          )}
          {reported ? "Reported — thanks!" : "Report a problem"}
        </button>
      </div>
    </aside>
  );
}

const railBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#737373",
  width: 38,
  height: 38,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const miniBtn: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  height: 32,
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 9,
  cursor: "pointer",
};
