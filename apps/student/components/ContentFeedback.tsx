"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

type ContentType =
  | "problem"
  | "rag_example"
  | "learn_practice_problem"
  | "learn_diagnostic_problem"
  | "learn_mastery_quiz_problem"
  | "lesson"
  | "refresher";

type Props = {
  sessionId: string;
  contentType: ContentType;
  contentId: string;
  label?: string;
};

export function ContentFeedback({ sessionId, contentType, contentId, label = "Rate this" }: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [reported, setReported] = useState(false);
  const [savingRating, setSavingRating] = useState(false);
  const [savingReport, setSavingReport] = useState(false);

  async function submit(payload: { rating?: number; report?: boolean }) {
    if (!sessionId || !contentId) return;
    await fetch("/api/content-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, contentType, contentId, ...payload }),
    });
  }

  async function rate(stars: number) {
    setRating(stars);
    setSavingRating(true);
    try {
      await submit({ rating: stars });
    } finally {
      setSavingRating(false);
    }
  }

  async function report() {
    if (reported) return;
    setReported(true);
    setSavingReport(true);
    try {
      await submit({ report: true });
    } catch {
      setReported(false);
    } finally {
      setSavingReport(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex items-center gap-4 flex-wrap">
      <span className="text-sm text-gray-600">{label}:</span>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => rate(star)}
            disabled={savingRating}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            className={cn(
              "text-2xl transition-all hover:scale-110 leading-none disabled:opacity-60",
              rating != null && star <= rating ? "text-yellow-400" : "text-gray-200 hover:text-yellow-300"
            )}
          >
            ★
          </button>
        ))}
      </div>
      {rating && (
        <span className="text-xs text-gray-400">
          {["", "Poor", "Fair", "OK", "Good", "Excellent"][rating]}
        </span>
      )}
      <div className="ml-auto">
        <button
          type="button"
          onClick={report}
          disabled={reported || savingReport}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
            reported
              ? "bg-orange-50 border-orange-300 text-orange-600 cursor-default"
              : "border-gray-200 text-gray-400 hover:border-orange-300 hover:text-orange-500 hover:bg-orange-50"
          )}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2a.5.5 0 0 1 .5-.5h.535c.127 0 .25.05.34.14L4.5 2.75l.625-.11A8.4 8.4 0 0 1 6.5 2.5c1.2 0 2.1.3 3 .6.9.3 1.8.6 3 .6a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5c-1.2 0-2.1-.3-3-.6-.9-.3-1.8-.6-3-.6-.48 0-.93.04-1.375.11L4.5 8.75 3.375 7.64A.5.5 0 0 0 3 7.5H2.5V14a.5.5 0 0 1-1 0V2.5A.5.5 0 0 1 2 2z" />
          </svg>
          {reported ? "Reported" : "Report"}
        </button>
      </div>
    </div>
  );
}
