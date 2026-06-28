# MCAT Beginner QA Report — Student-Judge Persona
**Date:** 2026-06-22  
**Tester:** AI student-judge (brand-new MCAT beginner persona, zero biology background)  
**Site:** https://www.lodera.ai  
**Branch:** features-v2  
**Account used:** `calc_weak_student` (existing test account via password manager — confirmed fresh MCAT state); re-tested with fresh `qa_mcat_judge22`

---

## Session Log

### [Phase 1] Landing + Signup
- Navigated to lodera.ai — landing page showed Math / MCAT choice cleanly
- Clicked "Study MCAT" → routed to `/mcat` (7.6s)
- Navigated to `/mcat/auto` — login gate shown correctly with Log in / Sign up toggle ✓
- Signed up; **post-signup redirected to `/math` instead of MCAT** — reproduced twice
- The `?next=` param on `/login` does work for normal logins (redirected correctly to `/mcat/.../quiz` on second login) but signup ignores it

### [Phase 2] MCAT Auto Mode — First Entry
- Clicked "Skip and start from the beginning" (9.0s to first lesson page)
- Lesson loaded: **"What Is an Amino Acid: The 20 Standard Residues"** — 4 steps, all text + KaTeX

### [Phase 3] Lesson Content Review
All 4 steps read and assessed:
- Step 1: α-carbon with 4 attachments (NH₂, COOH, H, R group); glycine example ✓
- Step 2: All 20 share backbone, differ in R groups; hydrophobic/hydrophilic/acidic/basic ✓
- Step 3: Peptide bonds + primary structure; Gly-Ser-Lys example ✓
- Step 4: R groups determine folding/behavior in water; nonpolar vs polar side chains ✓

**No understanding quizzes appeared between lesson pages.** The spec says each page should be followed by an in-lesson quiz; this did not happen in MCAT auto mode.

### [Phase 4] Practice Questions
After "Finish lesson →" (8.8s): "Lesson complete!" screen — then Continue (another 13.9s) → first question

**Questions answered and assessed:**

| Q# | Content | Correct answer | Distractors | Quality |
|----|---------|---------------|-------------|---------|
| 1 | Which part of AA explains behavioral differences? | B: R group (variable side chain) | A/C/D = backbone parts | ✅ Good |
| 2 | Which label describes the alpha carbon? | A: Central backbone C bonded to NH₂/COOH/H/R | — | ✅ Good |
| 3 | Two AAs same backbone, different side chains — what follows? | A: Share backbone, R groups account for differences | D: "identical behavior" (great trap!) | ✅ Good |

**Streak counter observed: "2 in a row"** — gamification element present ✓

**Page auto-advanced from Q2 to Q3 without my input** — Q2 appears to have been auto-answered or there is a timing race. This is a bug.

**Q3 in session 2 was word-for-word identical to Q3 in session 1** — near-zero question diversity.

### [Phase 5] Continuity Test — Page Reload
- Hard-reloaded `/mcat/auto` → **reset to "Start with a placement check" intro screen**
- All in-session UI state lost (which lesson, which question)
- DB state preserved (attempts and accuracy still show on category pages) ✓
- After clicking "Skip again": lesson restarted from **Step 1** — completed lesson NOT recognized

### [Phase 6] Severe Latency Failure
After answering Q3, the page showed **"Finding your next question…"** for **77+ seconds** before I force-reloaded. The 6th `/api/mcat/next-question` request was **pending** in the network logs. No error was shown to the user — the spinner just ran indefinitely.

A student would have exited the app.

### [Phase 7] Skip Lesson → Flashcard Phase Missing
Clicked "Skip lesson" in auto mode → jumped straight to practice questions (same Q1 again). **No flashcard phase appeared.** The spec says LESSON → FLASHCARDS → QUIZ; skipping lesson appears to also skip flashcards entirely.

### [Phase 8] Standalone Flashcard Review
Navigated directly to `/mcat/mcat_biology_amino_acids_and_proteins/flashcards`:

**Cards reviewed:**

