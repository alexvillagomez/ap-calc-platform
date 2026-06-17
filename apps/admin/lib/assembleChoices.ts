/**
 * Deterministic answer-choice assembly for generated quiz/practice MCQs (admin).
 *
 * Mirror of apps/student/lib/assembleChoices.ts. Trust contract: the generator
 * model returns the worked solution's FINAL ANSWER plus three plausible-but-wrong
 * distractors — never a `choices` array or a `correct_index`. This code is the
 * ONLY place that builds the four choices and decides the correct index, so the
 * keyed choice is, by construction, exactly the value the solution concluded —
 * placed at a random position. Returns null when a valid 4-option item can't be
 * formed; callers drop such items.
 */
export interface AssembledChoices {
  choices: [string, string, string, string];
  correct_index: number;
}

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

  const seen = new Set<string>([normKey(correct)]);
  const picked: string[] = [];
  for (const d of distractors) {
    if (typeof d !== "string") continue;
    const trimmed = d.trim();
    if (!trimmed) continue;
    const key = normKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(trimmed);
    if (picked.length === 3) break;
  }
  if (picked.length < 3) return null;

  const correctIndex = Math.floor(Math.random() * 4);
  const choices = [...picked];
  choices.splice(correctIndex, 0, correct);
  return {
    choices: choices as [string, string, string, string],
    correct_index: correctIndex,
  };
}
