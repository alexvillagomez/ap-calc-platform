# Build Prompt — MCAT Chemistry + Physics sections

Paste the block below to a fresh agent (with the AAMC PDF attached). It builds the **Chemistry** and **Physics** sections of `/mcat` the same way Biology and Psych/Soc were built.

---

You are building the **Chemistry** and **Physics** sections of the `/mcat` feature (two new discipline sections), from the AAMC **Chemical and Physical Foundations of Biological Systems** content area (Foundational Concepts 4 & 5, content categories 4A–5E). This repo just did the identical exercise for **Psych/Soc**; that is your template.

## Read FIRST (in this order), then work
1. **`docs/mcat-add-a-section-playbook.md`** — the authoritative step-by-step method, data model, pipeline order, and gotchas. Follow it exactly.
2. **`docs/mcat-psychsoc-taxonomy-2026-06.md`** — the most recent worked example (copy its approach and artifacts).
3. **`docs/mcat-system.md`** (architecture), **`docs/mcat-depth-standard.md`** (depth bar + numeric-value decision tree).
4. The Psych/Soc artifacts you will mirror: `content/mcat-psychsoc-taxonomy/_SPEC.md`, `_OUTLINE.md`, a sample `<CODE>.json`, `scripts/seed-mcat-psychsoc.ts`, `scripts/validate-psychsoc.mjs`.

## Ground truth — read the actual PDF
The verbatim AAMC subtopic lists are the ONLY acceptable source (do not work from memory). The PDF is large — read with the `pages` param, ≤20 pages/call. The **Chemical and Physical Foundations** section (4A–5E) **ends at page 74** (5E, equilibrium/kinetics) — Psych/Soc starts at p.75. Read the FC4/FC5 **framework page** first (a page that defines FC4 = 4A–4E and FC5 = 5A–5E; roughly pages 44–50) to pin the exact start, then read every 4A–5E content-category table verbatim. Transcribe them, preserving the course tags (PHY, GC = general chemistry, OC = organic chemistry, BC = biochemistry, BIO), into `content/mcat-chemphys-taxonomy/_OUTLINE.md`, with a clear `## PHYSICS` and `## CHEMISTRY` split and the boundary notes below.

## The discipline split (this section's one judgment call — proceed with this mapping)
The platform's sections are **by discipline**, so split AAMC's 4A–5E subtopics across two sections. Recommended categories (refine against the verbatim subtopics; each becomes one `mcat_categories` row with one expert subagent):

**PHYSICS (`section='physics'`, keyword id prefix `ph_`)** — from 4A, 4B, the physics parts of 4C/4E, and 4D:
- Kinematics & Translational Motion (4A) · Forces & Newton's Laws (4A) · Equilibrium, Torque & Center of Mass (4A) · Work, Energy & Power (4A) · Fluids (4B) · Electrostatics & Magnetism (4C-physics) · Circuits (4C-physics) · Periodic Motion, Waves & Sound (4D) · Light & Geometrical Optics (4D) · Atomic & Nuclear Phenomena (4E-physics: emission/Bohr, radioactive decay, half-life, binding energy, fission/fusion) · Thermodynamics & Heat (the *physics* treatment: heat transfer, calorimetry, PV work, laws of thermo, heat engines).

