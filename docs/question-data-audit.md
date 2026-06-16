# Question Data Completeness Audit

**Scope:** Live `math_questions` and `mcat_questions` (the tables that back both
practice and quizzes). **Mode:** read-only; lightweight COUNT + single-row
samples only. **Date:** 2026-06-16.

## Key structural finding: quizzes are NOT a separate table

Quizzes are assembled from the **same** question tables, not a dedicated store:

- `apps/student/app/api/math/quiz/route.ts` selects from `math_questions`.
- `apps/student/app/api/mcat/quiz/route.ts` selects from `mcat_questions`.
- No `math_quiz_questions`, `mcat_quiz_questions`, `quizzes`, or `quiz_questions`
  table exists (queries returned table-not-found).

Therefore **"quiz questions" inherit exactly the same data as the question pool** —
every gap below applies equally to practice and quiz contexts.

## Totals (live counts)

| Table | Rows |
|---|---|
| `math_questions` | 470 |
| `mcat_questions` | 75 |
| `math_keywords` | 1732 |
| `mcat_keywords` | 847 |

---

## Item 1 — Wrong-answer (distractor) descriptions

**Column involved:** **NONE on the live tables.** `math_questions.choices` and
`mcat_questions.choices` are plain JSONB **string arrays** (e.g. math:
`["$\sqrt{x}+5$","$7x^3-4x+2$",...]`; mcat: full-sentence strings). There is no
per-choice object, no `description`/`rationale` per wrong answer, and **no
`wrong_answer_data` column** (a `NOT NULL` filter on it errors — column absent).

What exists instead is a single overall explanation per question:
`math_questions.solution_latex` and `mcat_questions.explanation`.

| | Total | Has overall solution/explanation | Has per-distractor descriptions | % missing distractor desc. |
|---|---|---|---|---|
| math | 470 | 470 (0 null) | **0** | **100%** |
| mcat | 75 | 75 (0 null) | **0** | **100%** |

> A per-distractor description column **does** exist on the legacy AP-calc tables
> (`problems.wrong_answer_data`, `rag_examples.wrong_answer_data`; migration
> `20260525000001_wrong_answer_data.sql`). `rag_examples` has it populated
> (399 rows, only 1 empty). But `problems` is now empty (0 rows) and **neither
> the math nor mcat live tables carry that column.**

**Verdict: NOT MET.** Schema change required (add `wrong_answer_data`-style
column to `math_questions` + `mcat_questions`) plus generation backfill.

---

## Item 2 — Wrong-answer embeddings & per-distractor keyword weights

**Column involved:** **NONE on the live tables.** Per-distractor embeddings and
per-distractor `keyword_weights` are stored only inside the legacy
`wrong_answer_data[i]` objects (`{description, embedding, keyword_weights}` —
confirmed shape on a `rag_examples` sample, where `embedding` is a 1536-dim
array and each entry has its own `keyword_weights`). That column does not exist
on `math_questions`/`mcat_questions`.

The `keyword_weights` that the live tables **do** have is **question-level
(whole-stem) only**, not per-choice — one weight map describing the question's
content keywords.

| | Total | Per-distractor embeddings | Per-distractor weights | % missing |
|---|---|---|---|---|
| math | 470 | **0** | **0** | **100%** |
| mcat | 75 | **0** | **0** | **100%** |

Question-level embedding coverage (for completeness, not the same thing):

| | Total | Missing question `embedding` | % missing |
|---|---|---|---|
| math | 470 | 53 | 11.3% |
| mcat | 75 | 4 | 5.3% |

Keyword-level embeddings are fully backfilled: `math_keywords` 0/1732 missing,
`mcat_keywords` 0/847 missing. Question-level `keyword_weights` are populated
(0 questions have empty `{}` weights in either table).

**Verdict: NOT MET.** No per-distractor embeddings or weights exist on the live
tables; the storing column itself is absent. Schema change + backfill required.

---

## Item 3 — Action & Representation dimension tags

### The four-dimensional keyword system

Documented in `docs/admin.md` and `docs/content-pipeline.md`. The four
dimensions and how they are stored on the **legacy** `problems` / `rag_examples`
tables:

