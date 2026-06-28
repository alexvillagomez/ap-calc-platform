# Auto Mode Overhaul — progress

Goal: make `/math/[course]/auto` a proper adaptive engine. (MCAT auto is the older
weakness-first loop; this pass targets the math engine, the developed one.)

## The 8 behaviors & where they live
Primary file: `apps/student/app/math/[course]/auto/page.tsx`
Selection: `apps/student/app/api/math/next-question/route.ts`
Mastery: `apps/student/app/api/math/attempt/route.ts` (score≥0.8 & consec≥4; client advance on streak≥3 = `MASTERY_STREAK`).

1. PER-KEYWORD lesson→flashcards→questions→mastery→advance — ALREADY mostly via
   `beginSkillIntro` (per in_depth skill) → `startSkillFlashcards` → `loadQuestion`;
   advance on `topicCorrectStreak>=MASTERY_STREAK` in `handleNext`/`advanceKeyword`. ✅ baseline.
2. SPACED REVIEW interleaved — questions already interleaved (`pickReviewKeyword`+REVIEW_PROBABILITY).
   GAP: also interleave review FLASHCARDS. → `serveNextItem`.
3. SEE-LESSON = POPUP everywhere — flashcard phase already uses `QuestionToolbar`→`LessonModal`.
   GAP: question phase had no toolbar; header "Learn this" + after-problem offer used INLINE phase.
   → add `lessonModal` state + `<LessonModal>`; convert `handleStartLesson` to popup; add toolbar to practice.
4. MASTERY drives flashcard:question RATIO + difficulty — `serveNextItem` flashShare from mastery;
   difficulty: explicit tier from current-keyword mastery passed to `loadQuestion`.
5. BAD-AT-QUESTIONS → flashcards — `serveNextItem`: recentlyBad(consecWrong>=2) → flashcards (cap 2 in a row) then easy question.
6. IN-SCOPE questions — `next-question` single-keyword filter tightened to argmax/weight-threshold tiers.
7. LESSON RECOMMENDATIONS CORRESPOND — popup keyed to `question.primary_keyword_id` (toolbar + auto-surface).
8. AUTO-SURFACE help — auto-open `LessonModal` popup on repeated misses (consecWrong>=2), once per keyword.

## Status — DONE (typecheck clean, in-browser verified)
- [x] A: popup see-lesson + toolbar in practice + auto-surface (3,7,8)
- [x] B: serveNextItem adaptive ratio + bad→flashcards + review flashcards + difficulty (2,4,5)
- [x] C: in-scope tightening (6) — argmax/weight-threshold tiers in next-question
- [x] Behavior 7 fix: lesson keyed to SERVED keyword (`servedKeywordId`), NOT
      question.primary_keyword_id (embedding could resolve to a sibling →
      mismatched lesson; observed live "signed mult/div" for a precedence Q).

## In-browser verification (precalc auto, localhost:3011)
- Per-keyword LESSON→FLASHCARDS→QUESTIONS for "Precedence of mult/division":
  lesson (Step 1/3) → flip-card flashcard (Step 2) → MCQ + mastery meter 0/3. ✓
- API order: auto-plan → practice-queue?keyword_ids=<8 topic skills> → lesson/<first skill>. ✓
- See-lesson POPUP (role=dialog) from a FLASHCARD and from a QUESTION. ✓
- Lesson popup label == served keyword ("Precedence of multiplication and division"). ✓
- In-scope: every served Q was precedence/grouping ("5(2+3)−4", "8+3·(7−5)"). ✓
- Adaptive ratio: after a wrong Q (mastery drop) the engine served a FLASHCARD
  ("Precedence of division over addition/subtraction") instead of a Q. ✓
- Auto-surface: 2 consecutive wrong Qs → lesson popup auto-opened, keyed to served kw. ✓
- Review flashcards (2) + sustained bad→flashcards (5): implemented; need accumulated
  state (past-mastered kws / repeated misses) — deep-test over time will exercise.

## MCAT parity (2026-06-24, second pass)
Mirrored the entire overhaul onto `app/mcat/auto/page.tsx` + `app/api/mcat/next-question/route.ts`.
- Shared pure helpers extracted to `lib/courseEngine/adaptive.ts` (flashcardShareForMastery,
  tierForMastery, REVIEW_FLASHCARD_SHARE, MAX_FLASHCARDS_IN_ROW, DifficultyTier) — imported by
  BOTH math and MCAT auto pages (no duplication of the curve).
- MCAT was a pre-overhaul copy of math, so it already had per-keyword LESSON→FLASHCARDS→QUESTIONS
  in CED order (1) + question-only review interleave. Added: serveNextItem (2,4,5), servedKeywordId +
  LessonModal popup + QuestionToolbar in question phase + auto-surface (3,7,8), difficulty tier from
  mastery (4), interleaved-flashcard mode in handleFlashcardNext, and the in-scope filter tighten (6).
- Bonus fix: MCAT `loadQuestion` previously hard-set `setIsReviewCard(false)`, so review questions
  wrongly counted toward the current keyword's mastery; now takes `forReview` like math.
- MCAT review keywords have no category_id → review items scope to the frontier category id.

## Notes
- Both MATH (`/math/[course]/auto`) and MCAT (`/mcat/auto`) auto engines now run the same adaptive engine.
- Key constants: MASTERY_STREAK=3; flashcardShareForMastery (0→0.5, 0.8→0.08);
  tierForMastery (easy/medium/hard by score, easy when recentlyBad);
  REVIEW_FLASHCARD_SHARE=0.4; MAX_FLASHCARDS_IN_ROW=2.
