# MCAT Chemistry + Physics Taxonomy Build — 2026-06-26

Added the **Chemical and Physical Foundations of Biological Systems** content area (AAMC Foundational Concepts 4 & 5, content categories 4A–5E) to the `/mcat` feature as **TWO new discipline sections** — `section='physics'` (id prefix `ph_`) and `section='chemistry'` (id prefix `ch_`) — alongside Biology and Psych/Soc. Followed the [add-a-section playbook](mcat-add-a-section-playbook.md), mirroring the [Psych/Soc build](mcat-psychsoc-taxonomy-2026-06.md): expert-manager + per-category subagent fan-out → adversarial Opus critics → seed → embed/centroid/vec/blueprint pipeline → UI/grounding wiring → integrity + e2e verification.

## Ground truth
The verbatim AAMC "What's on the MCAT Exam?" (2020) 4A–5E subtopic lists (PDF pp. 58–74; FC4/FC5 framework p. 54–55) were transcribed into [content/mcat-chemphys-taxonomy/_OUTLINE.md](../content/mcat-chemphys-taxonomy/_OUTLINE.md), regrouped by **discipline** (not AAMC code) into a 24-category mapping with explicit boundary notes. House-style + quantitative-depth spec in `_SPEC.md`; per-category trees in `<CODE>.json` (the seed source of truth).

## The discipline split (the judgment call)
AAMC content categories are **not 1:1** with platform categories — 4A becomes four physics categories; 4E splits across physics & chemistry; the 4B gas laws go to chemistry; 4D splits optics (physics) vs. molecular spectroscopy (chemistry); 4C splits E&M/circuits (physics) vs. electrochemistry (chemistry); 5E thermodynamics splits heat-physics vs. reaction-thermochemistry.

- **Physics (11 categories, order 0–10):** P1 Kinematics & Translational Motion · P2 Forces & Newton's Laws · P3 Equilibrium, Torque & Center of Mass · P4 Work, Energy & Power · P5 Fluids · P6 Thermodynamics & Heat · P7 Periodic Motion, Waves & Sound · P8 Light & Geometrical Optics · P9 Electrostatics & Magnetism · P10 Circuits · P11 Atomic & Nuclear Phenomena.
- **Chemistry (13 categories, order 0–12):** C1 Atomic Structure & Periodic Trends · C2 Bonding & Molecular Structure · C3 Intermolecular Forces & Phases · C4 Stoichiometry & Reaction Types · C5 Gases & Solutions · C6 Acids & Bases · C7 Chemical Thermodynamics · C8 Chemical Kinetics · C9 Chemical Equilibrium · C10 Electrochemistry & Redox · C11 Organic Chemistry — Structure, Bonding & Stereochemistry · C12 Organic Chemistry — Reactions & Mechanisms · C13 Separations, Purification & Spectroscopy.

## Cross-section coordination (the key MECE decisions — no duplication)
- **5D biomolecules:** Biology owns the *biology* of amino acids/proteins/carbs/lipids/nucleic acids; the orgo categories (C11/C12) own only the **organic-chemistry angle** (functional groups, nomenclature, isomerism/stereochem, reactions/mechanisms). No protein 2°/3°/4° structure, folding, or metabolism rebuilt.
- **5E enzymes/bioenergetics → Biology.** Chemistry **Kinetics (C8) deliberately excludes enzyme kinetics / Michaelis–Menten / inhibition** (those are Biology). Both critics verified C8/C11/C12 are clean of Biology overreach.
- **4B fluids:** P5 builds the fluid physics only; circulatory/respiratory organ biology stays in Biology.
- **4C/4E/5E splits:** emission/Bohr/nuclear → P11; electron config/quantum numbers/periodic trends → C1. Electrostatics/circuits → P9/P10; electrochemical cells/Nernst → C10. Heat/calorimetry/PV-work/phase-diagrams/engines → P6; ΔG/ΔH/ΔS/Hess/spontaneity → C7.

