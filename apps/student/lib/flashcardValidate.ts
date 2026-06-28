/**
 * Math-specific flashcard integrity check. Statement-front dropping is already
 * handled everywhere via `isRecallFront` from `./flashcardRecall`; this file
 * adds the MATH-ONLY memorizable-content gate that runs after generation so a
 * purely conceptual card can never reach a student even when the prompt slips.
 */

/**
 * MATH ONLY: a math flashcard must carry a memorizable formula/value/notation,
 * or name a theorem/rule/identity/definition/law/notation. A card with neither
 * LaTeX math nor a memorizable keyword is a conceptual card (lesson material),
 * not a recall flashcard, and is dropped.
 */
export function hasMemorizableMath(front: string, back: string): boolean {
  const blob = `${front ?? ""} ${back ?? ""}`;
  if (/\$[^$]*\$/.test(blob)) return true;
  if (/\b(theorem|rule|identity|formula|law|definition|notation|value)\b/i.test(front ?? "")) return true;
  // Short-term back = recognition/classification recall (vocab-style), distinct from
  // verbose conceptual statements (which `isRecallFront` already blocks on the FRONT).
  // e.g. front: "A graph with a hole where lim≠f(a) is which discontinuity?" back: "Removable"
  const b = (back ?? "").trim();
  const wordCount = b.split(/\s+/).filter(Boolean).length;
  if (b && wordCount <= 4 && !/[.][)\]]?$/.test(b)) return true;
  return false;
}
