# Diagnostic Convergence

Read when tuning the `/demo` diagnostic — how fast it converges and when it stops. Algorithm lives in `apps/student/lib/practiceAlgorithm.ts`; orchestration in `apps/student/app/demo/page.tsx`.

## Direct-evidence update
`updateStrengthsDiagnostic` updates per-keyword scores after each answer (tuned for ~20-question convergence):
- **First-touch correct:** `0.5 + difficulty * 2.0 * w * correctSignal`
- **First-touch wrong:** `0.5 - difficulty * 2.0 * w * wrongSignal`
- **Subsequent correct α:** `difficulty * 1.5 * correctSignal`
- **Subsequent wrong α:** `1.0 * wrongSignal`

Higher than free-practice `updateStrengths` (`learningRate = 0.12`) because the diagnostic must reach confident scores in one session. `correctSignal`/`wrongSignal` (0.75/0.90) correct for guess probability and slip rate in 4-choice MCQ.

## Evidence propagation layer (infers untested skills)
`propagateEvidence(strengths, testedWeights, graph, correct, nd, inDepthToUmbrella)` runs in `commitAnswer` right after `updateStrengthsDiagnostic` (before the `heavyPenalty` override). The graph is built once per session via `buildGraphFromProblems(problems)` (co-occurrence of `keyword_weights` × `prerequisite_weights`). Three passes:
- **Upstream:** a correct answer credits prerequisites of the tested keyword.
- **Downstream:** a high-confidence correct nudges dependents up; a low-confidence wrong nudges them down.
- **Sibling:** nudges untested same-umbrella siblings toward the tested keyword's strength.

Constants (conservative): `PROP_UPSTREAM_RATE 0.20`, `PROP_DOWNSTREAM_RATE 0.12`, `PROP_SIBLING_RATE 0.08`, `PROP_HIGH_CONF 0.75`, `PROP_LOW_CONF 0.35`, `DEFAULT_SIBLING_CORR 0.30`. Validated at the **umbrella grain** (10 umbrellas), where it reaches in ~10 questions what direct-evidence alone reaches in ~18–20. Design & simulation in [weights-research.md](weights-research.md). Note: an older inline `updateStrengths(next, pw, true, PREREQ_LEARNING_RATE)` prerequisite boost still runs in `commitAnswer` and overlaps the upstream pass; both are intentionally kept (per-problem vs. graph-based signals).

## Stop conditions & shortcuts
- **Prerequisite inference:** in `commitAnswer`, any prerequisite keyword whose estimated post-boost strength crosses 0.62 is auto-credited as an umbrella touch.
- **Touch threshold:** `UMBRELLA_WELL_TESTED_THRESHOLD = 3` touches per umbrella (was 5); `DEMO_DIAGNOSTIC_MAX_QUESTIONS = 25` hard ceiling (was 40).
- **Strength mastery gate:** `checkAndCreditMasteredUmbrellas(next)` (inside `setKeywordStrengths`) groups in-depth keywords by umbrella; if average in-depth strength exceeds `UMBRELLA_MASTERY_STRENGTH_GATE = 0.72`, the umbrella is credited as well-tested without waiting for 3 touches. Collapses to ~10–15 questions for strong students, ~20–22 for weak.

## Problem selection & variety
`loadNext` in `demo/page.tsx` chooses each question. A fresh account starts with every keyword strength at 0.5, so pure adaptive scoring surfaces the *same* "best" (medium-difficulty/high-rated) problems for everyone. To avoid that:
- **Epsilon-decay exploration:** `exploreProb = max(0.25, 1 - answeredCount / 8)` — the first ~5 questions sample **uniformly** across the whole remaining pool (even coverage of all ~300 polynomial problems), decaying to a 0.25 floor.
- **Adaptive branch:** when not exploring, score via `scoreProblemByKeyword` with ±15% random jitter, then `selectProblem(scored, 40)` (top-40 candidate pool, not the default top-8) so it still spreads.
- **Pool:** `/api/demo/problems` returns polynomial-tagged `rag_examples` (~300; capped via `.limit(300)` newest-first). ~90% are unrated (`rating_count = 0`), so uniform exploration gives new content broad exposure for rating.

A simulation (2000 sessions × 20q) showed all 300/300 problems get sampled with even coverage, vs the old top-8 concentration where new accounts repeated the same handful.

## Restart / reset
Both "Restart diagnostic" entry points (the `/demo` done screen and the `/demo-practice` end screen) open a red **"Reset everything"** warning modal, then call `POST /api/demo/reset` to clear `learn_student_keyword_states`, the `diagnostic_completed_at` flag, and the saved practice position — a real reset, not the old in-place/dead button.

## Demo report (FeedbackReport)
`apps/student/components/FeedbackReport.tsx` "full" mode groups topic keywords by umbrella (avg shown, in-depth on click). Topic keywords are **Polynomials-only**: `buildStrengths()` in `demo/page.tsx` filters strictly to keywords in `inDepthToUmbrellaRef` (from `/api/demo/problems`); non-Polynomials keywords from `prerequisite_weights` are excluded. Each keyword carries `parentLabel`. After finishing, a **"Start practice →"** button navigates to `/demo-practice` (no auto-redirect — students need to read results first).

Tuning note: with the propagation layer, `DEMO_DIAGNOSTIC_MAX_QUESTIONS` could drop 25→20 for equivalent umbrella-level accuracy (proposed, not applied).