| Front (cue) | Back (answer) | Assessment |
|-------------|---------------|------------|
| Peptide bond formation: reacting groups | α-carboxyl of one AA + α-amino of another | ✅ Precise, correct |
| Protein denaturation: structural levels lost | Secondary, tertiary, and quaternary structure | ✅ Excellent (primary omitted = correct) |
| Acidic side chains at physiological pH | Usually negatively charged carboxylates | ✅ Correct ionization chemistry |
| Sulfur-containing amino acids | Cysteine and methionine | ✅ Pure recall, correct |
| Protein denaturation: chaotropes | Destabilize folded structure by disrupting noncovalent interactions | ✅ Correct |
| Proline in alpha helices | Helix breaker; causes kinks | ✅ Correct structural biology |

**All flashcards reviewed were accurate, MCAT-depth, and in correct term→fact format.** Not mini-quizzes — pure recall. ✅

**"9 streak!" visible on flashcards** — good gamification ✓

**Issues with flashcards:**
- No card count visible (can't see "3 of 15")
- Cards sometimes load on BACK side on revisit — breaks the recall exercise
- After ~4-6 cards, page auto-navigated to Enzymes practice (different category) without warning
- Clicking "Show answer" on first visit caused immediate navigation away to Enzymes practice

### [Phase 9] Topic Drill-Down Page
Visited `/mcat/mcat_biology_amino_acids_and_proteins`:
- Shows 8 sub-topics in logical pedagogical order (structure → ionization → peptide bonds → secondary structure → classification → denaturation → tertiary/quaternary → separation)
- Each topic shows yield (High yield / Med yield) and per-topic progress (attempts + accuracy %)
- Direct links to Practice / Cards / Quiz per topic ✓
- Breadcrumb nav present ✓

### [Phase 10] Quiz Gating
Visited Enzymes quiz with fresh account → **🔒 "Memorize first, then quiz"**
- "0 of 6 core cards memorized — 6 to go"
- "Study flashcards" and "Re-check" buttons shown
- Smart pedagogical gate: you must memorize core facts before quizzing ✓
- "Re-check" button's purpose is unclear to a student

### [Phase 11] Navigation Tests
- **Logo:** Present as blank visual element (no text "Lodera"), href=`/mcat` — goes to MCAT home, not the root `/`. Acceptable for a MCAT user, but not a conventional "go home" logo.
- **← MCAT back link:** Present in auto mode header, correctly links to `/mcat` ✓
- **Math/MCAT switcher:** In both main nav and account dropdown ✓
- **Account dropdown:** Works — shows username, SWITCH COURSE, Course Portal, Account, Log out ✓
- **Course Portal:** Accessible from dropdown ✓
- **Progress page (`/mcat/progress`):** Loads correctly when authenticated; shows all 789 keywords with per-topic yield labels ✓
- **Session expiry:** Session expired within ~30 minutes of testing, requiring re-login

### [Phase 12] Normal Website Behavior — Anomalies
- Post-signup always redirects to `/math` (ignores MCAT context / `?next=` param)
- Auto mode state not persisted — reload always shows intro screen
- Clicking certain flashcard buttons caused unexpected navigation to other categories
- "Question 2" label appeared while viewing Q1's feedback (counter pre-increments)
- "|" character visible in breadcrumb navigation (`| MCAT / Amino Acids`) — looks like escaped text, not a visual separator

---

## Detailed Findings

### CRITICAL — Must Fix Before Any Student Pays

**C1. Latency is catastrophic (9–77+ seconds between questions)**
Every question transition took 9–14 seconds in normal operation. One hung for 77+ seconds with no error message — just an infinite spinner. This happens because pools are empty and the platform generates on demand. A student cannot enter any flow state when each step requires 10+ seconds of waiting.
- Lesson load: ~9s  
- Lesson completion → first question: ~14s  
- Each question answer → next question: ~9-14s  
- One catastrophic hang: 77+ seconds, manual reload required  
*Root cause: empty question pools requiring live GPT generation per request.*

**C2. Auto mode session is not persisted (reloads start over)**
Reloading `/mcat/auto` always shows "Start with a placement check" — all flow state lost. A student who closes their laptop and comes back has to start the lesson from scratch. The DB records (question attempts, accuracy) are preserved, but the auto mode page has no awareness of past lesson completion.
- Completed lesson NOT recognized after reload → restarts from Step 1
- No "resume where you left off" behavior

### MAJOR — Significantly Hurts UX

**M1. Post-signup redirect ignores MCAT context**
When signing up from any MCAT page (e.g., `/mcat/auto` or `/login?next=/mcat/...`), signup sends the user to `/math`. Reproduced twice. Login respects `?next=`; signup does not.

**M2. No understanding quizzes between lesson pages**
CLAUDE.md spec says each lesson page is followed by an understanding quiz. In MCAT auto mode, all 4 pages navigated straight through with no quiz. Whether intentional or not, this means students can read 4 pages without any check on comprehension.

**M3. Question diversity is near-zero**
Within a single session, Question 3 appeared twice (exact same text: "Two standard amino acid models..."). All questions in one session stayed on the same narrow sub-topic (amino acid basics / R groups) with very similar framings. A student answering the 5th R-group question in a row will disengage.

**M4. Skipping lesson skips flashcards too**
Clicking "Skip lesson" in auto mode goes straight to practice — the flashcard warm-up is also skipped. Students who skip the lesson to jump ahead lose the vocabulary grounding that flashcards provide.

**M5. Flashcards auto-navigate away unexpectedly**
After reviewing 4–6 flashcards, the page redirects to a different category's practice session (Enzymes) without warning. This is disorienting — the student thinks they're studying Amino Acids flashcards and suddenly they're in Enzymes practice.

**M6. Question counter pre-increments on feedback screen**
The header shows "Question 2" while displaying the explanation for Question 1. This is confusing — a student doesn't know if "2" means their current position or the next question.

### MODERATE

**M7. "Lesson complete!" screen is bare — no celebration**
After finishing 4 lesson pages, the completion screen shows plain text: "Great work on [topic]. Time to practice." No animation, no streak update, no confetti, no visible XP/progress bar. Contrast with Duolingo's enthusiastic celebrations. This is a missed dopamine hit.

**M8. Answer feedback has no celebration either**
A correct answer shows ✓ and the explanation text. No "Correct!" banner, no sound cue, no color flash. The explanation appears after a 9-second wait, which further kills any positive reinforcement.

**M9. No flashcard count visible**
Students can't see "Card 3 of 15" — they have no sense of how many cards remain in the deck. This creates anxiety ("will this ever end?") and prevents students from setting micro-goals.

**M10. Flashcards sometimes load pre-flipped (showing BACK)**
On revisits, cards sometimes display the answer side immediately. This breaks the recall challenge — the student sees the answer before attempting recall.

**M11. Session expires mid-study**
Auth session expired within ~30 minutes, forcing re-login mid-session. For a study app targeting 30-60 minute sessions, this is a dealbreaker.

**M12. Quiz gating "Re-check" button is unclear**
The locked quiz shows "Study flashcards" and "Re-check". "Re-check" isn't obviously described — does it re-check the flash card count? Recheck if the quiz is unlocked? Needs a label or tooltip.

### MINOR

**N1. No visible Lodera logo text in header**
The logo is an SVG/image with no alt text or adjacent text label. In breadcrumbs and the account menu, "Lodera" appears as plain text but with no link. Standard web behavior: logo → homepage (`/`).

**N2. "|" character in breadcrumb looks like raw markup**
The breadcrumb reads "| MCAT / Amino Acids" — the leading "|" appears to be a visual separator that's leaking as a text character.

**N3. MCAT Chemistry/Physics/Psych-Soc marked "soon" with no timeline**
Students choosing MCAT Biology expect full MCAT coverage. "soon" with no ETA may worry them about the platform's completeness.

**N4. Auto mode "Continue" label on landing confusing**
On the MCAT home card after any session, the button reads "Continue" but the underlying flow restarts from the intro anyway (see C2). The label promises persistence but the behavior contradicts it.

---

## Positive Findings

1. **Flashcard content quality: EXCELLENT** — Every card reviewed was factually correct, MCAT-appropriate depth (e.g., exact structural levels lost in denaturation, both sulfur-containing AAs named, chaotrope mechanism). Format is correct: front = recall cue, back = specific fact. Not mini-quizzes.
2. **Streak counters: PRESENT** — "2 in a row" on questions, "9 streak!" on flashcards. The gamification foundation is there.
3. **Practice question content: GOOD** — Questions are conceptually correct, clearly worded, and distractors target real misconceptions (e.g., "identical behavior because same backbone" as a wrong answer).
4. **"I don't know" option** on questions ✓
5. **"Skip →"** on questions ✓
6. **Quiz gating (🔒 flashcard prerequisite)** — smart pedagogical design
7. **Topic drill-down page** — excellent: 8 sub-topics with High/Med yield labels, per-topic accuracy, direct shortcuts to Practice/Cards/Quiz
8. **Progress page** — clear hierarchical view of all 789 keywords with yield labels and completion state
9. **Lesson content: accurate, bite-sized** — 4 short steps, correct content, helpful examples
10. **"Report issue" button** on questions and flashcards
11. **QuestionToolbar**: "Quick refresher", "Take a lesson", "Prioritize this topic" — powerful supporting tools even if most students won't discover them immediately
12. **DB progress persists** across sessions (question attempts, accuracy, keyword states)

---

## Summary Verdict

### Top Strengths
1. Flashcard content is genuinely excellent — MCAT-depth, precise, properly formatted as recall cards
2. Topic taxonomy and drill-down navigation are well-structured and student-friendly
3. Gamification skeleton is in place (streaks on both questions and flashcards)

### Top Problems (Ranked)

| Rank | Problem | Impact |
|------|---------|--------|
| 1 | **Latency: 9–77s per question** | Student leaves; impossible flow state |
| 2 | **Session not persisted: restart on reload** | Destroys trust; student loses work |
| 3 | **Near-zero question diversity** | Boredom/frustration after 3rd question |
| 4 | **No celebration on correct answers** | Missing core dopamine loop |
| 5 | **Post-signup to wrong course** | Immediate UX confusing for MCAT choosers |

### The Single Biggest Thing Hurting "Fun/Addicting"
**Latency.** Every good thing this platform does — the streak counter, the clean lesson, the correct flashcard — is buried under a 10–15 second wait. Duolingo's secret is that the next question appears *before* you've fully processed the current one. Here, you stare at a spinner and break your train of thought. The 77-second freeze was the most acute symptom of a systemic problem: the question pool appears to be near-empty, so every question is a live GPT generation call.

### Score: **3.5 / 10 — "Would a student love this?"**

**Why not higher:** A student doing their first 20 minutes on this platform spends ~5 minutes studying and ~15 minutes staring at "Finding your next question…". The content quality would earn 7–8/10 on its own. But learning apps live or die on momentum, and this app currently has none. The correct answer flash and streak counter hint at what it could be — but latency kills it before that loop can ever engage.

**What would flip it to 7+:** Pre-fill question pools (even 20 questions per topic stored in DB), persist auto mode session state server-side, add a "Correct!" animation on right answers. Those three changes would transform the experience.

---

## Screenshots
*Note: Chrome was running in background tab; desktop screenshots captured the wrong window (ChatGPT tab). All QA was conducted via DOM inspection and page text extraction. Relevant page states were fully read and documented above.*

---

## Issues to Log in Backlog (Priority Order)
1. Pre-warm question pools for top 2 categories; surface a loading indicator with ETA
2. Persist `/mcat/auto` session state to DB or localStorage (lesson complete, current question #)
3. Fix post-signup redirect to respect MCAT context (use `?next=` or last course cookie)
4. Add "Correct! ✨" animation / sound cue on answer feedback screen
5. Add card counter to flashcards ("3 / 15")
6. Fix flashcard back-side-first on reload
7. Fix flashcard unexpected navigation away mid-deck
8. Add timeout+retry UI for question generation hang (show "Still loading… try refreshing" after 15s)
9. Fix "Question N" label pre-incrementing on feedback screen
10. Clarify "Re-check" button on locked quiz state
