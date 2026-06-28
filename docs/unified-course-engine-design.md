# Unified Course Engine — Design & Phased Refactor Plan

**Status:** Design only (2026-06-22). No code changes in this pass — other sessions are concurrently editing generators/routes/keywords, so this is a read-only architecture spec.
**Author goal (user directive):** Every course runs the **exact same workflow and study framework**. The ONLY per-course differences are (1) the **keyword taxonomy** and (2) an **emphasis config** of how much each learning form (lessons vs flashcards vs quiz/practice) matters. Adding a new course = supply a taxonomy + an emphasis config; **everything else is the shared engine, zero new bespoke code.**

This doc maps the current divergence, designs the generic engine + course-config object, defines the "add a new course" path, and gives an ordered, low-risk phase plan. It is grounded in the canonical spec in [CLAUDE.md](../CLAUDE.md) and the per-area docs in `docs/`.

---

## 0. TL;DR

- **Math and MCAT are ~95% the same system implemented twice.** Control flow, state machine, prompts' structure, embedding/tagging pipeline, mastery math, and the LESSON→FLASHCARDS→PRACTICE→QUIZ flow are effectively identical. They are forked at the *file* level, not the *logic* level.
- **A handful of files are already unified** by a `system: "math" | "mcat"` parameter — `questionEnrichment.ts`, `refresherGenerator.ts`, `assembleChoices.ts`, `scienceNotation.ts`, `bestKeyword.ts`, plus the `QuestionToolbar` component. **These are the proof-of-concept for the whole refactor**: do to everything else what was already done to these.
- **The genuine per-course differences are few and reducible to config:** taxonomy, yield representation (numeric vs high/med/low), flashcard SRS depth (Leitner vs simple), diagnostic strategy, and modality emphasis (math favors quiz, MCAT favors flashcards). All of these can be expressed as **data + a config object**, not branching code.
- **Recommended end state:** one `COURSE_REGISTRY`, one generic generator, one set of `[course]`-parameterized routes, one auto/diagnostic/flow UI, and **shared tables with a `course` column**. The `math_*` vs `mcat_*` split collapses into `course_*` tables. New course = INSERT taxonomy rows + add a registry entry.
- **Phase order** (each independently shippable): **(1)** course-config registry + emphasis config (additive, no behavior change) → **(2)** collapse duplicated libs into shared core keyed by config → **(3)** unify generator → **(4)** unify routes behind `[course]` → **(5)** unify UI/pages/components → **(6)** unify the data model into `course_*` tables → **(7)** delete the dead `math_*`/`mcat_*` stacks. Data-model unification (6) waits until in-flight content work lands.

---

## 1. Current-State Audit — where math and MCAT diverge vs share

### 1.1 The shape of the duplication

Both courses implement the canonical workflow from CLAUDE.md: onboarding → (diagnostic | skip) → **auto/guided path** that walks the taxonomy in order, per topic running **LESSON → FLASHCARDS → PRACTICE**, with a checkpoint **QUIZ** on category completion, spiral review interleaved (~35%), mastery-gated advancement, and refreshers on forgotten lessons. The two stacks reproduce this same flow in parallel files.

### 1.2 Already shared (the template to follow)

| File / component | How it's shared | Notes |
|---|---|---|
| `lib/questionEnrichment.ts` | Single file, `System = "math" \| "mcat"` config map (table names, stem/solution col, `isLatex`) | The cleanest existing example of "one impl, per-course config map." |
| `lib/refresherGenerator.ts` | Single file, system-parameterized prompt + table | Same pattern. |
| `lib/assembleChoices.ts` | Pure, course-agnostic | Builds 4 choices + correct index from solution's final answer. |
| `lib/scienceNotation.ts` | Pure, course-agnostic | ASCII→KaTeX normalization (used by both). |
| `lib/bestKeyword.ts` | `system` param; 3-tier RPC→cosine→stored-weights fallback | Embedding-pinpoints the lesson/refresher keyword. |
| `components/practice/QuestionToolbar.tsx` | `system: "math" \| "mcat"` prop + optional `course` | Stopwatch, take-a-lesson, refresher, prioritize. |
| `components/mcat/MathText.tsx`, `ChoiceButton.tsx` | Imported by both, but **physically under `components/mcat/`** | Shared-by-accident; misplaced, should move to `components/shared/`. |
| `lib/gamification.ts` | Course-agnostic | comboReducer, onCorrect/onIncorrect. |

