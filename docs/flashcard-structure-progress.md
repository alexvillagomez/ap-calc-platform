# Flashcard Restructure — Progress / Design (2026-06-24)

Goal: hierarchical, MECE, in-order, state-universal flashcards. ONE small deck PER in_depth
keyword. Category/umbrella/keyword Flashcards walk the keyword decks IN ORDER (order_index).
Continuous spacing (per-card SRS); in-order first, then random-weighted-by-weakness once
everything in scope is known. Gloss over already-known (mastered) decks. Universal per-user
state (keyword mastery + per-card SRS) shared across auto / category-flashcards / stream /
practice / quiz. Wipe all flashcards + deps; regenerate on demand.

## Current architecture (audited)
- Cards stored in `mcat_flashcards` / `math_flashcards`, keyed by `category_id`, tagged via
  `keyword_weights` JSON. Stored-preferred (generate once, reuse). Shared across users.
- `mcat_flashcard_srs` (per session+card Leitner box) EXISTS. `math_flashcard_srs` did NOT —
  math had no cross-session SRS. **(added in this work)**
- `*_student_keyword_states` (per session+keyword score/state) shared across all surfaces already.
- Playback: `components/cards/CourseCardsMode.tsx` = continuous stream that walked CATEGORY
  units. Scoped pages (`/{mcat|math}/.../flashcards`) had bespoke 8–12-card loops, NOT a full
  in-order keyword walk; math passed umbrella id AS keyword_id (wrong).
- API `/api/{mcat,math}/flashcards`: category+keyword(_ids) scope, `curriculum_order` flag, returns box.
  MCAT already generates a COMPLETE per-keyword deck for uncovered keywords (`complete:true`,
  gpt-5.5, sibling-aware). Math generated a small WHOLE-CATEGORY deck (not per-keyword).
- Scale: categories have 45–149 in_depth keywords → 45–149 small decks per category walk. Lazy.

## Design (implemented)
- **primary_keyword_id** column on both flashcard tables → each card owns exactly ONE keyword deck.
  Set at generation insert (gen is per-keyword). Index (category_id, primary_keyword_id, status).
- **math_flashcard_srs** table mirrors mcat → math now has universal per-card SRS; math
  flashcard-attempt writes it, math flashcards route reads box. Universal state achieved.
- **Per-keyword generation** for BOTH systems (math generator gained complete/sibling/categoryLabel).
  Cross-deck MECE: prompt sibling scope + a category-wide front-dedup pass before insert.
- **/api/{mcat,math}/deck-plan** (new): given scope (keyword | umbrella+category | category | whole
  course), returns ordered in_depth keyword list `{id,label,category_id,category_label,order_index,
  score,mastered,card_count}` sorted by (category order_index, keyword order_index). Drives the walk + gloss.
- **CardWalk engine** = generalized CourseCardsMode, scope-aware, driven by deck-plan keyword list:
  - frontier walks keywords IN ORDER; lazily loads each keyword's deck (keyword_id scope).
  - **Gloss-over:** frontier SKIPS mastered keywords (known from auto/other modes) — not introduced,
    not generated. Their cards don't re-drill.
  - spacing: due reviews first (Leitner box), then fresh in order.
  - **random-when-known:** once frontier exhausted + no fresh, switch to weakness-weighted random
    among in-rotation cards (emphasis on lower box / lower score).
  - used by all 4 surfaces: `/mcat/cards`, `/math/[course]/cards`, `/mcat/[categoryId]/flashcards`,
    `/math/[course]/[categoryId]/flashcards`.

## Universal state unification
- keyword mastery: `*_student_keyword_states` (already shared) — read by deck-plan gloss + practice/quiz.
- per-card SRS: `*_flashcard_srs` — math table ADDED; both attempt routes write, both flashcards
  routes read box. Same engine + same attempt routes across every surface → learned-in-auto =
  glossed-in-category and vice-versa.

## Wipe (DB workflow, direct SQL)
Before: mcat_flashcards 74, math 0, mcat_attempts 12, math_attempts 0, mcat_srs 10, math_srs (none).
Target: all 0. Regeneration on demand under new per-keyword/MECE scheme.

## Status checklist
- [x] DB: primary_keyword_id cols + math_flashcard_srs + indexes (migration 20260624000000, applied)
- [x] Wipe (confirmed 0/0/0/0/0/0)
- [x] Math generator: complete/sibling/categoryLabel + MECE dedup
- [x] flashcards routes: per-keyword gen + primary_keyword_id + cross-deck dedup (both)
- [x] deck-plan routes (mcat + math)
- [x] CardWalk engine (CourseCardsMode scope-aware) + rewire 4 pages
- [x] math flashcard-attempt writes math_flashcard_srs (universal SRS)
- [x] build/lint/types (isolated next build passed)
- [x] in-browser verify (see below)
- [x] deploy — https://www.lodera.ai (dpl_5JR2LMzQw7b2uF2rxcbS7T9dGm82); prod deck-plan smoke-tested OK

