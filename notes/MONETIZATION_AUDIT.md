# Lodera — Path-to-Payable Audit

**Date:** 2026-06-17 · **Method:** 11 parallel subagents, each owning a slice, exercising the **live production site** (`https://www.lodera.ai`) with real authenticated sessions + reading the codebase. All latency numbers are real measurements against prod. No product code was changed in this audit.

**One-line verdict:** The *content* is closer to pay-worthy than the *product around it*. The questions are correct (zero wrong keyed answers found across ~120 hand-solved items), the science is sound, and the MCAT flashcard SRS is genuinely good. But three structural defects make Lodera un-chargeable today: **(1) crippling latency on every interaction, (2) a learning loop whose progress/mastery is broken or thrown away, and (3) no monetization, retention, or trust scaffolding at all.** None of these are content problems; all are fixable.

---

## 1. Top conversion blockers (things actively preventing someone from paying)

Ranked by how directly they kill willingness-to-pay. Every one was independently confirmed by multiple agents.

### B1 — Latency is disqualifying, and it's everywhere ⛔ (the #1 blocker, confirmed by 6 of 11 agents)
Real measured prod latencies:

| Action | Cold (generate) | Warm (stored/cached) |
|---|---|---|
| First **lesson** (`/api/math/lesson`) | **6–20s** (19.7s observed) | 0.8s |
| First **MCAT question** (cold) | **46.9s** | 2.7–3.7s |
| **Quiz** (4q) | 14.8s | 2.2–2.4s |
| **Flashcards** deck | 5.4–15.8s | — |
| **next-question** (generate) | 9.7–12.1s | **2.2–2.9s, spiking to 8–17s** |
| **practice-queue** whole-course | 11–29s (+ intermittent 404 → 15s fallback) | — |

Two compounding facts: (a) the value-reveal moment for a new user — their first lesson — sits behind a **15–20s blank spinner** (the UI literally says "Can take 5–30 seconds"); (b) even the steady-state happy path costs **~2.9s per question** because there is **zero prefetch** anywhere (`app/math/[course]/auto/page.tsx:365` fires `next-question` only *after* the student answers) and every served question pays an extra OpenAI embedding round-trip for the toolbar keyword (`next-question/route.ts:348,583`). Khan/Anki/UWorld are instant. You cannot charge for an AI tutor that makes the user wait.
**Root causes & fixes in §3 (Performance).** The two highest-leverage fixes — **prefetch the next question during solution-read** and **pre-generate content offline** — are low/medium effort and together neutralize most of this.

### B2 — The learning loop's progress is broken or discarded ⛔ (confirmed by the Calc-auto and Diagnostic agents)
A motivated student does the work and **nothing moves**:
- **Mastery credit lands on the wrong keywords.** A correct calc limits question was tagged entirely to *precalc arithmetic* keywords; `attempt/route.ts:112` credits `keyword_weights` verbatim, so the limits skill the student practiced got **zero** credit and `auto-plan` keeps `mastered_count: 0`. The guided path can never leave Topic 1. (`next-question` embedding-retag misfires; generation also pulls "+2 sibling" keywords so questions drift off the requested skill.)
- **The diagnostic's placement is thrown away.** Auto mode gates its frontier on `state === "mastered"` (`auto-plan/route.ts:271,369`), but a correct diagnostic answer maxes out at prior `0.75` while the mastery gate is `0.8` — **so the diagnostic can never mark anything mastered.** Proven live: ace all 6 diagnostic questions → auto mode restarts you at "Topic 1/19, 0%." The student spends minutes on a test that visibly produces nothing.
- **Page vs server mastery thresholds disagree** (page advances at streak 3; server masters at streak 4 + score ≥ 0.8), so "done" skills re-appear.

This is the worst possible signal for a paid product: *invested effort with no payoff.*

