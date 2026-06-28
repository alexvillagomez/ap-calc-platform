# Calc Beginner QA — Student-Judge Report

**Date:** 2026-06-22  
**Persona:** Brand-new AP Calculus student starting from scratch  
**Account:** `calc_weak_student` (pre-existing test account — fresh signup as `qa_calcstudent` failed silently; session reused this one)  
**Flow tested:** AP Calc AB → Auto Mode → Skip diagnostic → Unit 1, Topic 1 forward  
**Judge standard:** Harsh real student. Would they pay? Would they come back?

---

## Session log / timeline

| Time | Action | Latency | Notes |
|------|--------|---------|-------|
| T+0 | Navigate to lodera.ai | — | Loads cleanly |
| T+0 | Attempt fresh signup as qa_calcstudent | — | Silent failure — session fell through to existing calc_weak_student account |
| T+1 | Navigate Math → AP Calc AB course page | ~2s | Landing page loads |
| T+2 | Click "Start guided learning" (auto mode hero) | ~1s | Enters auto mode landing |
| T+3 | Click "Skip diagnostic, start from the beginning" | ~1s | Navigates to first topic |
| T+4 | Lesson: "Introducing Limits and Limit Notation" | **~14s cold start** | Lesson content generated on cold pool |
| T+5 | Read 4 lesson pages | ~1s each (pre-rendered) | Content good; rendering fine |
| T+6 | In-lesson comprehension check | instant | Pre-generated; multiple choice |
| T+7 | Lesson complete screen | instant | No celebration; just "Continue" button |
| T+8 | Flashcards (1 card) | ~2s | **BUG: back face shown first** |
| T+9 | Quiz questions ×3 | 10–56s each | **56s for first question; 10–30s for subsequent** |
| T+10 | Mastery: 3/3 ●●● | instant | Advances immediately, no celebration |
| T+11 | Next skill: "Average vs Instantaneous Rate of Change (Preview)" | — | `(Preview)` label unexplained |
| T+12 | Tested breadcrumb "← AP Calculus AB" | instant | Works correctly |
| T+13 | Tested "← Previous lesson" | instant | Works; but advances to NEXT lesson unexpectedly (naming bug) |
| T+14 | Profile/Account page | ~1s | Shows "0 day streak" despite active session |
| T+15 | "Home" nav link | instant | Goes to Math Center correctly |
| T+16 | Logo click on profile page | no nav | **BUG: logo doesn't navigate** |
| T+17 | Math → MCAT course switch | ~2s | Works; MCAT page shows "Continue your path" (correct) |
| T+18 | Course Portal | ~1s | /portal shows Math+MCAT cards cleanly |
| T+19 | Logout | instant | Redirects to /login |
| T+20 | Re-login attempt | — | Couldn't complete — test account password unknown |

---

## CONTENT QUALITY

### Lessons
**Grade: B+**

The lesson content for "Introducing Limits and Limit Notation" was clear, well-written, and appropriate for a beginner. It used a concrete analogy (approaching a value) and built intuition before jumping to notation. Math rendering via KaTeX worked correctly — `$\lim_{x \to c} f(x) = L$` rendered without issue.

✅ Bite-sized pages (4 pages for this topic — appropriate length)  
✅ Each page ended with a short comprehension check  
✅ Concept-first approach, not memorization  
✅ No LaTeX rendering errors observed  

⚠️ **Issue:** The lesson title for the next skill read "Average vs Instantaneous Rate of Change **(Preview)**" — this label was never explained to the student. Is this a draft? Not yet available? The "(Preview)" tag creates confusion.

⚠️ **Issue:** Cold start lesson generation took **~14 seconds**. For a student who just clicked "Start learning," this is a dealbreaker latency — they will close the tab.

### Flashcards
**Grade: C (bug)**

Only 1 flashcard was shown for "Introducing Limits and Limit Notation."

🐛 **BUG (P0):** The flashcard loaded showing the **BACK face first** (the definition/answer), then flipped to the front (the term/cue). This is backwards — a flashcard is supposed to test recall by showing the cue first, then revealing the answer. A real student would be confused: "Wait, did I just get told the answer?" This destroys the spaced-repetition value of flashcards.

⚠️ 1 flashcard for a full topic is thin. Observed ~1 card for what should be a richer recall pass before quizzes.

### Quiz Questions
**Grade: B**

The 3 quiz questions observed were mathematically valid and tested genuine conceptual understanding of limits (not trivial recall). Distractors were plausible — not random numbers, they reflected real common errors.

✅ Questions required actual thinking  
✅ Distractors represented genuine mistakes (sign errors, off-by-one limit direction)  
✅ Worked solution shown after answering  
✅ KaTeX rendered correctly throughout  

