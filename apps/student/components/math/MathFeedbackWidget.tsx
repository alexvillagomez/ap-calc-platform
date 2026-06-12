"use client";

import { useState } from "react";

/**
 * Math feedback widget — posts to /api/math/feedback.
 * Mirrors FeedbackWidget but against math_* tables.
 */
export default function MathFeedbackWidget({
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
    fetch("/api/math/feedback", {
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
      <div className="flex items-center gap-3 text-neutral-400">
        {/* Star rating */}
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
              <svg
                className={`w-4 h-4 transition-colors ${
                  (hover ?? rating ?? 0) >= v
                    ? "fill-amber-400 text-amber-400"
                    : "text-neutral-300"
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
          ))}
        </div>
        {flagged ? (
          <span className="text-xs text-error-500">Reported — thanks</span>
        ) : (
          <button
            type="button"
            onClick={() => setFlagOpen((o) => !o)}
            className="flex items-center gap-1 text-xs text-neutral-400 hover:text-error-500 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 21l7-7m0 0L4 8l6 2 4-5 4 5 6-2-6 6z" />
            </svg>
            Report issue
          </button>
        )}
        {rating !== null && (
          <span className="text-xs text-neutral-400">Thanks!</span>
        )}
      </div>
      {flagOpen && !flagged && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
            placeholder="What's wrong? (optional)"
            className="flex-1 text-xs border border-neutral-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-error-300"
          />
          <button
            type="button"
            onClick={handleFlag}
            className="text-xs font-medium text-error-600 hover:text-error-700 px-2 py-1.5"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