### B3 — There is no monetization, and nothing to retain users with ⛔ (Monetization + Progress agents)
- **Zero payment infrastructure.** No Stripe/Paddle/checkout anywhere (`grep` clean). The "subscription" is a hardcoded stub: `profile/page.tsx:474-482` always shows "Free plan" + a disabled "Manage subscription (coming soon)" button. There is literally nothing to convert *to*.
- **No accumulating asset.** No XP, points, levels, or currency in the live product (only a daily-streak integer + per-category %). A subscription needs a stake the user won't abandon; there isn't one.
- **No return-tomorrow hook.** No reminder infrastructure at all — `grep` for `push|reminder|notification|cron|resend|email` returns nothing. The streak silently dies and the user is never warned. Worse, the streak extends on **page-load** (`useStreakTouchOnce` fires on mount), so it's a *login* streak, not a *learning* streak — it isn't even tied to doing work.
- **Streak badge is hidden at 0** (`StreakBadge.tsx:71`), so the exact cohort you're converting — brand-new users — sees no streak hook on day one.

Duolingo's entire business is loss-aversion on a streak the user is *reminded* they're about to lose. Lodera has neither the reminder nor a streak that can be meaningfully lost.

### B4 — Rendering corruption that screams "AI slop" on flagship content ⛔ (Lessons, Quizzes, Trust, Mobile agents)
A paying student sees these on day one:
- **Math lessons skip the LaTeX sanitizer entirely** (`mathGenerator.ts` never calls `sanitizeLearnLatex` that `learnGenerator.ts:219` applies). Result, **currently cached and served** on the *first concept in the calculus course* (`limit_1_two_sided_limit_existence_condition`): the model's self-correction monologue leaked in — *"In symbols, $\nabla$ sorry: ... Wait—use the rule: ... $\nlim_{x\to c}$"* — and `\nlim` throws in KaTeX, dumping raw LaTeX. Another keyword (`u6_net_change_as_integral`) ships bare `\text{}` with unbalanced braces → literal backslashes on screen. Hit **3 of 6** sampled calc lessons.
- **Broken `\lim` in 6 live questions** — `$lim_{x\to -1}$` without the backslash renders as italic *l·i·m*.
- **MCAT question stems are lowercased and stripped of punctuation** — *"a researcher notices that a protein s interior is enriched in alanine..."* — because `next-question/route.ts:324-330` overwrites the served `stem` with the *normalized dedup* form (a 3-line bug; the quiz route is unaffected). The AAMC writes formal capitalized prose; this reads like a hobby project.

### B5 — Onboarding buries the one good moment behind a marketing wall (Onboarding agent)
The default visitor path is: blank "Loading Lodera…" spinner → **3-screen marketing carousel** (3 clicks, zero interactivity) → subject choice → **login wall before any in-app content**. The one genuinely good hook — the public `/try` question (real, fast at ~0.25s, instant feedback) — is a tiny tertiary link under "Not sure yet?" Most visitors never see it, and after one question it dead-ends at a signup wall. Time-to-value on the default path: **never, before signup.**

### B6 — No trust/credibility scaffolding for a high-stakes exam (Trust agent)
The product never tells the student the content is trustworthy. `grep` for `aligned|AAMC|College Board|official|verified|accuracy` across user-facing files returns **nothing** — no "Aligned to the AP CED / AAMC outline," no coverage claim, no AP®/MCAT® disclaimer. Meanwhile the authoritative grounding *exists internally but is invisible* (the taxonomy already ships `yield_rationale` like *"Unit weight 10-12%; limits appear in ~40% of FRQs"*). And verification is fragile: `verifyMathQuestionFast` is a single-vote, same-model blind solve capped at **80 tokens** with a 4s timeout that **fails open** (`{agrees:true}` on any timeout/parse error/missing key) — unverified content is served as verified.

---

## 2. Highest-leverage paid-worthy improvements (ranked by impact ÷ effort)

### Tier 1 — Do these first (high impact, low/medium effort). These flip the core experience.

