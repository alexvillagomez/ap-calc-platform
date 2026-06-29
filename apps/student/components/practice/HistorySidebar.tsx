"use client";

/**
 * HistorySidebar — desktop-only left rail that lists every answered item in
 * the current Custom Practice session. Most-recent-first. Clicking an entry
 * opens a read-only re-view modal (HistoryReviewModal).
 */

import React from "react";

// ── Minimal structural shapes ─────────────────────────────────────────────────
// These capture only the fields HistorySidebar/HistoryReviewModal actually use.
// Both math and MCAT page Question/Flashcard types satisfy these structurally
// (extra fields on the concrete types are fine — TypeScript allows them).
interface HistoryQuestion {
  id: string;
  stem: string;
  choices: string[];
  correct_index: number;
  explanation: string;
  keyword_weights: Record<string, number>;
  primary_keyword_id?: string | null;
}

interface HistoryFlashcard {
  id: string;
  front: string;
  back: string;
  keyword_weights: Record<string, number>;
}

export type HistoryEntry =
  | {
      uid: string;
      kind: "question";
      question: HistoryQuestion;
      selectedChoice: number | null;
      dontKnow: boolean;
      wasCorrect: boolean;
      keywordId: string | null;
    }
  | {
      uid: string;
      kind: "flashcard";
      card: HistoryFlashcard;
      gotIt: boolean;
      keywordId: string | null;
    };

interface HistorySidebarProps {
  entries: HistoryEntry[];
  onSelect: (e: HistoryEntry) => void;
}

function truncate(str: string, max: number): string {
  const cleaned = str.replace(/\$[^$]*\$/g, "[…]").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned;
}

export function HistorySidebar({ entries, onSelect }: HistorySidebarProps) {
  const reversed = [...entries].reverse();

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-brand-xs overflow-hidden">
      {/* Title */}
      <div className="px-3 py-2.5 border-b border-neutral-100">
        <p className="text-xs font-semibold text-neutral-600 uppercase tracking-wide">
          History
        </p>
      </div>

      {reversed.length === 0 ? (
        <p className="px-3 py-4 text-xs text-neutral-400 leading-relaxed">
          Answered items will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-50">
          {reversed.map((entry, i) => {
            const number = entries.length - i;

            // Color dot
            let dotCls = "bg-neutral-300"; // flashcard default
            let label = "";

            if (entry.kind === "question") {
              dotCls = entry.wasCorrect ? "bg-success-400" : "bg-error-400";
              label = truncate(entry.question.stem, 46);
            } else {
              // Flashcards are always neutral — only questions are red/green.
              dotCls = "bg-neutral-300";
              label = truncate(entry.card.front, 46);
            }

            return (
              <li key={entry.uid}>
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-neutral-50 transition-colors group"
                >
                  {/* Index */}
                  <span className="shrink-0 text-[10px] font-medium text-neutral-400 w-5 text-right pt-0.5">
                    {number}
                  </span>
                  {/* Status dot */}
                  <span
                    className={`shrink-0 w-2 h-2 rounded-full mt-1.5 ${dotCls}`}
                  />
                  {/* Label */}
                  <span className="flex-1 min-w-0 text-xs text-neutral-700 leading-snug group-hover:text-neutral-900 break-words">
                    {label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
