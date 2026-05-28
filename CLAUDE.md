# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install all workspace dependencies
npm run dev          # Start both apps (admin: :3001, student: :3002)
npm run build        # Build all apps and packages via Turbo
npm run lint         # Lint all packages
npm run clean        # Remove .next dirs and node_modules
npm run seed:topics  # Seed topic_metadata table from packages/constants/topics.json
```

The admin app currently has pre-existing build errors (missing exports in `lib/ai/prompts.ts`). The student app builds cleanly. There are no automated tests.

## Architecture

This is a Turbo monorepo with two Next.js 15 (React 19) apps and three shared packages.

### Apps
- **`apps/admin`** (port 3001) — Problem authoring, keyword management, RAG agent, tagging tools
- **`apps/student`** (port 3002) — Student-facing precalc practice platform

### Shared Packages
- **`@ap-calc/types`** (`packages/types/src/index.ts`) — `Problem`, `ProblemInsert`, `TopicWeights`, `APCalcUnit` types
- **`@ap-calc/supabase`** (`packages/supabase/src/index.ts`) — Singleton Supabase client
- **`@ap-calc/constants`** (`packages/constants/`) — AP Calc topics, precalc keywords, unit→keyword map

Both apps must transpile shared packages via `transpilePackages` in `next.config.ts`.

---

## Student App

### Pages
- **`/precalc`** — Auth portal (sign in / register) + mode selector (Recommended Path, Free Practice, Lessons, Problem Lookup, My Progress)
- **`/precalc/diagnostic`** — Adaptive diagnostic (15–30 questions, stops when API signals `done` or MAX reached)
- **`/precalc/practice`** — Free practice: auto-starts immediately, no keyword selection, pulls from full `problems`+`rag_examples` pool
- **`/learn`** — Structured lesson flow: diagnostic → lesson → practice → mastery quiz
- **`/lookup`** — Semantic problem search (embedding-based + keyword fallback)
- **`/progress`** — Student keyword strength visualization

### Student Data Flow

1. Auth guard reads `ap_calc_account_id` from localStorage; redirects to `/precalc` if absent
2. Login/register via `/api/auth/login` and `/api/auth/register`
3. Session loads via `POST /api/session` — returns `strengths` (legacy topic EMA) and `keyword_strengths` (precalc keyword EMA)
4. **Free Practice**: `POST /api/precalc/next-problem` — no keyword selection required; scores entire `problems`+`rag_examples` pool against `keyword_strengths` (defaults 0.5 for unknown), picks via weighted random from top-8
5. Student answers → `POST /api/record-attempt` — records attempt (FK violations for unregistered rag_examples are non-fatal), updates `keyword_strengths` via EMA, calibrates `estimated_difficulty` via IRT-EMA
6. **Lookup**: `POST /api/lookup` — embeds query, cosine-matches against `problems`→`rag_examples`→`learn_practice_problems`→`learn_diagnostic_problems` embeddings; keyword fallback uses `topic_id` directly from matched keyword

### Practice Algorithm (`apps/student/lib/practiceAlgorithm.ts`)

- **`scoreProblemByKeyword(problem, keywordStrengths, targetDifficulty)`** — weakness-weighted score: `(1 - strength) × difficulty_proximity × rating_nudge`. All unknown keywords default to 0.5.
- **`computeTargetDifficulty(strengths, keywordIds)`** — maps avg strength [0,1] → target difficulty [1,4]; returns 2.5 for empty sessions
- **`updateStrengths(strengths, weights, correct)`** — weighted EMA (α=0.12); correct → toward 1, wrong → toward 0
- **`selectProblem(candidates)`** — weighted random from top-8 scored candidates
- **`computeNextReviewDate(inDepth, reviewCount)`** — spaced repetition intervals: [1,3,7,14,30,60] days × strength multiplier
- **`getLearningPhase(inDepth, consecutive, dueAt, state)`** — returns `"blocked"` | `"interleaved"` | `"spaced_review"` | `"mastered"`
- **`isReviewDue(dueAt)`** — true if spaced review date has passed

### Dynamic Difficulty Calibration

Each attempt updates `problems.estimated_difficulty` via IRT-EMA (α=0.15):
- Student skill: `1 + avg_keyword_strength × 4`
- Target: `skill - 0.5` on correct, `skill + 0.5` on wrong
- `new = clamp(old + 0.15 × (target - old), 1, 5)`; seeded from static `difficulty` on first attempt

### Diagnostic (`/precalc/diagnostic`)

- Fetches problems one at a time from `POST /api/learn/diagnostic`
- Scores candidates from `problems` + `rag_examples` (both queried in parallel) by information gain: `Σ uncertainty(kwScore) × weight`
- Stops at MAX=30 questions, or when API returns `done: true` AND ≥15 questions answered
- Routes student to lesson/practice based on `computeRoute()` in `diagnosticScoring.ts`

### Keyword Strength Storage

Two separate strength systems:
- **`student_sessions.keyword_strengths`** (JSONB) — precalc keyword EMA `{keywordId: 0–1}`; used by free practice and problem lookup
- **`learn_student_keyword_states`** table — rich per-keyword state machine for the structured learn system (state, in_depth_score, umbrella_score, consecutive_correct, spaced_review_due_at, etc.)

### Graph Rendering (`apps/student/lib/safeExpression.ts`)

`parseFunctionEquation` and `parseSlopeEquation` strip LHS prefixes (`y =`, `f(x) =`, `dy/dx =`, `y' =`) before evaluation. Bad points return `NaN` (skipped by `Number.isFinite` guard in `FunctionGraph.tsx`/`SlopeField.tsx`).

