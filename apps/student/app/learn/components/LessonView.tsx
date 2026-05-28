"use client";

import { Preview } from "@/components/Preview";

interface Props {
  title: string;
  latexContent: string;
  onComplete: () => void;
}

export function LessonView({ title, latexContent, onComplete }: Props) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-10 pb-28">
        <div className="max-w-xl mx-auto space-y-6">
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 ap-calc-preview">
            <Preview latexContent={latexContent} />
          </div>
        </div>
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 px-4 py-4 shadow-md">
        <div className="max-w-xl mx-auto">
          <button
            onClick={onComplete}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors"
          >
            Got it — let&apos;s practice →
          </button>
        </div>
      </div>
    </div>
  );
}
