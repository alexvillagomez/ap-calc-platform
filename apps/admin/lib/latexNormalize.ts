export function normalizeMcqChoices(choices: unknown): string[] | null {
  if (!Array.isArray(choices)) return null;
  // Coerce to strings; `/generate` and preview-json wrap bare math in `$...$` at render time (see mcqChoiceLatex).
  return choices.map((c) => (typeof c === "string" ? c : String(c ?? "")));
}