---

## Admin App

### Key Pages
- **`/generate`** — Problem authoring (MCQ/FRQ generation via OpenAI)
- **`/rag-agent`** — Batch MCQ generation from PDF templates using `rag_examples`
- **`/keywords`** — Keyword management (add, approve, dedup, embed)
- **`/tagging`** — Retroactively tag problems with keyword_weights
- **`/compare`** — Side-by-side problem comparison
- **`/lookup`** — Direct ID-based problem/rag_example lookup

### Key Admin Components

- **`Preview.tsx`** — Core renderer: tokenizes `$...$` / `$$...$$` math via KaTeX, handles `<SlopeField />` and `<FunctionGraph />` XML tags. Both apps use identical renderer logic; CSS overrides in each app's `globals.css` under `.ap-calc-preview`.
- **`SlopeField.tsx`** — SVG slope field for differential equations
- **`FunctionGraph.tsx`** — SVG function plotter (uses `safeExpression.ts` for evaluation)

---

## Database (Supabase/PostgreSQL)

Key tables in `supabase/migrations/`:

| Table | Purpose | Key columns |
|-------|---------|-------------|
| **`problems`** | Canonical problem store | `latex_content`, `solution_latex`, `choices`, `correct_index`, `difficulty`, `keyword_weights` (jsonb), `topic_weights` (jsonb), `status`, `estimated_difficulty`, `embedding` (jsonb) |
| **`rag_examples`** | Problem templates / seeds | Same content fields + `course`, `keyword_weights`, `promoted_problem_id`, `embedding` |
| **`student_sessions`** | Per-session state | `strengths` (legacy topic EMA), `keyword_strengths` (precalc keyword EMA) |
| **`student_problem_attempts`** | Attempt log | `session_id`, `problem_id` (FK→problems), `correct`, `rating`; unique on `(session_id, problem_id)` |
| **`student_accounts`** | Auth | `username`, `password_hash`, `session_id` |
| **`learn_keywords`** | Precalc keyword catalog | `id`, `label`, `tier` (`in_depth`/`umbrella`/`tag`), `category_id`, `topic_id`, `status`, `embedding` |
| **`learn_student_keyword_states`** | Rich keyword learning state | `in_depth_score`, `umbrella_score`, `state`, `consecutive_correct`, `spaced_review_due_at` |
| **`learn_practice_problems`** | Learn-system MCQs | `keyword_id`, `difficulty`, `hint_latex`, `embedding` |
| **`learn_diagnostic_problems`** | Legacy diagnostic problems | `topic_id`, `in_depth_keywords`, `embedding` |

`problems.problem_id` FK constraint: `student_problem_attempts.problem_id` must exist in `problems`. When a `rag_example` is promoted on first serve, it gets inserted into `problems`; if promotion fails, the attempt upsert throws FK violation (error code `23503`) — handled non-fatally in `record-attempt`.

RLS: anonymous users read approved problems only; service role used in API routes.

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # Required for API routes and seed scripts
OPENAI_API_KEY=               # Required for problem generation and embeddings
```

Root `.env.local` is read by both apps and seed scripts. Each app also has its own `.env.local` for app-specific overrides.

## Deployment

Student app is deployed on Vercel (`ap-calc-platform-student`). Admin app is not yet deployed. The student app deploys from the monorepo root — Vercel runs `turbo run build` scoped to the `student` package. Shared workspace packages (`@ap-calc/supabase`, `@ap-calc/types`) must not be published to npm; they are local workspace deps only.
