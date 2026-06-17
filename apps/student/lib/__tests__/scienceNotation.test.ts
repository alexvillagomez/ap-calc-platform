/**
 * Unit tests for normalizeScienceNotation().
 *
 * Run from the repo root:
 *   cd apps/student && ../../node_modules/.bin/tsx lib/__tests__/scienceNotation.test.ts
 */

import { normalizeScienceNotation } from "../scienceNotation";

// ─── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function expect(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// ─── Fast-path guards ─────────────────────────────────────────────────────────

expect(
  "already-delimited string is returned unchanged",
  normalizeScienceNotation("The $K_m$ of the enzyme"),
  "The $K_m$ of the enzyme"
);

expect(
  "bare-LaTeX string is returned unchanged",
  normalizeScienceNotation("\\frac{1}{2}"),
  "\\frac{1}{2}"
);

// ─── Enzyme kinetics ──────────────────────────────────────────────────────────

expect(
  "Vmax → $V_{max}$",
  normalizeScienceNotation("The Vmax of the enzyme is high."),
  "The $V_{max}$ of the enzyme is high."
);

expect(
  "VMAX → $V_{max}$",
  normalizeScienceNotation("VMAX was measured at 50 μmol/min."),
  "$V_{max}$ was measured at 50 μmol/min."
);

expect(
  "Km → $K_m$",
  normalizeScienceNotation("Km for glucose is 5 mM."),
  "$K_m$ for glucose is 5 mM."
);

expect(
  "Kcat → $K_{cat}$",
  normalizeScienceNotation("The Kcat value indicates turnover rate."),
  "The $K_{cat}$ value indicates turnover rate."
);

expect(
  "kcat → $k_{cat}$",
  normalizeScienceNotation("A high kcat means fast catalysis."),
  "A high $k_{cat}$ means fast catalysis."
);

// ─── Acid-base ────────────────────────────────────────────────────────────────

expect(
  "pKa → $pK_a$",
  normalizeScienceNotation("The pKa of acetic acid is 4.76."),
  "The $pK_a$ of acetic acid is 4.76."
);

expect(
  "pKb → $pK_b$",
  normalizeScienceNotation("pKb is related to Kb."),
  "$pK_b$ is related to $K_b$."
);

expect(
  "Keq → $K_{eq}$",
  normalizeScienceNotation("Keq determines the direction of the reaction."),
  "$K_{eq}$ determines the direction of the reaction."
);

expect(
  "Ksp → $K_{sp}$",
  normalizeScienceNotation("Ksp for BaSO4 is very small."),
  "$K_{sp}$ for BaSO4 is very small."
);

expect(
  "Ka standalone → $K_a$",
  normalizeScienceNotation("The Ka of a weak acid defines its strength."),
  "The $K_a$ of a weak acid defines its strength."
);

// ─── Common molecules ─────────────────────────────────────────────────────────

expect(
  "H2O → $H_2O$",
  normalizeScienceNotation("Water (H2O) is the solvent."),
  "Water ($H_2O$) is the solvent."
);

expect(
  "CO2 → $CO_2$",
  normalizeScienceNotation("CO2 is exhaled."),
  "$CO_2$ is exhaled."
);

expect(
  "O2 → $O_2$",
  normalizeScienceNotation("Hemoglobin carries O2."),
  "Hemoglobin carries $O_2$."
);

expect(
  "NH3 → $NH_3$",
  normalizeScienceNotation("NH3 is excreted by fish."),
  "$NH_3$ is excreted by fish."
);

expect(
  "H2O2 → $H_2O_2$ (before H2O rule)",
  normalizeScienceNotation("Catalase breaks down H2O2."),
  "Catalase breaks down $H_2O_2$."
);

// ─── Ions ─────────────────────────────────────────────────────────────────────

expect(
  "MnO4- → $MnO_4^-$",
  normalizeScienceNotation("The MnO4- ion is purple."),
  "The $MnO_4^-$ ion is purple."
);

expect(
  "HCO3- → $HCO_3^-$",
  normalizeScienceNotation("Bicarbonate HCO3- buffers blood."),
  "Bicarbonate $HCO_3^-$ buffers blood."
);

expect(
  "OH- → $OH^-$",
  normalizeScienceNotation("A base donates OH-."),
  "A base donates $OH^-$."
);

expect(
  "H+ → $H^+$",
  normalizeScienceNotation("H+ concentration determines pH."),
  "$H^+$ concentration determines pH."
);

expect(
  "H3O+ → $H_3O^+$",
  normalizeScienceNotation("H3O+ is the hydronium ion."),
  "$H_3O^+$ is the hydronium ion."
);

// ─── Nucleotide cofactors ─────────────────────────────────────────────────────

expect(
  "NAD+ → $NAD^+$ (not NADPH mangled)",
  normalizeScienceNotation("NAD+ accepts electrons in glycolysis."),
  "$NAD^+$ accepts electrons in glycolysis."
);

expect(
  "NADPH → $NADPH$",
  normalizeScienceNotation("NADPH is used in anabolic reactions."),
  "$NADPH$ is used in anabolic reactions."
);

expect(
  "NADP+ → $NADP^+$ (before NADPH rule)",
  normalizeScienceNotation("The pentose phosphate pathway generates NADP+."),
  "The pentose phosphate pathway generates $NADP^+$."
);

expect(
  "FADH2 → $FADH_2$",
  normalizeScienceNotation("FADH2 donates electrons to complex II."),
  "$FADH_2$ donates electrons to complex II."
);

expect(
  "ATP → $ATP$",
  normalizeScienceNotation("ATP is the energy currency of the cell."),
  "$ATP$ is the energy currency of the cell."
);

// ─── Non-false-positive checks ────────────────────────────────────────────────

expect(
  "mRNA is not mangled (no match rule for mRNA)",
  normalizeScienceNotation("mRNA carries genetic information."),
  "mRNA carries genetic information."
);

expect(
  "G1 phase not mangled",
  normalizeScienceNotation("G1 phase precedes S phase."),
  "G1 phase precedes S phase."
);

expect(
  "CO alone not mangled (no rule for standalone CO)",
  normalizeScienceNotation("CO binds hemoglobin with high affinity."),
  "CO binds hemoglobin with high affinity."
);

expect(
  "pH alone not mangled (no rule for standalone pH)",
  normalizeScienceNotation("The pH of blood is around 7.4."),
  "The pH of blood is around 7.4."
);

expect(
  "Words ending in substring 'Ka' not mangled — 'Kappa' stays intact",
  normalizeScienceNotation("Kappa chains are part of immunoglobulins."),
  "Kappa chains are part of immunoglobulins."
);

expect(
  "Multiple tokens in one string",
  normalizeScienceNotation("At Vmax, the enzyme is saturated; Km equals substrate concentration."),
  "At $V_{max}$, the enzyme is saturated; $K_m$ equals substrate concentration."
);

expect(
  "Mixed: already-delimited string with ASCII token is left alone",
  normalizeScienceNotation("The $pK_a$ and Vmax both matter."),
  "The $pK_a$ and Vmax both matter."   // has $ → guard fires, nothing changed
);

// ─── Summary ──────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${passed}/${total} tests passed${failed > 0 ? ` — ${failed} FAILED` : ""}`);
if (failed > 0) process.exit(1);