## Batch 2 — auto/flashcard/UI cleanup (2026-06-24, deployed ap-calc-platform-fiqvla5do)
- **Universal flip-card:** new `components/cards/FlipCard.tsx` (tap-to-flip, Missed it/Got it/
  I didn't know this). Used by standalone flashcards (CourseCardsMode) AND both auto-mode
  flashcard steps. Auto no longer uses the ANSWER/Next-card reveal. Auto flashcard grading
  writes the universal SRS (flashcard-attempt).
- **Order enforcement:** auto per-topic flow is lesson→flashcards→quiz; `startSkillFlashcards`
  retries once on an empty cold deck before falling through (fixes intermittent lesson→quiz skip).
- **Removed:** "STEP 2 OF 3 / FLASHCARDS · N OF M" labels, warm-up framing + Skip buttons,
  visible timer (QuestionToolbar; timing metrics kept), big GrindMeter bar (now `hidden` prop —
  still records, renders null) on auto/practice/quiz/flashcards, "✅ Nice!" affirmation box
  (AnswerAffirmation returns null on correct; CorrectPulse green flash is the affirmation),
  inline emojis in text (✗/✓ grade+choice badges, ×🔥, 🔥 headers, 🎉 in strings).
- **Auto header:** bold "← MCAT"/"← <course>" back button; dropped "N/M · Topic x/y" / "Unit x/y"
  counters (kept topic title).
- **Verified live (dev):** standalone flip-card (flip + Got it/Missed it, no timer/bar/emoji);
  auto header bold back + no counters/timer/bar; choices show A/B/C/D (no ✓/✗); correct answer →
  CorrectPulse green flash + NO "Nice!" box + explanation renders; incorrect → "Not quite" (no emoji).
- **WIPE HELD** (cost): did NOT wipe lessons/refreshers, did NOT re-wipe flashcards or mass-generate.
- **Flashcard model config:** `apps/student/lib/courseEngine/config.ts:51` → `flashcard: "gpt-5.5"`.
  Both generators read `GEN_MODELS.flashcard`; change this one line to `"gpt-5.4-mini"` to flip cheap.

## Batch 3 — all-mini + wipe + figures (2026-06-24, deployed ap-calc-platform-juma8q2rd)
- **All generation on gpt-5.4-mini:** every `GEN_MODELS` entry (default/question/mcatLesson/flashcard)
  = mini. Fixed `mathGenerator` QUESTION_MODEL (was hardcoded "gpt-5.5") to read the registry.
  No task uses gpt-5.5. To restore a larger model for one task, edit that one `GEN_MODELS` entry.
- **Wipe (cost-OK now):** mcat+math flashcards/attempts/srs/lessons/refreshers → confirmed 0 before/after.
  Before: mcat_flashcards 43, math 4, mcat_lessons 48, math_lessons 24, mcat_refreshers 30,
  math_refreshers 12 (+attempts). After: ALL 0. Regenerate on demand on mini with figures.
  (State tables — keyword_states, intro_seen — untouched.)
- **Figures emit on mini:** figureGuidance reframed optional→MANDATORY-ON-VISUAL-TOPICS; added keyed
  mandatory USER-message figure directives (MCAT lessons + MCAT/math flashcards; math lessons already
  had one). Verified on mini + IN-BROWSER: amino-acid backbone card renders a glycine `<Molecule/>`
  skeletal formula; ETC lesson emits `<Mermaid>` pathway; rational-HA lesson renders a 1/x
  `<FunctionGraph>` with the y=0 asymptote.

## Verification (dev server :3011, real session)
- deck-plan amino_acids: 58 keywords in curriculum order; mastered keyword → mastered:true (gloss).
- deck-plan umbrella scope: exactly the 8 children, in order. keyword scope: exactly 1.
- per-keyword gen: "Ionizable Groups" → 15 MECE cards (mixed cloze/Q→A, MCAT depth), all 1 primary_keyword_id.
- math deck-plan calc_unit_1: 59 kw, starts at Limits (CED order). per-keyword gen → primary set, box/memorized fields.
- math flashcard-attempt → math_flashcard_srs row created (box 3) = universal SRS.
- LIVE UI: /mcat/<cat>/flashcards starts at keyword 1 "Peptide bond formation by condensation" in order. ✓
- Note: rapid overlapping gen calls contend on the per-cell gen lock (returns 0, engine skips ahead);
  single-user cold visits generate keyword 1 synchronously and start there.

## All-mini + figures + hydration fix (2026-06-24, deployed ap-calc-platform-kn1cdp7s0)
- **All generation on gpt-5.4-mini:** every `GEN_MODELS` entry = mini (config.ts); fixed math
  QUESTION_MODEL that was hardcoded "gpt-5.5". No task uses gpt-5.5.
- **Wiped to 0** (mcat+math flashcards/attempts/srs/lessons/refreshers); regenerate on demand on mini.
- **Figures emit RELIABLY on mini:** figureGuidance reframed optional→MANDATORY-on-visual-topics;
  added keyed MANDATORY user-message figure directives (lessons + flashcards, both systems). Flashcard
  directive made hard (≥1 structure/graph card required on a visual deck).
- **FIXED `<div>`-in-`<p>` hydration bug** that displaced figures: FlipCard + math/mcat LessonView
  wrapped MathText (which emits a figure `<div>`) in a `<p>`. Switched to `<div>`.
- **Verified on mini (in-browser screenshot):** amino-acid flashcard renders an alanine `<Molecule/>`
  skeletal structure; glycolysis lesson `<Mermaid>`; ATP lesson `\ce{}`; rational-hole lesson
  `<FunctionGraph holes>`.
- **Deploy hygiene:** deployed only my committed work via a clean git worktree at HEAD (another
  session was mid-edit on the auto-mode overhaul in the same tree).
