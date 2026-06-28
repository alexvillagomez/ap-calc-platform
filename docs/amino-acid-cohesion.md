# Amino-Acid Unit Cohesion — MECE coverage with no holes, no redundancy

Worked example: the MCAT `mcat_biology_amino_acids_and_proteins` category. The goal is a
unit whose keywords **tile the testable content exactly once** — every essential concept is
owned by exactly one keyword (no holes), and no two keywords (or two flashcards) teach the
same fact (no redundancy). This doc records the structural approach; the code changes that
implement it are small and listed at the end.

## The problem we observed (real run, amino-acids intro)

1. **Intro lesson didn't define an amino acid.** The first lesson for
   `what_is_an_amino_acid_overview` rendered a molecule but never stated the definition
   (monomer of protein; α-carbon + amino/carboxyl/H/R; 20 standard) nor previewed the 20.
2. **The 20 amino acids are never memorized.** No deck drills name ↔ structure ↔ 3/1-letter
   code ↔ side-chain class. The closest keyword, `amino_acid_abbreviations_and_identity`, had
   **zero** flashcards.
3. **Flashcards were repetitive.** The intro deck had **30 cards** that rephrased ~6 atomic
   facts ("the R group is the variable part" was the answer to ~12 of them).
4. **Weak/empty scope contracts → out-of-scope questions.** Two overview keywords
   (`side_chain_classification_overview`, `ionizable_groups_and_pka_basics`) had **null
   blueprints**, so generated questions had no boundary and drifted into sibling territory.
5. **Decks were generated one keyword at a time, in isolation.** Each deck only saw sibling
   *labels*, never a shared partition — so coverage had both holes (most keywords empty) and
   overlap (the intro deck swallowed backbone/structure facts owned by neighbors).

## The model: a per-unit coverage map

Treat each **umbrella (topic)** as the MECE unit. An umbrella owns a finite set of
**essential concepts**; every concept is assigned to **exactly one** in-depth keyword. That
assignment IS the coverage map. It already exists implicitly in the data:

- `mcat_keywords.description` — the keyword's lane in one imperative sentence.
- `concept_blueprint.in_scope_concepts` / `key_terms` — what this keyword owns.
- `concept_blueprint.out_of_scope` — what a **sibling** owns (names the adjacent territory).
- `concept_blueprint.boundary_statement` — the hard fence that keeps generated
  questions/lessons/cards inside the lane.

The coverage map is therefore enforced by **good blueprints**, not a new table. Three
invariants make it MECE:

- **No holes (collectively exhaustive):** every essential concept of the umbrella appears in
  some keyword's `in_scope_concepts`. Gap check = "is there a concept no keyword claims?"
- **No overlap (mutually exclusive):** a concept appears in exactly one keyword's
  `in_scope_concepts`, and every *other* keyword that might be confused with it lists it in
  `out_of_scope`. Overlap check = "do two keywords both claim the same concept?"
- **One owner per fact at generation time:** flashcards/questions are tagged to a single
  primary keyword; a fact that belongs to a sibling is excluded by that sibling's blueprint.

### Amino-acids worked example (umbrella → owned concepts)

| Umbrella | In-depth keyword | Owns (exactly) |
|---|---|---|
| Structure & stereochem | `what_is_an_amino_acid_overview` | **definition + PREVIEW only**: monomer of protein, α-carbon scaffold, the 4 attached groups, "20 standard differ by R group", the 4 side-chain classes named (not drilled) |
| | `alpha_amino_acid_backbone_structure` | the shared backbone template; backbone vs side-chain atoms |
| | `amino_acid_abbreviations_and_identity` | **MEMORIZE THE 20**: name ↔ 3-letter ↔ 1-letter ↔ side-chain class |
| | `amino_acid_chirality_and_l_configuration` | chirality, L vs D |
| | `glycine_achiral_exception` | glycine is achiral |
| | `amino_acids_as_zwitterions` | dipolar form at physiological pH |
| | `amino_acid_absolute_configuration_rs` | R/S assignment |
| Classification | `side_chain_classification_overview` | the **map** of the 4 classes (preview); the per-class detail is owned by the class keywords below |
| | `nonpolar_aliphatic` / `aromatic` / `polar_uncharged` / `acidic` / `basic` / `sulfur` | each owns its class's members + chemistry |

Reading the table top-to-bottom: the **overview keyword previews**, the **abbreviations
keyword memorizes**, and each **class keyword drills its own members**. No keyword repeats
another's job — that is the partition.

## How the three invariants are enforced (small, concrete)

1. **Tight blueprints on every keyword (no holes / sharp fences).** Backfill the two missing
   blueprints and tighten the overview descriptions so they are imperative + scoped (the
   narrative "this frames the unit" invites broad questions; "preview only, do not test X"
   fences them). A keyword with a `boundary_statement` cannot generate out-of-scope questions
   because the SCOPE CONTRACT block is injected into every generator.

