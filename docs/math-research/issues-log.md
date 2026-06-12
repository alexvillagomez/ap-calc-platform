# Issues Log — math system + Lodera build (branch `math-system`)

Consolidated for review. QA persona findings (raw, with repro steps) land in
[persona-qa.md](persona-qa.md) as the three persona squads finish.

## Found and FIXED during the build (manager QA)

| Sev | Issue | Fix |
|---|---|---|
| BLOCKER | PostgREST silently caps queries at 1000 rows — taxonomy/practice-queue/auto-plan loaded only ~⅓ of a course's 1700+ keywords (UI showed "37 keywords" for a 111-keyword category) | `lib/mathPagedQuery.ts` pagination helper; patched taxonomy route, `loadTargetKeywords`, auto-plan. Backfill agent independently hit + fixed the same cap in `scripts/embed-math.ts` |
| MAJOR | Generated solutions rendered as raw LaTeX (`\text{...} \dfrac{-9}{-3}`) — the generator prompt's own example taught bare LaTeX without `$` delimiters | Prompt rules rewritten (prose + `$...$`); `MathText` got a bare-LaTeX detection fallback so the ~6 already-stored generated questions render too |
| MAJOR | Auto mode's focused practice (`keyword_ids`) silently fell back to whole-category queues — practice-queue only parsed singular `keyword_id` | Route now accepts repeated `keyword_ids` params |
| MAJOR | `math_flashcards` DB columns (`front`/`back`) mismatched the generator (`front_latex`/`back_latex`) | Rename migration `20260614000001` (table was empty) |
| MINOR | Exemplar fetcher ranked `rag_examples` by a keyword-count heuristic, claiming no embedding column exists — it does (1536-dim) | Cosine-similarity ranking on the real embeddings |
| MINOR | 3 of 777 legacy precalc keywords lost their mapping in the MECE merge (`independent/dependent_linear_systems`, `rational_exponent_radical_equivalence`) | Hardcoded yield write-back for those 3; old rows untouched |
| POLISH | Math UI primary buttons were `bg-neutral-900` (off-brand); streak chip showed a dead "0" for new users; login email placeholder duplicated | Brand-blue primaries; badge hidden until streak ≥ 1 (appears with day-1 celebration); placeholder de-duplicated |

## OPEN / DEFERRED (decide on review)

1. **DB cleanup — DEFERRED by user.** Full evidence-backed plan in
   [db-cleanup-plan.md](db-cleanup-plan.md). Phase A (drop-safe now): `learn_diagnostic_problems`
   (0 rows), ghost column `student_sessions.prereq_strengths`. Phase B (only after merge):
   `problems` (0 rows, legacy), `student_problem_attempts`, `student_accounts` (17 real users —
   needs migration path), `learn_refreshers`, several stale columns. Execute nothing until sign-off.
2. **Two parallel auth systems coexist.** New `app_users` (email+password, `lodera_uid` cookie)
   vs legacy `student_accounts` (username-only, used by `/api/auth/register` + old demo flows).
   Works today (LoginGate hydrates legacy localStorage keys) but should be consolidated; the 17
   existing `student_accounts` users have no email and can't log into the new flow.
3. **Cookie is the bare user UUID** (httpOnly, 1yr). Unguessable in practice but unsigned — fine
   for no-verification beta, should become a signed session token before real launch.
4. **`learn_keywords.yield_score` is write-only** — populated by the write-back but no student
   route reads it (live reads use `math_keywords.yield_score`). Kept for data continuity.
5. **Quiz progress dots**: current-question dot is `neutral-900` while answered are brand-blue —
   arguably fine, flagging for design consistency.
6. **Old learn/demo surfaces (`/demo`, `/demo-practice`, `/learn`, `/ap-calc-practice`) left
   untouched** per "don't delete" — they still use the old Gemini generator and old styling.
   Decide post-launch whether to retire or restyle.
7. **MCAT yield badges still show high/medium/low** (textual), unconverted by design — user asked
   for numeric yield on the math side only. Calc course now hides yield badges entirely (yield
   still drives selection); precalc shows numeric badges.
8. **Diagnostic question supply**: with only 437 stored questions (mostly polynomials-area
   imports), early diagnostics in sparse categories lean on live generation (slower first
   experience, ~5-10s/question). Warms up as the pool grows through use.

## Persona QA (10 personas, 3 squads) — see [persona-qa.md](persona-qa.md)
Running at time of writing: precalc journeys (beginner/shaky/overachiever), calc journeys
(strong-precalc/weak-trig/crammer incl. hand-verification of every answer key), MCAT regression +
persistence + feedback/flagging + API edge cases. Findings will be appended there with
[BLOCKER]/[MAJOR]/[MINOR]/[POLISH] tags; unfixed items get folded into this log.
