"use client";

import { cn } from "@/lib/cn";
import { formatKeywordLabel } from "@/lib/diagnosticScoring";
import type { DiagnosticResult, DiagnosticRoute } from "@/lib/diagnosticScoring";

interface Props {
  result: DiagnosticResult;
  onContinue: (route: DiagnosticRoute) => void;
  onSkipToPractice: () => void;
  onRetakeDiagnostic?: () => void;
}

type KeywordStatus = "lesson" | "refresher" | "practice" | "solid";

function getKeywordStatus(score: number, isNeverSeen: boolean): KeywordStatus {
  if (isNeverSeen) return "lesson";
  if (score < 0.45) return "lesson";
  if (score < 0.65) return "refresher";
  if (score < 0.8) return "practice";
  return "solid";
}

const STATUS_CONFIG: Record<KeywordStatus, { label: string; chipClass: string; dot: boolean }> = {
  lesson: { label: "Needs Lesson", chipClass: "bg-orange-100 text-orange-700", dot: true },
  refresher: { label: "Needs Refresher", chipClass: "bg-yellow-100 text-yellow-700", dot: true },
  practice: { label: "Needs Practice", chipClass: "bg-blue-100 text-blue-700", dot: true },
  solid: { label: "Solid ✓", chipClass: "bg-green-100 text-green-700", dot: false },
};

export function DiagnosticResults({ result, onContinue, onSkipToPractice, onRetakeDiagnostic }: Props) {
  const { route, inDepthScores } = result;

  // Sort: weak keywords first (ascending score), then solid
  const entries = Object.entries(inDepthScores).sort(([, a], [, b]) => a - b);
  const weakCount = entries.filter(([, s]) => s < 0.65).length;

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-50 px-4 py-10">
      <div className="w-full max-w-xl space-y-4">

        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-xl font-semibold text-gray-900">Your study plan</h1>
          <p className="text-sm text-gray-500">
            {weakCount > 0
              ? `${weakCount} skill${weakCount > 1 ? "s" : ""} to work on`
              : "You're in great shape on this topic!"}
          </p>
        </div>

        {/* Keyword plan list */}
        {entries.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {entries.map(([kw, score], i) => {
              const status = getKeywordStatus(score, false);
              const cfg = STATUS_CONFIG[status];
              return (
                <div
                  key={kw}
                  className={cn(
                    "flex items-center gap-3 px-5 py-3.5",
                    i < entries.length - 1 && "border-b border-gray-50"
                  )}
                >
                  {/* Dot indicator */}
                  <span className={cn(
                    "flex-shrink-0 w-2 h-2 rounded-full",
                    cfg.dot ? "bg-gray-400" : "border-2 border-gray-300 bg-white"
                  )} />

                  {/* Label */}
                  <span className="flex-1 text-sm text-gray-800">
                    {formatKeywordLabel(kw)}
                  </span>

                  {/* Status chip */}
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0",
                    cfg.chipClass
                  )}>
                    {cfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {entries.length === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
            <p className="text-sm text-green-800 font-medium">
              No skills assessed yet — the diagnostic didn&apos;t find matching problems.
            </p>
          </div>
        )}

        {/* CTA */}
        {route !== "skip" ? (
          <button
            onClick={() => onContinue(route)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
          >
            Start studying →
          </button>
        ) : (
          <button
            onClick={onSkipToPractice}
            className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
          >
            Go practice →
          </button>
        )}

        {/* Secondary actions */}
        <div className="flex flex-col items-center gap-2 pt-1">
          {route === "skip" && (
            <button
              onClick={() => onContinue(route)}
              className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
            >
              Review a lesson anyway →
            </button>
          )}
          <button
            onClick={onSkipToPractice}
            className="text-sm text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
          >
            I just want to go practice →
          </button>
          {onRetakeDiagnostic && (
            <button
              onClick={onRetakeDiagnostic}
              className="text-xs text-gray-300 hover:text-gray-500 underline underline-offset-2"
            >
              Re-take diagnostic
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
