/**
 * Lesson-explanation text helpers.
 *
 * The lesson generators are instructed to end an explanation with the one
 * takeaway ALONE in **bold** on its own line, separated by a blank line. Models
 * frequently ignore the blank line and append the bold sentence to the final
 * prose paragraph. This normalizes that deterministically at render time so the
 * key line always stands apart (also repairs already-stored lessons).
 */
export function breakOutKeyTakeaway(s: string): string {
  if (!s) return s;
  const trimmed = s.replace(/\s+$/, "");
  // Only act when the text ends with a bold span (the key takeaway).
  if (!trimmed.endsWith("**")) return s;
  const open = trimmed.lastIndexOf("**", trimmed.length - 3);
  if (open <= 0) return s; // bold span starts the string — nothing to break out
  const head = trimmed.slice(0, open).replace(/\s+$/, "");
  if (!head) return s;
  const bold = trimmed.slice(open);
  return `${head}\n\n${bold}`;
}
