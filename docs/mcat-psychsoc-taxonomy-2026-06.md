# MCAT Psych/Soc Taxonomy Build — 2026-06-26

Added the **Psychological, Social, and Biological Foundations of Behavior** section (AAMC Foundational Concepts 6–10, content categories 6A–10A) to the existing `/mcat` feature as a **second section** (`section='psych_soc'`) alongside Biology. Same playbook as the Biology audit ([mcat-taxonomy-audit-2026-06.md](mcat-taxonomy-audit-2026-06.md)): expert-manager + per-content-category subagent fan-out → adversarial completeness/MECE critics → SQL insert → pipeline → integrity checks.

## Ground truth
The verbatim AAMC "What's on the MCAT Exam?" (2020) Psych/Soc subtopic lists (pages 82–100), transcribed into [content/mcat-psychsoc-taxonomy/_OUTLINE.md](../content/mcat-psychsoc-taxonomy/_OUTLINE.md). House-style + depth spec in `_SPEC.md`; per-category trees in `<CODE>.json` (the seed source of truth).

## Data model
- **12 new `mcat_categories`** rows, one per AAMC content category, `section='psych_soc'`, ids `mcat_psychsoc_<code>_<slug>`, labels "6A · Sensing the Environment" … "10A · Social Inequality", `order_index` 0–11.
- AAMC **Topic** → umbrella keyword; AAMC **Subtopic / sub-subtopic** → in_depth keyword; **one INTRO keyword per umbrella** at `order_index = -1`.
- Keyword ids **namespaced `ps_<code>_<slug>`** (e.g. `ps_6a_webers_law`) to guarantee zero collision with Biology's bare-slug ids. Parent links computed from the JSON nesting.

## Discipline weighting & depth
≈65% intro psychology / 30% intro sociology / 5% intro biology. Depth = mile-wide-inch-deep at the first-semester intro-psych/intro-soc level: recognition, classification, directional relationships, named theories/effects/biases/stages — not graduate precision.

