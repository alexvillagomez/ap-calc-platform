# Math System Design Spec (precalc + calc_ab)

Authoritative spec for the new MCAT-style math learning system. Written by the build manager; all
subagents must conform to it. Grounding research: `precalc-outline.md`, `calc-ab-outline.md`,
`db-inventory.md` (same directory). MCAT reference implementation: `apps/student/lib/mcat*.ts`,
`apps/student/app/mcat/`, `apps/student/app/api/mcat/`, `docs/mcat-system.md`.

## Locked decisions (user-approved)
- Scope: Precalculus (foundations + AP Precalculus) and AP Calc AB only. No BC.
- New `math_*` tables modeled on `mcat_*`; existing `learn_*` / `rag_examples` / `problems` data is
  imported/mapped, NEVER deleted or destructively altered. All migrations strictly additive.
- Generation model: `gpt-5.4-mini` for everything (reason-first + blind-solve fast verification,
  same pipeline as MCAT). Embeddings: `text-embedding-3-small`.
- All work on branch `math-system`; never merge/push to `main` (auto-deploys prod).
- DB: user approved full additive access to Supabase project `czjyvmpvxejsrctxgqke`
  (CLI `supabase db push` for DDL, service-role PostgREST for DML).
- Yield is a single number 0.00–1.00 (NOT low/medium/high). Spread the full range.
- Practice problems are the core experience. Flashcards exist but are de-emphasized.

## Course / category model
Keywords exist ONCE, in exactly one category (MECE). Courses are views over categories via a join
table, which is how precalc lives standalone AND inside calc.

### Categories (19)
**Foundations section** (`section: 'foundations'`) — existing DB taxonomy is the base; enrich, don't drop:
- F1 `number_systems`
- F2 `algebraic_expressions`
- F3 `linear_equations_and_inequalities`
- F4 `systems_of_equations`
- F5 `polynomials`
- F6 `exponents_and_radicals`
- F7 `functions_and_graphs` (NEW — function notation, domain/range, evaluating, graph reading,
  piecewise definitions. Fills the empty `functions`/`piecewise_functions` learn_categories gap.)

**AP Precalculus section** (`section: 'ap_precalc'`):
- P1 `polynomial_and_rational_functions` (CED Unit 1, topics 1.1–1.14; includes transformations 1.12)
- P2 `exponential_and_logarithmic_functions` (CED Unit 2, 2.1–2.15; includes composition 2.7, inverses 2.8)
- P3 `trigonometric_and_polar_functions` (CED Unit 3, 3.1–3.15)
- P4 `parameters_vectors_and_matrices` (CED Unit 4, 4.1–4.14 — NOT exam-assessed; yield ≤ 0.15)

**AP Calc AB section** (`section: 'calc_ab'`):
- C1 `limits_and_continuity` (Unit 1) … C8 `applications_of_integration` (Unit 8), using CED unit
  names, ids `calc_unit_1`…`calc_unit_8`.

### Course membership (`math_course_categories`)
- `precalc` course: F1–F7 (role `core`, ordered first) + P1–P4 (role `core`).
- `calc_ab` course: F1–F7 + P1–P4 (role `foundation`) + C1–C8 (role `core`).
This is the "precalc lives inside calc" mechanism — one source of truth, two course views.

### Tiers
3-tier like MCAT: category → umbrella → in_depth.
- Umbrellas: ~6–14 per category. For AP categories, umbrellas ≈ CED topics (merge trivially small
  adjacent topics). For foundations, base = existing umbrella-tier `learn_keywords`.
- in_depth: 4–8 per umbrella; each tests exactly ONE narrow skill (one rule, one move, one
  interpretation). Slug ids, MCAT style (e.g. `chain_rule_with_nested_trig`).
- Target scale: ~150–200 umbrellas, ~900–1400 in_depth total.

