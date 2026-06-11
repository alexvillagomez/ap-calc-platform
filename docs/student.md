# Student App

Port 3002. Student-facing precalc practice platform.

## Pages

- **`/precalc`** — Auth portal (sign in / register) + mode selector (Recommended Path, Free Practice, Lessons, Problem Lookup, My Progress)
- **`/precalc/diagnostic`** — Adaptive diagnostic (15–30 questions, stops when API signals `done` or MAX reached)
- **`/precalc/practice`** — Free practice: auto-starts immediately, pulls from full `problems`+`rag_examples` pool
- **`/learn`** — Structured lesson flow: diagnostic → lesson → practice → mastery quiz
- **`/lookup`** — Semantic problem search (embedding-based + keyword fallback)
- **`/progress`** — Student keyword strength visualization
- **`/demo`** — Self-contained adaptive demo (pulls from DB, tracks keyword strengths, generates report)
- **`/mcat`** — MCAT **Biology** practice (isolated `mcat_*` tables; drill-down topics, generated questions/flashcards/lessons, mastery-gated spaced practice). Full docs: [mcat-system.md](mcat-system.md)

## Data Flow

1. Auth guard reads `ap_calc_account_id` from localStorage; redirects to `/precalc` if absent
2. Login/register via `/api/auth/login` and `/api/auth/register`
3. Session loads via `POST /api/session` — returns `strengths` (legacy topic EMA) and `keyword_strengths` (precalc keyword EMA)
4. **Free Practice**: `POST /api/precalc/next-problem` — scores `rag_examples` pool against `keyword_strengths` (defaults 0.5 for unknown), picks via weighted random from top-8
5. Student answers → `POST /api/record-attempt` — records attempt (FK violations for unregistered rag_examples are non-fatal), updates `keyword_strengths` via EMA, calibrates `estimated_difficulty` via IRT-EMA. Accepts optional `wrongAnswerKeywords: Record<string, number>` — on incorrect answers merges with `keyword_weights` via `mergeWrongAnswerWeights` (×0.5 discount). Client should pass `problem.wrong_answer_data?.[selectedIndex]?.keyword_weights`.
6. **Lookup**: `POST /api/lookup` — embeds query, cosine-matches against `problems`→`rag_examples`→`learn_practice_problems`→`learn_diagnostic_problems`; keyword fallback uses `topic_id` from matched keyword

## Practice Algorithm (`apps/student/lib/practiceAlgorithm.ts`)

- **`scoreProblemByKeyword(problem, keywordStrengths, targetDifficulty)`** — weakness-weighted score: `(1 - strength) × difficulty_proximity × rating_nudge`. Unknown keywords default to 0.5.
- **`computeTargetDifficulty(strengths, keywordIds)`** — maps avg strength [0,1] → target difficulty [1,4]; returns 2.5 for empty sessions
- **`updateStrengths(strengths, weights, correct)`** — weighted EMA (α=0.12); correct → toward 1, wrong → toward 0
- **`mergeWrongAnswerWeights(topicWeights, wrongAnswerWeights, discount=0.5)`** — on incorrect answers, blends topic keyword weights (full) with chosen wrong answer's keyword_weights (×0.5 discount). Takes `max(topic_weight, wrong_weight × 0.5)` per keyword to avoid double-penalizing.
- **`selectProblem(candidates)`** — weighted random from top-8 scored candidates
- **`computeNextReviewDate(inDepth, reviewCount)`** — spaced repetition intervals: [1,3,7,14,30,60] days × strength multiplier
- **`getLearningPhase(inDepth, consecutive, dueAt, state)`** — returns `"blocked"` | `"interleaved"` | `"spaced_review"` | `"mastered"`
- **`isReviewDue(dueAt)`** — true if spaced review date has passed

## Dynamic Difficulty Calibration

Each attempt updates `problems.estimated_difficulty` via IRT-EMA (α=0.15):
- Student skill: `1 + avg_keyword_strength × 4`
- Target: `skill - 0.1` on correct, `skill + 0.1` on wrong
- `new = clamp(old + 0.15 × (target - old), 0, 1)`; seeded from static `difficulty` on first attempt

## Diagnostic (`/precalc/diagnostic`)

- Fetches problems one at a time from `POST /api/learn/diagnostic`
- Scores candidates by information gain: `Σ uncertainty(kwScore) × weight`
- Stops at MAX=30 questions, or when API returns `done: true` AND ≥15 questions answered
- Routes student to lesson/practice based on `computeRoute()` in `diagnosticScoring.ts`

## Keyword Strength Storage

Two separate systems:
- **`student_sessions.keyword_strengths`** (JSONB) — precalc keyword EMA `{keywordId: 0–1}`; used by free practice, demo, and problem lookup
- **`learn_student_keyword_states`** table — rich per-keyword state machine for the structured learn system (state, in_depth_score, umbrella_score, consecutive_correct, spaced_review_due_at)

## Graph Rendering (`apps/student/lib/safeExpression.ts`)

`parseFunctionEquation` and `parseSlopeEquation` strip LHS prefixes (`y =`, `f(x) =`, `dy/dx =`, `y' =`) before evaluation. Bad points return `NaN` (skipped by `Number.isFinite` guard in `FunctionGraph.tsx`/`SlopeField.tsx`).
