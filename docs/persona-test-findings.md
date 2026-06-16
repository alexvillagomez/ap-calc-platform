# Persona test findings — 10 simultaneous users (run 2)

**Method:** 10 personas driven **simultaneously** via Playwright (`e2e/persona-runs.spec.ts`, `--workers=10`), each doing a long extensive pass + a short pass over its course. 5 math users (17yo: maya, jordan, priya, tyler, sofia) ran the math journey; 5 MCAT users (21yo: daniel, aisha, chris, lena, marcus) ran the MCAT journey. 175 screenshots captured to `test-results/personas/<key>/`; each persona then reviewed its own screenshots in character, asking "is this helpful / what I need, or could it be better?" Run passed 10/10 in 5.1 min.

## ⚠️ Critical caveat (read before acting on this report)
This was also a **load test**: 10 simultaneous users hitting a **Nano** Supabase instance (43 Mbps IO baseline) with live AI generation. Under that load the DB throttled (login latency rose from ~3s to ~10s), so pages sat in their loading states far longer than normal and many screenshots caught them **mid-load**. Verification on a healthy single-user DB (earlier passes + smoke tests) shows these same pages render real content fine. **So the near-unanimous "everything is a spinner" finding is largely an artifact of the stress conditions** — but the underlying signal (slow loads do happen on cold-start / live generation, and should be handled gracefully) is real and was acted on. The DB recovered to 2.3s immediately after the run; writes never failed.

## ✅ Fixes applied this round (95%-confidence, low-risk)
1. **Informative loading states** — added `components/ui/LoadingState.tsx` (branded skeleton/spinner + message) and replaced the one genuinely bare spinner (root onboarding `app/page.tsx`). Audit found most other loading states already have honest copy ("Building your quiz… up to a minute", "Finding your next question… 5–30 seconds", "Loading {course}…") — left intact (personas praised these).
2. **Inline password validation** on `/profile` — "At least 8 characters" and "Passwords match" hints update live (neutral→red→green) as you type. (jordan, daniel, chris)
3. **Labeled the streak badge** — `aria-label`/`title` "Current streak: N day(s)" and "Streak +1 today" on the gain badge. (daniel, chris, marcus)

## 👍 What personas praised (do not regress)
- **Content accuracy**: math KaTeX rendering (maya, priya, sofia); MCAT biology — amino-acid N→C convention, glycine achirality ("side chain is H, no stereocenter") confirmed correct (lena, daniel).
- **Honest loading copy** where present ("can take up to a minute", "5–30 seconds") — explicitly reduced anxiety (daniel, chris, aisha).
- **Course selection / home** clarity and on-brand cards (everyone).
- **QuestionToolbar** (timer, refresher, take-a-lesson, prioritize) and **progress dashboards** with color-coded mastery.

## 🔬 Content flag — escalated, NOT edited (goal: no new educational content)
- **lena**: the **"Fermentation vs Anaerobic Respiration"** lesson is a high-yield MCAT confusion. Verify it clearly distinguishes **fermentation** (regenerates NAD⁺, no ETC, no extra ATP) from **anaerobic respiration** (uses an ETC with an alternative terminal electron acceptor, e.g. nitrate). She couldn't confirm the body (it was mid-load). **Needs expert content review.**
- Earlier round also flagged a possible inverted "heat denaturation → hydrophobic effect" framing. Both belong in a content-accuracy audit.

## 📋 Backlog (below 95% confidence or larger features — for owner approval)
Ranked by cross-persona signal:
1. **Richer loading affordances** — skeleton screens that mirror the real layout + progress ("3 of 10 generated") + a cancel/back escape on long builds. (8/10) — bigger than this round's copy fix.
2. **Gamification depth** (jordan) — streak multipliers, XP/levels, mastery-bar fills, milestone celebrations, quiz score reveal ("7/8!").
3. **Optional timer + "Exam Mode"** (tyler, chris) — hide stopwatch by default; an exam-sim mode (timed, no hints, batch review). Anxious users find the always-on timer stressful.
4. **Expose collected analytics** (daniel) — accuracy-vs-time, per-question time bands, deck position ("Card 3 of 12"), deck metadata tags.
5. **Resume + session presets** (aisha) — "Resume last session" CTA; "Quick 5-min drill" / "Full timed exam" presets; prefetch on idle.
6. **Deeper explanations** (chris, maya) — "why each wrong answer is wrong", not just the correct solution.
7. **Navigation consistency** (marcus, sofia, aisha) — unify breadcrumbs/back-paths across question surfaces.
8. **Mobile polish** (sofia, marcus) — progress table mobile pass; compact/icon toolbar < 640px.
9. **Encouragement & framing** (tyler) — celebrate profile save/streaks; reframe "Prioritize this topic" → "Focus help here"; softer validation tone.
10. **Accessibility / ELL** (priya) — glossary/info-icons on jargon ("yield"), larger minimum font, fuller password guidance.
11. **Combine sequential loaders** (chris, daniel) — `/mcat` search → categories → topics shows 2–3 spinners in a row; merge into one "Building your session…".

## Non-issues (filtered false positives)
- "Auto-generated ugly username" (tyler/maya) — a **test-harness artifact**; real users choose their username at signup.
- "No save toast on profile" (daniel) — the toast IS implemented; the screenshot fired before the throttled save returned.

## Per-persona one-liners
- **maya** (math, perfectionist): course selection perfect; wanted faster first-question + skeletons.
- **jordan** (math, gamer): wants speed + visible XP/streak rewards; inline pw validation.
- **priya** (math, ELL): praised readable math/labels; wants glossary, larger consistent text.
- **tyler** (math, struggling): timer/loading silence = anxiety; wants warm copy + ETAs + reframed "prioritize".
- **sofia** (math, mobile): the rendered question card (1/40, adaptive tabs) works great on mobile; wants prefetch + mobile progress-table pass.
- **daniel** (mcat, gunner): biology accurate; demands visible analytics/timing + deck position + queue ETAs.
- **aisha** (mcat, time-poor): wants skeletons, resume, cancel-during-load, session presets.
- **chris** (mcat, anxious): praised honest load copy; wants Exam Mode + "why wrong" + merged loaders.
- **lena** (mcat, content skeptic): amino-acid content solid; flagged fermentation-vs-anaerobic lesson for review.
- **marcus** (mcat, UX): home/search polished; wants skeletons, unified breadcrumbs, consistent badge hierarchy.