## Cross-section coordination (the key MECE decisions)
- **6A** owns the **psychology of sensation & perception only** (psychophysics: thresholds, Weber's law, signal detection, sensory adaptation; perception: bottom-up/top-down, perceptual organization, Gestalt, feature/parallel processing). The **sensory-organ biology** (eye/ear/transduction/receptors/taste/smell/vestibular) stays in Biology's `sensory_systems_and_transduction` umbrella — **not duplicated**.
- **7A** ("Biological Bases of Behavior") is the **behavioral-neuroscience / intro-psych** treatment (brain regions → behavior, neurotransmitters → behavior, lateralization, methods to study the brain, PNS/CNS organization, endocrine effects on behavior). The cellular action-potential ionic mechanism stays in Biology.
- **8C** sociobiology (foraging, mate choice, game theory, inclusive fitness, reciprocal altruism) is intro-level behavioral content, distinct from Biology's organ systems.

## Build method
12 expert subagents (one per content category) authored umbrella→intro→in_depth JSON trees from the verbatim subtopics. Two adversarial Opus critics re-read the full set: **completeness** (0 zero-coverage AAMC subtopics; grade A) and **MECE/depth** (found 7A had bundled mega-keywords + missing boundary sentences + a few graduate-depth items). **7A was rebuilt on Opus** (split 7 neurotransmitters into one keyword each; split psychoanalytic/personality-disorders/schizophrenia bundles; down-scoped graduate behavioral-genetics; added an endocrine-glands keyword; added sibling boundary sentences throughout), plus 3 surgical fixes elsewhere (6B "types of problems", 8B self-fulfilling-prophecy dedup + assumed-similarity, 9A evolution-and-culture rescope).

## Final totals (verified)
- **12 categories · 114 umbrellas · 114 intros · 465 in_depth = 693 keywords**, all `status='approved'`.
- Per-category in_depth (excl. intros): 6A 27, 6B 66, 6C 26, 7A 83, 7B 37, 7C 43, 8A 20, 8B 23, 8C 43, 9A 39, 9B 29, 10A 29.
- Integrity: **0 orphans, 0 empty umbrellas, 0 umbrellas missing an intro, 0 duplicate labels per category, 0 missing embedding/embedding_vec/concept_blueprint/yield_level.** Yield mix: 138 high / 420 med / 20 low (1 hand-authored — see gotchas).

## Pipeline (the order matters)
1. `scripts/seed-mcat-psychsoc.ts` — idempotent upsert of categories + keywords from the JSON (`npx tsx scripts/seed-mcat-psychsoc.ts`, `--dry-run` supported).
2. `npm run mcat:embed` — embeds **in_depth keywords only** (`label. description`); umbrellas are skipped by design.
3. `npx tsx scripts/recompute-umbrella-embeddings.ts --system mcat` — umbrella embeddings = **centroid of their in_depth children**; writes BOTH `embedding` + `embedding_vec`.
4. `UPDATE mcat_keywords SET embedding_vec = embedding::text::vector WHERE embedding_vec IS NULL AND embedding IS NOT NULL` — backfills the pgvector column for the in_depth children.
5. `npm run mcat:blueprints` — `concept_blueprint` + `yield_level`/`yield_rationale` per in_depth keyword (gpt-5.4-mini).

## UI / generation wiring
- **Generation grounding:** added 12 entries to `lib/mcatContentOutline.ts` (AAMC scope/topics) and 12 entries to `CATEGORY_TO_TAG_PREFIXES` in `lib/mcatTemplateCards.ts` (mapped to the MileDown `Behavioral::*` deck — 891 cards).
- **Section is a first-class scope** via a `section` URL param, **default `biology`** so all existing Biology flows are byte-for-byte unchanged. `/api/mcat/taxonomy` returns `section` per category; `/api/mcat/auto-plan` filters categories by `section` (inferring it from the scope target's id prefix on "learn this" deep links); `/api/mcat/deck-plan` filters its whole-course walk; the landing page (`app/mcat/page.tsx`) has functional **Biology | Psych/Soc** tabs that filter the category grid and pass the section to the auto/cards/practice heroes; `/mcat/auto`, `/mcat/cards`, `/mcat/practice` thread the param.
- **Section field on generated content** (`mcat_questions`/`mcat_flashcards`): the 5 hardcoded `section: "biology"` insert sites now derive section from the category id (`startsWith("mcat_psychsoc_") ? "psych_soc" : "biology"`).
- `lib/humanize.ts` gained the `mcat_psychsoc_` prefix.

## Bugs found & fixed (the >1000-row class, again)
The table grew to **1736 keyword rows** and the in_depth tier alone exceeds 1000, which exposed two latent un-paginated/un-safe queries:
1. `scripts/embed-mcat.ts` `fetchKeywordsByCategory` (retag reference set) loaded all in_depth keywords un-paginated → would silently truncate at 1000. **Paginated** (range loop + stable `id` order).
2. `scripts/recompute-umbrella-embeddings.ts` used bare `createClient` → crashed on Node 20 (no native WebSocket). Switched to the realtime-safe `createServiceClient` helper (`fetchAll` there already paginated).

## Notes / follow-ups (not done)
- One keyword (`ps_8a_erikson_psychosocial_stages`) deterministically failed blueprint generation ("no valid output after retry"); its `concept_blueprint` + `yield_level='high'` were **hand-authored via SQL**.
- The `/mcat/progress` dashboard now lists both sections' categories together (no section tabs there) — acceptable; add tabs if desired.
- Content pools (questions/flashcards/lessons) generate on-demand and are grounded + blueprint-gated; one verification question was generated during testing. No bulk content pre-generation was done.
- `mcat-keywords.txt` / seed sources were NOT updated (the JSON in `content/mcat-psychsoc-taxonomy/` is the source of truth for this section; re-run `seed-mcat-psychsoc.ts` to re-apply).
