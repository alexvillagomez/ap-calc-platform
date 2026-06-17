/**
 * Unit tests for humanizeSlug().
 *
 * Run from the repo root:
 *   cd apps/student && ../../node_modules/.bin/tsx lib/__tests__/humanize.test.ts
 */

import { humanizeSlug } from "../humanize";

// ─── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function expect(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

expect(
  "mcat_biology prefix stripped, title-cased",
  humanizeSlug("mcat_biology_amino_acids_and_proteins"),
  "Amino Acids and Proteins"
);

expect(
  "calc_unit_ prefix stripped",
  humanizeSlug("calc_unit_1"),
  "1"
);

expect(
  "mcat_ prefix stripped",
  humanizeSlug("mcat_cell_biology"),
  "Cell Biology"
);

expect(
  "plain slug title-cased",
  humanizeSlug("polynomial_and_rational_functions"),
  "Polynomial and Rational Functions"
);

expect(
  "calc_ab_ prefix stripped",
  humanizeSlug("calc_ab_limits_and_continuity"),
  "Limits and Continuity"
);

expect(
  "precalc_ prefix stripped",
  humanizeSlug("precalc_linear_functions"),
  "Linear Functions"
);

expect(
  "hyphen replaced with space",
  humanizeSlug("amino-acids"),
  "Amino Acids"
);

expect(
  "already human-looking slug passes through",
  humanizeSlug("Amino Acids"),
  "Amino Acids"
);

expect(
  "empty string returns empty",
  humanizeSlug(""),
  ""
);

expect(
  "first word always capitalized even if minor word",
  humanizeSlug("the_calculus"),
  "The Calculus"
);

expect(
  "minor word 'of' stays lowercase in middle",
  humanizeSlug("rate_of_change"),
  "Rate of Change"
);

expect(
  "minor word 'in' stays lowercase in middle",
  humanizeSlug("integration_techniques_in_calculus"),
  "Integration Techniques in Calculus"
);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
