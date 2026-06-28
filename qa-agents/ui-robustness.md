# UI Robustness QA Report — Lodera Production
**Date:** 2026-06-22  
**Tester:** Claude (automated browser agent)  
**Target:** https://www.lodera.ai  
**Accounts used:** `calc_weak_student` (qa.calc.weights.2626@lodera-test.dev), `qa_calcstudent`, `qa_uirobust`  
**Scope:** Full "click everything and try to break it" pass — navigation, auth flows, Math auto mode (Calc AB), MCAT auto mode, profile page, course switcher, back/forward, fun/dopamine assessment.

---

## Summary

| Category | Status |
|----------|--------|
| Navigation / chrome | ⚠️ Minor issues |
| Auth (login / signup / logout) | ✅ Works |
| Profile page | ⚠️ Minor issues |
| Math auto mode (lesson→flashcard→quiz) | 🔴 1 critical bug, ⚠️ several UX issues |
| MCAT auto mode | ✅ Works |
| Course switcher (Math ↔ MCAT) | ✅ Works (brief stale render) |
| Progress page | ✅ Works |
| Fun / Dopamine loop | 🔴 Failing |

**Polish & Fun score: 4 / 10**

---

## Bugs Found (Ranked by Severity)

### 🔴 BUG-01 — AP Calc AB Diagnostic Dead-Ends (CRITICAL)
**Page:** `/math/calc_ab/diagnostic`  
**Steps:** Log out → Sign up fresh → "Choose a course" → AP Calc AB → take the diagnostic  
**Result:** Error page: *"Diagnostic not ready yet — The diagnostic requires course content to be seeded."*  
**Impact:** Every new user who tries the diagnostic (the first CTA shown) hits a dead end. They cannot access the course at all from this path. The "Back to AP Calculus AB" back button on the error page also didn't respond on first click (required manual URL navigation).  
**Expected:** Either the diagnostic works, or it gracefully falls back to auto mode with a message.

---

### 🔴 BUG-02 — Flashcard Blank After "Got It" on Single-Card Deck
**Page:** `/math/calc_ab/auto` — flashcard step  
**Steps:** Enter flashcard step (1 flashcard) → click "Got It" to mark it done → card area goes blank (invisible/empty front)  
**Result:** The card region shows nothing. "Show answer" reveals the back side; clicking "Got It" a second time advances to the quiz.  
**Impact:** Any 1-card flashcard set (or the end of a flashcard cycle) shows a broken UI. Users have no indication they should click "Show answer" on an empty card.  
**Workaround:** Click "Show answer" → "Got It" a second time.

---

### 🔴 BUG-03 — AP Calc AB First Lesson Has 30–35s Loading Delay
**Page:** `/math/calc_ab/auto` — first lesson load  
**Steps:** Enter auto mode for the first time → wait for lesson to appear  
**Result:** Blank loading spinner for ~30–35 seconds before lesson content renders.  
**Impact:** This is the very first thing a new user sees after choosing AP Calc AB. A 30-second white screen is a severe retention killer. The MCAT lesson loads instantly (pre-stored), confirming this is specifically the AI on-demand generation path.  
**Note:** Subsequent lesson pages (pages 2–4) load instantly — only the first page triggers generation.

---

### ⚠️ BUG-04 — Course Card Requires Two Clicks to Navigate
**Page:** `/math` (course selection)  
**Steps:** Click the "AP Calculus AB" course card  
**Result:** First click highlights/selects the card visually but does NOT navigate. Second click navigates.  
**Expected:** Single click should navigate.

---

### ⚠️ BUG-05 — Stale Render on Math → MCAT Switcher
**Page:** `/math` (course selection page)  
**Steps:** Click "MCAT" in the nav switcher  
**Result:** URL changes to `/mcat` immediately but the page still renders "Math Center" with Precalculus/AP Calc AB course cards for ~500ms before snapping to the MCAT home.  
**Expected:** Instant route transition, no ghost content.

