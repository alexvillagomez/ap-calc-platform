"use client";

/**
 * AnswerAffirmation — the gentle "Not quite" nudge shown right after a WRONG
 * answer, just above the explanation.
 *
 * On a CORRECT answer this renders nothing: the green flash on the chosen answer
 * (<CorrectPulse>) is the entire affirmation — no text box, no emoji, no extra
 * vertical space. (Removed the "✅ Nice!" affirmation box per design.)
 */

interface AnswerAffirmationProps {
  correct: boolean;
  /** Current consecutive-correct streak (unused on correct now; kept for API stability). */
  streak?: number;
  className?: string;
}

export function AnswerAffirmation({ correct, className }: AnswerAffirmationProps) {
  // Correct → no box; the CorrectPulse green flash is the only affirmation.
  if (correct) return null;
  return (
    <div
      className={`flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-700 lodera-affirm-in ${className ?? ""}`}
      role="status"
    >
      <span className="text-sm font-semibold">Not quite — here&apos;s how it works:</span>
    </div>
  );
}

export default AnswerAffirmation;
