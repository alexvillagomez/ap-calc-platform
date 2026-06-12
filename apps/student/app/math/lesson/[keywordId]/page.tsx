"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/auth/LoginGate";
import { MathLessonView } from "@/components/math/MathLessonView";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getOrCreateMathSession } from "@/lib/mathSession";

// ─── Inner ────────────────────────────────────────────────────────────────────

function MathLessonPageInner({
  params,
}: {
  params: Promise<{ keywordId: string }>;
}) {
  const { keywordId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("return") ?? "/math";
  const label = searchParams.get("label") ?? undefined;
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    getOrCreateMathSession().then(setSessionId);
  }, []);

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href={returnTo}
            className="text-xs text-neutral-400 hover:text-neutral-600"
          >
            ← Back
          </Link>
          <h1 className="font-semibold text-neutral-900 text-sm truncate">
            {label ? `Lesson: ${label}` : "Lesson"}
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <MathLessonView
          sessionId={sessionId}
          keywordId={keywordId}
          keywordLabel={label ?? keywordId}
          onComplete={() => router.push(returnTo)}
          onSkip={() => router.push(returnTo)}
        />
      </main>
    </div>
  );
}

function MathLessonPage({
  params,
}: {
  params: Promise<{ keywordId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <MathLessonPageInner params={params} />
    </Suspense>
  );
}

export default function MathLessonPageGated({
  params,
}: {
  params: Promise<{ keywordId: string }>;
}) {
  return (
    <LoginGate prompt="Sign in to access lessons.">
      <MathLessonPage params={params} />
    </LoginGate>
  );
}
