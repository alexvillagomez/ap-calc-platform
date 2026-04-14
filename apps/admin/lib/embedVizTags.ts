/**
 * Normalizes LLM-mangled <SlopeField /> and <FunctionGraph /> tags so parsers
 * match the canonical form used in preview-pdf (spaces after tag names, between attrs).
 */
export function normalizeEmbeddedVizTags(raw: string): string {
  let s = raw;
  // Stray space after "<": "< SlopeField" or "< FunctionGraph" -> "<SlopeField" / "<FunctionGraph"
  s = s.replace(/<\s+(SlopeField|FunctionGraph)\b/gi, "<$1");
  // Concatenated tag name + first attribute (no space): <SlopeFieldequation ...>
  s = s.replace(/<\s*SlopeFieldequation/gi, "<SlopeField equation");
  s = s.replace(/<\s*FunctionGraphequation/gi, "<FunctionGraph equation");
  // Missing space between closing quote and next attribute: "...4"rangeX = "..."
  s = s.replace(/"rangeX(\s*=)/gi, '" rangeX$1');
  s = s.replace(/"rangeY(\s*=)/gi, '" rangeY$1');
  s = s.replace(/"points(\s*=)/gi, '" points$1');
  // Optional spaces inside self-close: "/ >" -> "/>"
  s = s.replace(/\s*\/\s*>/g, "/>");
  return s;
}