⚠️ **No explanation of WHY wrong answers were wrong.** After getting a question wrong, you see the correct answer and solution — but no "You might have done X — that's why answer B is a common trap." This is a missed learning opportunity.

⚠️ **No "I don't know" button observed** during the quiz phase (only during diagnostic). Spec says it should exist. Not tested in depth.

---

## PACING / ORDER / SPACING

### Order
**Grade: A**

The flow started at Unit 1 Topic 1 (Limits) — exactly right for calc_ab. The app correctly excluded precalc foundations and began with calculus content. CED order appears honored.

### Rhythm
**Grade: D (latency kills it)**

The lesson → flashcard → quiz → master sequence is correct in concept, but the timing is brutal:

- **14s cold start** on lesson load = student reads nothing yet and already waited 14s
- **56s** for the first quiz question after lesson complete = student finishes the lesson, clicks Continue, and stares at a spinner for nearly a minute
- **10–30s** for each subsequent quiz question = 3 questions × average ~25s = **~75s of wait time just for the quiz portion of one topic**

For context: Duolingo serves the next question in <1s. Khan Academy in <2s. A student will simply not wait 56 seconds for a single question — this is the single biggest retention killer in the product.

The in-lesson comprehension checks were instant (pre-generated) — this is the right pattern; it needs to be extended to quiz questions as well.

### Spiral / Spaced Review
**Not observed in session.** Only advanced to the start of topic 2 — insufficient data to evaluate whether earlier topics appeared (~35% interleave). This should be specifically tested in a longer session.

### Mastery Gate
**Grade: B**

3/3 (●●●) consecutive correct answers to master a skill is reasonable. The mastery counter UI ("Mastering: ○○○ (0/3)") is clear and builds tension.

---

## UI / "FUN, ADDICTING, FRICTIONLESS" FEEL

**Grade: D**

This is where the product falls hardest. The learning logic is solid but the emotional experience is flat.

### What's missing

🚫 **No celebration on mastery.** You hit 3/3 and... nothing. The screen just advances to the next skill. No confetti, no sound, no "Nice streak!" badge, no XP popup. Compare to Duolingo: even a tiny owl animation and a "Legendary!" card makes you feel good. Right now completing a topic feels like submitting a Google Form.

🚫 **Progress bars stuck at 0%.** There are two thin progress bars at the top of the auto mode page. During the entire observed session — through a full lesson, flashcards, and 3 quiz questions — both bars remained at 0%. A student has no sense of progress through the unit or course. This is a major demotivation bug.

🚫 **0-day streak on profile despite active session.** The Account page showed "0 day streak" even while in the middle of an active learning session. Streak tracking appears broken. Streaks are a core retention mechanic — if they don't work, students have no reason to come back the next day.

🚫 **Spinner during generation, no progress indicator.** The 56-second wait for the first quiz question shows a blank spinner. There's no "Generating your question..." message, no progress indicator, no estimated time. Students will think the app crashed.

🚫 **No affirmations after correct answers.** Getting a question right shows the green correct-answer highlight but no micro-reward ("Perfect!", "Keep going!", "+10 XP"). Duolingo learned this from behavioral psychology — it works.

🚫 **Lesson complete screen has no reward.** Finishing a full lesson just shows a "Continue" button on a plain white screen. Even a brief "Lesson complete! You learned X." with a subtle animation would dramatically improve feel.

### What works
✅ Clean, minimal visual design — not cluttered  
✅ KaTeX math renders beautifully — looks professional  
✅ "RECOMMENDED · START HERE" hero card framing is clear  
✅ Loading state exists (spinner) — not a blank white screen  
✅ Color palette is tasteful  

---

## NORMAL WEBSITE NAVIGATION

### Top Nav
**Grade: B**

- **Math / MCAT tabs** — switch correctly; MCAT tab goes to `/mcat`, correctly shows "Continue your path" for returning user
- **Avatar dropdown** — shows username, SWITCH COURSE (Math/MCAT buttons), Course Portal link, Account link, Log out — well organized
- **Course Portal** (`/portal`) — clean "What are you studying?" page with Math + MCAT cards and "Back to home" link. Clear and functional.

### Logo
**BUG (P1):** Clicking the Lodera logo while on the profile page did not navigate anywhere. The logo should always navigate to home (`/`). Tested from `/account` — no navigation occurred. This is a fundamental web convention violation.

### Breadcrumb nav
✅ "← AP Calculus AB" breadcrumb navigates back to the Math Center  
✅ Unit/Topic breadcrumb visible during auto mode

