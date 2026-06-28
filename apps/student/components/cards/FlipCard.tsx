"use client";

/**
 * FlipCard — the ONE universal memorization flashcard UI used everywhere
 * (standalone flashcards, the flashcard-only stream, and the auto-mode flashcard
 * step). Tap the card to reveal the back, tap again to flip back. Once the back
 * has been seen, the grade buttons appear: Missed it / Got it / I didn't know this.
 *
 * Presentational + self-contained flip state; the parent owns sequencing and
 * passes `resetKey` (e.g. the card id) so flip state resets on each new card.
 */

import { useState, useEffect } from "react";
import MathText from "@/components/mcat/MathText";

export type FlipResult = "got_it" | "missed_it" | "dont_know";

interface FlipCardProps {
  front: string;
  back: string;
  onGrade: (result: FlipResult) => void;
  /** Changes per card so the flip state resets when the card changes. */
  resetKey: string | number;
}

export default function FlipCard({ front, back, onGrade, resetKey }: FlipCardProps) {
  const [cardPhase, setCardPhase] = useState<"front" | "back">("front");
  const [seenBack, setSeenBack] = useState(false);
  const [flipping, setFlipping] = useState(false);

  // Reset to the front face whenever the card changes.
  useEffect(() => {
    setCardPhase("front");
    setSeenBack(false);
    setFlipping(false);
  }, [resetKey]);

  const flip = () => {
    setFlipping(true);
    setTimeout(() => {
      setCardPhase((prev) => {
        const next = prev === "front" ? "back" : "front";
        if (next === "back") setSeenBack(true);
        return next;
      });
      setFlipping(false);
    }, 150);
  };

  return (
    <>
      <button
        type="button"
        onClick={flip}
        className={`w-full text-left bg-white rounded-2xl border-2 shadow-brand-sm p-6 min-h-[180px] flex flex-col justify-between transition-opacity duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
          flipping ? "opacity-0" : "opacity-100"
        } ${cardPhase === "front" ? "border-neutral-200" : "border-brand-300"}`}
      >
        {cardPhase === "front" ? (
          <div>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">Front</p>
            {/* div (not p): MathText may render a figure block (Molecule/graph/table). */}
            <div className="text-base font-medium text-neutral-900 leading-relaxed">
              <MathText>{front}</MathText>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs font-semibold text-brand-500 uppercase tracking-wide mb-3">Back</p>
            <div className="text-base text-neutral-800 leading-relaxed">
              <MathText>{back}</MathText>
            </div>
          </div>
        )}
        <p className="text-xs text-neutral-300 mt-4 text-right select-none">
          {cardPhase === "back" ? "tap to flip back" : "tap to flip"}
        </p>
      </button>

      {cardPhase === "front" && !seenBack && (
        <button
          onClick={flip}
          className="w-full py-3 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
        >
          Show answer
        </button>
      )}

      {seenBack && (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => onGrade("missed_it")}
              className="flex-1 py-3 rounded-xl bg-error-50 border border-error-200 text-error-700 text-sm font-semibold hover:bg-error-100 transition-colors"
            >
              Missed it
            </button>
            <button
              onClick={() => onGrade("got_it")}
              className="flex-1 py-3 rounded-xl bg-success-50 border border-success-200 text-success-700 text-sm font-semibold hover:bg-success-100 transition-colors"
            >
              Got it
            </button>
          </div>
          <div className="flex justify-center">
            <button
              onClick={() => onGrade("dont_know")}
              className="text-xs text-neutral-400 hover:text-neutral-600 underline"
            >
              I didn&apos;t know this
            </button>
          </div>
        </>
      )}
    </>
  );
}
