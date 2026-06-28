# Parity Approach (Phase 0)

Goal: confirm math and MCAT behavior is **unchanged** by the unification, **except**
the intended new emphasis behavior (proficiency-gated flashcard/quiz mix).

## Why parity holds largely by construction

The unification so far is **extraction + relocation, not logic change**:

1. **Constants relocated, values identical.** The hardcoded magic numbers
   (`MASTERY_STREAK` 3/4, `REVIEW_PROBABILITY` 0.35) now come from
   `COURSE_REGISTRY[course].emphasis` with the *same values*. Nothing else in the
   selection / mastery / plan / diagnostic / generation code changed.
2. **Tagging trio deduplicated, behavior preserved.** `cosineSimilarity`,
   `tagByEmbedding`, and the embedding call were bit-for-bit identical in
   `mathTagging.ts` / `mcatTagging.ts`; they now have one implementation in
   `lib/courseEngine/embeddings.ts`, re-exported by both. `embedText` still throws
   the same typed `MathGenError` / `McatGenError` with the same status codes
   (500 no-key, 502 request-fail), so the soft-fail contract is unchanged.
3. **The one intended change:** the warm-up flashcard COUNT is now
   `warmupFlashcardCount(course, proficiency)` instead of a fixed `3`. This is the
   headline feature, not a regression.

## Automated check

`npm run check:emphasis` (`scripts/check-emphasis.ts`) asserts both halves and
exits non-zero on any mismatch:

- **(A) Parity** — relocated constants equal their old values
  (precalc/calc_ab streak 3, mcat streak 4, review 0.35 all).
- **(B) New behavior** — the emphasis curve: math quiz-dominant & flat (share
  ≤ 0.15, ~1 warm-up card at every proficiency); MCAT flashcard-dominant when
  unproficient (share ≥ 0.80, ≥ 8 cards) shifting to ~80% quiz when proficient
  (share ≤ 0.25, ≤ 3 cards), strictly decreasing with proficiency.

Observed curve:

```
calc_ab   share/cards @ proficiency  0.00:0.10/1c  0.25:0.10/1c  0.50:0.10/1c  0.75:0.10/1c  1.00:0.10/1c
mcat_bio  share/cards @ proficiency  0.00:0.92/11c 0.25:0.62/7c  0.50:0.32/4c  0.75:0.20/2c  1.00:0.20/2c
```

## Manual / in-browser parity

Both guided flows are unchanged in structure (LESSON → FLASHCARDS → PRACTICE →
QUIZ, spiral review, mastery gate). The only observable difference:

- **MCAT auto**, fresh topic (low proficiency): shows a long flashcard warm-up
  (many cards) before practice. Later in a unit (higher avg proficiency): fewer
  warm-up cards before practice.
- **Math auto** (precalc/calc_ab): ~1 warm-up card then straight to quiz at any
  proficiency.

Build + typecheck + lint are clean; existing Playwright e2e
(`e2e/mcat-flow.spec.ts`, `e2e/demo-diagnostic.spec.ts`) still drive the same
routes and selectors (URLs unchanged per constraint #5).
