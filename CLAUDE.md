# CLAUDE.md

Guidance for Claude Code working in this repo. This file holds only the always-needed essentials; detailed, area-specific docs live in `docs/` and should be read **on demand** when a task touches that area.

## Docs map — read when relevant
| Doc | Read when… |
|-----|-----------|
| [docs/key-pages.md](docs/key-pages.md) | Working on any page's routing or behavior (admin + student). |
| [docs/journey-routing.md](docs/journey-routing.md) | Touching the onboarding → diagnostic → practice flow, auth routing, stage/resume state. |
| [docs/student.md](docs/student.md) | Student app architecture, data flow, practice algorithm, graph rendering. |
| [docs/admin.md](docs/admin.md) | Admin app pages, problem authoring workflow, four-dimensional keyword system. |
| [docs/database.md](docs/database.md) | Table schemas, RLS, FK constraints. |
| [docs/learn-system.md](docs/learn-system.md) | The `/learn` keyword-mastery subsystem, learn API routes, scoring. |
| [docs/content-pipeline.md](docs/content-pipeline.md) | `rag_examples` enrichment, keyword tagging, on-demand learn content (lessons/refreshers/tips/problems), LaTeX format contract. |
| [docs/diagnostic-convergence.md](docs/diagnostic-convergence.md) | Tuning the `/demo` diagnostic — convergence, propagation layer, stop conditions, report, problem-selection variety. |
| [docs/practice-flow.md](docs/practice-flow.md) | The `/demo-practice` Duolingo-style spaced/interleaved practice — block progression, interleaving, curriculum order, server-driven mastery, no auto-advance. |
| [docs/mcat-system.md](docs/mcat-system.md) | The student **`/mcat`** Biology feature — `mcat_*` tables, drill-down navigation, generation + AAMC-outline grounding, **per-keyword concept blueprints (scope contracts)**, **AAMC yield (importance + prioritization)**, **fast correctness verification** of generated content, reason-first question generation, mastery-gated spaced practice, difficulty model, embedding/tagging, scripts. **Read for anything `mcat`.** |
| [docs/deployment.md](docs/deployment.md) | Deploying the student app to Vercel — build scoping, env vars, the commit-everything gotcha, migrations. |
| [docs/difficulty-scales.md](docs/difficulty-scales.md) | Anything involving `difficulty` / `estimated_difficulty` / `targetDifficulty`. |
| [docs/progress-report.md](docs/progress-report.md) | The `/progress` report and `learn_student_keyword_states`. |
| [docs/weights-research.md](docs/weights-research.md) | Design + simulation behind the diagnostic evidence-propagation layer. |
| [docs/platform-overview.md](docs/platform-overview.md) | A full prose walkthrough of the whole platform (long-form onboarding read). |
| [docs/research-index.md](docs/research-index.md) | Index of all research/notes files in the repo. |
| [docs/math-research/design-spec.md](docs/math-research/design-spec.md) | The **`/math`** system (precalc + AP Calc AB) — authoritative spec: 19-category MECE taxonomy, course-as-view model, numeric 0–1 yield, generation pipeline, diagnostic + auto mode. **Read for anything `/math` or `math_*`.** |
| [docs/math-research/db-inventory.md](docs/math-research/db-inventory.md) + [precalc-outline.md](docs/math-research/precalc-outline.md) + [calc-ab-outline.md](docs/math-research/calc-ab-outline.md) | CED research grounding the math taxonomy/yields; legacy-data import mapping. |
| [docs/math-research/issues-log.md](docs/math-research/issues-log.md) + [persona-qa.md](docs/math-research/persona-qa.md) | Known issues, QA findings, deferred work (incl. the deferred DB cleanup plan in db-cleanup-plan.md). |
| [apps/student/docs/brand.md](apps/student/docs/brand.md) | **Lodera** brand system — palette, logo usage, voice, animation/sound principles. |
| [docs/gamification.md](docs/gamification.md) | Streaks/combo/sound wiring recipe for answer flows (math + MCAT). |
| [docs/scaling-infra.md](docs/scaling-infra.md) | Scaling: pgvector search, caching (`lib/serverCache.ts`), read-replica routing (`lib/supabaseRead.ts`), API rate-limit middleware, owner-only Supabase upgrade steps + env vars (UPSTASH_*, SUPABASE_REPLICA_URL, RATE_LIMIT_DISABLED). |
| [docs/question-data-audit.md](docs/question-data-audit.md) | Completeness audit of math/mcat questions: wrong-answer descriptions, per-distractor weights/embeddings, action/representation (4-dimension) tags — and what's missing. |
| [docs/features-v2-qa-report.md](docs/features-v2-qa-report.md) + [persona-test-findings.md](docs/persona-test-findings.md) + [db-efficiency-proposals.md](docs/db-efficiency-proposals.md) | Persona-QA findings + ranked UX backlog; DB-efficiency proposals (none applied). |
| [docs/retention-qa-report.md](docs/retention-qa-report.md) | "Would a student pay?" persona QA — top retention deterrents (latency between questions, no reward/dopamine loop, value gated behind sign-up+diagnostic, recurring MCAT onboarding modal) and the 3 fixes most likely to flip "no"→"yes". **Read before the next UX/retention sprint.** |

