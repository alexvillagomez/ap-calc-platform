# Retention QA — "Would a student pay for this?" (2026-06-17)

Two persona agents walked the real journey as picky students with free alternatives
(Khan Academy, Anki) and answered the money question. Screenshots:
`apps/student/test-results/persona-calc/` and `apps/student/test-results/persona-pcmcat/`.

## Verdict

**All three personas (AP Calc, Precalc, pre-med MCAT): "No, not at $10/month — yet."**
Not because anything is broken — the *bones are good and the content quality is real* — but
because the **new-user experience doesn't show the value before friction kills momentum.**
The two killers, named independently by every persona: **latency** and **no reward/dopamine.**

## Top deterrents (ranked by how much they block returning + paying)

1. **HIGH — Latency between questions and on first lesson/flashcard (5–30s).**
   "Finding your next question… 5–30s" after *every* question; first lesson/flashcard "~20s"
   on a blank spinner. Khan/Anki are instant. This is the single biggest churn driver.
   → **Fix:** pre-generate the next 2–3 questions while the student reads the current solution;
   pre-warm/cache one lesson + one flashcard deck per category so first load is instant
   (on-demand generation becomes the rare fallback, not the default).

2. **HIGH — No visible reward loop during practice.** A correct answer is a quiet checkmark.
   The gamification components exist (`StreakBadge`, `ComboMeter`, `CorrectPulse`, sound) but
   aren't surfaced in the practice/auto loop. No combo counter, no "🔥 3 in a row", no
   unit-complete celebration. → **Fix:** surface a live streak/combo + a correct-answer flash
   and sound; add a "Unit complete!" celebration with stats.

3. **HIGH — Value is gated behind sign-up + diagnostic before any dopamine.** The free
   question is a single hardcoded easy item (slope through two points) — not adaptive, not
   impressive. Auto mode hard-blocks on "Start with a placement check." → **Fix:** let a new
   visitor answer 2–3 *adaptive* sample questions that visibly adapt; make the diagnostic an
   optional "get better recommendations" nudge, not a wall.

4. **HIGH — MCAT onboarding modal reappears every fresh login** (state in `localStorage`, not
   the user record) and its scrim blocks all clicks. Infuriating for returning users / new
   browsers / incognito. → **Fix:** persist onboarding-seen on the user record (keyed to the
   `lodera_uid` user), not localStorage.

5. **MED — Diagnostic placement feels ignored.** Placement said "Strong in Calc Unit 7" but
   auto mode started at Unit 1. (Defensible pedagogically — prereqs first — but it *reads* as
   theater.) → **Fix:** when starting where prereqs aren't mastered, SAY so ("You're strong on
   derivatives — first let's shore up 2 foundations, then we jump ahead").

6. **MED — Progress shows "0/1482 keywords practiced."** Overwhelming, demotivating, and reads
   as "you've done nothing" right after working. → **Fix:** lead with mastered-of-attempted or
   a section-level summary; don't headline the 1482.

7. **MED — Returning-user experience dumps you into the marketing carousel / "Loading…"
   spinner**, not a quick "welcome back, resume" path. Course home shows a bare "Loading
   Precalculus…" with no skeleton.

8. **MED — Raw usernames shown in headers** (`p_mcB1_178…`) — no separate display name.

9. **MED — Diagnostic said "~10 questions" but ran to 16.** Set expectations honestly.

10. **LOW — polish:** "No verification needed yet" copy duplicated on the login page; dev
    Turbopack overlay visible (dev only); "Chemistry · soon" deflates pre-meds (reframe as a
    roadmap); precalc home is an 11-category wall with no "start here"; mobile `/mcat` header
    crowds at 375px; long academic category descriptions.

## What's genuinely good (brings them back)

- Lesson quality is real and focused (explanation → check → worked example w/ common-mistake
  callouts) — better than a 10-min video for a stuck student.
- Full step-by-step solution + "why each distractor is wrong" on every question.
- Honest diagnostic framing ("we skip what you know"; "I don't know" is always an option).
- Auto-mode architecture is the right Duolingo loop (warm-up → practice → mastery gate →
  spaced review → unit checkpoint).
- Clean, correct KaTeX everywhere; course-selection page is well designed.

## The three changes most likely to flip "no" → "yes" (next sprint)

1. **Kill the wait** — prefetch next questions + pre-warm one lesson/deck per category.
2. **Make winning feel good** — surface streak/combo/sound + unit-complete celebration.
3. **Show value before the wall** — adaptive try-before-signup + soften the diagnostic gate.

(Everything above is a *next-sprint* backlog; the current committed work — answer-keying,
rendering, honest progress, diagnostics, scope quarantine, free-question, push-help, mobile
headers — is a real step up from what's on `main` and is what's being deployed now.)
