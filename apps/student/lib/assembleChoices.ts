/**
 * Deterministic answer-choice assembly for ALL generated quiz/practice MCQs.
 *
 * Trust contract (fixes the "keyed answer contradicts the worked solution" bug):
 * the generator model returns the worked solution's FINAL ANSWER plus three
 * plausible-but-wrong distractors — it never emits a `choices` array or a
 * `correct_index`. This code is the ONLY place that builds the four choices and
 * decides the correct index, so the keyed choice is, by construction, exactly
 * the value the solution concluded — placed at a random position.
 *
 * Returns null when the model output can't form a valid 4-option item
 * (missing/blank correct answer, or fewer than 3 distinct distractors that
 * differ from the correct answer). Callers drop null items and regenerate.
 */
export interface AssembledChoices {
  choices: [string, string, string, string];
  correct_index: number;
}

/** Normalize a candidate string for duplicate detection (whitespace-insensitive). */
function normKey(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function assembleChoices(
  correctAnswer: unknown,
  distractors: unknown
): AssembledChoices | null {
  if (typeof correctAnswer !== "string") return null;
  const correct = correctAnswer.trim();
  if (!correct) return null;

  if (!Array.isArray(distractors)) return null;

  const correctNorm = normKey(correct);
  const seen = new Set<string>([correctNorm]);
  const picked: string[] = [];
  for (const d of distractors) {
    if (typeof d !== "string") continue;
    const trimmed = d.trim();
    if (!trimmed) continue;
    const key = normKey(trimmed);
    if (seen.has(key)) continue; // dedupe + never equal to the correct answer
    seen.add(key);
    picked.push(trimmed);
    if (picked.length === 3) break;
  }

  if (picked.length < 3) return null;

  // Insert the correct answer at a uniformly random index in [0, 3].
  const correctIndex = Math.floor(Math.random() * 4);
  const choices = [...picked];
  choices.splice(correctIndex, 0, correct);

  return {
    choices: choices as [string, string, string, string],
    correct_index: correctIndex,
  };
}