---

### ⚠️ BUG-06 — Profile Page Flash of Placeholder Content on Reload
**Page:** `/profile`  
**Steps:** Navigate to /profile (direct URL or after a redirect)  
**Result:** For ~300–500ms, the page shows "Your account" (not the username), "Y" avatar initial, and all form fields empty with placeholder text. Then the real data hydrates.  
**Expected:** Server-side rendered (or skeleton-loading) profile to avoid the jarring blank state.

---

### ⚠️ BUG-07 — Lodera Logo Is Not Clickable on Profile Page
**Page:** `/profile`  
**Steps:** Click the Lodera logo in the top-left  
**Result:** No navigation. The page stays on `/profile`.  
**Expected:** Logo should navigate to the home/course selection page.  
**Note:** Logo on `/math` stays at `/math` (no global home). Logo seems to only link within the same section. This is inconsistent — e.g. on the Account page there's no course-specific context, so the logo should ideally go somewhere useful.

---

### ⚠️ BUG-08 — "Continue" Button Race Condition on Lesson Complete Screen
**Page:** `/math/calc_ab/auto` — lesson complete screen  
**Steps:** Finish last lesson page → "Continue" button appears → first click has no response  
**Result:** First "Continue" click does nothing. Second click works.  
**Root cause:** Likely a debounce or onClick handler that isn't wired yet when the button first renders.

---

### ℹ️ BUG-09 — Breadcrumb Shows "Unit 1/8" Not "Unit 1/8 Units" (Minor Copy)
**Page:** `/math/calc_ab/auto`  
**Observation:** Breadcrumb reads "Unit 1/8 · Topic 1/12" — the denominator "8" represents 8 calc units, which is correct but could confuse a user who just sees "1/8" and wonders what that means without the word "units."

---

### ℹ️ BUG-10 — Progress Bar Percentage Shows 0% On First Auto Page Load
**Page:** `/math/calc_ab/auto`  
**Observation:** The top-right shows "0%" and the thin progress bar is empty even after completing a full lesson. It updates after a question is answered, but the lesson completion itself doesn't bump progress visually.

---

## Navigation / Chrome Findings

| Item | Result | Notes |
|------|--------|-------|
| Logo click from `/math` | ✅ Stays on `/math` (same page) | No global home — intentional? |
| Logo click from `/profile` | 🔴 No navigation | Bug BUG-07 |
| Logo click from `/math/calc_ab/auto` | Not tested directly — nav header uses breadcrumb |  |
| "Home" nav link | ✅ Goes to `/math` | Always goes to Math home regardless of course |
| Math ↔ MCAT switcher | ✅ Works | Brief stale render (BUG-05) |
| Course Portal (in dropdown) | Not tested — couldn't find a working link from tested pages |  |
| Account dropdown | ✅ Opens correctly | No emojis ✓, shows username, switcher, Course Portal, Account, Log out |
| "My Progress" (MCAT nav) | ✅ Works | Not present in Math nav |
| Back breadcrumb (`← AP Calculus AB`) | ✅ Works | Returns to course home |
| Browser back/forward | ✅ Mostly works | One stale-render on Math→MCAT switch |

---

## Auth Flow Findings

| Flow | Result | Notes |
|------|--------|-------|
| Sign up (fresh) | ✅ Works | Form validation present, success redirects to `/mcat` |
| Login with existing account | ✅ Works |  |
| Logout | ✅ Works | Redirects to login |
| Re-login after logout | ✅ Works | Session resumes, progress intact |
| Signup from `/try` (free sample) | ⚠️ Minor | "Sign up free" from `/try` redirected to `/mcat` when another session was cached — needed prior logout |

---

## Profile Page Findings

