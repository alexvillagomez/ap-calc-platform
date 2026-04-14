export function normalizeEmbeddedVizTags(raw: string): string {
  let s = raw;
  s = s.replace(/<\s+(SlopeField|FunctionGraph)\b/gi, "<$1");
  s = s.replace(/<\s*SlopeFieldequation/gi, "<SlopeField equation");
  s = s.replace(/<\s*FunctionGraphequation/gi, "<FunctionGraph equation");
  s = s.replace(/"rangeX(\s*=)/gi, '" rangeX$1');
  s = s.replace(/"rangeY(\s*=)/gi, '" rangeY$1');
  s = s.replace(/"points(\s*=)/gi, '" points$1');
  s = s.replace(/\s*\/\s*>/g, "/>");
  return s;
}
