"use client";

import { Preview } from "@/components/Preview";
import { cn } from "@/lib/cn";
import type { DiagnosticQuestion } from "../data/exponentRules";

interface Props {
  question: DiagnosticQuestion;
  questionNumber: number;
  totalQuestions: number;
  onAnswer: (selectedIndex: number) => void;
  onForgotten: () => void;
  onNeverSeen: () => void;
  onFlag?: () => void;
  flagged?: boolean;
}

const LABELS = ["A", "B", "C", "D"];

export function DiagnosticQuestionView({
  question,
  questionNumber,
  totalQuestions,
  onAnswer,
  onForgotten,
  onNeverSeen,
  onFlag,
  flagged,
}: Props) {
  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-50 px-4 py-10">
      {/* Progress */}
      <div className="w-full max-w-2xl mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-500">
            Question {questionNumber} of {totalQuestions}
          </span>
          <span className="text-sm text-gray-400">
            {Math.round(((questionNumber - 1) / totalQuestions) * 100)}% complete
          </span>
        </div>
        <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all duration-300"
            style={{ width: `${((questionNumber - 1) / totalQuestions) * 100}%` }}
          />
        </div>
      </div>

      {/* Question card */}
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
        {/* Stem */}
        <div className="text-base leading-relaxed">
          <Preview latexContent={question.latex_content} />
        </div>

        {/* Choices */}
        <div className="space-y-2">
          {question.choices.map((choice, i) => (
            <button
              key={i}
              onClick={() => onAnswer(i)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left",
                "border-gray-200 hover:border-blue-400 hover:bg-blue-50",
                "transition-colors text-sm font-normal"
              )}
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-600">
                {LABELS[i]}
              </span>
              <span className="flex-1 min-w-0">
                <Preview latexContent={choice} />
              </span>
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-100" />

        {/* Secondary buttons */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onForgotten}
            className="text-sm text-gray-500 hover:text-gray-800 underline underline-offset-2 text-center transition-colors"
          >
            I&apos;ve learned this but don&apos;t remember it
          </button>
          <button
            onClick={onNeverSeen}
            className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2 text-center transition-colors"
          >
            I&apos;ve never seen this
          </button>
          {onFlag && (
            <div className="flex justify-end pt-1">
              <button
                onClick={onFlag}
                disabled={flagged}
                className={cn(
                  "flex items-center gap-1 text-xs transition-colors",
                  flagged
                    ? "text-orange-400 cursor-default"
                    : "text-gray-300 hover:text-orange-400"
                )}
              >
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 2a.5.5 0 0 1 .5-.5h.535c.127 0 .25.05.34.14L4.5 2.75l.625-.11A8.4 8.4 0 0 1 6.5 2.5c1.2 0 2.1.3 3 .6.9.3 1.8.6 3 .6a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5c-1.2 0-2.1-.3-3-.6-.9-.3-1.8-.6-3-.6-.48 0-.93.04-1.375.11L4.5 8.75 3.375 7.64A.5.5 0 0 0 3 7.5H2.5V14a.5.5 0 0 1-1 0V2.5A.5.5 0 0 1 2 2z" />
                </svg>
                {flagged ? "Reported" : "Report"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
