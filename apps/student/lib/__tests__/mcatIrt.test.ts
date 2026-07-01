/**
 * Unit tests for lib/courseEngine/mcatIrt.ts
 *
 * Run:
 *   cd apps/student && ../../node_modules/.bin/tsx lib/__tests__/mcatIrt.test.ts
 */

import {
  predict,
  effectiveAbility,
  stepSize,
  wrongAmplifier,
  reportedMastery,
  updateItemDifficulty,
  applyAttempt,
  benchmark,
  decayAbility,
  serveDifficulty,
  isDue,
  flashcardProbability,
  seedFromImport,
  tierLabel,
  benchmarkProgressPct,
  DEFAULT_ABILITY,
  K_LOGISTIC_STEEPNESS,
  K_START,
  K_MIN,
  A_MAX,
  IMPORT_THETA_CAP,
  IMPORT_SEED_ATTEMPTS,
  MIX_FLASHCARD_LOW,
  MIX_FLASHCARD_HIGH,
  TIER_SOLID_RATIO,
  BENCH_MAX,
  SERVE_STRETCH,
  SERVE_MIN,
  SERVE_MAX,
  MASTERY_TARGET_P,
} from "../courseEngine/mcatIrt";

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

function expectTrue(label: string, cond: boolean): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  expected: true`);
    console.error(`  actual:   false`);
  }
}

// ─── predict ─────────────────────────────────────────────────────────────────

expectApprox(
  "predict: θ === b → 0.5",
  predict(0.5, 0.5),
  0.5
);

expectApprox(
  "predict: θ === b for different value → 0.5",
  predict(0.3, 0.3),
  0.5
);

expectTrue(
  "predict: increases as θ−b grows (0.6 vs 0.4 at b=0.5)",
  predict(0.6, 0.5) > predict(0.4, 0.5)
);

expectTrue(
  "predict: large positive gap → near 1",
  predict(1.0, 0.0) > 0.99
);

expectTrue(
  "predict: large negative gap → near 0",
  predict(0.0, 1.0) < 0.01
);

// ─── Defining round-trip: predict(ability, reportedMastery(ability)) ≈ 0.80 ──

for (const ability of [0.3, 0.5, 0.7, 0.9]) {
  const bStar = reportedMastery(ability);
  expectApprox(
    `round-trip: predict(${ability}, reportedMastery(${ability})) ≈ ${MASTERY_TARGET_P}`,
    predict(ability, bStar),
    MASTERY_TARGET_P,
    0.001
  );
}

// ─── effectiveAbility ─────────────────────────────────────────────────────────

expectApprox(
  "effectiveAbility: weighted avg — {a:0.7,b:0.3}, {a:0.8,b:0.4} → 0.68",
  effectiveAbility({ a: 0.7, b: 0.3 }, { a: 0.8, b: 0.4 }),
  0.7 * 0.8 + 0.3 * 0.4  // 0.56 + 0.12 = 0.68
);

expectApprox(
  "effectiveAbility: missing ability key defaults to DEFAULT_ABILITY",
  effectiveAbility({ x: 1.0 }, {}),
  DEFAULT_ABILITY
);

expectApprox(
  "effectiveAbility: empty weights → DEFAULT_ABILITY",
  effectiveAbility({}, { a: 0.9 }),
  DEFAULT_ABILITY
);

expectApprox(
  "effectiveAbility: zero-weight key skipped, only non-zero contributes",
  effectiveAbility({ a: 0.0, b: 1.0 }, { a: 0.1, b: 0.6 }),
  0.6
);

// ─── stepSize ─────────────────────────────────────────────────────────────────

expect(
  "stepSize: at 0 attempts → K_START",
  stepSize(0),
  K_START
);

expectTrue(
  "stepSize: strictly decreasing with attempts",
  stepSize(5) > stepSize(10) && stepSize(10) > stepSize(20)
);

expectApprox(
  "stepSize: very large attempts → K_MIN",
  stepSize(10000),
  K_MIN,
  1e-6
);

expectTrue(
  "stepSize: never below K_MIN",
  stepSize(1000000) >= K_MIN
);

// ─── wrongAmplifier ───────────────────────────────────────────────────────────

expectApprox(
  "wrongAmplifier: b far below ability (ability=0.9, b=0.1) → near A_MAX",
  wrongAmplifier(0.1, 0.9),
  A_MAX,
  0.01
);

expectApprox(
  "wrongAmplifier: b === ability → 1",
  wrongAmplifier(0.5, 0.5),
  1.0
);

expectApprox(
  "wrongAmplifier: b > ability → 1 (no amplification for hard items)",
  wrongAmplifier(0.8, 0.3),
  1.0
);

expectTrue(
  "wrongAmplifier: strictly increases as ability−b increases",
  wrongAmplifier(0.4, 0.6) < wrongAmplifier(0.2, 0.6)
);

// ─── reportedMastery ──────────────────────────────────────────────────────────

expectTrue(
  "reportedMastery: rises with ability",
  reportedMastery(0.3) < reportedMastery(0.5) &&
    reportedMastery(0.5) < reportedMastery(0.8)
);

expectTrue(
  "reportedMastery: clamped to [0,1]",
  reportedMastery(0.0) >= 0 && reportedMastery(1.0) <= 1
);

// ─── updateItemDifficulty ─────────────────────────────────────────────────────

{
  const b = 0.5;
  const p = predict(0.5, b); // = 0.5
  const bAfterCorrect = updateItemDifficulty(b, "correct", p);
  const bAfterWrong = updateItemDifficulty(b, "wrong", p);
  const bAfterIDK = updateItemDifficulty(b, "dont_know", p);

  expectTrue(
    "updateItemDifficulty: correct → b decreases (item gets easier in calibration)",
    bAfterCorrect < b
  );

  expectTrue(
    "updateItemDifficulty: wrong → b increases (item gets harder in calibration)",
    bAfterWrong > b
  );

  expect(
    "updateItemDifficulty: dont_know → b unchanged",
    bAfterIDK,
    b
  );
}

// ─── applyAttempt: correct ────────────────────────────────────────────────────

{
  const abilities = { kw1: 0.4, other: 0.9 };
  const attemptsByKeyword = { kw1: 2, other: 5 };
  const keywordWeights = { kw1: 1.0 };
  const b = 0.6;

  const result = applyAttempt({ abilities, attemptsByKeyword, keywordWeights, b, outcome: "correct" });

  expectTrue(
    "applyAttempt correct: ability rises for weighted keyword",
    result.abilities["kw1"] > abilities["kw1"]
  );

  expect(
    "applyAttempt correct: unrelated key 'other' is unchanged",
    result.abilities["other"],
    abilities["other"]
  );

  expectTrue(
    "applyAttempt correct: attempts increment by weight",
    result.attemptsByKeyword["kw1"] === attemptsByKeyword["kw1"] + 1.0
  );

  expectTrue(
    "applyAttempt correct: b decreases (correct)",
    result.b < b
  );

  expectTrue(
    "applyAttempt correct: p is in (0,1)",
    result.p > 0 && result.p < 1
  );
}

// ─── applyAttempt: wrong ──────────────────────────────────────────────────────

{
  const abilities = { kw1: 0.7 };
  const attemptsByKeyword = { kw1: 3 };
  const keywordWeights = { kw1: 1.0 };
  const b = 0.4;

  const result = applyAttempt({ abilities, attemptsByKeyword, keywordWeights, b, outcome: "wrong" });

  expectTrue(
    "applyAttempt wrong: ability falls",
    result.abilities["kw1"] < abilities["kw1"]
  );

  expectTrue(
    "applyAttempt wrong: b increases",
    result.b > b
  );
}

// ─── Asymmetry: wrong on easy item drops ability MORE than wrong on hard item ──

{
  const sharedAbility = 0.6;
  const abilities = { kw1: sharedAbility };
  const attemptsByKeyword = { kw1: 0 };
  const keywordWeights = { kw1: 1.0 };

  const easyB = 0.2; // easy item — ability well above difficulty
  const hardB = 0.8; // hard item — difficulty above ability

  const resultEasy = applyAttempt({ abilities, attemptsByKeyword, keywordWeights, b: easyB, outcome: "wrong" });
  const resultHard = applyAttempt({ abilities, attemptsByKeyword, keywordWeights, b: hardB, outcome: "wrong" });

  const dropEasy = sharedAbility - resultEasy.abilities["kw1"];
  const dropHard = sharedAbility - resultHard.abilities["kw1"];

  expectTrue(
    "asymmetry: wrong on easy item (b=0.2) drops ability MORE than wrong on hard item (b=0.8)",
    dropEasy > dropHard
  );
}

// ─── applyAttempt: dont_know ──────────────────────────────────────────────────

{
  const ability = 0.5;
  const abilities = { kw1: ability };
  const attemptsByKeyword = { kw1: 0 };
  const keywordWeights = { kw1: 1.0 };
  const b = 0.5;

  const resultIDK = applyAttempt({ abilities, attemptsByKeyword, keywordWeights, b, outcome: "dont_know" });
  const resultWrong = applyAttempt({ abilities, attemptsByKeyword, keywordWeights, b, outcome: "wrong" });

  expectTrue(
    "applyAttempt dont_know: ability drops",
    resultIDK.abilities["kw1"] < ability
  );

  expectTrue(
    "applyAttempt dont_know: ability drops LESS than a full wrong on the same item",
    resultIDK.abilities["kw1"] > resultWrong.abilities["kw1"]
  );

  expect(
    "applyAttempt dont_know: b is unchanged",
    resultIDK.b,
    b
  );
}

// ─── Recency: correct at 0 attempts raises ability MORE than at 20 attempts ───

{
  const ability = 0.4;
  const b = 0.7;
  const keywordWeights = { kw1: 1.0 };

  const resultFresh = applyAttempt({
    abilities: { kw1: ability },
    attemptsByKeyword: { kw1: 0 },
    keywordWeights,
    b,
    outcome: "correct",
  });

  const resultExperienced = applyAttempt({
    abilities: { kw1: ability },
    attemptsByKeyword: { kw1: 20 },
    keywordWeights,
    b,
    outcome: "correct",
  });

  const gainFresh = resultFresh.abilities["kw1"] - ability;
  const gainExperienced = resultExperienced.abilities["kw1"] - ability;

  expectTrue(
    "recency: correct at attempts=0 raises ability MORE than at attempts=20",
    gainFresh > gainExperienced
  );
}

// ─── multi-keyword: weight proportionality ────────────────────────────────────

{
  const abilities = { a: 0.4, b: 0.4 };
  const attemptsByKeyword = { a: 0, b: 0 };
  const keywordWeights = { a: 0.7, b: 0.3 };
  const itemB = 0.7;

  const result = applyAttempt({
    abilities,
    attemptsByKeyword,
    keywordWeights,
    b: itemB,
    outcome: "correct",
  });

  const gainA = result.abilities["a"] - abilities["a"];
  const gainB = result.abilities["b"] - abilities["b"];

  expectTrue(
    "multi-keyword: keyword 'a' (weight 0.7) gains MORE ability than 'b' (weight 0.3)",
    gainA > gainB
  );
}

// ─── benchmark ───────────────────────────────────────────────────────────────

expectTrue(
  "benchmark: rises with tStudiedMinutes",
  benchmark(10, 0.5) > benchmark(0, 0.5)
);

expectTrue(
  "benchmark: rises with yieldValue",
  benchmark(30, 1.0) > benchmark(30, 0.0)
);

expectApprox(
  "benchmark: capped at BENCH_MAX",
  benchmark(1e9, 1.0),
  BENCH_MAX,
  1e-9
);

// ─── decayAbility ─────────────────────────────────────────────────────────────

{
  const now = 1_000_000_000_000; // arbitrary ms timestamp
  const hour = 60 * 60 * 1000;

  const decayed = decayAbility(0.7, now - 2 * hour, now);
  expectTrue(
    "decayAbility: drops with elapsed time (2 hours)",
    decayed < 0.7
  );

  const unchanged = decayAbility(0.7, null, now);
  expectApprox(
    "decayAbility: null lastReview → ability unchanged",
    unchanged,
    0.7
  );

  const floored = decayAbility(0.01, now - 10000 * hour, now, 0.05);
  expectApprox(
    "decayAbility: respects floor — never below floor",
    floored,
    0.05,
    0.05
  );
  expectTrue(
    "decayAbility: floor respected (not negative)",
    floored >= 0.05
  );
}

// ─── serveDifficulty ──────────────────────────────────────────────────────────

{
  const bStar = 0.5;
  const bench = 0.7;

  const notStruggling = serveDifficulty(bStar, bench, false);
  expectTrue(
    "serveDifficulty: not struggling → above bStar",
    notStruggling > bStar
  );

  expectTrue(
    "serveDifficulty: not struggling and bench > bStar → ≤ bench",
    notStruggling <= bench
  );

  const struggling = serveDifficulty(bStar, bench, true);
  expectTrue(
    "serveDifficulty: struggling → below bStar",
    struggling < bStar
  );

  // Clamp checks
  expectTrue(
    "serveDifficulty: result ≥ SERVE_MIN",
    serveDifficulty(0.0, 0.1, true) >= SERVE_MIN
  );
  expectTrue(
    "serveDifficulty: result ≤ SERVE_MAX",
    serveDifficulty(1.0, 0.5, false) <= SERVE_MAX
  );
}

// ─── isDue ────────────────────────────────────────────────────────────────────

expectTrue(
  "isDue: true when bStar < benchmark",
  isDue(0.4, 0.7)
);

expectTrue(
  "isDue: false when bStar >= benchmark",
  !isDue(0.8, 0.7)
);

expectTrue(
  "isDue: false when equal",
  !isDue(0.6, 0.6)
);

// ─── flashcardProbability ─────────────────────────────────────────────────────

{
  const pLow = flashcardProbability(0.0, 0.7);
  const pHigh = flashcardProbability(0.7, 0.7);

  expectApprox(
    "flashcardProbability: bStar=0 → MIX_FLASHCARD_LOW",
    pLow,
    MIX_FLASHCARD_LOW
  );

  expectApprox(
    "flashcardProbability: bStar=benchmark → MIX_FLASHCARD_HIGH",
    pHigh,
    MIX_FLASHCARD_HIGH
  );

  expectTrue(
    "flashcardProbability: decreases as bStar rises toward benchmark",
    flashcardProbability(0.2, 0.7) > flashcardProbability(0.5, 0.7)
  );
}

// ─── seedFromImport ───────────────────────────────────────────────────────────

{
  const seedMax = seedFromImport(1.0);
  expectApprox(
    "seedFromImport: confidence=1 → ability === IMPORT_THETA_CAP",
    seedMax.ability,
    IMPORT_THETA_CAP
  );

  const seedZero = seedFromImport(0.0);
  expectApprox(
    "seedFromImport: confidence=0 → ability === IMPORT_THETA_FLOOR (0)",
    seedZero.ability,
    0.0
  );

  const seedClamped = seedFromImport(2.0);
  expectApprox(
    "seedFromImport: confidence clamped to 1",
    seedClamped.ability,
    IMPORT_THETA_CAP
  );

  const seedNeg = seedFromImport(-1.0);
  expectApprox(
    "seedFromImport: negative confidence clamped to 0",
    seedNeg.ability,
    0.0
  );

  expectTrue(
    "seedFromImport: step size > stepSize(10) — high uncertainty fast self-correction",
    // stepSize(IMPORT_SEED_ATTEMPTS=0.5) >> stepSize(10)
    stepSize(IMPORT_SEED_ATTEMPTS) > stepSize(10)
  );
}

// ─── tierLabel ────────────────────────────────────────────────────────────────

expect(
  "tierLabel: ratio >= 1 → 'Strong'",
  tierLabel(0.8, 0.7),
  "Strong"
);

expect(
  "tierLabel: ratio exactly 1 → 'Strong'",
  tierLabel(0.7, 0.7),
  "Strong"
);

expect(
  "tierLabel: ratio >= TIER_SOLID_RATIO but < 1 → 'Solid'",
  tierLabel(0.4, 0.7),  // ratio = 0.4/0.7 ≈ 0.571 > 0.5
  "Solid"
);

expect(
  "tierLabel: ratio < TIER_SOLID_RATIO → 'Building'",
  tierLabel(0.1, 0.7),  // ratio = 0.1/0.7 ≈ 0.143 < 0.5
  "Building"
);

expect(
  "tierLabel: benchmark=0 → 'Building'",
  tierLabel(0.5, 0.0),
  "Building"
);

// ─── benchmarkProgressPct ─────────────────────────────────────────────────────

expectApprox(
  "benchmarkProgressPct: 0 → 0%",
  benchmarkProgressPct(0.0, 0.8),
  0,
  0.5
);

expectApprox(
  "benchmarkProgressPct: bStar === benchmark → 100%",
  benchmarkProgressPct(0.8, 0.8),
  100,
  0.5
);

expectApprox(
  "benchmarkProgressPct: bStar > benchmark → capped at 100%",
  benchmarkProgressPct(1.0, 0.5),
  100,
  0.5
);

expectApprox(
  "benchmarkProgressPct: 0.4 / 0.8 = 50%",
  benchmarkProgressPct(0.4, 0.8),
  50,
  0.5
);

// ─── Summary ─────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(
  `\n${passed} passed, ${failed} failed`
);
if (failed > 0) process.exit(1);
