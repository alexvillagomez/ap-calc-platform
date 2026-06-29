/**
 * Robust JSON parsing for raw LLM output that contains LaTeX / escape sequences.
 *
 * THE BUG THIS FIXES
 * ──────────────────
 * Generators ask the model for JSON whose string values contain LaTeX, e.g.
 *   { "rule_latex": "Use $\rightarrow$ to ..." }
 * Models very often emit LaTeX commands with a SINGLE backslash (`\rightarrow`,
 * `\text{...}`, `\frac`) instead of the JSON-legal double backslash. Because
 * `\r`, `\t`, `\b`, `\f`, `\n` are *valid* JSON escapes, `JSON.parse` silently
 * turns them into control characters:
 *   "$\rightarrow$"  →  "$<CR>ightarrow$"   (the visible text becomes "ightarrow")
 *   "\text{...}"      →  "<TAB>ext{...}"
 * The LaTeX is destroyed BEFORE any renderer sees it — this is corruption
 * upstream of KaTeX, not a styling problem.
 *
 * Models also sometimes emit ANSI/terminal control sequences for emphasis
 * (`[1m…[0m`). `` is a valid JSON unicode escape, so it
 * survives into the parsed string as a literal ESC char and renders as a box
 * glyph (e.g. "are ⍰0mbasic⍰0m because…").
 *
 * THE FIX
 * ───────
 *  1. BEFORE parsing: repair lone/LaTeX backslashes so `JSON.parse` keeps the
 *     LaTeX intact (a `\` followed by a letter is a LaTeX command, never a JSON
 *     escape — JSON's only letter escapes are the single chars b/f/n/r/t and
 *     the `\uXXXX` form).
 *  2. AFTER parsing: recursively strip ANSI escape sequences and stray C0
 *     control characters from every string value (newlines/tabs are preserved).
 */

// ANSI CSI sequences (ESC [ … final-letter) and a few common variants, plus
// any stray C0 control char EXCEPT \t (\x09) and \n (\x0A) which are legitimate
// whitespace we want to keep for `whitespace-pre-line` rendering.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const STRAY_CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Remove ANSI escape sequences and stray control characters from a string.
 * Tabs and newlines are preserved. Safe to run on already-stored content so
 * legacy rows render cleanly even before they are regenerated.
 */
export function stripControlChars(s: string): string {
  return s.replace(ANSI_RE, "").replace(STRAY_CONTROL_RE, "");
}

/**
 * LaTeX command names that begin with one of the JSON escape letters
 * (b, f, n, r, t). Only these need disambiguation: `\rightarrow` vs a genuine
 * `\r`. Every OTHER letter after a backslash (`\alpha`, `\sigma`, …) is already
 * unambiguously LaTeX because JSON has no such escape. A backslash + one of
 * these letters whose following run starts with a listed command is treated as
 * LaTeX; anything else (a real `\n`/`\t`/…) is left as a JSON escape.
 */
const LATEX_COMMANDS_BFNRT = [
  // b — IMPORTANT: boldsymbol/bmatrix/begin must be here so \boldsymbol is not
  // parsed as the JSON \b escape (backspace U+0008), which would then be stripped
  // by deepStripControls leaving the lossy literal "oldsymbol" stored in the DB.
  "beta", "bar", "binom", "bmod", "big", "bigl", "bigr", "bigcup", "bigcap",
  "bigwedge", "bigvee", "bigoplus", "bigotimes", "boxed", "bullet", "because",
  "between", "bot", "blacksquare", "bowtie", "bigtriangleup", "bigtriangledown",
  // b (extended — previously missing, causing \boldsymbol→oldsymbol corruption)
  "boldsymbol", "bmatrix", "begin", "breve", "beth",
  "backslash", "backsim", "backsimeq", "backepsilon", "barwedge",
  "bigstar", "bigsqcup", "biguplus", "bigodot",
  "blacklozenge", "blacktriangle", "blacktriangledown",
  "blacktriangleleft", "blacktriangleright",
  "boxplus", "boxminus", "boxtimes", "bumpeq",
  // f
  "frac", "forall", "fbox", "fcolorbox", "flat", "frown", "footnotesize",
  // n
  "nu", "nabla", "neq", "ne", "ni", "not", "notin", "nleftarrow", "nrightarrow",
  "nleftrightarrow", "nonumber", "nmid", "nparallel", "nsim", "ncong", "nexists",
  "nsubseteq", "nsupseteq", "neg", "natural",
  // r
  "rightarrow", "rho", "rfloor", "rceil", "rangle", "right", "rightleftharpoons",
  "rightharpoonup", "rightharpoondown", "rbrace", "rbrack", "rmoustache", "real",
  "restriction", "rightrightarrows", "rightsquigarrow",
  // t
  "text", "textbf", "textit", "textrm", "texttt", "textsf", "textcolor",
  "textstyle", "textnormal", "times", "theta", "tau", "tan", "tanh", "to", "top",
  "tilde", "triangle", "triangleq", "triangleleft", "triangleright", "tfrac",
  "therefore", "thinspace", "tbinom", "twoheadrightarrow",
];