2. **Batch-across-keywords first generation (the partition).** When a unit's decks are first
   built, generate the decks for **all in-depth keywords of an umbrella in one call**, passing
   the model the full keyword set + scopes and telling it to *partition* the umbrella's facts:
   assign each fact to exactly one keyword (`keyword_weights`), cover every keyword, never
   duplicate a fact across keywords. One pass that sees the whole umbrella produces no holes
   and no overlap — which N isolated calls cannot guarantee. Per-keyword complete-deck
   generation remains the fallback/top-up path.

3. **Size follows content + dedup (no redundancy).** A small overview topic is a small deck.
   The generator is told explicitly: small/definition subtopics → ~5–10 cards; never write two
   cards that test the same underlying fact or that share an answer for the same reason. A
   code-side near-duplicate filter (same normalized answer + high front-token overlap) drops
   rephrasings the model still emits. "Less is better if it's a smaller thing."

4. **Gap/overlap audit (ongoing).** `mcat:audit-scope` already flags questions whose primary
   tested skill is out-of-scope for their keyword (overlap detector). The coverage-map view
   adds the dual check — a keyword whose `in_scope_concepts` no card/question covers is a hole.
   (Audit tooling is existing; this doc just frames it as the MECE check.)

## What we changed for the amino-acids unit (small + targeted)

- **Intro lesson**: `generateMcatLesson` now detects an overview/intro keyword and requires the
  lesson to (a) *define* an amino acid and (b) *preview* the 20 by their 4 side-chain classes
  (without drilling them — that is the abbreviations keyword's job).
- **Memorize-the-20 deck**: strengthened `amino_acid_abbreviations_and_identity` (label,
  description, blueprint) to be the dedicated memorization set (name ↔ 3/1-letter ↔ class) and
  strengthened the generator's amino-acid block to build name↔class cards for all 20, not just
  codes.
- **Scope contracts**: backfilled the two null blueprints and tightened the overview
  descriptions so the *next generated question stays in scope*.
- **Dedup + size**: stronger near-duplicate filter + explicit size-follows-content rules in the
  flashcard generator.
- **Batch-across-keywords**: `generateMcatFlashcards` gained a `batchPartition` mode; the
  flashcards route uses it to first-generate an umbrella's decks as one MECE partition.
- **UI**: removed the redundant top-right "Learn this" button (duplicate of the toolbar's "Take
  a lesson"); category-row "Learn this" buttons stay.
- **Data**: deleted the bloated 30-card intro deck so it regenerates small under the new rules.

## Questions apply, flashcards teach (coverage guarantee)

A fourth invariant on the coverage map: **anything a keyword's QUESTIONS test must be COVERED by that keyword's FLASHCARDS.** Flashcards are the memorizable facts; questions apply them. A student must be able to *learn* a fact (via flashcards) before being *quizzed* on it.

Worked example: the abbreviations keyword (`amino_acid_abbreviations_and_identity`) has a quiz item that tests one-letter codes ("GAV" → Gly-Ala-Val). Its deck must therefore drill the name ↔ three-letter ↔ one-letter mapping for all 20 (G↔Gly↔Glycine, A↔Ala↔Alanine, V↔Val↔Valine, …). Verified: the deck contains exactly those code cards for all 20 residues.

Enforced in generation: the complete-deck and batch-partition prompts now carry a "QUESTIONS APPLY, FLASHCARDS TEACH" directive — if a question on a keyword could test a mapping/value/classification, the deck must contain a card drilling exactly that fact. No question should test something the flashcards never taught.

## Lesson generation robustness (gpt-5.4-mini)

Lesson gen was failing ("produced no valid output after retry") because `validateLesson` was all-or-nothing: a SINGLE bad check question (e.g. distractors that collide so `assembleChoices` returns null), a single missing field, or a figure-induced dropped distractor rejected the ENTIRE lesson — and the retry re-ran the identical, over-constrained (mandatory-figure) prompt. Fixes:
- **Per-step recovery**: drop only the offending step, keep the lesson if ≥3 good steps remain, re-indexed 1..n. Coerce non-essential fields (example, hint).
- **Figure non-breaking**: the figure directive is now "strongly encouraged" with hard rules that it must never cost valid JSON or a complete check question; if it can't, OMIT the figure and use prose.
- **Figure-free retries**: attempt 1 asks for a figure; retries are plain-text (the figure constraint is the biggest failure source on mini).
- Same hardening applied to the math lesson generator.
- **No raw JSON to users**: the lesson error states now show "We couldn't load this lesson right now — try again or skip" instead of the raw `{"error":...}` body.
