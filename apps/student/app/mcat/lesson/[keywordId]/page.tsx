"use client";

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LoderaLogo } from "@/components/brand/LoderaLogo";
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
    <div className="min-h-screen bg-neutral-50">
      {/* Top bar */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/mcat/progress" className="shrink-0">
              <LoderaLogo size={22} />
            </Link>
            <Link
              href="/mcat/progress"
              className="text-xs text-neutral-400 hover:text-brand-600 shrink-0 transition-colors"
            >
              ← My Progress
            </Link>
          </div>
          <p className="font-semibold text-neutral-900 text-sm truncate px-3">
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
            <div className="relative w-10 h-10">
              <div className="w-10 h-10 rounded-full border-4 border-brand-100" />
              <div className="absolute inset-0 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
