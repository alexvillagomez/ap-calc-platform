# Prompt for Gemini: Fix Gold Standard LaTeX Rendering

Copy everything below the line into Gemini. Goal: produce corrected `latex_content` and `solution_latex` strings for the FREE_RESPONSE gold standard so they render correctly in our stack.

---

You are helping fix LaTeX rendering for a **gold standard** example used in an AP Calculus admin app.

## Tech stack (do not change this code)

- **Rendering**: React component receives a string and passes it to `ReactMarkdown` with:
  - `remark-math` (parses inline math `$...$` and display math `$$...$$`)
  - `rehype-katex` (renders math with KaTeX)
- So: the **runtime string** is treated as **markdown**. Content **inside** `$...$` or `$$...$$` is sent to KaTeX as LaTeX. Content **outside** is normal markdown (where `\` can be an escape character).

## What goes wrong

- LaTeX shows as **raw text** (e.g. `displaystyle`, `frac`, `cos`, `rule`) or **garbled** (e.g. `dredHdt2d2H` instead of a fraction).
- Likely causes:
  1. In **JavaScript/TypeScript**: in template literals (backticks), `\v` is vertical tab, `\n` is newline, `\r` is carriage return, `\f` is form feed. So a single `\` before a letter can be consumed. To get a **literal backslash** in the string you must write `\\` in the source (so the string contains one `\` for LaTeX).
  2. **Markdown** may treat `\` as escape before the content reaches the math plugin, so backslashes can be stripped or doubled depending on pipeline order.

## Constraints

- **Only** change the two string values `latex_content` and `solution_latex` of the **FREE_RESPONSE** object in the file `apps/admin/lib/ai/prompts.ts`.
- Use **template literals** (backticks) for both strings, same style as the working **MULTIPLE_CHOICE** example in that file.
- In the **working** MULTIPLE_CHOICE example, every LaTeX backslash is written as `\\` in the source (e.g. `\\frac`, `\\displaystyle`), so the **runtime string** contains a single `\` (e.g. `\frac`). Use the same rule.
- Do **not** use `\vspace`, `\noindent`, or any LaTeX that appears **outside** `$...$` (they are not rendered by KaTeX and can trigger bad escapes). Use plain newlines and text like "(a)", "(b)", "(c)" for structure.
- Keep the **same mathematical content** (same problem and solution); only fix escaping and structure so it renders.

## Reference: current file (FREE_RESPONSE only)

Path: `apps/admin/lib/ai/prompts.ts`

The FREE_RESPONSE object currently has:

- **latex_content**: A calculus problem about seawater depth and a differential equation for $H(t)$, with parts (a) find second derivative at (0,4), (b) separation of variables for $H(t)$, (c) critical point in $0 < t < 5$ and max/min justification.
- **solution_latex**: Step-by-step solution for (a) product rule and evaluation, (b) separation and integration giving $H(t) = 3e^{\sin(t/2)} + 1$, (c) critical point at $t = \pi$ and relative maximum.

Use the same wording and math; ensure every LaTeX command is inside `$...$` or `$$...$$` and that in the **TypeScript source** every backslash intended for LaTeX is written as `\\` (so the runtime string has one `\`).

## Output format

Return **only** the two corrected template-literal strings, ready to paste into `prompts.ts`:

1. **latex_content**: full problem text with all math in `$...$`, no `\vspace`/`\noindent`, correct `\\` escaping for LaTeX.
2. **solution_latex**: full solution with same rules.

You can format your response as:

```
latex_content: `...`
solution_latex: `...`
```

so the user can copy-paste into the FREE_RESPONSE object.