## Yield (0–1 numeric)
`yield_score REAL` + `yield_rationale TEXT` on every keyword (all tiers).
Calibration: exam-unit weighting × topic centrality × FRQ frequency (from research docs).
Foundations: frequency the skill is exercised inside downstream topics. Anchors: chain rule 0.95,
FTC 0.90, exponent laws 0.92, sinusoidal modeling 0.90, linearization 0.55, arc length 0.35,
set-builder notation 0.20, Unit 4 precalc ≤ 0.15. Practice-queue nudge maps yield linearly to the
MCAT bounded-nudge range (yield 1.0 → −0.12, yield 0.0 → +0.10 on effective weakness score).
Existing precalc content gets numeric yield during import (this satisfies "update existing precalc
yield metrics").

## Taxonomy authoring format
One JSON file per category: `content/math-taxonomy/<category_id>.json`:
```jsonc
{
  "category": {
    "id": "polynomial_and_rational_functions",
    "label": "Polynomial and Rational Functions",
    "description": "...",
    "section": "ap_precalc",
    "ced_unit": "AP Precalc Unit 1",
    "courses": [ {"course":"precalc","role":"core","order_index":8},
                 {"course":"calc_ab","role":"foundation","order_index":8} ],
    "yield_score": 0.85, "yield_rationale": "30-40% of AP Precalc exam"
  },
  "umbrellas": [ {
    "id": "rational_function_end_behavior",
    "label": "...", "description": "...",
    "ced_topics": ["1.7","1.8"],
    "yield_score": 0.7, "yield_rationale": "...",
    "source_learn_keyword_id": null,        // set when this maps to an existing learn_keywords row
    "in_depth": [ {
      "id": "horizontal_asymptote_from_degree_comparison",
      "label": "...", "description": "1-2 sentences, what exactly is tested",
      "yield_score": 0.75, "yield_rationale": "...",
      "source_learn_keyword_id": null
    } ]
  } ]
}
```
Rules:
- Foundation categories MUST include every existing precalc umbrella/in_depth `learn_keywords` row
  for that category (see db-inventory.md) — keep DB ids as `source_learn_keyword_id`, improve
  labels/descriptions where weak, add yields. New keywords may be added where there are gaps.
- The 161 MCAT-biology rows and 57 tag/action rows inside `learn_keywords` are EXCLUDED.
- `representations`-style dimensions (symbolic/graphical/tabular/verbal) are NOT categories or
  keywords; they may appear later as question tags only.
- MECE: a skill lives in exactly one category. Boundary rules: transformations → P1; composition &
  inverses → P2; all limits content → C1 even if "limits of trig" (P3 owns trig values/identities);
  derivative of exp/log → C2/C3 (P2 owns exp/log algebra); solving trig equations → P3 (C* assumes it).

## Database schema (math_* additive migration)
- `math_categories`: id (text pk), label, description, section ('foundations'|'ap_precalc'|'calc_ab'),
  ced_unit text, yield_score real, yield_rationale text, order_index int, embedding jsonb, status.
- `math_course_categories`: course text ('precalc'|'calc_ab'), category_id fk, role ('core'|'foundation'),
  order_index int. PK (course, category_id).
- `math_keywords`: id text pk, category_id fk, parent_keyword_id fk nullable, tier ('umbrella'|'in_depth'),
  label, description, ced_topics jsonb, yield_score real, yield_rationale text,
  concept_blueprint jsonb, source_learn_keyword_id text, examples jsonb, status, order_index,
  embedding jsonb.
- `math_questions`: uuid pk, category_id, stem_latex, choices jsonb (4), correct_index, solution_latex
  (worked solution, KaTeX), hint_latex, keyword_weights jsonb, difficulty real (0.2–0.9 like MCAT),
  parent_question_id, source ('generated'|'imported_rag'|'imported_practice'), source_id text,
  embedding jsonb, avg_rating, rating_count, flag_count, status ('active'|'flagged'|'out_of_scope').
- `math_flashcards`: like mcat_flashcards (kept lean).
- `math_lessons`: keyword_id unique fk, micro_steps jsonb, model, ratings/flags.
- `math_question_attempts`, `math_flashcard_attempts`: like MCAT equivalents.
- `math_student_keyword_states`: PK (session_id, keyword_id); score real, total/correct attempts,
  consecutive_correct, dont_know_count, state ('in_progress'|'mastered'), spaced_review_due_at,
  spaced_review_count, course text.
- `math_content_feedback`: like mcat_content_feedback.
- `math_prereq_edges`: from_category_id, to_category_id, strength real, note. (Drives diagnostic
  inference: failing `from` implies likely failing `to`.) Seed from research docs' prerequisite sections.
- `math_diagnostic_sessions`: id uuid, session_id, course, status, asked jsonb (question/keyword log),
  category_estimates jsonb, created_at/completed_at.
- ALSO additive: `learn_keywords.yield_score real`, `learn_keywords.yield_rationale text`
  (backfilled for the 777 precalc rows = "update existing precalc yield metrics" in place too).
Reuse MCAT conventions exactly (indexes, defaults, fail-open nullables). Sessions reuse the existing
MCAT/student session mechanism (`mcatSession.ts` pattern).

## Generation pipeline (port of MCAT)
- `mathGenerator.ts`: reason-first JSON generation (stem → solution → choices), code-assigned random
  correct index, exactly-4-distinct-choices validation, blind-solve fast verification (~4s timeout,
  fail-open) for questions/lessons/flashcards. ALL math content in KaTeX-compatible LaTeX (`$...$`
  inline, `$$...$$` display) — same renderer the MCAT pages use.
- Difficulty: continuous 0.2–0.9 with easy/medium/hard bands (reuse MCAT mapping).
- Grounding blocks injected into every prompt: (1) concept blueprint scope contract,
  (2) CED outline context for the category (`mathContentOutline.ts`, built from the research docs),
  (3) exemplar problems: nearest `rag_examples` / imported `math_questions` by embedding —
  the analog of MCAT's anki template cards. rag_examples define the house style for problems:
  clean LaTeX stem, 4 choices, worked solution, plausible distractors keyed to specific mistakes.
- Wrong answers: each distractor should embody a specific predictable error (sign slip, dropped
  chain factor, swapped formula) — solution explains the trap when natural.
- Blueprints: `mathBlueprint.ts` port; sibling-grounded; generated per keyword in same call as yield.

## Practice / quiz / lesson flow (port of MCAT)
Same loop as MCAT practice: weakness-first queue (cap 40), mastery gate (score ≥ 0.8 AND 4
consecutive correct), ~50% similar-variant bias, ~35% spaced-review injections, lessons on struggle
(2 consecutive misses) or on demand. Quizzes: 8 questions, mixed difficulty spread. Flashcards only
as warm-up (≤2) and on-demand — practice problems dominate.

## Diagnostic + fully-automatic mode
- Adaptive, SHORT diagnostic per course: walks the prerequisite DAG (math_prereq_edges + category
  order). Start mid-chain; binary-search style. A miss on a prerequisite category propagates a low
  prior to all downstream categories (no questions asked there); strong answers skip upstream
  basics. Target: 8–14 questions for placement, hard cap 16. Output: per-category prior scores
  (0–1) written into math_student_keyword_states as priors at category umbrella level + a starting
  category.
- "Automatic mode" (`/math/[course]/auto` or similar): Duolingo-style continuous path. Uses
  diagnostic priors → picks current frontier category → runs the standard practice loop with
  mastery gates → auto-advances along course order, periodically injecting spaced review and
  unit-quiz checkpoints. One button: "Continue".

## UI
Mirror the MCAT layout/components (landing cards + mastery bars + yield badges, browse drill-down,
practice loop screen, quiz with deferred review, lesson page, progress dashboard) under:
- `/precalc` → course view (sections: Foundations, AP Precalculus)
- `/calc` → course view (sections: Precalc Foundations (collapsed/secondary), Units 1–8)
- Both share components under `apps/student/components/math/` and routes `/math/...` are fine too —
  follow MCAT file structure conventions. KaTeX everywhere. Yield badge shows the 0–1 number
  rendered as e.g. "Yield 0.85" with color ramp.

## Quality gates (manager will verify)
1. `cd apps/student && npx next build` passes (ESLint strict) — required before every commit.
2. Every taxonomy file passes MECE audit + schema validation script.
3. Sample generations per category blind-solve-verified; manual spot reads.
4. Screenshots of every page state reviewed; prompts iterated until lessons/problems look right.
5. No writes to `main`; no destructive SQL ever.
