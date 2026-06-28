# Codex Work Log

Date: 2026-05-28

## Student App Changes

- Fixed the general diagnostic persistence gap in `apps/student/app/api/learn/classify/route.ts`.
  - After `/precalc/diagnostic` classifies answers, it now also seeds `student_sessions.keyword_strengths`.
  - The update is merged with existing strengths instead of replacing all history.
  - Both existing and new keys are filtered to approved `learn_keywords`, so legacy keyword IDs do not remain in the student strength map.

- Tightened keyword-strength updates in `apps/student/app/api/record-attempt/route.ts`.
  - Practice attempts now validate submitted `keywordWeights` against approved `learn_keywords`.
  - Attempts with no approved learn keywords skip strength updates instead of writing irrelevant IDs.
  - Existing `keyword_strengths` are filtered before writing the updated map.

- Sanitized free-practice candidate selection in `apps/student/app/api/precalc/next-problem/route.ts`.
  - Free practice loads approved `learn_keywords` and filters both session strengths and candidate `keyword_weights` to that vocabulary.
  - Candidates with no approved learn keyword overlap are dropped before scoring.

- Made first answers establish a stronger benchmark.
  - `apps/student/lib/practiceAlgorithm.ts`: first observed strength update now benchmarks full-weight correct at `0.75` and full-weight wrong at `0.25`; later attempts keep the existing EMA.
  - `apps/student/lib/diagnosticScoring.ts`: diagnostic scoring now uses the same first-answer benchmark behavior.
  - `apps/student/app/api/learn/practice/attempt/route.ts`: first learn-practice attempts now pass empty score seeds so the scoring helper can distinguish a true first answer from a prior score of `0.5`.

- Fixed auth/demo polish.
  - `apps/student/app/login/page.tsx` now requires `sessionId`, stores it consistently, and redirects successful auth to `/precalc` instead of the legacy `/` practice app.
  - Added programmatic labels for username/password fields on `/login` and `/precalc`.
  - Added distinct aria labels for create-account tabs so browser automation and assistive tech can distinguish tab switching from form submission.
  - Replaced the user-facing seed-script message on `/precalc` with demo-safe copy.

## Admin App Changes

- Restored the admin home page navigation in `apps/admin/app/page.tsx`.
  - The admin pages were still present on disk, but `/` only linked to two routes.
  - The home page now links to the existing admin tools: generation, RAG agent, RAG examples, keyword engine, add keyword, deduplication, similarity test, tagging, lookup, compare, and preview pages.

## Verification

- `npm run build --workspace student` passes.
  - Existing warnings remain in `app/api/learn/practice/next/route.ts`, `app/learn/page.tsx`, and `app/page.tsx`.

- Direct first-answer strength check passed:
  - first correct with weight `1` -> `0.75`
  - first wrong with weight `1` -> `0.25`
  - first correct with weight `0.5` -> `0.625`
  - later correct from `0.75` -> `0.78`

- Local API verification against the restarted student dev server passed.
  - Fresh account registration succeeded.
  - Four diagnostic answers followed by `/api/learn/classify` produced non-empty `student_sessions.keyword_strengths`.
  - Sample persisted keys were approved learn keywords such as `negative_exponents`, `power_of_a_product`, and `product_rule_for_exponents`.

- Local admin home verification passed.
  - `http://127.0.0.1:3001/` includes links for `Problem generation`, `RAG problem agent`, `Keyword engine`, `Tagging pipeline`, `Problem lookup`, `Compare text`, and `Preview from JSON`.

## Known Remaining Issues

- `npm run build --workspace admin` still fails on pre-existing admin issues unrelated to the home-page navigation change.
  - Missing exports from `lib/ai/prompts` used by RAG-agent routes.
  - Missing `DIFFICULTY_SCALE` export used by RAG problem code.
  - Existing lint errors for unescaped quotes in `apps/admin/app/keywords/page.tsx` and `apps/admin/app/tagging/page.tsx`.

- `topic_weights` should not be deleted yet.
  - It is still used by the legacy student `/` practice page, `/api/next-problem`, `/api/topics`, and the topic-strength branch of `/api/record-attempt`.
  - The investor-facing precalc flow now uses `learn_keywords` for keyword strengths, but a schema migration to remove `topic_weights` needs a separate compatibility cleanup.

- The working tree had unrelated pre-existing edits before this pass, including changes in lookup, next-problem, Preview, and generated/local files. Those were not reverted.
