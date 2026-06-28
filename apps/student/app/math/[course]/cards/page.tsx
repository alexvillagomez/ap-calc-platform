"use client";

import { use } from "react";
import CourseCardsMode from "@/components/cards/CourseCardsMode";
import { COURSE_LABELS } from "@/components/math/mathUiTypes";

/**
 * /math/[course]/cards — flashcard-only study mode for a math course. Walks the
 * course's categories in curriculum order doing only spaced-repetition flashcards
 * (Anki-style), offered alongside auto mode.
 */
export default function MathCardsPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = use(params);
  const courseLabel = COURSE_LABELS[course as keyof typeof COURSE_LABELS] ?? "Math";
  return (
    <CourseCardsMode
      system="math"
      course={course}
      courseLabel={courseLabel}
      homeHref={`/math/${course}`}
    />
  );
}
