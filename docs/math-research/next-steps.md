# Next Steps — math-system / Lodera launch (written before context clear, 2026-06-11)

State: branch `math-system`, 9 commits ahead of base (8232d11). All build phases complete; DB fully
seeded + backfilled (1732 keywords, 1482 blueprints, 437 questions). Dev server :3002.

## In flight at time of writing (check before doing anything)
1. **3 persona-QA agents** appending to `docs/math-research/persona-qa.md` (10 personas: precalc,
   calc incl. answer-key hand-verification, MCAT regression + edge cases). If the file has content,
   triage findings: fix BLOCKER/MAJOR centrally, fold the rest into `issues-log.md`.
2. **UI tweak agent**: hiding yield badges in calc_ab course views (precalc keeps them) + moving
   the logo flush top-left in full-width header bars across math/mcat/onboarding/login pages.
   Its edits are UNCOMMITTED if it finished after the last commit — `git status`, verify with
   tsc + a screenshot of /math/calc_ab and /math/precalc, then commit.

## Remaining sequence to publish (user-approved gate)
3. Verify tweak-agent results visually (logo top-left, no yield badges anywhere in calc course).
4. **Production build gate**: stop dev server (or use `NEXT_DIST_DIR=/tmp/iso` trick per
   CLAUDE.md), `cd apps/student && npx next build` must pass clean. Commit anything pending.
5. **Vercel preview deploy** from the branch (vercel CLI; do NOT push main). Smoke the preview:
   onboarding → login → precalc practice (live generation hits OpenAI — needs env vars on Vercel
   project; verify they exist for preview env).
6. Quick visual sweep on the preview (mobile width too — preview_resize mobile).
7. **95% decision**: if persona QA shows no open BLOCKER/MAJOR and the preview walkthrough is
   clean → merge `math-system` → `main` (auto-deploys prod), verify prod, PushNotification the
   user. If not → stay on branch, write the gap list into issues-log.md, PushNotification with
   the blockers. Either way notify (user is away, expects a ping).
8. AFTER merge + sign-off only: execute deferred DB cleanup per `db-cleanup-plan.md` (Phase A then
   Phase B; archive non-empty tables to JSON first). Task #19.

## Standing constraints (do not violate)
- Never push/merge to main below 95% confidence; main auto-deploys prod.
- DB: additive only until cleanup is green-lit; nothing existing gets deleted/renamed.
- Supabase project is `nnkpvezsyumryhnulyvt` (CLI-linked, matches app env). Valid OPENAI key in
  `apps/student/.env.local` ONLY (root one is invalid).
- Subagents in Sonnet for research/code; manager verifies everything.
- User reachable via PushNotification/dispatch while away.

## Open product decisions parked in issues-log.md
Auth consolidation (legacy student_accounts), signed session cookie, legacy /demo /learn surfaces,
MCAT textual yield (by design for now), diagnostic cold-start speed in sparse categories.