---

## Commands
```bash
npm install          # Install all workspace dependencies
npm run dev          # Start both apps (admin :3001, student :3002)
npm run build        # Build all apps and packages via Turbo
npm run lint         # Lint all packages
npm run clean        # Remove .next dirs and node_modules
npm run seed:topics  # Seed topic_metadata from packages/constants/topics.json
npm run seed:mcat    # Seed MCAT Biology taxonomy from mcat-keywords.txt
npm run mcat:expand  # Generate in-depth MCAT keywords per umbrella
npm run mcat:embed   # Embed + retag MCAT keywords/questions/flashcards
npm run mcat:blueprints  # Backfill per-keyword concept blueprints + AAMC yield (fill-missing; --force/--umbrella/--category/--keyword)
npm run mcat:audit-scope # Audit stored questions vs their keyword blueprint; --apply to quarantine out-of-scope
npm run math:validate    # Validate content/math-taxonomy/*.json against the design-spec format
npm run math:seed        # Upsert math taxonomy (categories/courses/keywords/prereq edges) into math_* tables
npm run math:embed       # Embed math_keywords (text-embedding-3-small); paginated + resume-safe
npm run math:blueprints  # Backfill math concept blueprints (yields stay as authored; fill-missing only)
npm run math:import      # Import rag_examples + learn practice/quiz problems into math_questions (idempotent)
npm run math:yield-writeback # Write numeric yield back onto learn_keywords via source_learn_keyword_id
```

The MCAT (`/mcat`) Biology feature is fully documented in [docs/mcat-system.md](docs/mcat-system.md) — it uses isolated `mcat_*` tables and never touches the precalc `learn_*`/`problems` pools. **Biology only; do not expand to other sections unless asked.**

The math (`/math`) feature — **precalc + AP Calc AB**, modeled on the MCAT architecture — uses isolated `math_*` tables (courses are views over shared categories via `math_course_categories`; precalc lives standalone AND as the foundation layer inside calc). Taxonomy source of truth is `content/math-taxonomy/*.json` (seeded via `math:seed`; never hand-edit the DB). Yield is numeric 0–1 and drives queue prioritization; **the calc course hides yield badges in the UI by design** (precalc shows them). Generation = gpt-5.4-mini, reason-first, blind-solve verified; all content is prose with `$...$`-delimited KaTeX (`MathText` has a bare-LaTeX fallback for legacy rows). Whole-course keyword queries MUST paginate via `lib/mathPagedQuery.ts` — PostgREST caps at 1000 rows silently.