**Takeaway:** the unification pattern is already established and working in the codebase. The refactor generalizes it; it does not invent a new architecture.

### 1.3 Duplicated (identical logic, forked files)

| Area | Math | MCAT | Verdict |
|---|---|---|---|
| Generator | `lib/mathGenerator.ts` | `lib/mcatGenerator.ts` | Structurally identical (difficulty bands, output order, validation, fast-verify). Differs only in prompt *text* (LaTeX-mandatory vs prose; AP vs MCAT depth) and field names (`stem_latex`/`solution_latex` vs `stem`/`explanation`). **Reducible to config + prompt strings.** |
| Tagging/embedding | `lib/mathTagging.ts` | `lib/mcatTagging.ts` | `cosineSimilarity`, `embedText`, `tagByEmbedding` are **bit-for-bit identical**. Only `loadTargetKeywords` differs (math takes `course`, paginates; MCAT single-shot). Pure duplication. |
| API routes (~18 each) | `app/api/math/*` | `app/api/mcat/*` | next-question, attempt, auto-plan, practice-queue, flashcards, flashcard-attempt, quiz, diagnostic/{start,answer,skip}, search, taxonomy, auto-intro, lesson/[id], refresher/[id], feedback, similar — all parallel, same logic, different table + field names. |
| Auto/guided page | `app/math/[course]/auto/page.tsx` (~1900 LOC) | `app/mcat/auto/page.tsx` (~1600 LOC) | ~95% identical: same 14-phase state machine, same intro/practice/review/checkpoint flow, same constants (35% review). Differ in API prefix, `course` threading, mastery streak (3 vs 4). |
| Landing | `app/math/[course]/page.tsx` | `app/mcat/page.tsx` | ~80% identical taxonomy render; differ in section grouping + onboarding modal + yield visibility. |
| Diagnostic page | `app/math/[course]/diagnostic` | `app/mcat/diagnostic` | ~90% identical UX. |
| Lesson view | `components/math/MathLessonView.tsx` | `components/mcat/LessonView.tsx` | **Identical data contract** (`micro_steps`, `CheckQuestion`), 95% identical logic. Math adds combo gamification. |
| Flashcards / quiz / practice / category pages | `app/math/[course]/[categoryId]/*` | `app/mcat/[categoryId]/*` | 70–80% duplicated; differ in SRS model + prioritization. |

### 1.4 Genuinely different (and why) — the drifts

These are the *cost of not unifying*: places where one side got a fix/feature the other lacks, or where the two diverged on a design choice.

