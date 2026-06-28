# Next Step: Closed Beta Validation Sprint

**Goal:** Prove the AP Calc / Precalc app is *worth paying for* and that students *come back* — before spending a dollar or an hour on marketing, payments, or an LLC.

**Why this is the next step:** Your biggest unknown is content quality + retention, not reach. A 1–2 week closed beta with 5–10 real students answers it cheaply. If it passes, you launch with confidence. If it fails, you fix the product instead of marketing a weak one.

**Timeline:** ~2 weeks. **Cost:** ~$0.

---

## Phase 0 — Lock scope & positioning (Day 1, ~1 hour)

- [ ] Decide the beta audience: **AP Calc / Precalc students** (this app). Note: they're minors — keep data collection minimal (email only, no DOB, no extra PII).
- [ ] Write one sentence: "This app helps a Precalc/AP Calc student ______ better than Khan Academy because ______." If you can't finish it crisply, that's the real work to do first.
- [ ] Pick the single "wow" surface you're testing. Recommended: **the diagnostic + its personalized report**, since that's your clearest differentiator.
- [ ] Define your pass/fail bar *now*, before you see results (so you can't rationalize later). Suggested: see Phase 5.

## Phase 1 — Make it safe to put in front of real students (Days 1–2)

- [ ] Add a minimal **Terms of Service** with: no score guarantee, "content is educational and may contain errors," beta disclaimer. (Template is fine for now.)
- [ ] Add a minimal **Privacy Policy** covering what you store (email, practice data) and that you don't sell it. Required before any external user.
- [ ] Confirm no real PII beyond email is collected during signup. Strip anything extra.
- [ ] Sanity-check auth: a brand-new student can register → reach the diagnostic → reach practice without you intervening. Do this in an incognito window as if you were a stranger.
- [ ] Pick a working brand name that does **not** lead with "AP" (College Board trademark). Use "for AP Calculus / Precalc" only descriptively. A placeholder is fine for beta.

## Phase 2 — Content quality QA — the make-or-break (Days 2–4)

This is the phase that actually decides whether it's worth paying for. Do not skip or rush it.

- [ ] Generate **10 diagnostic runs** across different ability levels (intentionally answer as a strong student, a weak student, a mixed student). For each, read the resulting report and rate 1–5: *Is it accurate? Does it correctly identify weak topics? Would a student find it useful?*
- [ ] Generate **15 AI lessons/refreshers** spanning your hardest Precalc + AP Calc topics (e.g. limits, related rates, trig identities, logs). For each, check:
  - [ ] **Mathematically correct?** (No wrong formulas, no wrong worked steps.) This is non-negotiable — one wrong derivative kills trust.
  - [ ] **Better than the free alternative?** Open Khan Academy on the same topic. Is yours genuinely more useful, or just a paraphrase?
  - [ ] **LaTeX / formatting renders cleanly?** No broken equations.
- [ ] Generate **20 practice problems + solutions**; verify each answer is correct and the difficulty label matches reality.
- [ ] Log every error you find in a simple list. **Tally the error rate.** If >5% of generated content has a math error, fix the prompts/pipeline before any user sees it.
- [ ] Fix the top recurring failure modes (usually a few prompt tweaks).

## Phase 3 — Instrument it so you can measure retention (Days 4–5)

You cannot judge "do they come back" without basic tracking.

- [ ] Add lightweight analytics (PostHog free tier or even a Supabase query) capturing per-user: signup date, sessions, days active, problems attempted, lessons opened, last-active date.
- [ ] Make sure you can answer, for any user: *How many distinct days did they use it? Did they return after day 1?*
- [ ] Add a one-question in-app prompt after the diagnostic: "Was this report useful? 👍/👎 + optional text."

## Phase 4 — Recruit 5–10 real beta students (Days 5–7)

- [ ] List every Precalc/AP Calc student you can reach directly: UCLA tutoring contacts, younger siblings/cousins, high-school teacher contacts, friends who tutor.
- [ ] DM 15–20 of them personally (expect ~half to actually engage). Script: "I built a Precalc/AP Calc study tool. Can you use it 3 times this week and tell me honestly if it's any good? Free, takes 15 min a session." 
- [ ] Get at least **5 committed** to actually use it 3+ times over the week.
- [ ] For 2–3 of them, **watch them use it live** (screen share or in person). Say nothing; just observe where they get confused, bored, or impressed. This is the single most valuable hour in the whole sprint.

## Phase 5 — Run the beta & measure (Days 7–12)

- [ ] Let them use it for ~5 days. Send one mid-week nudge.
- [ ] Collect the numbers: how many returned after day 1, how many used it 3+ days, diagnostic 👍 rate.
- [ ] Collect qualitative: what they loved, what was confusing, what made them stop.
- [ ] Ask each one the money question directly: **"Would you pay $X/month for this? Why or why not?"** Their hesitation tells you more than their politeness.

**Pass/fail bar (set in Phase 0, judged here):**
- [ ] PASS if: ≥50% returned after day 1, ≥3 used it 3+ times, diagnostic 👍 rate ≥70%, and ≥2 say they'd genuinely pay.
- [ ] FAIL if: most used it once and vanished, or the feedback is "it's fine" (fine = no one pays).

## Phase 6 — Decision gate (Day 12+)

- [ ] **If PASS:** move to the launch sprint — Stripe paywall on the AI features, founding-member price, then the Reddit/Discord/network marketing motion. You now have testimonials + numbers to sell with.
- [ ] **If MIXED:** fix the top 2 complaints, re-run a 1-week mini-beta with 3 new students.
- [ ] **If FAIL:** do not market yet. The problem is the product, and marketing a weak product just burns your reputation in the communities you'll need later. Use the feedback to decide what to rebuild.

---

### What you are explicitly NOT doing yet
- ❌ Forming an LLC (fast-follow once revenue is real)
- ❌ Building the full payment system (only after PASS)
- ❌ Public marketing / Reddit / TikTok (only after PASS, with testimonials in hand)
- ❌ MCAT expansion (separate track; don't split focus mid-sprint)
