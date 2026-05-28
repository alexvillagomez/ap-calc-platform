"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

interface Props {
  sessionId: string;
  contentType: "lesson" | "refresher" | "tip";
  keywordId: string;
  label?: string;
}

type Vote = "helpful" | "not_helpful" | null;

export function FeedbackButtons({ sessionId, contentType, keywordId, label = "Was this helpful?" }: Props) {
  const [vote, setVote] = useState<Vote>(null);
  const [busy, setBusy] = useState(false);

  async function submit(helpful: boolean) {
    if (busy) return;
    const next: Vote = helpful ? "helpful" : "not_helpful";
    if (vote === next) return; // already voted this way
    setBusy(true);
    try {
      await fetch("/api/learn/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, content_type: contentType, keyword_id: keywordId, helpful }),
      });
      setVote(next);
    } catch {
      // non-critical
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400">{label}</span>
      <button
        onClick={() => submit(true)}
        disabled={busy}
        className={cn(
          "flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors",
          vote === "helpful"
            ? "bg-green-100 border-green-300 text-green-700"
            : "border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-600"
        )}
      >
        👍 Helpful
      </button>
      <button
        onClick={() => submit(false)}
        disabled={busy}
        className={cn(
          "flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors",
          vote === "not_helpful"
            ? "bg-red-100 border-red-300 text-red-700"
            : "border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-600"
        )}
      >
        👎 Not helpful
      </button>
    </div>
  );
}