| # | Dimension | Column | Keyword category that defines it |
|---|---|---|---|
| 1 | **Topic / concept** | `keyword_weights` | all non-action content categories |
| 2 | **Action** (cognitive verb) | `action_weights` | `action_items` |
| 3 | **Representation** (how it's shown) | `representation_weights` | `representations` (symbolic, verbal, contextual, graphical, tabular, diagram, exact_form, approximate_form) |
| 4 | **Prerequisite** | `prerequisite_weights` | all non-action content categories |

So the **dimension is encoded by the keyword's category**, and each dimension
has its own JSONB weight column. Tagger: `apps/admin/lib/ai/keywordTagger.ts`
→ `autoTagKeywords()`. Note: the `action_weights` / `representation_weights` /
`prerequisite_weights` columns appear in **no migration file** — they were added
ad-hoc and exist only on `problems` / `rag_examples`.

### How the live math/mcat tables encode dimensions

They **don't.** `math_questions` and `mcat_questions` have a **single
`keyword_weights` column** and no `action_weights` / `representation_weights`
columns (a non-null filter on `action_weights` errors — column absent).

The keyword pools contain **only content/topic categories** — there is no
`action_items` or `representations` category to tag against:

- `math_keywords` categories: `algebraic_expressions`, `calc_unit_1`…`calc_unit_8`,
  `exponential_and_logarithmic_functions`, `exponents_and_radicals`,
  `functions_and_graphs`, `linear_equations_and_inequalities`. (No action/representation.)
- `mcat_keywords` categories: ten `mcat_biology_*` content categories. (No action/representation.)

Sampled live `keyword_weights` reference only these content keywords
(e.g. `polynomial_expression_definition`, `gibbs_free_energy_sign_and_spontaneity`).

| | Total | Carry ≥1 ACTION tag | Carry ≥1 REPRESENTATION tag |
|---|---|---|---|
| math | 470 | **0** | **0** |
| mcat | 75 | **0** | **0** |

**Verdict: NOT MET.** Only 1 of the 4 dimensions (topic) is implemented for
math/mcat. Action and representation dimensions are entirely absent — no
columns, no keyword categories, no tags. (They exist for the legacy AP-calc
`rag_examples` pool: sampled `action_weights` `{"combine":0.65,"identify":0.35}`,
`representation_weights` `{"verbal":0.72,"symbolic":0.28}`.)

---

## Existing backfill / generation infrastructure

| Script / route | What it does | Covers a gap above? |
|---|---|---|
| `scripts/embed-math.ts` | Embeds `math_keywords` (label+description), 1536-dim | Keyword embeddings only — not distractors |
| `scripts/embed-mcat.ts` | Embeds mcat keywords, **questions** (stem+correct choice), flashcards; retags **question-level** `keyword_weights` via cosine | Question + keyword embeddings; whole-stem weights — **not** per-distractor, not action/representation |
| `scripts/backfill-math-blueprints.ts`, `backfill-mcat-blueprints.ts` | Fill `concept_blueprint` (in/out-of-scope contract per keyword) | Scope contracts — unrelated to distractors/dimensions |
| `scripts/seed-math-taxonomy.ts`, `seed-mcat-taxonomy.ts` | Seed content categories/keywords | Topic dimension only; defines no action/representation categories |
| `scripts/expand-mcat-keywords.ts`, `*-yield`, `audit-mcat-scope.ts` | Keyword expansion / yield / scope audit | Not distractor/dimension related |
| `apps/admin/lib/ai/keywordTagger.ts` (`autoTagKeywords`) | Generates all 4 dimension weight maps **and** per-distractor `wrong_answer_data` (description + embedding + weights) | **Exists, but targets legacy `problems`/`rag_examples` only** — would need porting to math/mcat tables + the schema columns to write into |

**Bottom line:** the *logic* for distractor rationales and the 4-dimension tagger
already exists (`keywordTagger.ts`, used on `rag_examples`), but it has never
been wired to `math_questions`/`mcat_questions`, and those tables lack the
columns (`wrong_answer_data`, `action_weights`, `representation_weights`) to
receive its output. Fixing all three items requires: (a) additive schema columns
on both live tables, and (b) a backfill pass adapting the existing tagger.

---

## Overall verdict

| Item | math | mcat | Met? |
|---|---|---|---|
| 1. Wrong-answer descriptions | 0/470 | 0/75 | **NOT MET** (no column) |
| 2. Per-distractor embeddings/weights | 0/470 | 0/75 | **NOT MET** (no column) |
| 3. Action + representation tags | 0/470 | 0/75 | **NOT MET** (no columns, no keyword categories) |

All three requirements are unmet for the live math and mcat question pools (and
therefore for quizzes, which draw from the same tables). The required
infrastructure exists in prototype form on the legacy AP-calc tables but was
never carried into the current math/mcat schema.
