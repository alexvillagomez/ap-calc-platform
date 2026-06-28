"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import CourseCardsMode from "@/components/cards/CourseCardsMode";

/**
 * /mcat/cards — flashcard-only study mode for MCAT. Walks the given section's
 * taxonomy in curriculum order. Defaults to "biology" so the existing Biology
 * behavior is unchanged when no section param is present.
 */
function McatCardsPageInner() {
  const searchParams = useSearchParams();
  const section = searchParams.get("section") ?? "biology";

  return (
    <CourseCardsMode
      system="mcat"
      courseLabel="MCAT"
      homeHref="/mcat"
      section={section}
    />
  );
}

export default function McatCardsPage() {
  return (
    <Suspense>
      <McatCardsPageInner />
    </Suspense>
  );
}
