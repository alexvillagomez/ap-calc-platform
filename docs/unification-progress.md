# Unification Progress (features-v2)

Tracking the course-framework unification per user overrides (routes stay separate, DB stays separate, emphasis in code).

## Overrides (authoritative)
1. Unify the shared FRAMEWORK/core libs/components/flow into a generic engine parameterized by a CourseConfig registry (generalize the `system:"math"|"mcat"` pattern).
2. DO NOT unify API routes — keep `/api/math/*` and `/api/mcat/*` separate; they become thin wrappers over shared core.
3. DO NOT unify DB — keep `math_*` / `mcat_*`; new course = own tables. Organize tables into per-course folders/naming where tooling allows.
4. Emphasis config stored in code (registry).
5. URL scheme unchanged (`/math/[course]`, `/mcat`).
6. Fix embed scripts (Node 20 lacks global WebSocket → supabase-js realtime throws).

## Headline feature — emphasis → serving mix
`flashcardShare(course, proficiency)` curve, course-specific endpoints:
- calc_ab + precalc: ~90% quiz / 10% flashcards across the board.
- mcat: ~only flashcards at low proficiency, shifting to ~80% quiz / 20% flashcards once proficient.
Proficiency = mastery/score on current material. Mastery SCORING unchanged; only flashcard-vs-quiz SERVING mix driven by emphasis. Replaces hardcoded magic numbers (math 3 cards/streak-3, MCAT 3 warmup/streak-4).

## Phases
- [ ] Phase 0: parity approach (doc + lightweight snapshot)
- [x] Phase 1: emphasis config real — DONE
      - `lib/courseEngine/config.ts`: CourseConfig + COURSE_REGISTRY (precalc, calc_ab, mcat_bio) + `flashcardShare`/`warmupFlashcardCount`/`masteryStreakFor`/`reviewProbabilityFor`.
      - math auto page: MASTERY_STREAK/REVIEW_PROBABILITY from registry; warm-up card count = warmupFlashcardCount(course, proficiency). Proficiency = frontier category avg_score (fallback kw.score).
      - mcat auto page: same; COURSE_ID="mcat_bio"; fetchFlashcards takes count; removed MAX_WARMUP_FLASHCARDS cap → uses flashcards.length.
      - tsc --noEmit clean.
- [x] Phase 0: parity approach — `scripts/check-emphasis.ts` (`npm run check:emphasis`) + docs/unification-parity.md. All green.
- [x] Phase 2: consolidate shared libs — `lib/courseEngine/embeddings.ts` (cosineSimilarity/tagByEmbedding/embedTextRaw/EmbeddingError); mathTagging & mcatTagging re-export + wrap typed errors. Registry in config.ts.
- [x] Embed-script fix — `scripts/lib/serviceClient.ts` (ws transport); embed-math/embed-mcat use it. Both run dry-run on Node 20.
- [x] Per-course table folder organization — `supabase/schema/{README,math,mcat}.md` (naming convention + inventory; migrations stay flat for the runner).
- [x] Verify — tsc clean; isolated `next build` clean (eslint+types); in-browser: both auto pages mount, MCAT guided flow ran lesson→flashcard-fetch→practice w/ no console errors. Deployed prod → https://www.lodera.ai (READY).

## DONE — deploy
Prod: https://ap-calc-platform-fy9adp99q-alexvillagomezs-projects.vercel.app → aliased www.lodera.ai. All key routes 200.

## Notes / deferred
- This DB has 0 seeded mcat_questions/mcat_flashcards → couldn't visually count served flashcards in-browser (on-demand gen against empty tables is slow). Emphasis verified deterministically via check:emphasis.
- Pre-existing security advisory: 32 tables have RLS disabled (math_*/mcat_* etc). Not introduced by this work — flag to user.
- Did NOT merge the two 1900/1600-LOC auto pages into one file (high-risk, routes/pages stay separate per constraints 2/5). Shared logic lives in courseEngine; both pages call it. Generator unification deferred (design Phase 3, gated on in-flight work).

## Emphasis curve (implemented)
flashcardShare(courseId, proficiency) = lerp(low→high over [0,proficientAt]).
- math (precalc/calc_ab): low .10, high .10 (flat), budget 3, minCards 1, streak 3 → ~1 card always (quiz-dominant).
- mcat_bio: low .92, high .20, proficientAt .6, budget 12, minCards 1, streak 4 → ~11 cards unproficient → ~2 proficient.
warmupFlashcardCount = clamp(round(share*budget), minCards, budget).

## Key findings
- math auto page: `apps/student/app/math/[course]/auto/page.tsx` (1902 LOC). Consts: MASTERY_STREAK=3, MINI_QUIZ_COUNT=4, TOPIC_FLASHCARD_COUNT=3.
- mcat auto page: `apps/student/app/mcat/auto/page.tsx` (1621 LOC). Consts: MASTERY_STREAK=4, MINI_QUIZ_COUNT=4, MAX_WARMUP_FLASHCARDS=3.
- Tagging trio (`cosineSimilarity`/`embedText`/`tagByEmbedding`) is bit-identical in mathTagging.ts & mcatTagging.ts. `loadTargetKeywords` differs (math paginates+course filter; mcat single-shot; yield_score vs yield_level).
- Already shared via `system` param: questionEnrichment, refresherGenerator, assembleChoices, scienceNotation, bestKeyword, QuestionToolbar.
- embed scripts: createClient(url, key) with no opts → realtime WS init. Fix = disable realtime.

## Decisions
- Shared core dir: `apps/student/lib/courseEngine/`.
