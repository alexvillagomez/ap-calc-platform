# Usage-Fixes Progress (2026-06-22)

Batch of fixes/features from real-usage QA (qa-agents/*.md). Working autonomously, phased + verified, deploy as we go.

## Status legend: ⬜ todo · 🔬 investigating · 🔨 building · ✅ done+verified · 🚀 deployed · ⏸️ deferred

| # | Item | Status | Notes |
|---|------|--------|-------|
| P0.1 | Mastery resets on reopen | 🚀 | FIXED+VERIFIED+DEPLOYED. master-skill endpoints + auto-plan oversized-.in() fix. API test: master topic1 → reopen resumes topic2. |
| P0.2 | Universal on-demand generation | 🚀 | DEPLOYED. Flashcard runGeneration closure + scoped top-up (empty OR seen-all), seeded from existing. Serve verified (3 cards). |
| P1.3 | Amino acid memorization flashcards | 🚀 | DEPLOYED. MCAT generator gets amino-acid memorize-the-20 directive. |
| P1.4 | Topic order everywhere (curriculum order_index) | 🚀 | DEPLOYED. progress + mcat browse now preserve taxonomy (order_index) order. |
| P2.5 | Lodera logo clickable → home | 🚀 | DEPLOYED+VERIFIED. /math /mcat /profile logo → Link to /. Browser: click → navigates to /. |
| P2.6 | Remove UI cruft ("low sample n=1") | 🚀 | DEPLOYED. 5 LowSampleBadge sites → "Not enough data yet" neutral. |
| P2.7 | Streak redesign → top, fire/grind meter | 🚀 | DEPLOYED+VERIFIED. New GrindMeter; moved off between-Q/choices to top on auto+all practice/quiz/flashcard pages. Browser screenshot confirms placement+fire motif. |
| P3.8 | Flashcard-only Anki-like mode | 🚀 | DEPLOYED+VERIFIED. New CourseCardsMode + /mcat/cards + /math/[course]/cards; walks decks in curriculum order, Leitner SRS, front-first, entry cards on landings. Browser: MCAT 10 decks + math 8 decks load, grade advances. (existing /anki = separate user-upload feature, untouched.) |

## Addendum (folded into this session)
| # | Item | Status | Notes |
|---|------|--------|-------|
| A | MCAT memorization-first (lesson→flashcards→quiz, volume, depth) | 🚀 | DEPLOYED. Order enforced; volume raised (topic-scoped warm-up + cap [6,12]); depth via system prompt + amino booster. |
| B | Prerequisite "See also" panel | 🚀 | DEPLOYED+VERIFIED. /api/{math,mcat}/prereqs + PrereqSeeAlso in QuestionToolbar (universal) + lesson pages. Live endpoints return real data; math panel browser-verified. |

## Deploy log
- P0/P1 (f125d1f) → prod https://www.lodera.ai (dpl_6WwmYDhfgf22nkPbbWLYrsVBgptk). Smoke-tested: master-skill 400, auto-plan 200.
- P2 (72914ea) → prod https://www.lodera.ai (ap-calc-platform-oy6f3qrxg). Browser-verified logo nav + GrindMeter placement.
- P3 (a62a65d) → prod https://www.lodera.ai (ap-calc-platform-lc8jtst26). Smoke-tested /mcat/cards 200, /math/calc_ab/cards 200.
- Addendum A+B (978d275) → prod https://www.lodera.ai (ap-calc-platform-1d1u93y3t). MCAT volume + prereq "See also". Smoke-tested both prereq endpoints return real data.

## Findings

### P0.1 ROOT CAUSE (confirmed)
- Frontier in `/api/math/auto-plan` (and mcat) = first topic with a skill whose `state !== 'mastered'`.
- Client advances a skill when `topicCorrectStreak >= MASTERY_STREAK` (math=3, mcat=4) — `app/math/[course]/auto/page.tsx:925` `advanceKeyword`.
- Server marks skill `mastered` ONLY when `score >= 0.8 AND consecutive_correct >= 4` — `app/api/math/attempt/route.ts:277`. EMA (lr 0.12) from 0.5 reaches ~0.70 after 4 correct, ~0.82 after 8. So a topic "completed" in UI is NEVER mastered server-side.
- Result: server frontier never advances → reopen resets to start / re-serves mastered topic's lesson.
- Secondary: `intro_seen` persisted fire-and-forget (`markIntroSeen`), can be lost.
- **Fix:** add authoritative `POST /api/{math,mcat}/master-skill` that sets `state='mastered'` + `intro_seen=true` + spaced-review when the client advances a skill by streak (`wasMastered`). Keep EMA mastery as an additional earlier path. Makes server frontier match what the user actually did.

### P0.2 (generation) map
- Flashcards generate only when `allFcs.length < TARGET_DECK` (deck-extend); never on per-request exhaustion / "seen all". Math flashcard gen has NO template param; MCAT passes `templateCards`.
- Questions: batch-on-miss recycle exists (cold=6/warm=4) but only fires when stored candidates miss difficulty/scope; no "user has seen everything" trigger; no seeding from existing items.
- **Fix:** add exhaustion trigger (all scoped items already seen) → generate seeded from existing items as templates. Add template param to math flashcard gen.

### P1.4 (ordering) map
- Taxonomy APIs already return categories+umbrellas in order_index order. BUG is client `sortUmbrellas()`/`sortChildren()` (attempts-then-score) in: math/progress, mcat/progress, mcat/[categoryId]. Replace with order_index/API order.

### P2 map
- Logo not clickable on `/math`, `/mcat`, `/profile` (raw `<LoderaLogo>` no Link). Home = `/`.
- Streak `<ComboMeter>` sits between question & choices on all practice/quiz/auto surfaces; top progress bars in auto pages. Move streak to top as fire grind-meter, replacing progress indicator.
- "low sample (n=X)" badge in progress pages → "Not enough data yet" or hide.
