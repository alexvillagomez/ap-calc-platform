/**
 * A flashcard FRONT must be a real recall cue (cue → answer), never a bare
 * declarative statement. A statement like "Limit is about x→a, not x=a" teaches
 * nothing to RECALL — that belongs in a lesson, not a flashcard.
 *
 * A front qualifies as a recall cue if it is any of:
 *   - a cloze (contains a "_____" blank the back fills in),
 *   - a question (contains "?"),
 *   - a recall prompt that names what to recall ("Power rule for derivatives",
 *     "Definition of continuity", "Notation for the derivative", "Name this …").
 *
 * Used by both the math and MCAT flashcard validators to drop statement-cards.
 */
const RECALL_CUE =
  /\b(name|names|define|definition|formula|formulas|rule|rules|notation|state|states|identity|identities|theorem|theorems|value|values|recall|write|give|express|cue|term|what|which|when|why|how|who|where)\b/i;

export function isRecallFront(front: string): boolean {
  const f = (front ?? "").trim();
  if (!f) return false;
  if (f.includes("_____")) return true; // cloze
  if (f.includes("?")) return true; // question
  return RECALL_CUE.test(f); // names what to recall (formula/rule/definition/…)
}