1. **Prefetch the next question during solution-read.** Fire `next-question` in the background while the student reads the revealed solution (they spend 5–20s there). Kills the steady-state 2.9s + spikes between every question. *Low effort, huge impact.* (`auto/page.tsx:365`)
2. **Pre-generate lessons/quizzes/flashcards offline** (a `math:warm-content` / `mcat:warm-content` script per keyword). Makes the 15–47s cold spinner the rare exception instead of the value-reveal moment. *Medium effort, huge impact.* (already recommended in `docs/scaling-infra.md:39`)
3. **Fix mastery credit (B2a):** when `keyword_id` is supplied, force the served question's `keyword_weights` to include the requested skill as primary (don't let embedding-retag overwrite it), and drop the "+2 siblings" generation expansion. Unblocks all progression. (`next-question/route.ts` tag step, `:380`; `attempt/route.ts:112`)
4. **Fix the diagnostic handoff (B2b):** have `auto-plan` seed its frontier from diagnostic priors (treat prior ≥ ~0.65 as "skip/learned"), or raise the correct-boost above the 0.8 gate. Converts wasted diagnostic effort into a visible head-start. (`auto-plan/route.ts:271,369`; `diagnostic/answer/route.ts:42,552`)
5. **Run the LaTeX sanitizer on math lessons + purge corrupted cached rows (B4).** Port `sanitizeLearnLatex` into `mathGenerator.ts`; delete `math_lessons` rows containing `\nlim`/` sorry`/`Wait—`/bare `\text{`. The flagship limits lesson is live-broken until this runs.
6. **Fix the MCAT stem-normalization leak (B4):** ~3-line change so the normalized form is used only for dedup comparison, never assigned back onto the served row. (`next-question/route.ts:324-330,580-586`)
7. **Fix the math Flashcards 404 (Flashcards agent):** `[categoryId]/page.tsx:131` ships a "Flashcards" link to every calc skill pointing at a route that **doesn't exist** (`.../flashcards` → 404 live). Either remove the link or build the page (the MCAT page is a ready template).
8. **Promote `/try` to the front door + defer the login wall.** Make the interactive question the primary CTA (not a buried link), serve 2–3 adaptive questions, start with an *easy* one for a guaranteed first win, and gate signup on "save your progress," not first content. (`page.tsx:419-430`, `try/page.tsx`)
9. **Stop the math flashcard data-loss bug:** `flashcards/route.ts:110` filters out *every* previously-seen card, so a card you get **wrong vanishes forever** (opposite of SRS). Recirculate missed cards.
10. **Surface the trust signals you already have:** "Aligned to the AP CED / AAMC content outline" badges, the existing `yield_rationale` copy, a visible "report an issue" affordance, and an AP®/MCAT® disclaimer. Zero new data needed.

### Tier 2 — Retention + monetization machinery (high impact, medium effort). These create a reason to pay.

11. **Tie the streak to a daily goal, not page-load** (call `touchStreak` from the `attempt` route after the Nth answer of the day) and **add a streak-at-risk reminder** (email first, push later — no infra exists today; this is the single biggest monetization lever).
12. **Add an XP economy** (per-correct, combo bonus, unit-complete bonus) with a visible non-resetting lifetime total. Reuses existing combo/attempt hooks.
13. **Give math real SRS** (clone the MCAT `flashcard_srs` table + `lib/flashcardSrs.ts` wiring) and add **keyboard controls** (Space-to-flip, 1-4 to grade) to flashcards — today there are none, which disqualifies the surface vs Anki.
14. **Stream lesson tokens** so the first micro-step paints in ~2s instead of waiting 20s for the whole blob.

### Tier 3 — The actual paywall (the point of all the above)