| Difference | Math | MCAT | Is it intrinsic? |
|---|---|---|---|
| **Multi-course** | `math_course_categories(course, category_id, role)` — precalc + calc_ab as views over shared categories; calc_ab hides yield badges | Single hardcoded "biology"; no course join | **No** — MCAT just hasn't needed it yet. The generic engine makes *every* course multi-capable. |
| **Yield representation** | numeric `yield_score` 0–1 | categorical `yield_level` high/med/low | **No** — standardize to numeric; map h/m/l → 0.8/0.5/0.2. |
| **Diagnostic** | adaptive binary-search + prereq-edge propagation (`math_prereq_edges`) up/down | umbrella-sweep in order, no propagation | **Partly** — propagation needs a prereq DAG; that's *data* (edges) the course supplies, not bespoke code. Engine runs propagation when edges exist, falls back to sweep when they don't. |
| **Flashcard SRS** | simple recirculation + keyword-level spaced review | per-card Leitner box (`mcat_flashcard_srs`) | **No** — Leitner is the better impl; make it the shared default, parameterized by emphasis. |
| **Checkpoint gate** | baked into auto-plan frontier | separate `quiz-gate` route | Same intent, two impls — converge on one. |
| **Onboarding** | public `sample-question` free-trial | login-gated, no sample | **No** — engine offers sample-question for any course; whether it's exposed is config. |
| **Lesson verification** | `verifyLessonStepFast` exists | missing | Drift/gap — unify gives MCAT the fix for free. |
| **Exemplar blocks** | generator accepts `exemplarBlock` | missing | Drift/gap. |
| **Modality emphasis** | de-emphasizes flashcards (default 2 cards), favors quiz | emphasizes flashcards (default 12 cards) | **This is exactly the user's "emphasis config."** Currently hardcoded as magic numbers in routes; promote to the course config. |

**Conclusion:** every divergence is either (a) pure duplication, (b) a one-sided fix that unification propagates for free, or (c) a *data/config* difference (taxonomy, yield numbers, prereq edges, modality emphasis). **None is irreducibly bespoke per-course logic.** The directive is achievable.

---

## 2. Target Architecture — one generic engine + a course config

### 2.1 The core idea

Replace "math stack + MCAT stack" with **one engine** that takes a **`CourseConfig`** and a **`course` id**. Everything reads from config:

```
                    ┌─────────────────────────────────────┐
                    │          COURSE_REGISTRY            │
                    │  Record<courseId, CourseConfig>     │
                    └─────────────────────────────────────┘
                                     │ (course id from route param)
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
  Generic Generator          Generic Routes              Generic UI
  (prompts from config)      app/learn/[course]/api/*    app/learn/[course]/*
        │                            │                            │
        └──────────► Shared core: embeddings, tagging, mastery,
                     selection, SRS, diagnostic engine, enrichment
                                     │
                                     ▼
                     Unified data model: course_* tables (course column)
```

### 2.2 The `CourseConfig` object (the only thing a course supplies, besides taxonomy rows)

```ts
// lib/courseEngine/config.ts
export type LearningForm = "lesson" | "flashcard" | "quiz" | "practice";

export interface CourseConfig {
  id: string;                       // "precalc" | "calc_ab" | "mcat_bio" | <new>
  label: string;                    // "AP Precalculus"
  family: string;                   // "math" | "mcat" — groups courses for switching/nav only
  // ---- (1) TAXONOMY REFERENCE ----
  taxonomy: {
    source: "db";                   // taxonomy lives in course_* tables, seeded from JSON
    courseFilter: string;           // the `course` value rows are tagged with
    sections?: SectionConfig[];     // optional UI grouping (foundations/ap_precalc/calc_ab)
    hasPrereqEdges: boolean;        // engine runs propagation diagnostic iff true
  };
  // ---- (2) EMPHASIS / "WHAT MATTERS MORE" ----
  emphasis: {
    // relative weight of each learning form — drives ordering, counts, and review mix
    forms: Record<LearningForm, number>;   // e.g. math {lesson:1, flashcard:0.3, quiz:1, practice:1}
                                            //      mcat {lesson:1, flashcard:1, quiz:0.5, practice:0.8}
    flashcardCount: number;         // default cards per topic (math 2, mcat 12) — derived from forms.flashcard
    masteryStreak: number;          // consecutive-correct to master (math 3, mcat 4)
    reviewProbability: number;      // spiral-review interleave rate (~0.35 both)
    srsModel: "leitner" | "simple"; // flashcard SRS depth
    diagnostic: "adaptive" | "sweep"; // adaptive needs hasPrereqEdges
  };
  // ---- GENERATION ----
  generation: {
    domainLine: string;             // "AP Precalc/Calc AB adaptive app" | "MCAT Biology"
    isLatex: boolean;               // math: all in $...$; mcat: prose + $...$ for chem
    depthDirective: string;         // the MCAT "deepen past AP-Bio" block; "" for math
    distractorStyle: string;        // course-specific distractor guidance
    useExemplars: boolean;          // math grounds on exemplar problems
    useTemplateCards: boolean;      // mcat grounds on template cards
  };
  // ---- PRESENTATION ----
  ui: {
    showYieldBadges: boolean;       // precalc true, calc_ab false
    onboardingModal: boolean;       // mcat true
    sampleQuestion: boolean;        // math free-trial true
  };
}
```