/**
 * True if a consecutive-letter run beginning at `start` in `raw` starts with a
 * known LaTeX command (case-sensitive lowercase) — i.e. it's `\rightarrow`,
 * not a stray `\r`. Reads only the letter run, so it's cheap.
 */
function looksLikeLatexCommand(raw: string, start: number): boolean {
  let end = start;
  while (end < raw.length && /[a-zA-Z]/.test(raw[end])) end++;
  const run = raw.slice(start, end).toLowerCase();
  return LATEX_COMMANDS_BFNRT.some((cmd) => run.startsWith(cmd));
}

/**
 * Repair a raw JSON string so that single-backslash LaTeX survives JSON.parse.
 *
 * Walks the raw text and, for every backslash, decides whether it begins a
 * legitimate JSON escape or is a lone/LaTeX backslash that must be doubled:
 *   - `\"`, `\\`, `\/`                         → kept (valid JSON escapes)
 *   - `\uXXXX` (4 hex)                          → kept (valid unicode escape)
 *   - `\b \f \n \r \t` + a non-letter           → kept (genuine whitespace escape)
 *   - `\b \f \n \r \t` + a letter (e.g. `\rightarrow`, `\frac`, `\nu`) → doubled
 *   - `\` + any other char (e.g. `\alpha`, `\(`) → doubled
 *   - trailing `\`                               → doubled
 */
export function repairModelJson(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];

    // Trailing backslash — escape it.
    if (next === undefined) {
      out += "\\\\";
      continue;
    }
    // Always-valid JSON escapes — keep as-is.
    if (next === '"' || next === "\\" || next === "/") {
      out += ch + next;
      i += 1;
      continue;
    }
    // Valid \uXXXX unicode escape — keep as-is.
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
      out += raw.slice(i, i + 6);
      i += 5;
      continue;
    }
    // Ambiguous single-char whitespace escapes (\b \f \n \r \t): valid JSON
    // escapes that are ALSO the first letter of common LaTeX commands
    // (`\rightarrow`, `\frac`, `\text`, `\beta`, `\nu`). Treat as LaTeX only
    // when the following letter-run actually begins a known LaTeX command;
    // otherwise it's a genuine newline/tab/… and stays a JSON escape.
    // (Uppercase-initial LaTeX like `\Theta`/`\Rightarrow` starts with the
    // capital right after the backslash, so it never reaches this branch.)
    if (next === "b" || next === "f" || next === "n" || next === "r" || next === "t") {
      if (looksLikeLatexCommand(raw, i + 1)) {
        out += "\\\\";
        // do not consume `next`; it is the first letter of the LaTeX command
        continue;
      }
      out += ch + next;
      i += 1;
      continue;
    }
    // Any other `\x` (`\alpha`, `\(`, `\,`, `\%`, …) — lone backslash, double it.
    out += "\\\\";
    // do not consume `next`
  }
  return out;
}

/** Recursively strip control chars from every string value in a parsed object. */
function deepStripControls(value: unknown): unknown {
  if (typeof value === "string") return stripControlChars(value);
  if (Array.isArray(value)) return value.map(deepStripControls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepStripControls(v);
    }
    return out;
  }
  return value;
}

/**
 * Parse raw model JSON robustly. Repairs LaTeX backslashes before parsing and
 * strips ANSI/control chars after. Throws (like JSON.parse) if the text cannot
 * be parsed even after repair — callers map that to a typed gen error.
 */
export function parseModelJson<T = Record<string, unknown>>(raw: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(repairModelJson(raw));
  } catch {
    // Repair can, in rare cases, make valid JSON worse (e.g. content that was
    // already correctly escaped). Fall back to parsing the original text.
    parsed = JSON.parse(raw);
  }
  return deepStripControls(parsed) as T;
}