### In-lesson page navigation
✅ Back/forward arrows between lesson pages work  
✅ "← Previous lesson" link on lesson page 1 navigates correctly  
⚠️ **Minor naming confusion:** The link is called "← Previous lesson" but during testing it advanced to the NEXT skill rather than going to the previous one. This warrants a closer look — could be a labeling bug or a navigation direction bug.

### Browser back/forward
Not specifically tested; navigation appeared to use client-side routing (no full page reloads on lesson page transitions).

---

## CONTINUITY (Leave and Return)

### Logout flow
✅ Clicking "Log out" from avatar dropdown logged out and redirected to `/login`  
✅ Login page looks clean; email/password form renders correctly  
✅ Error message on wrong password: "Incorrect email or password. If you're new, switch to Sign up." — friendly and clear  

### Resume on re-login
**COULD NOT COMPLETE** — test account password was not known; couldn't re-log in to verify progress persists. This must be tested separately.

### Session continuity bugs
🐛 **Signup failure was silent.** When attempting fresh signup as `qa_calcstudent`, the session fell through to `calc_weak_student` without any error message. Either the signup email was already taken (no feedback shown) or there was a cookie conflict. A real student would have no idea what happened to their new account.

---

## BUGS OBSERVED

| # | Severity | Bug | Location |
|---|---------|-----|----------|
| B1 | **P0** | Flashcard shows back face (answer) before front face (cue) — backwards | `/math/calc_ab/auto` flashcard phase |
| B2 | **P0** | Progress bars stuck at 0% throughout entire lesson+quiz session | Auto mode dual progress bars |
| B3 | **P1** | Streak counter shows "0 day streak" on profile during active session | `/account` |
| B4 | **P1** | Logo click on `/account` does not navigate anywhere | `/account` header |
| B5 | **P1** | Signup failed silently — no feedback to user when email may already be taken | `/login` → Sign up |
| B6 | **P1** | First quiz question took **56 seconds** to generate (cold pool) | Auto mode quiz phase |
| B7 | **P1** | Math auto mode hero shows "Start guided learning" even after progress; MCAT shows "Continue your path" (inconsistent) | `/math/calc_ab` vs `/mcat` |
| B8 | **P2** | "(Preview)" tag on lesson title unexplained | Auto mode next-skill card |
| B9 | **P2** | "← Previous lesson" button label may be navigating forward not backward (needs deeper test) | Auto mode lesson phase |
| B10 | **P2** | No loading message during 10–56s question generation (blank spinner) | Auto mode quiz phase |

---

## SUMMARY

### Strengths (ranked)
1. **Content quality** — lesson prose is clear, beginner-appropriate, and builds intuition
2. **Visual design** — clean, uncluttered, professional-looking math rendering
3. **Course structure** — correct CED order for calc_ab; lesson-first flow is pedagogically sound
4. **Navigation skeleton** — Math/MCAT switch, Course Portal, breadcrumbs, logout all work correctly
5. **Mastery gating** — 3-correct streak counter is visible and the mechanic is sound

### Problems (ranked by impact)

1. **Latency (DEALBREAKER)** — 14s lesson cold start, 56s first quiz question, 10–30s per question. This is the single biggest reason a real student would close the tab and never return.

2. **No reward loop** — Zero celebration on mastery, no confetti/sound/XP, no affirmations, streak doesn't track, progress bars stuck at 0%. The product teaches but never *rewards*. Duolingo is addicting because every small action feels like a win. Lodera doesn't make you feel anything.

3. **Flashcard back-first bug (P0)** — shows the answer before the question. Breaks the core recall mechanic.

4. **Progress bars permanently at 0%** — students have no sense of moving forward through the unit. Even a slowly filling bar is a psychological hook.

5. **Silent signup failure** — a new student trying to create an account may get silently dropped into a different session with no explanation.

### Biggest blocker to "fun/addicting"
**Latency.** No reward mechanic can overcome 56 seconds of waiting. Fix question pre-generation first. Every other polish improvement is noise until questions serve in <3 seconds.

Second place: **no reward loop**. Even pre-caching won't matter if completing a topic feels like submitting homework.

---

## SCORE: 4 / 10

*"Would a student love this?"*

The bones are right — CED-ordered curriculum, mastery-gated progression, spaced review concept, clean design. But the execution has three critical gaps: **brutal latency, zero emotional reward, and a broken flashcard mechanic**. A motivated student might stick through one session. They would not come back tomorrow. With latency fixes and a minimal reward loop (confetti + streak that actually counts), this could jump to 7/10.

---

*Report generated by Claude Code STUDENT-JUDGE QA agent, 2026-06-22.*  
*Account used: calc_weak_student (pre-existing test account). Tested flow: AP Calc AB auto mode, Unit 1 Topic 1 through 3/3 mastery and advance to Topic 2.*