**Everything that currently differs between math and MCAT maps to a field above.** The two existing courses become two `CourseConfig` literals; `precalc` and `calc_ab` are already two courses inside the math family, proving the registry can hold N courses per family.

### 2.3 Shared core modules (consolidation targets)

| Module | Replaces | Responsibility |
|---|---|---|
| `lib/courseEngine/embeddings.ts` | math+mcat tagging trio (identical) | `cosineSimilarity`, `embedText`, `tagByEmbedding`. |
| `lib/courseEngine/keywords.ts` | both `loadTargetKeywords` | course-filtered, paginated keyword load (always paginate — PostgREST 1000 cap). |
| `lib/courseEngine/generator.ts` | mathGenerator + mcatGenerator | `generateQuestions/Flashcards/Lesson(config, …)`; prompts assembled from `config.generation`. |
| `lib/courseEngine/mastery.ts` | duplicated EMA/state logic in both `attempt` routes | EMA 0.12, distractor shift 0.20, refresher credit 0.4, state machine; streak from `config.emphasis.masteryStreak`. |
| `lib/courseEngine/selection.ts` | duplicated next-question scoring | weakness-fit + difficulty Gaussian + yield nudge (numeric) + MMR diversity. |
| `lib/courseEngine/srs.ts` | `flashcardSrs.ts` + math recirculation | Leitner or simple per `config.emphasis.srsModel`. |
| `lib/courseEngine/diagnostic.ts` | math + mcat diagnostic route bodies + `mcatDiagnostic.ts` | adaptive-with-propagation when `hasPrereqEdges`, else sweep. |
| `lib/courseEngine/plan.ts` | both auto-plan routes | frontier walk + spiral review + checkpoint logic. |

Already-unified files (`questionEnrichment`, `refresherGenerator`, `assembleChoices`, `scienceNotation`, `bestKeyword`) move under `lib/courseEngine/` and take `CourseConfig` instead of the `"math"|"mcat"` string.

### 2.4 Routes — one set, parameterized by `[course]`

```
app/learn/[course]/api/
  next-question, attempt, auto-plan, practice-queue,
  flashcards, flashcard-attempt, quiz, quiz-gate,
  diagnostic/{start,answer,skip},
  search, taxonomy, auto-intro, sample-question,
  lesson/[keywordId], refresher/[keywordId], feedback, similar
```

Each handler: `const config = COURSE_REGISTRY[params.course]` → call shared core with `config`. No per-course branching beyond the registry lookup. (`/api/math/*` and `/api/mcat/*` become thin redirects during migration, then deleted.)

### 2.5 UI — one set of pages + shared components

```
app/learn/[course]/
  page.tsx                  (landing — config.ui drives sections/onboarding/yield)
  auto/page.tsx             (the 14-phase guided engine, config-driven)
  diagnostic/page.tsx
  [categoryId]/{page,practice,quiz,flashcards}/page.tsx
  progress/page.tsx
components/shared/
  LessonView, FlashcardRunner, PracticeRunner, ChoiceButton, MathText, FeedbackWidget
```

`MathText`/`ChoiceButton` move out of `components/mcat/` into `components/shared/`. `MathLessonView` + `LessonView` merge into one `LessonView` (combo gamification becomes a prop). The family switcher (Math | MCAT) in `NavMenu` switches between *registry entries grouped by `family`*, so adding a course family is automatic.

