"use client";

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getOrCreateMcatSession } from "@/lib/mcatSession";
import { LessonView } from "@/components/mcat/LessonView";

export default function StandaloneLessonPage({
  params,
}: {
  params: Promise<{ keywordId: string }>;
}) {
  const { keywordId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sessionId, setSessionId] = useState<string>("");
  const [ready, setReady] = useState(false);

  // Label: prefer query param ?label=, fall back to humanizing the id
  const rawLabel = searchParams.get("label") ?? "";
  const keywordLabel = rawLabel
    ? rawLabel
    : keywordId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  useEffect(() => {
    getOrCreateMcatSession().then((sid) => {
      setSessionId(sid);
      setReady(true);
    });
  }, []);

  const handleDone = () => {
    router.back();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            href="/mcat/progress"
            className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
          >
            ← My Progress
          </Link>
          <p className="font-semibold text-gray-900 text-sm truncate px-3">
            {keywordLabel}
          </p>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {ready && sessionId ? (
          <LessonView
            sessionId={sessionId}
            keywordId={keywordId}
            keywordLabel={keywordLabel}
            onComplete={handleDone}
            onSkip={handleDone}
          />
        ) : (
          <div className="flex items-center justify-center py-32">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </main>
    </div>
  );
}