**Lodera rebrand**: the product is **Lodera** (`components/brand/LoderaLogo.tsx`, tokens `brand-*` in tailwind config + globals.css, primitives in `components/ui/`). Onboarding at `/` (general intro → Math | MCAT choice → center); login is email+username+password with auto-signup, no verification (`app_users` + scrypt, httpOnly `lodera_uid` cookie; legacy `student_accounts` auth still exists for old demo flows). Gamification: `lib/gamification.ts` + `user_streaks` (+`/api/streak/touch`) — wiring recipe in docs/gamification.md.

**features-v2 (live on `main` / Vercel prod):** student app gained a full **profile** page (edit info, change password, logout, subscription stub), a shared **QuestionToolbar** (`components/practice/QuestionToolbar.tsx`: stopwatch, take-a-lesson [new tab], quick-refresher [inline; correct-after-refresher gets ×0.4 credit], prioritize-this [`/api/priority` + selection boost + auto-resolve]), per-course **pgvector cosine search** (`/api/{math,mcat}/search` + `match_*_keywords` RPCs), a **metrics** layer (`student_events` + `lib/metrics.ts` + `/api/events` + per-question time rollup), and scaling infra (caching, read-replica routing, `middleware.ts` rate limiting). **The refresher/lesson keyword is chosen by embedding-pinpointing** (`lib/bestKeyword.ts` → `primary_keyword_id` from the next-question routes), NOT raw max-weight `keyword_weights` — because tags can be mis-weighted/missing (e.g. a "sign of quotient" question was mis-tagged to a grouping keyword). **Migrations to apply manually (SQL editor), in order:** `20260615000000_features_v2.sql`, `20260615000001_pgvector_search.sql`, `20260616000000_category_keyword_match.sql`. Known data gaps on math/mcat questions (wrong-answer descriptions, per-distractor weights, action/representation tags) — see [docs/question-data-audit.md](docs/question-data-audit.md).

**Trust + Duolingo-mode work (2026-06-17, on `main`):**
- **Answer-keying contract:** generators emit the worked solution's final answer + distractors; `lib/assembleChoices.ts` (mirrored in admin) builds the 4 choices and picks the index in code, so the key can never contradict the solution. See [[project-answer-assembly-contract]]. Math/MCAT/learn generators all follow it.
- **Render trust:** `components/mcat/MathText.tsx` is the single math renderer — it normalizes ASCII science notation (`lib/scienceNotation.ts`: `Vmax`→`$V_{max}$`, `H2O`→`$H_2O$`), repairs JSON-escape LaTeX corruption (control chars `\f`/`\t`→`\frac`/`\theta`), renders bare LaTeX, and draws `<FunctionGraph>`/`<SlopeField>` viz segments.
- **Diagnostic → auto:** the math diagnostic shows a placement report then routes into **auto mode** (`/math/[course]/auto`, Duolingo loop: flashcard warm-up → weakness-first practice → mastery gate → spaced review → unit checkpoint quiz). **MCAT auto mode** exists too (`/mcat/auto`, no diagnostic). `lib/mathTagging.ts loadTargetKeywords` filters by course (calc_ab asks calculus).
- **Honest progress:** `/api/{math,mcat}/taxonomy` returns `questions_answered`/`correct_answers` counted from the `*_question_attempts` log (NOT summed per-keyword, which 4×-inflated the old counters).
- **Onboarding:** a brand-new visitor can answer one free question at `/try` (public `/api/math/sample-question`) before the login wall; `LoginGate` has a Log in / Sign up toggle.
- **Question diversity:** `lib/questionDiversity.ts` caps consecutive same-keyword items + filters near-duplicate stems in the next-question/quiz routes.
- **Beta status:** persona QA says NOT yet pay-worthy — top blockers are **latency** (5–30s between questions / first lesson) and **no reward loop**; see [docs/retention-qa-report.md](docs/retention-qa-report.md) for the next-sprint priorities.
- **Gotcha:** the root `.env.local OPENAI_API_KEY` is stale (401); the valid key is in `apps/student/.env.local` (and on Vercel). Scripts must load the student env for OpenAI — see [[project-openai-key-split]]. e2e auth uses the cookie flow (`POST /api/auth/login` `mode:"signup"`); run one Playwright invocation at a time (concurrent runs thrash the single dev server).