### 2.6 Data layer — recommendation: **unify into `course_*` tables with a `course` column**

Two options:

**Option A — Keep `math_*`/`mcat_*` physically, share only code (interface layer).**
The shared core resolves table names from `CourseConfig` (as `questionEnrichment.ts` already does). Lowest migration risk.
- ✅ No data migration; ships fastest.
- ❌ Adding a new course **still requires creating a new set of tables** + wiring names — violates the "supply only taxonomy + config" directive. Yield representation stays inconsistent. The table-name map is permanent boilerplate.

**Option B — Unify into shared `course_*` tables keyed by a `course` column.** *(Recommended.)*
`course_categories`, `course_keywords`, `course_questions`, `course_flashcards`, `course_lessons`, `course_*_attempts`, `course_student_keyword_states`, `course_flashcard_srs`, `course_prereq_edges`, `course_diagnostic_sessions`, `course_course_categories` (membership), `course_action_keywords`, `course_representation_keywords`, plus a new **`course_content_weights`** (or fold emphasis into a `courses` registry table). Every row carries `course text`.
- ✅ New course = **INSERT taxonomy rows with the new `course` value + add a registry entry. Zero DDL, zero new tables, zero new code** — exactly the directive.
- ✅ Forces yield standardization (numeric 0–1) and one SRS model.
- ✅ Cross-course analytics/search trivial.
- ❌ One-time migration of live `math_*`/`mcat_*` data; must reconcile schema diffs (`stem_latex` vs `stem`). Highest risk — so it's the **last** phase, gated on a backup + the parity test suite.

**Decision: target Option B, reached via Option A as an intermediate.** Phases 2–5 unify the code behind a table-name interface (Option A behavior); Phase 6 performs the physical merge to `course_*`. This lets every earlier phase ship without touching data.

