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

There are no automated tests in this project.

## Architecture

This is a Turbo monorepo with two Next.js 15 (React 19) apps and three shared packages.

### Apps
- **`apps/admin`** (port 3001) — Problem authoring tool for teachers/admins
- **`apps/student`** (port 3002) — Student-facing practice interface (minimal, in progress)

### Shared Packages
- **`@ap-calc/types`** (`packages/types/src/index.ts`) — `Problem`, `ProblemInsert`, `TopicWeights`, `APCalcUnit` types
- **`@ap-calc/supabase`** (`packages/supabase/src/index.ts`) — Singleton Supabase client (uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- **`@ap-calc/constants`** (`packages/constants/topics.json`) — All 68+ AP Calc AB topic definitions (Units 1–10)

Both apps must transpile shared packages via `transpilePackages` in `next.config.ts`.

### Admin App Data Flow

1. Admin selects topics/difficulty/type on `/generate` (`topicIds` must be valid catalog ids — the API uses only that pool, not the full topic list)
2. Frontend POSTs to `/api/generate-problem` with selections + optional refinement feedback
3. API builds format-specific system prompts via `buildCreateSystemPrompt` / `buildRefineSystemPrompt` (`lib/ai/prompts.ts`) plus canonical topics. **MCQ:** server picks a random emphasis topic from the pool; `topic_weights` must be `{ emphasis_id: 1 }`. **FRQ:** server picks a random archetype (1–7) mapped to TYPE A–G; calculator is never allowed. Difficulty uses narrative lines from `lib/ai/examPrepConstants.ts` (levels 1–5).
4. OpenAI returns JSON: `{ latex_content, solution_latex, choices?, correct_index?, rubric?, topic_weights, generation_meta? }` (`generation_meta` preserves emphasis / FRQ archetype for refinement)
5. Frontend renders live preview via `components/Preview.tsx` (KaTeX + custom visualizations)
6. Admin rates/tweaks, then saves to Supabase `problems` table

### Key Admin Components

- **`Preview.tsx`** — Core renderer: single-pass tokenizer splits text into `$...$` (inline) and `$$...$$` (display) math, renders via KaTeX, and handles custom `<SlopeField />` and `<FunctionGraph />` XML tags embedded in LaTeX content. Both admin and student apps share identical renderer logic; CSS overrides live in each app's `globals.css` under `.ap-calc-preview`.
- **`SlopeField.tsx`** — Canvas-based slope field for differential equations
- **`FunctionGraph.tsx`** — Canvas-based function plotter

### Student App Data Flow

1. Auth guard on `/` reads `ap_calc_account_id` from localStorage; redirects to `/login` if absent
2. Login/register via `/api/auth/login` and `/api/auth/register`; stores `ap_calc_account_id`, `ap_calc_username`, `ap_calc_student_session_id` in localStorage
3. Session strengths loaded via `POST /api/session`; student selects topics
4. `POST /api/next-problem` scores unseen approved MCQ problems using `scoreProblem()` (topic weakness × difficulty proximity × quality), picks via weighted random from top-8
5. Student answers → `POST /api/record-attempt`: records attempt, updates session strengths via `updateStrengths()`, and calibrates `estimated_difficulty` on the problem via IRT-EMA
6. If no unseen problems remain, fallback generates one via admin app `/api/generate-problem`

### Practice Algorithm (`apps/student/lib/practiceAlgorithm.ts`)

- **`computeTargetDifficulty(strengths, topicIds)`** — maps average student strength [0,1] → target difficulty [1,4]
- **`computeStudentSkill(strengths, topicWeights)`** — maps weighted topic strength → 1–5 scale for IRT calibration
- **`scoreProblem(problem, strengths, topicIds, targetDifficulty)`** — combines topic weakness score, Gaussian difficulty proximity (uses `estimated_difficulty ?? difficulty`), and avg_rating nudge
- **`updateStrengths(strengths, topicWeights, correct)`** — weighted EMA; correct → strength toward 1, wrong → toward 0 (α = 0.12)
- **`selectProblem(candidates)`** — weighted random pick from top-8 scored candidates

### Dynamic Difficulty Calibration

Each student attempt updates `problems.estimated_difficulty` via IRT-inspired EMA (α = 0.15):
- Student skill computed from pre-attempt topic strengths: `1 + avg_strength * 4`
- Target: `skill - 0.5` on correct, `skill + 0.5` on wrong
- `new = clamp(old + 0.15 * (target - old), 1, 5)`; seeded from static `difficulty` on first attempt
- `attempt_count` / `success_count` also tracked on `problems` for observability
- `scoreProblem()` uses `estimated_difficulty` when available, falls back to static `difficulty`

### Database (Supabase/PostgreSQL)

Key tables in `supabase/migrations/`:
- **`problems`** — `latex_content`, `solution_latex`, `choices` (jsonb), `correct_index`, `difficulty` (1–5, static/authored), `topic_weights` (jsonb, sparse), `subtopic_relevance` (jsonb, expanded), `rubric`, `type` (`multiple_choice`|`free_response`), `status` (`pending_review`|`approved`|`rejected`), `avg_rating`, `rating_count`, `attempt_count`, `success_count`, `estimated_difficulty` (numeric, IRT-calibrated; null until first attempt)
- **`topic_metadata`** — `id` (e.g. `"1_1"`), `description`
- **`student_sessions`** — `id` (UUID, client-generated), `strengths` (jsonb `{topic_id: 0–1}`), timestamps
- **`student_problem_attempts`** — `session_id`, `problem_id`, `selected_index`, `correct`, `rating` (1–5, optional), `attempted_at`; unique on `(session_id, problem_id)`
- **`student_accounts`** — `id`, `username`, `password_hash`, `session_id` (FK to student_sessions)

RLS: anonymous users read approved problems only; service role used in API routes.

### AI Prompts (`apps/admin/lib/ai/prompts.ts`, `lib/ai/examPrepConstants.ts`)

- `buildCreateSystemPrompt(format)` / `buildRefineSystemPrompt(format)` — System message for one format (MCQ or FRQ) plus `CANONICAL_TOPICS_TEXT`
- `buildApCalcMCQUserPrompt` / `buildApCalcFRQUserPrompt` — User messages (difficulty narratives from `examPrepConstants`, FRQ archetype text, topic pool lines)
- `AP_CALC_GENERATION_SYSTEM` / `AP_CALC_REFINEMENT_SYSTEM` — Deprecated concatenation of both formats (still exported)
- `CANONICAL_TOPICS_TEXT` — All AP Calc AB topic ids/descriptions for valid `topic_weights` keys

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # Required for API routes and seed script
OPENAI_API_KEY=               # Required for problem generation
```

Root `.env.local` is read by both apps and the seed script.
