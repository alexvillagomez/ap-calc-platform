"use client";

import { useState } from "react";
import { Star, Flag } from "lucide-react";

/**
 * Inline rating + flag widget for MCAT content (questions, flashcards, lessons).
 * Posts to /api/mcat/feedback. Ratings nudge selection; flags pull content.
 */
export default function FeedbackWidget({
  sessionId,
  contentType,
  contentId,
  className = "",
}: {
  sessionId: string;
  contentType: "question" | "flashcard" | "lesson";
  contentId: string;
  className?: string;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flagged, setFlagged] = useState(false);

  const send = (body: Record<string, unknown>) => {
    fetch("/api/mcat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        content_type: contentType,
        content_id: contentId,
        ...body,
      }),
    }).catch(() => {});
  };

  const handleRate = (value: number) => {
    setRating(value);
    send({ rating: value });
  };

  const handleFlag = () => {
    setFlagged(true);
    setFlagOpen(false);
    send({ flagged: true, flag_reason: flagReason.trim() || null });
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center gap-3 text-gray-400">
        <div className="flex items-center gap-0.5" aria-label="Rate this content">
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => handleRate(v)}
              onMouseEnter={() => setHover(v)}
              onMouseLeave={() => setHover(null)}
              className="p-0.5"
              aria-label={`Rate ${v} of 5`}
            >
              <Star
                className={`w-4 h-4 transition-colors ${
                  (hover ?? rating ?? 0) >= v
                    ? "fill-amber-400 text-amber-400"
                    : "text-gray-300"
                }`}
              />
            </button>
          ))}
        </div>
        {flagged ? (
          <span className="text-xs text-red-500">Reported — thanks</span>
        ) : (
          <button
            type="button"
            onClick={() => setFlagOpen((o) => !o)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            <Flag className="w-3.5 h-3.5" />
            Report issue
          </button>
        )}
        {rating !== null && (
          <span className="text-xs text-gray-400">Thanks!</span>
        )}
      </div>
      {flagOpen && !flagged && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
            placeholder="What's wrong? (optional)"
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-300"
          />
          <button
            type="button"
            onClick={handleFlag}
            className="text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1.5"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
