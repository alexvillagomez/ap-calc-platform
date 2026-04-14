/**
 * MCQ choice strings from the model often omit `$...$`. Preview treats `\frac`-style
 * bare TeX as display math and plain `24x` as non-math text — unlike the stem.
 * Wrap math-looking choices so they render as inline KaTeX like delimited stem math.
 */
export function normalizeMcqChoiceLatex(choice: string): string {
  const t = choice.trim();
  if (!t || t.includes("$")) return choice;

  if (/\\|\^|_|\{|\}/.test(t)) return `$${t}$`;

  const onlyMathyChars = /^[\s\d+\-*/^=().a-zA-Z]+$/i.test(t);
  const proseOnlyWords = /^[a-z]+(\s[a-z]+)+$/i.test(t);
  if (onlyMathyChars && !proseOnlyWords) return `$${t}$`;

  return choice;
}
