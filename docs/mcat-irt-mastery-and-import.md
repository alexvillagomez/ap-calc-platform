# MCAT IRT Mastery + Progress Import (spec)

Status: **design locked, not built** · Scope: **MCAT only** · Local-only (do not deploy until told).

This spec redefines MCAT mastery as a latent-ability model on a shared difficulty
scale, and adds two ways to "bring in past progress" (Anki import + a manual
confidence pass). It is **isolated to the MCAT serving path** — `lib/courseEngine/adaptive.ts`
and the math engine are **untouched**. When math is reintroduced it gets its own
separate pipeline.

> Companion context: [docs/v2-single-page-app.md](v2-single-page-app.md) (the surface),
> [docs/mcat-system.md](mcat-system.md), [docs/difficulty-scales.md](difficulty-scales.md),
> `apps/student/lib/mcatSection.ts` (the four sections), `apps/student/lib/courseEngine/adaptive.ts` (the OLD model we are replacing for MCAT).

---

## 1. The model — IRT / Elo on one shared scale

Mastery and difficulty live on the **same ~0–1 scale**. Per keyword the student has
an **ability `θ`**; each item (question or flashcard) has a **difficulty `b`**. The
chance of a correct answer is logistic:

```
p = 1 / (1 + e^(−k·(θ − b)))
```

**Reported mastery = `b*`**, the difficulty at which `p = 0.80`. Since
`b* = θ − ln(4)/k`, reported mastery is just ability shifted down by a constant —
"the hardest level you're still ~80% likely to get right." There is **no terminal
"mastered"** — only a benchmark that says *good enough for now*, and it moves.

Both sides are **dynamic**: every attempt Elo-updates `θ` and the item's `b`.

