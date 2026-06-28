"use client";

/**
 * GeneratingLoader — a friendly, ALIVE loading state for cold content generation
 * (questions / lessons / flashcards can take 5–30s on a cold cache). Instead of a
 * dead spinner, it rotates encouraging status lines and shows an indeterminate
 * shimmer bar so the wait never reads as "frozen". After a long wait it surfaces a
 * gentle reassurance so the student knows it's still working, not broken.
 */
import { useEffect, useState } from "react";

interface GeneratingLoaderProps {
  /** Rotating status lines. First is shown immediately. */
  messages?: string[];
  /** Optional fixed sub-line under the messages. */
  subline?: string;
}

const DEFAULT_MESSAGES = [
  "Building your next question…",
  "Tailoring it to where you are…",
  "Picking the right challenge…",
  "Almost there…",
];

export function GeneratingLoader({ messages, subline }: GeneratingLoaderProps) {
  const lines = messages && messages.length > 0 ? messages : DEFAULT_MESSAGES;
  const [i, setI] = useState(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const rot = setInterval(() => setI((n) => (n + 1) % lines.length), 2600);
    const slowT = setTimeout(() => setSlow(true), 12000);
    return () => {
      clearInterval(rot);
      clearTimeout(slowT);
    };
  }, [lines.length]);

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 w-full">
      <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-medium text-neutral-700 text-center min-h-[1.25rem] transition-opacity">
        {lines[i]}
      </p>
      {/* Indeterminate shimmer so it always feels alive */}
      <div className="w-48 h-1.5 bg-neutral-200 rounded-full overflow-hidden">
        <div className="h-full w-1/3 bg-brand-400 rounded-full lodera-indeterminate" />
      </div>
      <p className="text-xs text-neutral-400 text-center">
        {slow
          ? "Still working — fresh content is worth the wait. Hang tight."
          : subline ?? "This can take a few seconds the first time."}
      </p>
    </div>
  );
}

export default GeneratingLoader;
