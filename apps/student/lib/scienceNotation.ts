/**
 * Science-notation normalizer for the render-side safety net in MathText.
 *
 * Upgrades a CONSERVATIVE, fixed allowlist of well-known biochemistry /
 * chemistry ASCII tokens to their KaTeX-delimited forms. Only applied to
 * strings that contain NO existing `$` delimiters and NO bare LaTeX backslash
 * commands — i.e. pure ASCII prose that slipped through without proper notation.
 *
 * TOKENS HANDLED (allowlist):
 *   Enzyme kinetics:  Vmax, VMAX, Km, Kcat, kcat
 *   Acid-base:        pKa, pKb, pKw, pKsp, pOH, Keq, Ksp, Ka, Kb, Kw
 *   Simple molecules: H2O2, H2O, CO2, O2, N2, H2, NH3, CH4
 *   Ions / charged:   MnO4-, HCO3-, H2PO4-, H3O+, OH-, H+
 *   Nucleotides:      NADP+, NADPH, NAD+, NADH, FADH2, FAD, ATP, ADP, AMP
 *
 * TOKENS DELIBERATELY EXCLUDED:
 *   pH   — substrings in too many words; single-character variable risk
 *   CO   — ambiguous abbreviation / variable name
 *   G1/G2/S-phase — cell-cycle labels, no subscript needed
 *   mRNA/tRNA/rRNA — no typography gain from KaTeX wrapping
 *   Generic CxHy formulas — too many prose false positives
 */

/** One replacement rule: [regex, KaTeX replacement]. */
type Replacement = [pattern: RegExp, latex: string];

/**
 * Ordered list of replacements. Longer / more-specific tokens MUST come before
 * their shorter prefixes (e.g. NADP+ before NAD+, H2O2 before H2O).
 */
export const SCIENCE_REPLACEMENTS: Replacement[] = [
  // ── Enzyme kinetics ──────────────────────────────────────────────────────────
  [/\bVmax\/2\b/g, "$V_{max}/2$"],
  [/\bVmax\b/g, "$V_{max}$"],
  [/\bVMAX\b/g, "$V_{max}$"],
  [/\bKm\b/g, "$K_m$"],
  [/\bKcat\b/g, "$K_{cat}$"],
  [/\bkcat\b/g, "$k_{cat}$"],

  // ── Acid-base / equilibrium ───────────────────────────────────────────────────
  [/\bpKa\b/g, "$pK_a$"],
  [/\bpKb\b/g, "$pK_b$"],
  [/\bpKw\b/g, "$pK_w$"],
  [/\bpKsp\b/g, "$pK_{sp}$"],
  [/\bpOH\b/g, "$pOH$"],
  [/\bKeq\b/g, "$K_{eq}$"],
  [/\bKsp\b/g, "$K_{sp}$"],
  // Ka/Kb only as standalone whole-word tokens (not inside words like "kappa")
  [/\bKa\b/g, "$K_a$"],
  [/\bKb\b/g, "$K_b$"],
  [/\bKw\b/g, "$K_w$"],

  // ── Common molecules — longer tokens before shorter prefixes ─────────────────
  [/\bH2O2\b/g, "$H_2O_2$"],
  [/\bH2O\b/g, "$H_2O$"],
  [/\bCO2\b/g, "$CO_2$"],
  [/\bO2\b/g, "$O_2$"],
  [/\bN2\b/g, "$N_2$"],
  [/\bH2\b/g, "$H_2$"],
  [/\bNH3\b/g, "$NH_3$"],
  [/\bCH4\b/g, "$CH_4$"],

  // ── Ions / charged species ─────────────────────────────────────────────────
  // For anions (trailing -) and cations (trailing +): \b doesn't work after
  // non-word characters, so use a lookahead for end-of-token (space/punct/end).
  [/\bMnO4-(?=\s|[.,;:!?)'"]|$)/g, "$MnO_4^-$"],
  [/\bHCO3-(?=\s|[.,;:!?)'"]|$)/g, "$HCO_3^-$"],
  [/\bH2PO4-(?=\s|[.,;:!?)'"]|$)/g, "$H_2PO_4^-$"],
  [/\bH3O\+(?=\s|[.,;:!?)'"]|$)/g, "$H_3O^+$"],
  [/\bOH-(?=\s|[.,;:!?)'"]|$)/g, "$OH^-$"],
  // H+ — require word start + lookahead end to avoid H+/H- in equations
  [/\bH\+(?=\s|[.,;:!?)'"]|$)/g, "$H^+$"],

  // ── Bond/group notation (chemistry) — before nucleotide abbreviations ──────
  // N-H, C=O, C-N, C-H as standalone bond tokens (not mid-word).
  // Match when preceded by space/start and followed by space/punct/end.
  [/(?<=\s|^)N-H(?=\s|[.,;:!?)'"]|$)/g, "$N{-}H$"],
  [/(?<=\s|^)C=O(?=\s|[.,;:!?)'"]|$)/g, "$C{=}O$"],
  [/(?<=\s|^)C-N(?=\s|[.,;:!?)'"]|$)/g, "$C{-}N$"],
  [/(?<=\s|^)C-H(?=\s|[.,;:!?)'"]|$)/g, "$C{-}H$"],

  // ── Nucleotide cofactors — longer tokens first ────────────────────────────
  [/\bNADP\+/g, "$NADP^+$"],
  [/\bNADPH\b/g, "$NADPH$"],
  [/\bNAD\+/g, "$NAD^+$"],
  [/\bNADH\b/g, "$NADH$"],
  [/\bFADH2\b/g, "$FADH_2$"],
  [/\bFAD\b/g, "$FAD$"],
  [/\bATP\b/g, "$ATP$"],
  [/\bADP\b/g, "$ADP$"],
  [/\bAMP\b/g, "$AMP$"],
];

/** Bare-LaTeX detector (must stay in sync with the one in MathText.tsx). */
const BARE_LATEX_RE = /\\[a-zA-Z]+|\\\\|\\[([]/;

/**
 * Upgrade well-known ASCII science tokens to KaTeX in a plain-text string.
 *
 * Only processes strings that have NO existing `$` delimiters AND no bare
 * LaTeX backslash commands. Returns the original string unchanged when neither
 * condition is met (fast path avoids allocation).
 */
export function normalizeScienceNotation(text: string): string {
  if (text.includes("$") || BARE_LATEX_RE.test(text)) return text;
  let out = text;
  for (const [pattern, latex] of SCIENCE_REPLACEMENTS) {
    out = out.replace(pattern, latex);
  }
  return out;
}