### Symbol glossary
| Symbol | Meaning | Typical |
|---|---|---|
| `θ` | per-keyword ability (what we store as the keyword's `score`) | ~0–1 |
| `b` | per-item difficulty | ~0–1 |
| `p` | predicted P(correct) before the answer | 0–1 |
| `o` | outcome: correct=1, wrong=0 (IDK=0, softened) | 0/1 |
| `o − p` | surprise (drives every update) | −1..+1 |
| `k` | curve steepness (width of the 80% band) | const |
| `K` | ability step size; large early, decays with attempts | ~0.15→min |
| `K_item` | difficulty step size; ≪ `K` | ~0.01–0.02 |
| `A` | wrong-answer amplifier (≥1 on misses, 1 on correct) | 1..~2 |

---

## 2. Initial difficulty assignment

- **Flashcards → low fixed `b ≈ 0.15`** (recognition/recall is easy). A correct
  flashcard is weak evidence of high ability; a wrong one is strong evidence of a
  gap — the asymmetry falls out of the low `b`, no bolted-on rule.
- **Questions → seed `b` at the LLM band midpoint** (easy 0.30 / med 0.55 / hard 0.80),
  then Elo-calibrate from real attempts. (`mcat_questions.difficulty` *is* `b`.)
- **`SOURCE_WEIGHT` is retired** — in IRT the low flashcard `b` already does the
  down-weighting; keeping a separate discount would double-count.

---

## 3. The per-attempt update

For an item answered under effective ability `θ_eff` (see §5) and difficulty `b`:

```
p       = 1 / (1 + e^(−k·(θ_eff − b)))
A       = correct ? 1 : amplifier(b, θ_eff)   // ≥1, grows as b sits below θ
θ_new   = θ + K · A · (o − p) · keywordWeight  // per keyword on the item
b_new   = b − K_item · (o − p)                 // item drifts once
```

- **Uncertainty-shrinking `K`:** each keyword starts at `K_START` and decays toward
  `K_MIN` as attempts accumulate → fast early movement (recovers the old "fast early"
  feel), stable later. The per-keyword uncertainty doubles as **confidence** (used
  by import seeding and re-verification).
- **Wrong-answer amplifier `A`:** `1` on a correct answer; on a miss it ramps up the
  further `b` sits *below* `θ` (a careless miss on an easy item stings extra). Elo's
  expected-value term already punishes easy misses; `A` amplifies on top.
- **"I don't know"/skip:** treated as wrong with a reduced step (`IDK_FACTOR · loss`).

### All tunable constants (one block at top of the new module)
`K_PROB_STEEPNESS (k)`, `K_START`, `K_MIN`, `K_DECAY_PER_ATTEMPT`,
`K_ITEM`, `A_MAX`, `A_RAMP`, `IDK_FACTOR`,
`FLASHCARD_BASE_B`, `Q_BAND_MID {easy,med,hard}`,
plus the benchmark/decay/serve/import constants below.

---

## 4. Benchmarks — "good enough for now," rising over time

There is **no master-then-advance gate.** Learning continues by doing later topics
that reuse earlier ones (see §5). Each keyword has a **moving benchmark** target on
the `b*` scale:

- **Yield-scaled base:** high-yield keywords are held to a higher bar (taxonomy
  carries numeric yield). Tunable; can flatten to a single global target.
- **Rises in log over time** (`BENCH_BASE + BENCH_LOG_RATE·log(1+t)`), repurposing
  the existing `masteryGoal()` shape — early after a topic is introduced the bar is
  low (easy to "know it enough" and move on); later it has risen.
- **Mastery decays in negative log** (`b* − DECAY_BETA·log(1+Δt)`), repurposing
  `decayedScore()` — recent reps matter more, old ones less.
- The **widening gap** between a rising benchmark and a decaying `b*` is what forces
  revisiting old problems. **Non-terminal:** when `b*` falls below the benchmark the
  keyword re-enters review (`isDue` = `b* < benchmark`).

"Advance to the next topic" = frontier keywords clear their *current* (low, early)
benchmark — not full mastery.

---

## 5. Multi-keyword weighting (central to this architecture)

Every item carries `keyword_weights` over many keywords at once. That weight shows
up in **both** halves:

- **Prediction:** effective ability is the weighted average of the tagged keywords'
  abilities — `θ_eff = Σ(wᵢ·θᵢ) / Σwᵢ` — then `p = logistic(k·(θ_eff − b))`.
  (Weakest-link `θ_eff = min(...)` is parked as a future upgrade for multi-step items.)
- **Update:** the surprise `(o − p)` is distributed to **every** tagged keyword,
  scaled by its weight (the `updateMasteryMap` pattern). The item's `b` updates once.

This is the mechanism by which **doing later topics reinforces earlier ones**: a
Topic-5 question weighted 0.3 onto Topic-2 nudges Topic-2 ability for free, paying
down the decay debt on past material.

---

## 6. Serving policy

- **Difficulty served = `b* + STRETCH`**, clamped toward the keyword's current
  benchmark, with adaptive escalation (escalate on a win, drop to `b*`/below on a
  miss or while struggling). `STRETCH` is tuned to keep success at **75–80%** —
  the explicit "fun/addictive" target.
- **Which keyword:** frontier topic interleaved with ~35% spiral review, where
  "due" = `b* < benchmark` (decayed below the chasing bar).
- **Flashcard vs question:** low ability → more (low-`b`) flashcards; rising ability
  → more questions (the `flashcardProbability` shape, re-expressed on the new scale).

---

## 7. Anki import (Profile → Settings → current MCAT section)

Goal: pre-seed ability from a deck the student already studied. **Cards are never
stored** — parsed and embedded in memory, then discarded.

**Pipeline**
1. Upload `.apkg` → parse **in memory** (zip/deflate **and zstd**; `collection.anki2`
   / `collection.anki21b`) with `better-sqlite3` server-side.
2. Per card compute **retention 0–1**: FSRS `R` from `cards.data` JSON if present,
   else from SM-2 `ivl`/`factor`/`lapses` (log-mapped interval, lapse penalty,
   new/suspended → 0).
3. **Text-only matching (NO images, ever):** embed note fields + AnKing **tags** +
   subdeck/deck names; cosine-match to keyword embeddings via the existing
   `match_*_keywords` pgvector RPCs. Image bytes are never read or stored.
   Image-dominant / low-text cards are **dropped from seeding and counted** (logged,
   no silent coverage loss).
4. **Aggregate** a keyword's matched cards by cosine × retention (mean / high
   percentile, tunable) → a per-keyword confidence 0–1.
5. **Seed ability, capped:** `θ_seed = θ_floor + confidence·(θ_cap − θ_floor)` with
   **`θ_cap = 0.7`** (tunable). Anki proves recall, not problem-solving, so even a
   flawless deck lands below full problem-solving mastery.
6. **Seed as a high-uncertainty prior** (large `K`): the first few real attempts move
   it fast — confirms or corrects the import. Safety valve against inflated decks.
