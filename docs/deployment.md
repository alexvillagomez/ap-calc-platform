# Deployment (Vercel + Turbo monorepo)

The **student** app deploys to Vercel (project `ap-calc-platform`, internal name `student`). The GitHub integration **auto-deploys production on push to `main`** (and previews for other branches).

## Build is scoped to the student app
`vercel.json` (repo root) scopes the build so the admin app — which has **pre-existing build errors** (missing exports in `lib/ai/prompts`, missing `pdf-parse`, lint) — is not built and doesn't fail the deploy:
```json
{
  "framework": "nextjs",
  "buildCommand": "turbo run build --filter=student",
  "installCommand": "npm install",
  "outputDirectory": "apps/student/.next"
}
```
`--filter=student` still builds the shared `@ap-calc/*` workspace deps. Do **not** run an unscoped `turbo build` for deploy — admin will fail it.

## Env vars — two places, both required
1. **On the Vercel project** (Settings → Environment Variables, or `vercel env add <NAME> production`), for Production **and** Preview: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_AI_API_KEY`. Without these, the live app returns **"Supabase not configured"** at runtime.
2. **In `turbo.json` `globalEnv`** — Turbo strict mode (Vercel) **prunes any env var not declared here** from the build, so `NEXT_PUBLIC_*` won't be inlined into client bundles. The same six names are listed in `turbo.json`.

Env var changes only apply to **new** deployments — redeploy (push, or `vercel redeploy <url>`) after changing them.

## ⚠️ The git-vs-working-tree gotcha (this bit us repeatedly)
The GitHub auto-deploy builds the **committed git state**, not your working tree. If routes/pages/components exist only locally (uncommitted), the build fails with `Module not found` or the route 404s in production **even though it builds green locally**. Symptoms seen: missing `@/components/FeedbackReport`, a TS error in `api/learn/lesson` (uncommitted `category_id` fix), and `/api/demo/problems` 404 (whole untracked `api/demo/*` dirs). **Always commit all source** before relying on the deploy. Note `git add -u` only stages tracked-modified files — untracked directories must be added explicitly (`git status --porcelain | grep '^??'`).

## Verifying a build locally
- Isolated build (don't clobber a running `next dev`'s `.next`): `cd apps/student && NEXT_DIST_DIR=/tmp/iso npx next build`.
- Reproduce the exact Vercel build: `npx vercel build --prod` (reads `vercel.json`).
- Deploy prebuilt output: `npx vercel deploy --prebuilt --prod`. (Note: large uploads can be network-throttled in some sandboxes — prefer pushing to `main` and letting the GitHub integration build.)

## Migrations
Plain SQL in `supabase/migrations/`, applied manually in the Supabase SQL editor (no automated runner; no direct DB connection in CI). Routes that touch new columns are written to **degrade gracefully** pre-migration (try/catch → benign result) so a deploy doesn't hard-depend on the migration landing first.
