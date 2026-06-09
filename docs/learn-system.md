# Learn System

Full documentation for the student adaptive learn system: state machine, diagnostic scoring, API routes, practice algorithm, spaced repetition, and content format contracts.

---

## Learn Flow (`/learn` + `/learn/practice`)

The `/learn` page is a full state machine covering diagnostic → adaptive learn → practice.

**State machine phases:**
```
loading → diagnostic → results → lesson | refresher | mastery_quiz → practice (redirect)
```

| Phase | What happens |
|---|---|
| `diagnostic` | 5 MCQ questions fetched from `learn_diagnostic_problems`. Each has umbrella + in-depth keyword weights. "I've learned this but don't remember it" / "I've never seen this" buttons. No solutions shown. |
| `results` | EMA scoring classifies keyword strengths. Routes to lesson / refresher / targeted / skip based on umbrella score, forgotten count, never-seen count, and weak in-depth skills. Persists to `learn_student_keyword_states` via `POST /api/learn/classify`. |
| `lesson` | Fetches micro-steps from `learn_lessons` (or generates on-demand). Steps 1–2: content-only (no check). Steps 3–4: explanation → example → check question. Wrong: show hint + retry. After all steps: mastery quiz. |
| `refresher` | Fetches from `learn_refreshers` (or generates). Rule card + example + one check question. After: mastery quiz. |
| `mastery_quiz` | 4 questions one at a time from `learn_mastery_quiz_problems`. After all: show score. Pass (≥80%) → mark mastered in DB. Both outcomes → redirect to practice. |
| `practice` | Separate page `/learn/practice?keyword=&topic=`. Adaptive MCQ loop. Tip popup after 2 consecutive wrong. Mastery quiz offer after consecutive correct streak. |

**Topic label:** The `ProgressBar` component accepts an optional `topicLabel` prop (keyword label string) displayed as a blue chip above the step counter. Derived in `/learn/page.tsx` from `lessonQueue`.

**On-demand content generation (`apps/student/lib/learnGenerator.ts`):**
All content is generated once and stored. Routes check DB first; generate + store on first miss. Delete the DB row to force regeneration. Functions: `generateAndStoreLesson`, `generateAndStoreRefresher`, `generateAndStoreTip`, `generateAndStoreProblems`, `generateAndStoreMasteryQuiz`. Uses `gemini-3.5-flash` via its own internal `createGenClient()` (reads `GEMINI_API_KEY` — **not** the shared admin `genClient.ts`).

---

## Diagnostic Scoring (`apps/student/lib/diagnosticScoring.ts`)

Two-tier EMA system:
- **Umbrella keywords** (broad category, e.g. `exponent_rules`) — determines routing
- **In-depth keywords** (specific skill, e.g. `product_rule_exponents`) — determines targeted instruction

```
Correct answer:   score[k] += 0.25 * weight * (1 - score[k])
Wrong answer:     score[k] -= 0.20 * weight * score[k]
Forgotten:        same decay as wrong; sets flaggedForgotten = true
Never seen:       excluded from EMA entirely; sets flaggedNeverSeen = true
After lesson:     score[k] += 0.15 * weight * (1 - score[k])   (weaker nudge)
```

Routing thresholds (`computeRoute`):
- `neverSeenCount ≥ 3` OR `umbrellaScore < 0.35` → `full_lesson`
- `forgottenCount ≥ 2` OR `umbrellaScore < 0.5` → `refresher`
- `umbrellaScore < 0.75` OR any in-depth < 0.45 → `targeted`
- Otherwise → `skip`

---

## Student Learn API Routes (`apps/student/app/api/learn/`)

| Route | Method | Purpose |
|---|---|---|
| `diagnostic` | GET `?topic=` | Fetch diagnostic problems for a topic |
| `classify` | POST | Run EMA on answers, persist `learn_student_keyword_states` |
| `lesson/[keyword]` | GET | Fetch lesson micro-steps; generate on-demand if missing |
| `lesson/progress` | POST | Update `learn_student_lesson_progress` (step + completed) |
| `refresher/[keyword]` | GET | Fetch refresher; generate on-demand if missing |
| `tip/[keyword]` | GET | Fetch tip; generate on-demand if missing; log tip event |
| `practice/next` | POST | Phase-based problem selection (see Practice Algorithm below) |
| `practice/attempt` | POST | Record attempt, update `learn_student_keyword_states` via EMA; apply mastery gate |
| `mastery-quiz/[keyword]` | GET | Fetch quiz problems; generate on-demand if missing |
| `mastery-quiz/submit` | POST | Grade quiz, update state to `mastered` if ≥80%, set spaced review |
| `feedback` | POST | Record helpful/not-helpful on lesson/refresher/tip; update aggregate counts |

---

## Practice Algorithm (`apps/student/lib/practiceAlgorithm.ts`)

### Core scoring functions

- **`computeTargetDifficulty(strengths, keywords)`** — `1 + avg_strength * 3` → [1, 4]
- **`scoreProblem(problem, strengths, target)`** — `kwScore × diffScore × ratingScore`; `diffScore` = Gaussian centered on target (σ=1); returns 0 if no keyword_weights
- **`selectProblem(candidates, K=8)`** — weighted random from top-K scored
- **`updateKeywordStrengths(strengths, kwWeights, correct)`** — bounded EMA (α=0.12)
- **`computeStudentSkill(strengths, weights)`** — `1 + weighted_avg * 4` → [1, 5] for IRT