The admin app has pre-existing build errors (missing exports in `lib/ai/prompts.ts`); the student app builds cleanly. `next build` runs ESLint and **fails on errors** (e.g. `prefer-const`, unused vars) — keep code clean.

> **Verifying a build without disturbing a running dev server:** `next.config.ts` honors `NEXT_DIST_DIR`, so `cd apps/student && NEXT_DIST_DIR=/tmp/iso npx next build` (then `next start`) builds to an isolated dir. A running `next dev` writing to the shared `.next` can otherwise contaminate a `next start` (stale/404 chunks → broken hydration).

Playwright e2e tests live in `e2e/` (`playwright.config.ts`, baseURL `:3002`). Run `npx playwright test`. `e2e/demo-diagnostic.spec.ts` has two tests: the **diagnostic** journey (register → answer correctly → verify keyword states ≥ 0.70 + ratings in DB) and the **demo-practice** flow (seed `needs_lesson` → `/demo-practice` → lesson API 200 → stored in `learn_lessons`). `e2e/mcat-flow.spec.ts` walks the whole MCAT feature (landing → drill-down → practice/quiz/flashcards → progress) and screenshots each surface; its `beforeEach` registers an account + seeds auth localStorage since **MCAT is login-gated**.

---

## Architecture
Turbo monorepo — two Next.js 15 (React 19) apps, three shared packages.
- **`apps/admin`** (:3001) — problem authoring, keyword management, RAG agent.
- **`apps/student`** (:3002) — student-facing precalc/AP Calc practice platform.

Shared packages (local workspace only — **never published to npm**):
- **`@ap-calc/types`** (`packages/types/src/index.ts`) — `Problem`, `ProblemInsert`, `TopicWeights`, `APCalcUnit`.
- **`@ap-calc/supabase`** (`packages/supabase/src/index.ts`) — singleton Supabase client.
- **`@ap-calc/constants`** (`packages/constants/`) — AP Calc topics, precalc keywords, unit→keyword map.

Both apps transpile shared packages via `transpilePackages` in `next.config.ts`.

---

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=    # API routes + seed scripts
OPENAI_API_KEY=               # Problem/content generation + embeddings
```
Root `.env.local` is read by both apps and seed scripts; each app also has its own `.env.local` for overrides. API routes use the service-role key (bypasses RLS) — pattern in `apps/student/app/api/session/route.ts`.

> On-demand AI generators (`apps/student/lib/learnGenerator.ts`) fail **soft**: a bad/missing `OPENAI_API_KEY`, network error, or non-JSON model output throws a typed `LearnGenError`, and the lesson/refresher/tip/mastery-quiz routes return a structured `{ error, detail }` with status **502** instead of an opaque empty 500. If a key is set on Vercel but invalid, every AI feature 502s — check the key, not the code.

---

## Deployment
The student app **auto-deploys to Vercel production on push to `main`** (GitHub integration). The build is scoped to the student app (admin is excluded — it has pre-existing errors), **requires env vars set on the Vercel project**, and — because the git-based build only sees **committed** files — every source file must be committed (uncommitted routes/components break it even when it builds locally). Migrations are plain SQL in `supabase/migrations/`, applied manually in the Supabase SQL editor. Full details: **[docs/deployment.md](docs/deployment.md)**.

> **IRT difficulty calibration** writes `estimated_difficulty` on both `problems` and `rag_examples`. The `rag_examples` column is added by migration `20260609000000_rag_examples_estimated_difficulty.sql` — if it hasn't been applied to the live DB, `/demo` calibration degrades gracefully (resilient fallback) but won't converge. The `/demo` diagnostic is **test-like**: no per-question solution/answer reveal; the results screen auto-shows the score and offers a click-in review of right/wrong answers + solutions.
