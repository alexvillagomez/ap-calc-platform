"use client";

/**
 * /math/[course]/[categoryId]/flashcards — scoped flashcard walk.
 *
 * Walks the in_depth keyword decks of this scope IN CURRICULUM ORDER via the
 * shared CourseCardsMode engine (login-gated; math flashcards are de-emphasized
 * but use the same per-keyword/MECE/SRS model as MCAT):
 *   - no scope params  → the whole category's keyword decks, first keyword first.
 *   - ?umbrella=<id>   → that umbrella's keyword decks, in order.
 *   - ?keyword=<id>    → just that keyword's deck.
 * Mastered decks are glossed over; per-card SRS spacing interleaves.
 */

import { use, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LoginGate } from "@/components/auth/LoginGate";
import CourseCardsMode from "@/components/cards/CourseCardsMode";
import { COURSE_LABELS } from "@/components/math/mathUiTypes";

function MathScopedFlashcards({
  course,
  categoryId,
}: {
  course: string;
  categoryId: string;
}) {
  const searchParams = useSearchParams();
  const umbrellaId = searchParams.get("umbrella") ?? undefined;
  const keywordId = searchParams.get("keyword") ?? undefined;
  const label = searchParams.get("label") ?? undefined;
  const isScoped = !!(umbrellaId || keywordId);

  const courseLabel = label ?? COURSE_LABELS[course] ?? categoryId.replace(/_/g, " ");
  const homeHref = isScoped ? `/math/${course}/${categoryId}` : `/math/${course}`;

  return (
    <CourseCardsMode
      system="math"
      course={course}
      courseLabel={courseLabel}
      homeHref={homeHref}
      scope={{ categoryId, umbrellaId, keywordId, label }}
    />
  );
}

export default function MathFlashcardsPageGated({
  params,
}: {
  params: Promise<{ course: string; categoryId: string }>;
}) {
  const { course, categoryId } = use(params);
  return (
    <LoginGate prompt="Sign in to study flashcards.">
      <Suspense
        fallback={
          <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        <MathScopedFlashcards course={course} categoryId={categoryId} />
      </Suspense>
    </LoginGate>
  );
}
