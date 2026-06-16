# Features-v2 QA Report — 10 Persona Test Users

_Branch: `features-v2`. Generated after shipping the 8-task feature sprint (profile, stopwatch, take-a-lesson, quick-refresher, prioritize-this, course search, metrics, persona QA)._

This is the **consolidated report** from 10 simulated test users (5 Math @ 17yo, 5 MCAT @ 21yo, run on a cheap model) who toured every page of the app, judged content quality + aesthetics, and gave advice. **Taking this report is the intended next phase of the project.**

> **Context caveats:**
> - A full browse pass captured every page live while the DB was healthy; personas critiqued that material. Bugs already fixed during this sprint were excluded from their briefs.
> - The Supabase project went **down mid-session (Cloudflare 522)**. Some personas who tried live browsing (e.g. Aisha) saw "loading forever"/auth hangs — those are the **outage**, not product bugs.
> - The DB migration `supabase/migrations/20260615000000_features_v2.sql` must be **applied manually** in the Supabase SQL editor for the new persistence (metrics, priorities, refresher cache, profile fields) to take effect. All runtime code is fail-soft until then.

---

## Top themes (ranked by signal strength across personas)

### 1. The always-on stopwatch creates anxiety — make it optional ⭐ (highest-consensus)
Tyler & Chris (anxious learners) both say the ticking timer makes them rush and feel watched; Sofia wants it docked/sticky; Daniel wants it *smarter*, not gone.
- **Action:** Hide the stopwatch by default (especially for new users) with a toggle to turn it on; keep logging time silently for analytics. Add an **"Exam Mode"** (timer on, no hints, batch review) for those who want simulation.

### 2. "Take a lesson" new-tab is divisive on mobile — prefer an in-page overlay
Sofia, Aisha, Marcus: opening a new tab preserves the session (good) but fragments mobile UX.
- **Action:** Replace `window.open` with a **modal / bottom-sheet lesson overlay** that closes back to the exact question. Prefetch the lesson JSON for prioritized topics to kill latency.

### 3. "Show me the data you're collecting" — expose analytics
Daniel & Aisha: the app now tracks time/hint-use/accuracy but shows none of it back.
- **Action:** Build learner-facing analytics: accuracy-vs-time scatter per topic, per-question time bands ("this Q: 68–95s, you: 84s"), predicted-score estimate, and an explicit **spaced-review scheduler / "Resume last session" CTA**. (The metrics tables from this sprint are the substrate.)

### 4. Gamification is shallow — add progression & rewards
Jordan: streaks are shown but unrewarded; no leveling, no mastery-bar fills, no quiz score reveal/celebration.
- **Action:** Streak multipliers, a study-level bar, real-time mastery-bar fills with milestone celebrations, quiz score reveal ("7/8!"), optional weekly challenges/leaderboard.

### 5. Content quality & explanation depth (CONTENT — review, don't auto-edit)
- ⚠️ **Possible accuracy error (Lena):** an MCAT item frames *heat denaturation as caused by the hydrophobic effect*. Lena argues this is inverted — the hydrophobic effect *stabilizes* folding; heat disrupts it via kinetic energy. **Flag for biochemist review before it propagates.**
- Lena: glycine "achiral" phrasing is imprecise (identical substituents → no enantiomers, rather than "no stereocenter").
- Maya & Chris: solutions show the right answer but not *why wrong answers are wrong*; quick-refresher should address the misconception, not just restate the rule.
- **Action:** Add a **user content-flagging audit trail** (a "this looks wrong" → logged-with-keyword pipeline) and a pre-launch expert content review pass.

### 6. Navigation: missing back-paths / breadcrumbs (consistency)
Marcus, Aisha, Maya, Sofia: practice/quiz pages have no Back button or breadcrumb; you must use the browser back button. `/mcat/practice` can't return to `/mcat`.
- **Action:** Add a consistent breadcrumb ("MCAT › Biology › Cellular Transport › Q3/8") + a "← Back to categories" link on every question surface.

### 7. Mobile polish
Sofia, Aisha, Marcus, Priya: toolbar (stopwatch + 4 buttons) crowds/wraps under ~640px; refresher panel text too small; category progress bars hard to scan.
- **Action:** Icon-only compact toolbar < 640px (overflow into a drawer); larger refresher text / full-screen slide-up on mobile; color-tint category cards by mastery (green/amber/red) for glanceability.

### 8. Accessibility / ELL support
Priya: keyword wording assumes strong English; "yield" is unexplained; small text.
- **Action:** Inline glossary/info-icon definitions on first use of jargon (coefficient, factor, yield…), "why am I seeing this?" tooltip on the mastery bar, larger minimum font on mobile.

### 9. Encouragement & framing for struggling learners
Tyler: "Prioritize this topic" reads like punishment ("show me my weakness MORE"); topic-selection checkboxes are overwhelming.
- **Action:** Reframe to "Focus help here"; add a one-tap **"Start Adaptive"** that picks topics for you; celebrate effort/streaks-in-a-row with encouraging copy, not just correctness.

### 10. Empty states, loading & first-impression latency
Maya, Marcus, Aisha: "Start" with 0 topics selected silently fails; cold-start question generation is slow (~5–10s); refresher failures are vague; "Course 1/Course 2" labels look like placeholder text.
- **Action:** Disable Start until a topic is chosen; visible loading states; bank more questions for high-yield topics to avoid live-gen latency on first impression; remove placeholder-looking labels.

### 11. Session efficiency (time-poor users)
Aisha: wants preset session lengths ("Quick 5-min drill", "Full timed exam"), resume-mid-session, in-session running accuracy, and a PWA/offline story for flashcards.

---

## What personas praised (keep / don't regress)
- **Semantic search** ("factoring quadratics" / "cellular respiration" → ranked, relevant, links straight into Practice/Quiz/Lesson) — repeatedly called out as the best feature.
- **Crisp math/KaTeX rendering** and the **toolbar concept** (timer + inline refresher + lesson + prioritize in one place).
- **MCAT biology rigor** & AAMC-outline alignment (Daniel, Lena) — accurate amino-acid / protein-folding content, with the one flagged exception above.
- **Honest progress tracking** (mastery dots, color-coded yield badges, category % bars).
- **Profile page** felt clean and complete (member-since, editable info + toast, password validation, subscription stub).

---

## Recommended next-phase backlog (prioritized)
1. Stopwatch optional + Exam Mode (#1) — small, high satisfaction.
2. Lesson modal overlay + prefetch (#2) — mobile cohesion.
3. Learner analytics + resume + spaced-review surfacing (#3, #11) — leverages new metrics tables.
4. Breadcrumbs/back-paths everywhere (#6) — cheap consistency win.
5. Content audit: fix the flagged hydrophobic-effect item, add user flag→audit pipeline, deepen wrong-answer explanations (#5).
6. Mobile compact toolbar + ELL glossary + larger text (#7, #8).
7. Gamification depth (#4) and struggling-learner framing (#9).
8. Empty/loading states + question banking + label cleanup (#10).