#### Schema reconciliation for the merge
- **Field names:** adopt neutral columns. Store content as `stem` + `solution` (drop the `_latex` suffix); an `is_latex` flag lives on the course config, not the row. Keep `front`/`back` for flashcards. Migrate `stem_latex`→`stem`, `solution_latex`→`solution`, `explanation`→`solution`, `*_latex` flashcard cols→`front`/`back`.
- **Yield:** `yield_score real` everywhere; convert MCAT `yield_level` h/m/l → 0.8/0.5/0.2 (preserve `yield_rationale`).
- **Course membership:** `course_course_categories(course, category_id, role, order_index)` — math already has this; MCAT gets one row per category with `role='core'`.
- **Emphasis:** a `courses` table (or `course_content_weights`) holding the per-form weights + `mastery_streak`, `review_probability`, `srs_model`, `flashcard_count`, `diagnostic_strategy`, `is_latex`, `show_yield`, etc. — i.e. the persisted half of `CourseConfig`. Generation prompt strings stay in code (they're code, not data).

---

## 3. The "Add a New Course" Path (end state)

A developer adds a course by supplying **two things and nothing else**:

1. **A keyword taxonomy** — JSON in `content/<course>-taxonomy/*.json` following the existing math schema (category → umbrella → in_depth, each with description + examples + numeric `yield_score`), optionally `_prereq_edges.json`. Seeded via a generic `course:seed` script (generalization of `math:seed`) which writes rows tagged with the new `course` value into the shared `course_*` tables. Embeddings via generic `course:embed`.
2. **A `CourseConfig` registry entry** — one literal in `COURSE_REGISTRY` (taxonomy filter, emphasis weights, generation domain line + LaTeX/depth/distractor directives, UI flags). For MCAT-like recall-heavy courses set `forms.flashcard` high + `srsModel:"leitner"`; for math-like reasoning courses set `forms.quiz` high + `srsModel:"simple"`.

The engine then automatically provides, with **zero new bespoke code**: generation + 7-embedding enrichment + tagging, the diagnostic (adaptive if prereq edges supplied, else sweep), auto/guided LESSON→FLASHCARDS→PRACTICE→QUIZ flow, mastery + spiral review + checkpoints, all routes under `app/learn/[newcourse]/`, all UI pages, nav/switcher integration (grouped by `family`), refreshers, prioritize, metrics. The course is live the moment its rows exist and its registry entry is present.

**Acceptance test for "done":** standing up a hypothetical third course (e.g. "MCAT Chemistry") requires only a taxonomy JSON + a registry entry + running `course:seed`/`course:embed`. If any `.ts`/route/component edit is needed, the engine isn't generic yet.

---

## 4. Phased, Low-Risk Refactor Plan

Each phase is independently shippable and testable. A **golden parity test** (capture current math + MCAT outputs for a fixed seed set: next-question selection, attempt state transitions, auto-plan frontier, diagnostic placement, generated-content shape) is built **first** and re-run after every phase to prove no behavior change.

> **Sequencing vs in-flight work:** Phases 0–2 are additive/extraction and safe to start now. **Hold Phase 3 (generator) and Phase 6 (data migration) until the in-flight distractor rebuild, diagnostic fixes, and curriculum gap-fill land** — those touch the exact prompt/selection/diagnostic code the unification consolidates, and merging mid-flight would thrash. Coordinate: unify a module only after its in-flight edits settle.

### Phase 0 — Parity harness + course registry scaffold *(no behavior change)*
- Build the golden parity test suite (fixtures for both courses).
- Introduce `lib/courseEngine/config.ts` + `COURSE_REGISTRY` with three entries (`precalc`, `calc_ab`, `mcat_bio`) describing **current** behavior. Nothing consumes it yet.
- **Ship/risk:** trivial; pure addition.

### Phase 1 — Emphasis config made real *(small, visible win)*
- Replace the hardcoded magic numbers (flashcard count 2 vs 12, mastery streak 3 vs 4, review 0.35, SRS choice) with reads from `COURSE_REGISTRY[course].emphasis`.
- This delivers the user's headline feature first: **"what matters more" is now a config**, even before the big consolidation.
- **Risk:** low — values unchanged, just relocated. Parity test guards.

### Phase 2 — Consolidate the duplicated libs into shared core *(Option A interface)*
- Merge the tagging trio + `loadTargetKeywords` → `lib/courseEngine/{embeddings,keywords}.ts` (always paginate).
- Move already-unified files under `lib/courseEngine/`, switch their signature from `"math"|"mcat"` to `CourseConfig`.
- Extract `mastery.ts`, `selection.ts`, `srs.ts`, `plan.ts`, `diagnostic.ts` from the route bodies (logic unchanged, table names resolved from config).
- Routes still live at `/api/{math,mcat}/*` but now call the shared core.
- **Risk:** medium — touches every route's internals. De-risk: one module at a time, parity test after each; yield numeric/categorical handled by a config adapter (no schema change yet).

### Phase 3 — Unify the generator *(hold for in-flight distractor/diagnostic work)*
- `lib/courseEngine/generator.ts` assembles prompts from `config.generation`; `mathGenerator`/`mcatGenerator` become thin wrappers, then deleted.
- Backfill the drift fixes for free: lesson verification + exemplar support become config flags available to all courses.
- **Risk:** high-touch (generation is the latency-sensitive hot path + actively edited). De-risk: land **after** distractor rebuild settles; keep fast-verify; diff generated output against golden fixtures.

### Phase 4 — Unify routes behind `app/learn/[course]/api/*`
- Stand up the parameterized route tree calling the shared core.
- Point `/api/{math,mcat}/*` at the new handlers (re-export) so existing clients keep working; flip clients over; delete old routes.
- **Risk:** medium — surface area is wide but logic is already shared by Phase 2/3. De-risk: redirect shim keeps both URL families alive during cutover.

### Phase 5 — Unify UI/pages/components
- Build `app/learn/[course]/*` pages from the merged components; move `MathText`/`ChoiceButton` to `components/shared/`; merge the two LessonViews and the two auto pages into config-driven single implementations.
- Old `/math/[course]/*` and `/mcat/*` pages redirect to `/learn/*`.
- **Risk:** medium — UI regressions. De-risk: Playwright e2e (`mcat-flow.spec.ts`, `demo-diagnostic.spec.ts`) extended to drive `/learn/*`; screenshot diffs.

### Phase 6 — Unify the data model into `course_*` tables *(gated on backup + all in-flight content work)*
- Create `course_*` tables; backfill from `math_*` + `mcat_*` with the schema reconciliation in §2.6 (field renames, yield numeric, membership rows, emphasis registry table).
- Switch the shared core's table resolver from per-family names to the single `course_*` set filtered by `course`.
- **Risk:** highest (live data). De-risk: do it as an additive backfill (write new tables, dual-read, verify counts/spot-checks), then flip reads, keep old tables read-only for a rollback window. Run during low traffic; snapshot first. **Wait for distractor rebuild + curriculum gap-fill to finish** so you migrate final data once.

### Phase 7 — Delete the dead stacks
- Remove `mathGenerator`/`mcatGenerator`, `mathTagging`/`mcatTagging`, `mcatDiagnostic.ts`, the old route trees, the old pages, and (after the rollback window) the `math_*`/`mcat_*` tables.
- Update CLAUDE.md + `docs/*` to describe the single engine.
- **Risk:** low once 0–6 are stable and parity is green.

### Riskiest parts & how they're de-risked
- **Generation (Phase 3):** actively edited + latency-critical → sequence after in-flight work, keep fast-verify, golden-diff outputs.
- **Data migration (Phase 6):** live data + schema reconciliation → additive backfill + dual-read + rollback window + single migration after content work lands.
- **Auth/session:** **already unified** via Supabase Auth + `lodera_uid` cookie (both stacks resolve the user identically), so it is *not* a risk — the engine inherits one auth path.
- **Diagnostic divergence:** adaptive-vs-sweep is config (`diagnostic` + `hasPrereqEdges`); MCAT keeps sweep until/unless it supplies prereq edges, so no forced behavior change.

---

## 5. Alignment with the canonical spec

This design *is* the CLAUDE.md canonical workflow, factored into one engine:
- The **8-part problem**, **7-embedding** enrichment, and **keyword tiers** (course → categories → umbrella → subtopic, with ACTION/REPRESENTATION pools) are already shared infra (`questionEnrichment.ts`, the four-dimension migration) — the engine keeps them course-agnostic.
- The **LESSON → FLASHCARDS → PRACTICE** guided path, **diagnostic → auto in course order**, **spiral review**, **refreshers**, and **mastery threshold** are the spec's workflow — promoted from two implementations to one config-driven `plan.ts` + auto page.
- The directive's **"only taxonomy + emphasis differ"** is satisfied exactly by `CourseConfig` (§2.2): taxonomy reference + `emphasis.forms`. Flashcards-matter-more (MCAT) vs quiz-matters-more (math) becomes `emphasis.forms`, which drives counts, ordering, and the review/checkpoint mix — replacing today's hardcoded 2-vs-12 and 3-vs-4 magic numbers.

---

## 6. Open decisions to confirm before Phase 3/6

1. **Yield mapping** for MCAT h/m/l → numeric — confirm 0.8/0.5/0.2 (or re-author numerically during gap-fill).
2. **Emphasis storage** — DB `courses` table vs code-only registry. Recommend **DB for the numeric/behavioral half** (so non-deploy tuning is possible) + **code for prompt strings**.
3. **URL scheme** — `/learn/[course]/*` (recommended, neutral) vs keeping `/math` `/mcat` as families. Affects bookmarks/SEO; redirect shims cover it either way.
4. **How emphasis weights map to behavior** — exact formula from `forms` weights → flashcard count, review mix, and form ordering. Propose a simple linear mapping in Phase 1 and tune.