15. **Gate the *outcome*, not the *activity*.** Keep unlimited practice **free** (it's the top-of-funnel and the data moat in a market where Khan/Anki are free). Put the paywall on the **exam-readiness layer:** a calibrated **predicted exam score** (AP 1–5 / MCAT scaled — you already have the substrate: attempt logs, IRT `estimated_difficulty`, per-keyword mastery, AAMC/CED yield), **unlimited AI tutor** (substitutes a $40–250/hr human), and **guaranteed full-curriculum coverage + full-length sims.**
16. **Price to the two markets' opposite willingness-to-pay:** AP Calc cheap-and-parental (**~$9.99/mo or ~$59/yr**, below a tutor-hour, annual as hero SKU); MCAT premium-and-cycle-based (**~$29–39/mo or ~$149 for a 6-month pass**), anchored far below the UWorld ($329–549) + AAMC ($268–320) + course ($1,800–2,999) stack. *Prerequisite for MCAT pricing: expand past Biology-only and add trust artifacts.*

---

## 3. Per-area findings (specifics)

### Calc AUTO guided path
- Content quality is pay-worthy; **the loop is not.** Mastery credit mistagged to precalc keywords → path stuck on Topic 1 (B2a). Whole-course `practice-queue` loads the full ~1700-keyword set *including the unused 1536-dim embedding column* (`mathTagging.ts:116`), causing 11–29s loads + intermittent 404 → 15s category fallback. Drop the `embedding` column from that query for the single biggest latency win here. Page/server mastery-streak mismatch (3 vs 4) re-surfaces "finished" skills.

### MCAT AUTO guided path
- Bones and science are sound (redox, gluconeogenesis, NADPH, plasma-vs-serum all keyed correctly). Killers: 46.9s cold first question; **lowercased/unpunctuated stems** (B4 leak bug); diversity filters are **inert in auto mode** (`auto/page.tsx:289-298` never sends `seen_stems`/`recent_keyword_ids`, so the permanganate question served twice back-to-back); **scope drift** (aromatic side-chain questions served under an *aliphatic* keyword 3/8; gen-chem redox-balancing served under a Biology metabolism keyword — run `mcat:audit-scope --apply`). `handleChoice` swallows attempt failures in a bare `catch {}` so mastery can silently diverge from the UI.

### Lessons
- **MCAT lessons are genuinely good** (enzyme kinetics, glycolysis, axon-hillock — correct, well-scaffolded). **Math lessons have shipping-blocker rendering bugs** (B4): leaked model monologue, bare `\text{}`, shuffled `A./B.` letter-prefixed choices (`assembleChoices` doesn't strip prefixes), intermittent 502 on valid keywords. Pedagogy gaps: math examples never use the `<FunctionGraph>` tool that's available; lesson steps are repetitive; lesson-complete navigation is a flat "Continue" with no reward.

### Flashcards
- **MCAT SRS is the strongest surface audited** — real persisted Leitner 1–5 boxes, due-dates, cross-device stable, good cards. **Math has no SRS at all**, missed cards vanish forever, and the only UI entry point is a **404**. `/anki` is orphaned dead code (full import flow, no SRS, unlinked). No keyboard support anywhere. No durable per-deck mastery counter.

### Quizzes / practice questions
- **Reassuring headline: zero wrong keyed answers across ~120 hand-solved items.** The `assembleChoices` contract + blind-solve verify works. Real problems: **difficulty is noise** (same question stored at both 0.55 and 0.81; trivial recall marked "hard 0.80" identical to multi-step chain-rule; the `imported_rag` pool — 68% of questions — caps at 0.55 and can never surface as hard), breaking the adaptive engine's core promise. **Explanations cite phantom distractors** not on screen (serine question discusses "glutamate" and "tyrosine," neither a choice; ≥8/350 MCAT). Exact-duplicate math stems stored 2×; `normalizeStem` collapses all numbers to `NUM` so distinct limits dedup-merge incorrectly; diversity is session-only.

### Diagnostic / placement
- **Decorative — placement is discarded** (B2b). `starting_category` is always `number_systems` regardless of performance; the report shows undifferentiated "Strong 75%" bars; mixed-ability students hit a thrash loop burning the full 16-question cap on 2 categories; strong students are walked toward *easier* topics (index direction inverted); 4–5s mid-diagnostic latency spikes; diagnostic attempts aren't logged so they don't count toward progress. The product already demotes the diagnostic to a tiny tertiary link — a tell that it's half-abandoned.

### Onboarding
- Public API surfaces are fast (sample-question 0.25s, landing TTFB 0.10s). The problem is structural: 3-screen marketing carousel + premature content-free login wall + hidden `/try` + post-auth latency cliff + a second "choose a course" decision. The real positioning ("Learn anything, addictively") never appears in the rendered UI; no "why Lodera over Khan/UWorld," no social proof, no "free" stated.

### Progress / motivation
- **Correction to `docs/retention-qa-report.md`:** the gamification machinery *is* now wired into every practice/auto page (StreakBadge, ComboMeter, CorrectPulse, sound, unit-complete 🎉 + checkpoint quiz). The remaining gaps are economic, not plumbing: no XP, no daily goal, no return-tomorrow nudge, login-streak not learning-streak, streak hidden at 0, combo session-only with stubbed sound escalation, and a dead legacy `/progress` page hardcoded to only show `polynomials` (`progress/page.tsx:125`).

### Mobile / performance / accessibility
- Latency root causes & fixes as in B1/§2. Mobile: **KaTeX display math has no overflow-x handling** in the student app (`globals.css` scopes it only to admin `.ap-calc-preview`) → wide equations overflow on phones; "Learn this" is `hidden sm:inline` (gone exactly where students study). A11y: KaTeX injected via `dangerouslySetInnerHTML` with no `role="math"`/aria; **contrast failures** (`neutral-400` body text = 2.56:1, brand/success/error button labels all < 4.5:1); choice buttons convey correctness by color with no `aria-pressed`/`aria-label` and no `focus-visible` ring. (QuestionToolbar is a good a11y model — copy it.)

### Trust / credibility
- Underlying content more accurate than its packaging suggests. Defects are **packaging + verification fragility** (B6): no exam-alignment claim, MCAT casing tell, single-vote 80-token fail-open verifier, no disclaimer, internal grounding invisible. The async strong-model adversarial re-check is documented-but-unbuilt (`mcat-system.md:103`).

---

## 4. Concrete path to a payable product

A staged sequence — each stage is shippable and each removes a specific "no."

**Stage 0 — Stop the bleeding (1 sprint).** Tier-1 fixes #5, #6, #7, #9 (sanitizer + purge corrupted lessons, MCAT stem leak, flashcard 404, missed-card data loss). These are small bugs producing outsized distrust. *Removes "this looks broken."*

**Stage 1 — Make the loop fast and honest (1–2 sprints).** Tier-1 #1, #2, #3, #4 (prefetch, pre-warm content, fix mastery credit, fix diagnostic handoff). *Removes "it's slow and my effort does nothing"* — the two biggest churn drivers. After this, a free user can actually fall in love with the product.

**Stage 2 — Build the habit (1–2 sprints).** Tier-2 #11–#14 (daily goal + streak-at-risk reminder, XP economy, math SRS + keyboard, streaming lessons) plus trust surfacing (#10) and recalibrated difficulty. *Creates week-1→week-4 retention and a stake worth protecting* — the prerequisite for any subscription.

**Stage 3 — Charge for the outcome (1 sprint + ongoing).** Tier-3 #15–#16: ship a **predicted exam score** as the paywall trigger, gate the AI-tutor/coverage/sim layer, keep practice free, price AP cheap-and-parental vs MCAT premium-and-cycle-based. Add a money-back/accuracy guarantee to neutralize "can I trust AI for my real exam?" *This is the conversion event.* Expand MCAT past Biology before charging MCAT-tier prices.

---

## Executive summary

Lodera's content is in better shape than its surrounding product: across ~120 hand-solved questions there were **zero wrong keyed answers**, the MCAT science is sound, lessons (MCAT especially) are well-scaffolded, and the MCAT flashcard spaced-repetition engine is genuinely good. That's the hard part, and it's largely done.

What blocks payment is everything *around* the content. **First, latency** — 15–47s cold-generation spinners on the first lesson/question and ~2.9s between every question, with no prefetch and no pre-warming; this alone is the named #1 churn driver. **Second, a broken progress loop** — correct answers are credited to the wrong keywords so the guided path can't advance, and the diagnostic's placement is mathematically incapable of advancing the student (it restarts them at "Topic 1, 0%" after they ace it). **Third, no business scaffolding** — there is no payment system (just a stub), no XP or accumulating asset, no daily goal, and no return-tomorrow reminder of any kind, so there's structurally no recurring reason to come back. Layered on top are trust-eroding rendering bugs (leaked model monologue in the flagship limits lesson, lowercased MCAT stems, a math-flashcard 404) and an onboarding flow that buries its one good hook behind a marketing carousel and a premature login wall.

None of these are content problems and most of the highest-leverage fixes are low-effort: **prefetch + pre-warm content** (kills latency), **fix the keyword-credit and diagnostic-handoff bugs** (makes effort pay off), and **run the existing LaTeX sanitizer + fix two normalization bugs** (kills the "AI slop" tells). Do those, then build the retention machinery (daily goal + streak reminder + XP), then gate the *outcome* — a predicted exam score and unlimited AI tutor — behind a paywall priced cheap-and-parental for AP (~$59/yr) and premium-and-cycle-based for MCAT (~$149/6mo), keeping unlimited practice free. The product is roughly **3–4 focused sprints from being something a demanding student would actually pay for** — and the gap is execution scaffolding, not the AI content that's hardest to build.
