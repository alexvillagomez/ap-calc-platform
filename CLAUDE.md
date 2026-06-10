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
| [docs/deployment.md](docs/deployment.md) | Deploying the student app to Vercel — build scoping, env vars, the commit-everything gotcha, migrations. |
| [docs/difficulty-scales.md](docs/difficulty-scales.md) | Anything involving `difficulty` / `estimated_difficulty` / `targetDifficulty`. |
| [docs/progress-report.md](docs/progress-report.md) | The `/progress` report and `learn_student_keyword_states`. |
| [docs/weights-research.md](docs/weights-research.md) | Design + simulation behind the diagnostic evidence-propagation layer. |
| [docs/platform-overview.md](docs/platform-overview.md) | A full prose walkthrough of the whole platform (long-form onboarding read). |
| [docs/research-index.md](docs/research-index.md) | Index of all research/notes files in the repo. |

---

## Commands
```bash
npm install          # Install all workspace dependencies
npm run dev          # Start both apps (admin :3001, student :3002)
npm run build        # Build all apps and packages via Turbo
npm run lint         # Lint all packages
npm run clean        # Remove .next dirs and node_modules
npm run seed:topics  # Seed topic_metadata from packages/constants/topics.json
```

The admin app has pre-existing build errors (missing exports in `lib/ai/prompts.ts`); the student app builds cleanly. `next build` runs ESLint and **fails on errors** (e.g. `prefer-const`, unused vars) — keep code clean.

> **Verifying a build without disturbing a running dev server:** `next.config.ts` honors `NEXT_DIST_DIR`, so `cd apps/student && NEXT_DIST_DIR=/tmp/iso npx next build` (then `next start`) builds to an isolated dir. A running `next dev` writing to the shared `.next` can otherwise contaminate a `next start` (stale/404 chunks → broken hydration).

Playwright e2e tests live in `e2e/` (`playwright.config.ts`, baseURL `:3002`). Run `npx playwright test`. `e2e/demo-diagnostic.spec.ts` has two tests: the **diagnostic** journey (register → answer correctly → verify keyword states ≥ 0.70 + ratings in DB) and the **demo-practice** flow (seed `needs_lesson` → `/demo-practice` → lesson API 200 → stored in `learn_lessons`).

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

---

## Deployment
The student app **auto-deploys to Vercel production on push to `main`** (GitHub integration). The build is scoped to the student app (admin is excluded — it has pre-existing errors), **requires env vars set on the Vercel project**, and — because the git-based build only sees **committed** files — every source file must be committed (uncommitted routes/components break it even when it builds locally). Migrations are plain SQL in `supabase/migrations/`, applied manually in the Supabase SQL editor. Full details: **[docs/deployment.md](docs/deployment.md)**.
