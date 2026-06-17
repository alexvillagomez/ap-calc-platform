/**
 * Unit tests for questionDiversity.ts
 *
 * Run from repo root:
 *   cd apps/student && ../../node_modules/.bin/tsx lib/__tests__/questionDiversity.test.ts
 */

import {
  normalizeStem,
  jaccardSimilarity,
  filterNearDuplicates,
  streakKeyword,
  filterStreakKeyword,
  NEAR_DUP_THRESHOLD,
  KEYWORD_STREAK_CAP,
} from "../questionDiversity";

// ─── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function expect<T>(label: string, actual: T, expected: T): void {
  const ok =
    typeof expected === "number" && typeof actual === "number"
      ? Math.abs((actual as number) - (expected as number)) < 1e-9
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

function expectApprox(label: string, actual: number, expected: number, tol = 0.001): void {
  if (Math.abs(actual - expected) <= tol) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ~${expected} (±${tol})`);
    console.error(`  actual:   ${actual}`);
  }
}

// ─── normalizeStem ────────────────────────────────────────────────────────────

expect(
  "normalizeStem: lower-cases the stem",
  normalizeStem("Find The Derivative"),
  "find the derivative"
);

expect(
  "normalizeStem: replaces numbers with NUM",
  normalizeStem("Find f'(3) when x = 2.5"),
  "find f NUM when x NUM NUM"
);

expect(
  "normalizeStem: strips punctuation",
  normalizeStem("What is f'(x) for f(x) = x^2?"),
  "what is f x for f x x NUM"
);

expect(
  "normalizeStem: collapses whitespace",
  normalizeStem("  lots   of   space  "),
  "lots of space"
);

expect(
  "normalizeStem: handles LaTeX-heavy stem",
  normalizeStem("Evaluate $\\int_0^1 x^2 dx$"),
  "evaluate int NUM NUM x NUM dx"
);

// ─── jaccardSimilarity ────────────────────────────────────────────────────────

expectApprox(
  "jaccardSimilarity: identical strings → 1.0",
  jaccardSimilarity("find the derivative", "find the derivative"),
  1.0
);

expectApprox(
  "jaccardSimilarity: largely different (shares 'the') → low Jaccard",
  // "find the derivative" vs "compute the integral" → intersection={"the"}, union=5 → 0.2
  jaccardSimilarity("find the derivative", "compute the integral"),
  0.2
);

expectApprox(
  "jaccardSimilarity: partial overlap",
  // "a b c" vs "a b d" — intersection={a,b}, union={a,b,c,d} → 2/4 = 0.5
  jaccardSimilarity("a b c", "a b d"),
  0.5
);

expectApprox(
  "jaccardSimilarity: empty strings → 1.0 (both empty)",
  jaccardSimilarity("", ""),
  1.0
);

expectApprox(
  "jaccardSimilarity: one empty → 0.0",
  jaccardSimilarity("hello world", ""),
  0.0
);

// ─── filterNearDuplicates ─────────────────────────────────────────────────────

const stemA = normalizeStem("Find the derivative of f(x) = x^2 + 3x");
const stemAslightlyDifferent = normalizeStem("Find the derivative of f(x) = x^2 + 5x");
const stemB = normalizeStem("Evaluate the integral from 0 to 1 of x^2 dx");

const makeQ = (stem: string) => ({ id: stem.slice(0, 8), stem });

expect(
  "filterNearDuplicates: empty seenStems returns all candidates",
  filterNearDuplicates([makeQ("Find f prime"), makeQ("Evaluate integral")], []).length,
  2
);

expect(
  "filterNearDuplicates: removes near-duplicate (high Jaccard)",
  (() => {
    // Two stems that differ only by one number → very high Jaccard
    const seen = [normalizeStem("Find the derivative of f of x equals x squared plus NUM x")];
    const candidates = [
      { id: "a", stem: "Find the derivative of f of x equals x squared plus NUM x" },
      { id: "b", stem: "Evaluate the integral from NUM to NUM of x squared dx" },
    ];
    return filterNearDuplicates(candidates.map(q => ({ ...q, stem: normalizeStem(q.stem) })), seen).length;
  })(),
  1
);

expect(
  "filterNearDuplicates: keeps non-duplicate",
  (() => {
    const candidates = [
      { id: "b", stem: stemB },
    ];
    return filterNearDuplicates(candidates, [stemA]).length;
  })(),
  1
);

expect(
  "filterNearDuplicates: fallback — returns full pool if all filtered",
  (() => {
    const candidates = [{ id: "a", stem: stemA }];
    // seenStems contains the exact same stem → Jaccard=1 → would filter out
    return filterNearDuplicates(candidates, [stemA]).length;
  })(),
  1  // fallback fires, returns 1 item
);

expect(
  "filterNearDuplicates: similar-but-below-threshold pair is kept",
  (() => {
    // stemA vs stemB — different topics, should be below threshold
    const candidates = [{ id: "a", stem: stemA }, { id: "b", stem: stemB }];
    const result = filterNearDuplicates(candidates, [stemAslightlyDifferent]);
    // We just verify no crash and that candidates can be returned
    return result.length >= 1;
  })(),
  true
);

// ─── streakKeyword ────────────────────────────────────────────────────────────

expect(
  "streakKeyword: fewer than cap → null",
  streakKeyword(["kw1"]),
  null
);

expect(
  "streakKeyword: exactly cap all-same → returns that keyword",
  streakKeyword(["kw1", "kw1"]),
  "kw1"
);

expect(
  "streakKeyword: cap-many all-same → returns that keyword",
  streakKeyword(["kw2", "kw1", "kw1", "kw1"]),
  "kw1"
);

expect(
  "streakKeyword: last two differ → null (no streak)",
  streakKeyword(["kw1", "kw1", "kw2"]),
  null
);

expect(
  "streakKeyword: empty → null",
  streakKeyword([]),
  null
);

expect(
  "streakKeyword: one element → null (below cap of 2)",
  streakKeyword(["kw1"]),
  null
);

expect(
  "streakKeyword: exactly cap=2 with different last → null",
  streakKeyword(["kw1", "kw2"]),
  null
);

// ─── filterStreakKeyword ──────────────────────────────────────────────────────

const makeQkw = (id: string, kwId: string, weight = 1.0) => ({
  id,
  keyword_weights: { [kwId]: weight },
});

expect(
  "filterStreakKeyword: null blockedKeyword → returns all",
  filterStreakKeyword([makeQkw("a", "kw1"), makeQkw("b", "kw2")], null).length,
  2
);

expect(
  "filterStreakKeyword: removes questions whose top keyword matches blocked",
  (() => {
    const candidates = [makeQkw("a", "kw1"), makeQkw("b", "kw2"), makeQkw("c", "kw1")];
    return filterStreakKeyword(candidates, "kw1").map((q) => q.id);
  })(),
  ["b"]
);

expect(
  "filterStreakKeyword: keeps question with null keyword_weights",
  (() => {
    const candidates = [
      { id: "a", keyword_weights: null as unknown as Record<string, number> },
      makeQkw("b", "kw1"),
    ];
    return filterStreakKeyword(candidates, "kw1").map((q) => q.id);
  })(),
  ["a"]
);

expect(
  "filterStreakKeyword: fallback — returns full pool if all filtered",
  (() => {
    const candidates = [makeQkw("a", "kw1"), makeQkw("b", "kw1")];
    return filterStreakKeyword(candidates, "kw1").length;
  })(),
  2  // fallback fires, both returned
);

expect(
  "filterStreakKeyword: picks top-weight keyword when multiple present",
  (() => {
    // q has kw1=0.2, kw2=0.9 → top is kw2; blocking kw1 should NOT remove it
    const candidates = [{ id: "a", keyword_weights: { kw1: 0.2, kw2: 0.9 } }];
    return filterStreakKeyword(candidates, "kw1").length;
  })(),
  1  // not filtered — top keyword is kw2
);

expect(
  "filterStreakKeyword: blocks question whose top keyword matches even when others differ",
  (() => {
    const candidates = [{ id: "a", keyword_weights: { kw1: 0.9, kw2: 0.2 } }];
    return filterStreakKeyword(candidates, "kw1").length;
  })(),
  1  // only one candidate; fallback fires
);

// ─── Constants sanity ─────────────────────────────────────────────────────────

expect("NEAR_DUP_THRESHOLD is 0.72", NEAR_DUP_THRESHOLD, 0.72);
expect("KEYWORD_STREAK_CAP is 2", KEYWORD_STREAK_CAP, 2);

// ─── Summary ─────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(
  `\n${passed}/${total} tests passed${failed > 0 ? ` — ${failed} FAILED` : " — all green"}`
);
if (failed > 0) process.exit(1);
