# Flashcard completeness + QA cleanup — progress

Session goal: 3 workstreams (flashcard completeness, wipe+regen MCAT flashcards, QA findings + UI simplify).

## WS1 — Flashcard completeness (MCAT headline)
Approach: per-SUBTOPIC (keyword) COMPLETE/MECE deck. No fixed count. Model ENUMERATES every
memorizable fact for the subtopic (within its blueprint scope contract), then emits one card per
item, then dedups. gpt-5.5 for breadth. Math kept lighter (complete coverage, no padding, default model).

- [x] Added `GEN_MODELS.flashcard = "gpt-5.5"` (config.ts)
- [ ] mcatGenerator: complete-mode generateMcatFlashcards (enumerate→emit, gpt-5.5)
- [ ] mcat flashcards route: per-keyword complete decks instead of flat category TARGET_DECK
- [ ] mathGenerator: "complete coverage, no padding" prompt (lighter)
- [ ] verify cleared subtopic regenerates complete MECE deck (amino acids + 1 metabolism/enzyme)

## WS2 — Wipe + regenerate MCAT flashcards
- [ ] Delete mcat_flashcards + dependent mcat_flashcard_attempts + mcat_flashcard_srs
- [ ] Spot-check 2 subtopics regenerate complete

## WS3 — QA findings + UI simplify
Full triage from qa-agents/*.md + docs/usage-fixes-progress.md (see session). Open items L1–L34.
Headliners called out by user: diagnostic jargon, post-signup wrong-course redirect, "Correct!"
celebration, "(Preview)" label, cold-gen latency UX, remove PROGRESS BAR, simplify/declutter.

### Done this session
- WS1: GEN_MODELS.flashcard=gpt-5.5; generateMcatFlashcards complete mode (enumerate→emit→dedup);
  mcat flashcards route generates per-keyword COMPLETE decks (uncovered keywords, ≤4/req, cap 40);
  math FLASHCARD_SYSTEM "complete coverage, no padding". VERIFIED via script: amino acids=40 MECE cards,
  glycolysis=33 content-determined cards, both MCAT-grade.
- WS2: wiped mcat_flashcards (54), mcat_flashcard_attempts (13), mcat_flashcard_srs (13) → 0/0/0.
- WS3:
  - L9 jargon → friendly "skip the placement check / Start learning" (math+mcat diagnostic).
  - L30 Correct! celebration: AnswerAffirmation component + lodera-affirm-in; wired math auto (q+quiz),
    mcat auto (q+quiz).
  - L1/L2 latency UX: GeneratingLoader (rotating msgs + shimmer + 12s reassurance); math+mcat auto loaders;
    flashcards pages loader.
  - L8 post-signup wrong course: /login destination() honors lodera_last_center.
  - L14 card counter "Card X of Y" on math+mcat flashcards pages.
  - Progress bar: already replaced by GrindMeter in auto (user's target surface).
- Notes: L12 (skip-lesson→flashcards) & L27 (breadcrumb pipe) appear already-OK in mcat auto per subagent.
  L23 "(Preview)" not found in code (likely model-generated lesson title or already removed).

### Verification (in-browser + prod API)
- WS1/WS2 end-to-end on PROD (real wiped DB): amino acids deck regenerated 37 stored (gpt-5.5, complete),
  glycolysis 25 (after retry fix). Both deep/MECE/MCAT-grade. Local script: amino 40, glycolysis 33.
- Fixed a prod bug found during verify: complete-deck gen intermittently returned 0 cards (no retry) →
  added single retry in generateMcatFlashcards + maxDuration=300 on the route. Redeployed.
- In-browser (isolated verify server :3011): GeneratingLoader live in math auto ("Finding your next
  challenge…" → rotates "Tailoring it to where you are…", shimmer bar, reassurance). Flashcards page live:
  "Building your flashcard deck…" + 12s "Still working…" reassurance, then "Card 1 of 12" counter (L14),
  FRONT face first, deep card. Diagnostic + auto flow healthy, no breakage.
- AnswerAffirmation: wired in 4 reveal spots (math+mcat practice & mini-quiz), compiles/builds/deploys;
  not reached in live click-through (requires completing a full cold lesson+flashcard sequence) — verified
  by code review + the identical loader pattern rendering correctly.

### Deploy
- Prod: https://www.lodera.ai (project ap-calc-platform). Two deploys: initial batch, then retry/maxDuration fix.

### DB-first fix (existing deck loaded slow as if generating)
Root cause: the per-subtopic complete-deck block `await`ed up to 4 gpt-5.5 decks for UNCOVERED sibling
subtopics on EVERY category-scoped visit, BEFORE serving — so even a category with stored cards blocked
~70s. The math route had the analogous blocking TARGET_DECK + top-up `await`s.
Fix (both routes): compute scoped stored cards FIRST; SERVE immediately whenever in-scope cards exist;
generate synchronously ONLY when scopedFcs is empty (brand-new subtopic — bounded to ONE complete deck);
all other fill (uncovered siblings / top-up) runs in the BACKGROUND via Next `after()`. Complete-deck
enumeration is gated on `!coveredKwIds` so a covered subtopic never re-generates. Files:
app/api/mcat/flashcards/route.ts, app/api/math/flashcards/route.ts (+ `after` import).
Verified on prod: existing MCAT amino (185 cards) 3.3s, math calc_unit_1 (27) 2.6s — were ~70s.
Brand-new category ~30-62s (one-time, loader justified). `after()` confirmed working (cell_structure
grew 25→64 cards in background). In-browser: both amino + calc_unit_1 load straight to "Card 1 of N", no
"Building your flashcard deck" spinner.

### Addendum — lesson/refresher access on flashcard surfaces
Mirror the question toolbar's "Quick refresher" / "Take a lesson" onto flashcard views. Reused the existing
`QuestionToolbar` (contentType="flashcard", keyword from `primaryKeywordId(card.keyword_weights)`).
- MCAT standalone flashcards page — ALREADY had it (pre-existing).
- Added: math standalone flashcards (app/math/[course]/[categoryId]/flashcards/page.tsx),
  Anki mode (components/cards/CourseCardsMode.tsx, both math+mcat), math auto warm-up
  (app/math/[course]/auto/page.tsx flashcard phase), MCAT auto warm-up (app/mcat/auto/page.tsx).
- Verified in-browser: math standalone + Anki show Quick refresher/Take a lesson/Prioritize on a card;
  refresher panel opens (aria-expanded=true, close button mounts); `/api/math/refresher/{kw}` and
  `/math/lesson/{kw}` both 200. Deployed to prod.

### Deferred (with reason)
- L1 true latency (backend prefetch/cache) — large; only loading-UX shipped.
- L16 per-page understanding quizzes in MCAT lessons; L10 auto-advance; L11 dup questions; L13 flashcard
  redirect; L17 session expiry; L6 streak 401; L9 diagnostic dead-end(BUG-01) — deeper/risky, next sprint.

