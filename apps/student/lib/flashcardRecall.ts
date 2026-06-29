/**
 * A flashcard FRONT must be a real recall cue (cue → answer), never a bare
 * declarative statement. A statement like "Limit is about x→a, not x=a" teaches
 * nothing to RECALL — that belongs in a lesson, not a flashcard.
 *
 * A front qualifies as a recall cue if it is any of:
 *   - a cloze (contains a "_____" blank the back fills in),
 *   - a question (contains "?"),
 *   - a comparison cue ("Essential vs nonessential amino acids"),
 *   - a recall prompt that names what to recall ("Power rule for derivatives",
 *     "Definition of continuity", "Notation for the derivative"),
 *   - a SHORT noun-phrase label naming a subject ("Glycolysis net ATP",
 *     "Three-letter code for alanine") — a cue, not a sentence.
 *
 * A declarative SENTENCE (has a finite/linking verb: "Cysteine has a thiol …")
 * is NOT a cue and is dropped.
 *
 * Used by both the math and MCAT flashcard validators to drop statement-cards.
 */
const RECALL_CUE =
  /\b(name|names|define|definition|formula|formulas|rule|rules|notation|state|states|identity|identities|theorem|theorems|value|values|recall|describe|describes|explain|explains|list|lists|compare|compares|summarize|summarizes|identify|identifies|outline|outlines|write|give|express|cue|term|code|type|class|classification|category|role|location|product|products|order|range|sign|direction|what|which|when|why|how|who|where)\b/i;

// Verbs that make a front a declarative statement (belongs on the back, not a cue).
const STATEMENT_VERB =
  /\b(is|are|was|were|be|been|being|has|have|had|equals?|becomes?|means?|contains?|causes?|produces?|binds?|requires?|uses?|makes?|forms?|occurs?|consists?|refers?|describes?|represents?|acts?|works?|happens?|stays?|remains?)\b/i;

export function isRecallFront(front: string): boolean {
  const f = (front ?? "").trim();
  if (!f) return false;
  if (f.includes("_____")) return true; // cloze
  if (f.includes("?")) return true; // question
  if (/\bvs\.?\b|\bversus\b/i.test(f)) return true; // comparison cue
  if (RECALL_CUE.test(f)) return true; // names what to recall (formula/rule/definition/…)
  // A short noun-phrase label is a valid cue; a declarative sentence is not.
  const words = f.split(/\s+/).filter(Boolean);
  if (words.length <= 9 && !STATEMENT_VERB.test(f)) return true;
  return false;
}