| Feature | Result | Notes |
|---------|--------|-------|
| Page loads | ✅ | With placeholder flash (BUG-06) |
| First name save | ✅ | "Profile updated." toast appears; data persists across reload |
| Username / email read-only (pre-filled) | ✅ |  |
| Security (change password form) | ✅ Present | Not tested (submit) |
| Subscription section | ✅ | Shows "Free plan · Manage subscription (coming soon)" |
| Delete account button | ✅ Has confirmation | Inline confirm dialog: "Are you sure? This is permanent." + Cancel |
| Log out link | ✅ Works |  |

---

## Math Auto Mode (AP Calc AB) — Step-by-Step

| Step | Result | Notes |
|------|--------|-------|
| Entering auto mode | ✅ | Via `/math/calc_ab` → hero "Start auto mode" card |
| Lesson first page loads | 🔴 30–35s wait | AI on-demand generation (BUG-03) |
| Lesson pages 2–4 | ✅ Fast | Cached / pre-generated |
| Lesson back/forward nav | ✅ Works | "Back" / "Next" buttons functional |
| "Skip lesson" link | ✅ Present | Not tested (didn't want to skip for testing) |
| Lesson understanding quiz (per page) | ✅ Works | Renders question + choices correctly |
| Wrong answer → stays on lesson | ✅ Works as designed |  |
| Correct answer → advances page | ✅ Works |  |
| Lesson complete screen | ✅ Works | "Continue" race condition (BUG-08) |
| Flashcard step | ✅ Works | 1-card blank bug (BUG-02) |
| Quiz question generation | ✅ Works | ~35s first generation time |
| Correct answer feedback | ✅ Works | Green highlight, streak badge ("2 in a row"), mastery dots update (●○○ → ●●○) |
| Solution render (KaTeX) | ✅ Works | Fractions, subscripts, inline math all render correctly |
| "Continue" after answer | ✅ Works | Advances to next question |

---

## MCAT Auto Mode — Step-by-Step

| Step | Result | Notes |
|------|--------|-------|
| MCAT home | ✅ | Hero card + section tabs (Biology active, 3 sections "soon") |
| "Continue your path" CTA | ✅ Works | Loads /mcat/auto instantly |
| Lesson load | ✅ Instant | Pre-stored lessons (no AI generation delay) |
| Lesson KaTeX | ✅ Works | α, NH₂, COOH, R = H all render |
| "Try a question" + "Next" both present | ✅ | Two CTA paths in one lesson card |
| Progress bar ("0/10 categories") | ✅ Present |  |

---

## Fun & Dopamine Assessment

### What works
- **Streak badge** ("2 in a row") appears after consecutive correct answers — good micro-reward
- **Mastery dots** (●○○ → ●●○) give visible progress within a topic
- **Green answer highlight** with checkmark is satisfying
- **KaTeX renders beautifully** — math looks professional, not crude
- **"RECOMMENDED · START HERE" hero card** creates clear starting point
- **Lesson → Flashcard → Quiz** progression feels like a real course

### What's missing / broken for dopamine
1. **30-second dead silence** between entering auto mode and seeing the first question is a momentum killer. There's no skeleton loader, no "generating your question…" animation, no fun copy — just a white spinner.
2. **No sound effects or haptic feedback** — correct answers are silent. A subtle chime on correct, a gentle buzz on wrong, would dramatically improve the feel.
3. **No XP / points / stars system** — streaks exist but don't accumulate into anything meaningful. There's no currency, no level-up, no "you earned X today."
4. **No end-of-session summary** — finishing a topic should trigger a celebration screen (confetti, total correct, time spent, streak). Currently you just get the next topic.
5. **No daily goal or commitment device** — Duolingo's "5 minutes/day" goal drives retention. Lodera has zero time commitment prompt.
6. **Auto-advance is absent** — after answering, the solution screen sits indefinitely. The user must manually click "Continue." Even a 3-second auto-advance (cancellable) would improve momentum.
7. **"2 in a row" badge disappears immediately** — there's no toast/animation persistence. Blink and miss it.
8. **Progress bar barely moves** — "0%" for the entire first lesson + flashcards + first question. Students need finer-grained progress signals.
9. **Flashcard blank bug** (BUG-02) completely breaks the one flashcard in the Limits unit — first impression ruined.
10. **Diagnostic dead-end** (BUG-01) — new users who trust the "take the diagnostic" path hit a hard error.

---

## Ranked Bug List (Fix Priority)

| # | ID | Severity | Description |
|---|-----|----------|-------------|
| 1 | BUG-01 | 🔴 Critical | AP Calc AB diagnostic dead-ends with "not seeded" error |
| 2 | BUG-03 | 🔴 Critical | 30–35s blank screen on first Math lesson load |
| 3 | BUG-02 | 🔴 High | Flashcard blank on single-card deck after "Got It" |
| 4 | BUG-08 | ⚠️ Medium | "Continue" button race condition on lesson complete |
| 5 | BUG-04 | ⚠️ Medium | Course card requires two clicks to navigate |
| 6 | BUG-07 | ⚠️ Medium | Logo not clickable on /profile |
| 7 | BUG-05 | ⚠️ Low | Stale render on Math → MCAT switcher |
| 8 | BUG-06 | ⚠️ Low | Profile page flash of placeholder content |
| 9 | BUG-09 | ℹ️ Cosmetic | Breadcrumb "Unit 1/8" lacks context word |
| 10 | BUG-10 | ℹ️ Cosmetic | Progress bar shows 0% through entire lesson |

---

## Ranked UX / Dopamine Improvements

| # | Impact | Effort | Description |
|---|--------|--------|-------------|
| 1 | 🔴 Highest | Medium | Add loading skeleton / "Generating your question…" animated copy during 30s AI wait |
| 2 | 🔴 Highest | Low | Sound effects: chime on correct, buzz on wrong (opt-out toggle in nav) |
| 3 | 🔴 Highest | Medium | End-of-topic celebration screen with confetti, stats, and "Next topic" CTA |
| 4 | ⚠️ High | Low | Auto-advance 3s after answer (with skip button) to maintain momentum |
| 5 | ⚠️ High | Medium | Daily goal / streak commitment prompt ("Practice 10 min/day?") |
| 6 | ⚠️ High | Medium | XP / points system (even cosmetic) so correct answers feel earned |
| 7 | ⚠️ High | Low | Persist streak badge as a visible toast with animation (not just a tiny disappearing label) |
| 8 | ⚠️ Medium | Low | Finer progress granularity — show per-lesson progress (e.g. "Lesson 1 of 8 complete") |
| 9 | ⚠️ Medium | Low | Add "My Progress" to Math nav (parity with MCAT) |
| 10 | ℹ️ Low | Low | Profile flash: SSR or skeleton to prevent jarring blank state |
| 11 | ℹ️ Low | Low | Single-click navigation on course cards (remove the double-click) |

---

## Polish & Fun Score: **4 / 10**

**Justification:**

The bones are solid — the lesson→flashcard→quiz progression is coherent, KaTeX is beautiful, the mastery-dot system makes sense, and the correct-answer feedback (green + streak) is a decent foundation. The MCAT section works particularly well with its pre-stored lessons and zero loading delay.

But the experience repeatedly breaks the cardinal rule of addictive learning apps: **momentum**. The 30-second blank screen on first entry, the two-click course card, the silent correct answer, the infinite wait between questions — these compound into a leaky dopamine bucket. A student who feels good about an answer and has to wait 35 seconds to see the next one will leave. Duolingo, Khan Academy, and Brilliant all solved this the same way: instant feedback loops, sound, micro-celebrations, and auto-advance. None of those exist here yet.

The critical bugs (dead-ending diagnostic, blank flashcard, 30s spinner) push the score below 5. Without BUG-01 and BUG-03, the experience would be a **6**. With a basic sound + celebration layer added, it could reach **8**.

---

*Report generated by automated QA agent, 2026-06-22*