7. Write seeds into `mcat_student_keyword_states` for the **current section's**
   keywords only. Persist a tiny **audit row** (timestamp, #cards parsed, #matched,
   #dropped, #keywords seeded). Discard all card text + embeddings.

Does **not** touch per-card flashcard SRS (`mcat_flashcard_srs`) — Anki cards don't
map 1:1 to our flashcards; seed keyword *ability* only.

---

## 8. Manual confidence pass (same seeding primitive)

A *"How confident are you?"* control per **umbrella/category** (subtopic is too
granular across 900+ keywords) → maps a confidence level to a **capped (`≤0.7`),
high-uncertainty** ability seed — the **exact same primitive** as Anki, just a
different input. No heavyweight placement quiz needed: high-uncertainty seeds make
the normal adaptive serving converge fast and self-correct.

---

## 9. Display (My Progress popup)

There is **no auto page** — mastery shows in the **My Progress popup** (MyProgressChip):

- **Per-topic benchmark ring** = `b*` ÷ current benchmark, capped at 100% =
  *"good enough for now."* The ring **recedes** as the benchmark rises / decay pulls
  back — honest, and the nudge to revisit old topics.
- **Tiered labels** as display bands over `b*` (e.g. **Building / Solid / Strong**;
  tunable). No terminal "Mastered."
- Raw `b`/`θ` and uncertainty stay hidden from the student.

---

## 10. Scope, data, schema

- **MCAT only.** New IRT logic lives in a **separate module** (e.g.
  `lib/courseEngine/mcatIrt.ts`) consumed only by MCAT routes. `adaptive.ts` /
  math untouched; math gets its own pipeline later.
- **No backfill:** reinterpret existing `mcat_student_keyword_states.score` as an
  ability prior and set its uncertainty high → re-converges in a few attempts.
- **Schema (hand-applied SQL, per repo convention):**
  - `mcat_flashcards` → **add `difficulty` (default ~0.15)** = `b`.
  - `mcat_student_keyword_states` → **add `uncertainty`** (drives `K`); keep
    `score` (=ability), `floor`, `last_review_at`.
  - `mcat_questions.difficulty` → **reused as `b`** (already 0–1, already nudged).
  - Optional `mcat_progress_imports` audit table (no card content).

### Integration surface (MCAT serving path only)
- `/api/mcat/attempt`, `/api/mcat/flashcard-attempt` → Elo `θ`/`b` update replaces
  `updateMastery`.
- `/api/mcat/next-question` + the v2 serve-queue / `practiceBuffer` → difficulty
  selection becomes `b* + STRETCH`.
- **New** `/api/mcat/import` (Anki) + a seeding endpoint the confidence sliders call.
- Entry UI: **Profile → Settings → section-aware MCAT settings** (current section).

---

## 11. Suggested build order
1. ✅ **DONE** — `lib/courseEngine/mcatIrt.ts` (constants + pure functions:
   `predict`, `applyAttempt`, `reportedMastery`, `benchmark`, `decayAbility`,
   `serveDifficulty`, `seedFromImport`, `tierLabel`, …) + `lib/__tests__/mcatIrt.test.ts`
   (71 tests, all green). Pure, isolated, no wiring yet.
2. ✅ **DONE** — schema ALTERs applied (migration `20260701000002_mcat_irt_mastery.sql`):
   `mcat_flashcards.difficulty` (0.15), `mcat_student_keyword_states.ability_attempts`
   (the uncertainty/step-size driver; default 0 = high-uncertainty prior, no backfill),
   `mcat_progress_imports` audit table. `mcat_questions.difficulty` reused as `b` (unchanged).
3. ✅ **DONE & live-verified** — MCAT `attempt` / `flashcard-attempt` now Elo-update
   ability + item `b` (persist `ability_attempts`, drift `difficulty`); `next-question`
   accepts a numeric `target_difficulty` and the v2 loop (`useMcatPractice.loadQuestion`)
   sends `serveDifficulty(reportedMastery(score), …)`; the route's adaptive branch is
   b*-based too. Verified: correct 0.30→0.364 / wrong→0.255, item `b` drifts both ways,
   served difficulty tracks the target (0.25→~0.25, 0.85→~0.80, adaptive→0.30 ≈ 73% success).
   State machine / floor / dampening / distractor-shift intentionally unchanged (step 4).
4. ✅ **4a DONE** — My Progress popup shows benchmark-progress rings + Building/Solid/Strong
   tiers (uniform benchmark for now; yield-scaling deferred). **4b (server `state` machine)
   assessed & recommended SKIP** — it's read only by legacy `/mcat` pages; v2 drives off the
   ability score directly, so "no terminal mastered" is already delivered for v2 by 4a + serving.
5. Anki import route (parse → retention → match → cap-seed) + Settings UI.
6. Manual confidence sliders → same seeding endpoint.
7. Tune constants live (HMR) against the 75–80% success target.
```