## Depth (quantitative — different from Psych/Soc)
These keywords legitimately carry **formulas**, written as inline `$...$` KaTeX in descriptions/examples ($F=ma$, $PV=nRT$, Henderson–Hasselbalch, $\Delta G=\Delta H-T\Delta S$, Nernst, Coulomb, Bernoulli $P+\tfrac12\rho v^2+\rho gh$, $t_{1/2}$, Snell's law, $1/p+1/q=1/f$, …). Numeric-value decision tree applied: universal constants kept ($c$, $N_A$, $g$, $R$, $K_w=10^{-14}$, $22.4$ L/mol, $109.5°$); problem-specific numbers belong in stems, not keywords; **the periodic table is provided on the exam** so keywords test trends/skills, not lookups.

## Build method
24 expert subagents (general-purpose, model **sonnet**), one per category, authored umbrella→intro→in_depth JSON trees from the verbatim subtopics. Deterministic validator [`scripts/validate-chemphys.mjs`](../scripts/validate-chemphys.mjs) (24 codes, header fields, slug/label uniqueness, one-intro-per-umbrella) caught 10 mechanical issues (uppercase-in-slug, 2 within-category duplicate labels) — all fixed. **Two adversarial Opus critics** (physics P1–P11; chemistry C1–C13), each running completeness + MECE/depth lenses, graded the build **A/A− across all 24 categories with no wholesale rebuilds**. Applied their actionable findings: split the P9↔P10 voltage/potential-difference duplication, added Kirchhoff's laws (P10), disambiguated the C12 kinetic-vs-thermodynamic-control duplication with C8, and trimmed the C12 β-lactam example off the Biology seam.

## Final totals (verified)
- **24 categories · 195 umbrellas · 195 intros · 646 in_depth = 1,036 keywords**, all `status='approved'`.
  - Physics: 11 categories, 444 keywords (89 umbrellas, 89 intros, 266 in_depth).
  - Chemistry: 13 categories, 592 keywords (106 umbrellas, 106 intros, 380 in_depth).
- Per-category in_depth (excl. intros): P1 24, P2 23, P3 14, P4 22, P5 20, P6 36, P7 23, P8 30, P9 26, P10 24, P11 24; C1 30, C2 28, C3 19, C4 25, C5 32, C6 32, C7 18, C8 16, C9 19, C10 17, C11 58, C12 50, C13 36.
- **Integrity: 0 orphans, 0 empty umbrellas, 0 umbrellas missing an intro, 0 not-approved, 0 missing embedding/embedding_vec, 0 in_depth missing concept_blueprint/yield_level, 0 duplicate labels per category.**
- Yield mix (in_depth): **high 413 / medium 412 / low 16**. (4 keywords failed blueprint generation on the first pass — `ch_c11_benzene_structure`, `ch_c12_reading_energy_diagrams`, `ch_c13_simple_distillation_principle`, `ph_p7_simple_pendulum_period` — all succeeded on a second fill-missing run; **0 hand-authored**.)

## Pipeline (order matters)
1. `npx tsx scripts/seed-mcat-chemphys.ts` — idempotent upsert of categories + keywords. **Category metadata (section/category_code/category_label/order_index) is read from each JSON HEADER** (no hardcoded list); category ids `mcat_<section>_<code>_<slug(label)>`, keyword ids `<ph|ch>_<code>_<slug>`, intro `order_index=-1`, `status='approved'`.
2. `npm run mcat:embed` — embedded all 841 in_depth-tier keywords (umbrellas skipped by design); Phases 2/3 found no new chem/phys questions/flashcards.
3. `npx tsx scripts/recompute-umbrella-embeddings.ts --system mcat` — 418 umbrella centroids (incl. the 195 new), 0 skipped.
4. `UPDATE mcat_keywords SET embedding_vec = embedding::text::vector WHERE embedding_vec IS NULL AND embedding IS NOT NULL` — backfilled the pgvector column for the in_depth children.
5. `npm run mcat:blueprints` — `concept_blueprint` + `yield_level`/`yield_rationale` per in_depth keyword (837 first pass + 4 on retry).

## UI / generation wiring
- **Generation grounding:** added 24 `OutlineEntry` rows to [`lib/mcatContentOutline.ts`](../apps/student/lib/mcatContentOutline.ts) (AAMC scope/topics per category) and 24 `CATEGORY_TO_TAG_PREFIXES` entries to [`lib/mcatTemplateCards.ts`](../apps/student/lib/mcatTemplateCards.ts) mapped to the precise MileDown deck subareas (`MileDown::Physics::*` + `::All_MCAT_Equations::Physics`; `::General_Chemistry::*` + `::All_MCAT_Equations::Gen_Chem`; `::OChem::*`).
- **Section inference centralized:** new helper [`lib/mcatSection.ts`](../apps/student/lib/mcatSection.ts) `sectionFromId(id)` maps any category/keyword id → section (`biology` default, `psych_soc`/`physics`/`chemistry`). Replaced the 6 inline `startsWith("mcat_psychsoc_") ? … : "biology"` insert sites (quiz/similar/flashcards/next-question routes + `lib/lessonLab.ts` ×2) and the `/api/mcat/auto-plan` deep-link inference with it.
- **Landing page:** [`app/mcat/page.tsx`](../apps/student/app/mcat/page.tsx) now has four LIVE section tabs (Biology · Psych/Soc · Chemistry · Physics); `SOON_SECTIONS` is empty; `activeSection` type widened.
- **`lib/humanize.ts`** gained the `mcat_physics_` and `mcat_chemistry_` strip-prefixes.

## Verification (all passed)
- Integrity SQL (above): all 10 checks = 0.
- `cd apps/student && npx tsc --noEmit` → **0 errors** (needs `NODE_OPTIONS=--max-old-space-size=8192`; the project exceeds the default tsc heap).
- `GET /api/mcat/taxonomy` → returns all 4 sections (biology 10, psych_soc 12, physics 11, chemistry 13), each category with `section`.
- `GET /api/mcat/auto-plan?section=physics` → frontier `mcat_physics_p1_kinematics_translational_motion`; `?section=chemistry` → `mcat_chemistry_c1_atomic_structure_periodic_trends`; **no-section → `mcat_biology_amino_acids_and_proteins`** (Biology unchanged).
- `POST /api/mcat/next-question` for `mcat_physics_p5_fluids` → a real Bernoulli question (correctly keyed to "$P+\tfrac12\rho v^2+\rho gh$ constant along the streamline"), stored with `section='physics'`; for `mcat_chemistry_c6_acids_bases` → a Brønsted–Lowry conjugate-base question, stored with `section='chemistry'`. Both returned a 4-item prefetch buffer.

## Notes / follow-ups (not done)
- Content pools (questions/flashcards/lessons) generate **on-demand** and are grounded + blueprint-gated; only the 2 verification questions above were generated. No bulk pre-generation.
- `/mcat/progress` lists all four sections' categories together (no section tabs there) — acceptable, as with Psych/Soc.
- **LOCAL-ONLY:** nothing deployed/pushed/committed. Taxonomy + pipeline writes are to the shared Supabase (as with prior section builds); the seed/embed/blueprint scripts are idempotent and re-runnable.

## Artifact inventory
`content/mcat-chemphys-taxonomy/{_SPEC.md, _OUTLINE.md, P1–P11.json, C1–C13.json}` · `scripts/seed-mcat-chemphys.ts` · `scripts/validate-chemphys.mjs` · this build record.
