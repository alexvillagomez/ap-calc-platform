"use client";

/**
 * /mcat/[categoryId]/flashcards — scoped flashcard walk.
 *
 * Walks the in_depth keyword decks of this scope IN CURRICULUM ORDER via the
 * shared CourseCardsMode engine:
 *   - no scope params  → the whole category's keyword decks, first keyword first.
 *   - ?umbrella=<id>   → that umbrella's keyword decks, in order.
 *   - ?keyword=<id>    → just that keyword's deck.
 * Mastered decks (known from auto / prior study, via shared keyword state) are
 * glossed over; per-card SRS spacing interleaves; once everything is introduced it
 * shifts to weakness-weighted random.
 */

import { use, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import CourseCardsMode from "@/components/cards/CourseCardsMode";

function McatScopedFlashcards({ categoryId }: { categoryId: string }) {
  const searchParams = useSearchParams();
  const umbrellaId = searchParams.get("umbrella") ?? undefined;
  const keywordId = searchParams.get("keyword") ?? undefined;
  const label = searchParams.get("label") ?? undefined;
  const isScoped = !!(umbrellaId || keywordId);

  const homeHref = isScoped ? `/mcat/${categoryId}` : "/mcat";
  const courseLabel =
    label ?? categoryId.replace(/^mcat_biology_/, "").replace(/_/g, " ");

  return (
    <CourseCardsMode
      system="mcat"
      courseLabel={courseLabel}
      homeHref={homeHref}
      scope={{ categoryId, umbrellaId, keywordId, label }}
    />
  );
}

export default function McatFlashcardsPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = use(params);
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
          <div className="relative w-10 h-10">
            <div className="w-10 h-10 rounded-full border-4 border-brand-100" />
            <div className="absolute inset-0 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
          </div>
        </div>
      }
    >
      <McatScopedFlashcards categoryId={categoryId} />
    </Suspense>
  );
}