**CHEMISTRY (`section='chemistry'`, keyword id prefix `ch_`)** — from the chem parts of 4C/4E and 5A–5E:
- Atomic Structure & Periodic Trends (4E-chem: quantum numbers, electron configuration, periodic trends) · Bonding & Molecular Structure (5B: Lewis, VSEPR, hybridization, polarity) · Intermolecular Forces & Phases (5B) · Stoichiometry & Reaction Types (foundational GC) · Gases & Solutions (5A: ideal gas, partial pressures, solubility, colligative properties, concentration) · Acids & Bases (5A: pH, Ka/Kb, buffers, titration, Henderson-Hasselbalch) · Chemical Thermodynamics (5E: ΔG, ΔH, ΔS, spontaneity, Hess's law) · Chemical Kinetics (5E: rate laws, rate-determining step, Arrhenius, catalysts, energy profiles) · Chemical Equilibrium (5E: Keq, Le Chatelier, Ksp) · Electrochemistry & Redox (4C-chem: oxidation states, balancing redox, galvanic/electrolytic cells, cell potential, Nernst) · Organic Chemistry — Structure, Bonding & Stereochemistry (5D: functional groups, IUPAC, isomerism, chirality) · Organic Chemistry — Reactions & Mechanisms (5D) · Separations, Purification & Spectroscopy (5C: extraction, distillation, chromatography, electrophoresis; IR, NMR, UV-Vis, mass spec).

## Cross-section coordination — DO NOT duplicate (mirror how Psych/Soc 6A avoided sensory biology)
- **5D biomolecules:** the **Biology** section already owns the structure/function of amino acids, proteins, carbohydrates, lipids, and nucleic acids. The Chemistry orgo categories own the **organic-chemistry angle only** — functional groups, nomenclature, isomerism/stereochemistry, reaction mechanisms, separations/spectroscopy of small molecules. Do NOT re-create biomolecule biology.
- **4B fluids:** build the **fluid physics** (pressure, buoyancy/Archimedes, continuity, Bernoulli, Poiseuille, viscosity). The circulatory/respiratory *organ biology* stays in Biology.
- **4E split:** atomic emission/Bohr + nuclear decay → **Physics**; electronic structure/quantum numbers/periodic trends → **Chemistry**.
- **4C split:** electrostatics/circuits/magnetism → **Physics**; electrochemistry/redox cells → **Chemistry**.
- **Thermodynamics split:** heat/calorimetry/PV-work/heat-engines → **Physics**; ΔG/ΔH/ΔS/spontaneity/Hess → **Chemistry**.

## Depth (DIFFERENT from Psych/Soc — this content is quantitative)
Follow `docs/mcat-depth-standard.md`, but unlike Psych/Soc, these keywords legitimately carry **formulas** — populate `concept_blueprint.in_scope_formulas` with the core MCAT relations (e.g. kinematics, F=ma, Ohm's V=IR, PV=nRT, Henderson-Hasselbalch, ΔG=ΔH−TΔS, Nernst, Coulomb's law, Bernoulli, half-life). Apply the depth standard's **numeric-value decision tree**: keep universal constants, provide problem values in the stem (don't require memorizing them), no obscure derivations or graduate-level precision. A periodic table is provided on the real exam — don't write keywords that hinge on memorizing it.