### Spaced repetition helpers

- **`computeNextReviewDate(inDepthScore, attemptCount)`** — D+1 → D+3 → D+7 → D+14 → D+30 schedule anchored to now. Halves the interval if `inDepthScore < 0.6`.
- **`isReviewDue(spacedReviewDueAt)`** — returns `true` if the stored ISO date string is in the past.
- **`getLearningPhase(inDepthScore, consecutiveCorrect, spacedReviewDueAt, state)`** → `'blocked' | 'interleaved' | 'spaced_review' | 'mastered'`

### Phase-based `practice/next` routing

The `practice/next` route uses three priority levels:

1. **Spaced reviews due** — scans all keyword states for the session; if any have `spaced_review_due_at` in the past, serves the most overdue one first.
2. **Blocked phase** (`in_depth_score < 0.5` AND `consecutive_correct < 3`) — serves only the active keyword's problems to build fluency.
3. **Interleaved phase** — 75% probability serves the active keyword; 25% picks the highest `in_depth_score` non-current keyword for a mixed review.

Response includes `servedKeywordId` and `phase` fields for client transparency.

### Mastery gate (`practice/attempt`)

After each attempt, if `in_depth_score ≥ 0.8` AND `consecutive_correct ≥ 4`:
- Sets `state = 'mastered'`
- Calls `computeNextReviewDate` to schedule the first spaced review
- Stores `spaced_review_due_at` and initializes `spaced_review_count`

On subsequent spaced review completions: increments `spaced_review_count` and advances the schedule.

---

## Dynamic Difficulty Calibration

Each student attempt updates `problems.estimated_difficulty` (α=0.15 EMA):
- `skill = 1 + avg_strength * 4`
- `target = skill - 0.5` (correct) or `skill + 0.5` (wrong)
- `new = clamp(old + 0.15 * (target - old), 1, 5)`
- Seeded from static `difficulty` at problem creation (not null on first attempt)

---

## Learn Content Format Contracts

These contracts are enforced by system prompts in `learnGenerator.ts`.

All generators share one universal format via the `FORMAT_RULES` constant. See [content-pipeline.md](content-pipeline.md) → "LaTeX format contract" for the canonical version.

### Universal format (`example_latex`, `solution_latex`, `explanation_latex`, `rule_latex`, `hint_latex`, `tip_latex`)

- **Prose is plain text — never `\text{}`.** (Older builds wrapped prose in `\text{}`; that broke line wrapping and is no longer emitted.)
- Inline math in `$...$`; displayed/multi-step math in `$$...$$` or `$$\begin{aligned}...\end{aligned}$$` (line breaks `\\`, alignment `&=`).
- Plain prose must contain no `\`, `^`, `_`, or `{}` — anything needing those goes inside `$...$`.
- No forced `\n\n`; write it the way you'd write it on paper.
- `<FunctionGraph equation="..." rangeX="..." rangeY="..." />` only for genuinely visual topics (graphing/transformations/intervals) — not for algebraic manipulation. Equation uses expr-eval syntax (`*` multiply, `^` power, no implicit multiplication).

### Lesson `has_check` pattern

- **Every step has `has_check: true`** with a real `check_question` (text field `latex_content`) and `hint_latex`. Difficulty ramps: step 1 easy → later steps require genuine understanding. Distractors must reflect real student mistakes.

### Backslash & tab normalization (`learnGenerator.ts`)

`fixTabCorruptedText` repairs `<TAB>ext{` → `\text{` (stray single-backslash `\text` corrupted by JSON tab-escaping). `fixBackslashEscaping` repairs over-escaped LaTeX, applied to all stored content:
1. `\\\\letter` → `\letter` (fully doubled command)
2. `\\letter` → `\letter` (single-over-escaped)
3. `\\\\` not before letter → `\\` (preserves `\begin{aligned}` line breaks)

---

## KaTeX Rendering Modes

`apps/student/components/Preview.tsx` and `apps/admin/components/Preview.tsx` share the same rendering pipeline. Content is split into paragraphs on `\n\n`, then each paragraph goes through:

1. `splitMath()` — parses `$...$` (inline) and `$$...$$` (display) delimiters into typed segments
2. Single undelimited segment with `isUndelimited()` (detects `\begin{aligned}` etc.) → `renderMath(trimmed, true)` (display mode, centered)
3. Single undelimited segment with `looksRaw()` (has `\` but no block environment) → `renderMath(trimmed, false)` (inline mode). Raw `\frac`, `\sqrt`, `\infty` in choices render **inline**, not centered display.
4. Mixed `\text{...}` + math segments → `splitRawLatexByText()` → interleaved `<span>` nodes

**KaTeX overflow handling:** After each render, a `useEffect` with `requestAnimationFrame` finds all `div.katex-display` wrappers, detects overflow via `getBoundingClientRect()`, and reduces `fontSize` proportionally (minimum 0.45em). CSS: `div.katex-display { overflow: hidden }`.
