/**
 * Phase-0 parity + Phase-1 emphasis check.
 *
 * Confirms two things the unification must hold:
 *
 *  (A) PARITY — the constants relocated from hardcoded magic numbers into the
 *      CourseConfig registry still equal their old values, so math/MCAT behavior
 *      is UNCHANGED except for the intended new emphasis behavior:
 *        - mastery streak: precalc/calc_ab = 3, mcat_bio = 4
 *        - review probability: 0.35 for all
 *
 *  (B) NEW EMPHASIS BEHAVIOR — the proficiency-gated flashcard/quiz serving mix:
 *        - math: quiz-dominant and ~flat (small flashcard presence) at every
 *          proficiency.
 *        - mcat: flashcard-dominant when unproficient, shifting toward quiz
 *          (lower flashcard share + fewer warm-up cards) as proficiency rises.
 *
 * Run: npx tsx scripts/check-emphasis.ts
 * Exits non-zero on any failed assertion.
 */
import {
  flashcardShare,
  warmupFlashcardCount,
  masteryStreakFor,
  reviewProbabilityFor,
} from "../apps/student/lib/courseEngine/config";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ✗ FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

console.log("=== (A) Parity: relocated constants match old magic numbers ===");
assert(masteryStreakFor("precalc") === 3, "precalc mastery streak = 3");
assert(masteryStreakFor("calc_ab") === 3, "calc_ab mastery streak = 3");
assert(masteryStreakFor("mcat_bio") === 4, "mcat_bio mastery streak = 4");
assert(reviewProbabilityFor("precalc") === 0.35, "precalc review prob = 0.35");
assert(reviewProbabilityFor("mcat_bio") === 0.35, "mcat_bio review prob = 0.35");

console.log("\n=== (B) Emphasis curve: flashcard share vs proficiency ===");
const ps = [0, 0.25, 0.5, 0.75, 1];
for (const course of ["calc_ab", "mcat_bio"]) {
  const row = ps
    .map((p) => `${p.toFixed(2)}:${flashcardShare(course, p).toFixed(2)}/${warmupFlashcardCount(course, p)}c`)
    .join("  ");
  console.log(`  ${course.padEnd(9)} share/cards @ proficiency  ${row}`);
}

console.log("\n=== Assertions ===");
// Math (calc_ab): quiz-dominant & flat — share <= 0.15 everywhere, ~1 warm-up card.
for (const p of ps) {
  assert(flashcardShare("calc_ab", p) <= 0.15, `calc_ab flashcard share <= 0.15 @ p=${p}`);
  assert(warmupFlashcardCount("calc_ab", p) <= 2, `calc_ab warm-up cards <= 2 @ p=${p}`);
}

// MCAT: flashcard-dominant when unproficient, shifting toward quiz as proficiency rises.
assert(flashcardShare("mcat_bio", 0) >= 0.8, "mcat unproficient share >= 0.80 (flashcards first)");
assert(warmupFlashcardCount("mcat_bio", 0) >= 8, "mcat unproficient warm-up cards >= 8 (essentially only flashcards)");
assert(flashcardShare("mcat_bio", 1) <= 0.25, "mcat proficient share <= 0.25 (~80% quiz)");
assert(warmupFlashcardCount("mcat_bio", 1) <= 3, "mcat proficient warm-up cards <= 3");
assert(
  flashcardShare("mcat_bio", 0) > flashcardShare("mcat_bio", 1),
  "mcat share strictly DECREASES with proficiency (shift to quiz)"
);
assert(
  warmupFlashcardCount("mcat_bio", 0) > warmupFlashcardCount("mcat_bio", 1),
  "mcat warm-up cards strictly DECREASE with proficiency"
);

console.log("");
if (failures > 0) {
  console.error(`FAILED: ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("All parity + emphasis assertions passed.");