## Method (work as a manager — same as Psych/Soc)
1. Write `content/mcat-chemphys-taxonomy/_SPEC.md` (copy Psych/Soc's; add the "formulas are in scope here" depth note). Write `_OUTLINE.md` with the verbatim AAMC subtopics + the coordination boundaries.
2. **Fan out one expert subagent per category** (general-purpose, model `sonnet`); each reads `_SPEC.md` + its `_OUTLINE.md` section + the coordination notes, writes its tree to `content/mcat-chemphys-taxonomy/<CODE>.json`, returns a 3-line summary. Each JSON must declare its own category metadata: `section` ("chemistry"|"physics"), `category_code` (short slug, e.g. `kinematics`), `category_label`, `order_index`, then `umbrellas[]` (each with `slug`, `label`, `description`, `intro{}`, `in_depth[]`). Every umbrella gets exactly one INTRO keyword.
3. **Validate** with a `scripts/validate-chemphys.mjs` (copy the psychsoc validator): valid JSON, slug + label uniqueness within each category, every umbrella has one intro + ≥1 in_depth, examples present.
4. **Run 1–2 adversarial Opus critics** over all JSON + `_OUTLINE.md`: completeness (0 AAMC subtopics with zero coverage, per section) and MECE/depth (split bundled keywords, kill within-category duplicates, fix boundary sentences, check formula scope). Apply fixes; rebuild any weak category wholesale on Opus.

## Insert + pipeline (see the playbook for full detail; ORDER MATTERS)
- Write `scripts/seed-mcat-chemphys.ts` (copy `seed-mcat-psychsoc.ts`, but read category metadata from each JSON's header instead of a hardcoded map). Category ids `mcat_<section>_<code>_<slug>`; keyword ids `<ph|ch>_<code>_<slug>` (namespaced — zero collision); intro at `order_index=-1`; **`status='approved'`**; upsert on id; categories → umbrellas → children. Use `createServiceClient`. Dry-run, then run.
- `npm run mcat:embed` → `npx tsx scripts/recompute-umbrella-embeddings.ts --system mcat` → `UPDATE mcat_keywords SET embedding_vec = embedding::text::vector WHERE embedding_vec IS NULL AND embedding IS NOT NULL;` → `npm run mcat:blueprints`. (All fill-missing; they auto-pick up the new keywords. Hand-author any keyword that deterministically fails blueprint gen.)

## Wire the UI + grounding
- `lib/mcatContentOutline.ts`: add one `OutlineEntry` per new category.
- `lib/mcatTemplateCards.ts` `CATEGORY_TO_TAG_PREFIXES`: Physics categories → `["MileDown::Physics","MileDown::All_MCAT_Equations"]`; Chemistry gen-chem categories → `["MileDown::General_Chemistry","MileDown::All_MCAT_Equations"]`; Chemistry orgo categories → `["MileDown::OChem"]`; separations/spectroscopy → `["MileDown::OChem","MileDown::General_Chemistry"]`.
- `app/mcat/page.tsx`: move `"Chemistry"` and `"Physics"` from `SOON_SECTIONS` into `LIVE_SECTIONS` (`{ key:"chemistry", label:"Chemistry" }`, `{ key:"physics", label:"Physics" }`); the `activeSection` type becomes `"biology"|"psych_soc"|"chemistry"|"physics"`. `SOON_SECTIONS` becomes `[]` (the soon-stub block then renders nothing).
- Section-field-on-insert helper (`flashcards`/`similar`/`quiz`/`next-question` routes + `lib/lessonLab.ts`): extend so `mcat_chemistry_*` → `"chemistry"` and `mcat_physics_*` → `"physics"`.
- `lib/humanize.ts`: add `"mcat_chemistry_"` and `"mcat_physics_"` to `STRIP_PREFIXES`.
- The `section` URL-param plumbing (taxonomy/auto-plan/deck-plan/auto/cards/practice) is already generic with default `biology` — just confirm the new sections flow through (auto-plan infers section from the scope id prefix; add `ch_`/`ph_` and `mcat_chemistry_`/`mcat_physics_` to that inference if needed).

## Verify (all must pass — same as the playbook's Phase 7)
Integrity SQL = 0 across orphans / empty umbrellas / umbrellas-missing-intro / not-approved / missing embedding / embedding_vec / in_depth blueprint / in_depth yield / duplicate labels per category; balanced per-category counts. `npx tsc --noEmit` = 0 errors. `curl` taxonomy (new categories present with section) + auto-plan `?section=physics` and `?section=chemistry` (frontier in the right section) + no-section still starts at Biology. `POST /api/mcat/next-question` for one chemistry and one physics category → real, on-scope, correctly-keyed questions stored with the right `section`.

## Rules
- **LOCAL-ONLY** — do not deploy, push to `main`, or commit unless explicitly told. Valid `OPENAI_API_KEY` is in `apps/student/.env.local` (root is stale); Supabase keys valid in root `.env.local`. Apply taxonomy via the seed script / direct SQL (no migration files). Keep everything `status='approved'`. Write a build record `docs/mcat-chemphys-taxonomy-<date>.md` when done.
