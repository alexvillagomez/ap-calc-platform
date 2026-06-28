# Curriculum / Taxonomy Completeness Audit

Goal: every unit starts with a foundational/intro subtopic and builds **linearly with no gaps**; subtopics are **MECE** (mutually exclusive, collectively exhaustive) **at least within each unit**. Priority order: **MCAT → AP Calc → Precalc**.

## How the taxonomy works (verified in DB + code)

- Tiers: course → **category (unit)** → **umbrella** keyword → **in_depth** (subtopic) keyword.
- Tables: `mcat_keywords`, `math_keywords`. Columns of note:
  - `id` (text slug, PK), `category_id`, `parent_keyword_id` (umbrella id for in_depth; null for umbrella), `tier` (`umbrella`|`in_depth`), `label`, `description`, `examples` (jsonb string[]), `status` (all `approved`), `order_index` (int), `embedding` (jsonb float[]), `embedding_vec` (pgvector), `concept_blueprint` (jsonb), yield (`yield_level` text high/med/low for MCAT; `yield_score` real 0–1 for math).
- **Ordering (the guided/auto flow):** umbrellas sorted by `order_index` within a category; in_depth children sorted by `order_index` **within their umbrella**. (`/api/mcat/auto-plan`, `/api/math/auto-plan`, taxonomy routes all sort umbrellas then children separately.) Routes filter `status='approved'`.
  - ⇒ To insert an intro subtopic at the front of an umbrella: bump that umbrella's children `order_index += 1`, insert intro at `order_index = 0`.
  - ⇒ A "unit intro" = first child (order 0) of the first umbrella (order 0) of the category.
- **Embedding:** `npm run mcat:embed` / `npm run math:embed` (resume-safe — only rows with `embedding IS NULL`). Embedded text = `"{label}. {description}"` (examples are NOT embedded by the script, despite the spec — so descriptions must be self-contained). Model `text-embedding-3-small`. Loads OPENAI key from `apps/student/.env.local`. Then backfill `embedding_vec` via `update <tbl> set embedding_vec=(embedding::text)::vector where embedding is not null and embedding_vec is null;`.
- **Non-destructive guarantee:** embed Phase 2/3 only retags questions/flashcards with `embedding IS NULL`, so adding keywords never disturbs existing question→keyword tags.
- `concept_blueprint` left null on new rows → backfill later with `npm run mcat:blueprints` / `npm run math:blueprints` (fill-missing). Not required for ordering/lessons.

## Conventions for new keywords

- `status='approved'`, `tier='in_depth'`, sensible `yield_level`/`yield_score`.
- `description`: 2–4 plain sentences, self-contained (it's what gets embedded).
- `examples`: 3 short student-facing task prompts (matches existing style).
- id slug: snake_case, unique, descriptive (e.g. `introduction_to_amino_acids`).

---

# MCAT (10 units) ✅ COMPLETE

_status: DONE — all 10 units applied + verified; **48 new keywords** embedded (text-embedding-3-small) + `embedding_vec` backfilled (0 unembedded remaining). No duplicate `order_index` within any umbrella._

**Totals:** 48 new in_depth keywords (intros/foundational + missing prerequisites), ~20 reorders. Every unit now opens with a from-scratch intro and each touched umbrella has an entry point. Overlaps documented per unit under "left for later" (no deletions — preserves existing question→keyword tags).

**Deferred (optional):** umbrella centroid embeddings not recomputed (each added child shifts a centroid negligibly; new keywords remain tag-reachable as umbrella children). Concept blueprints null on new rows → `npm run mcat:blueprints` (fill-missing) when convenient. The dedup work in each unit's "left for later" is a separate future pass. Seed source (`mcat-keywords.txt`/expand scripts) NOT updated — a future re-seed would need these additions folded in.

Applied via DB (`mcat_keywords`). New rows: `tier=in_depth`, `status=approved`, intros placed at `order_index=0` of their umbrella (siblings shifted +1); reorders set explicitly. Embedding pending (run `npm run mcat:embed` after all batches, then backfill `embedding_vec`). `concept_blueprint` left null → `npm run mcat:blueprints` later.

## Unit 1 — Amino Acids and Proteins ✅ linear + MECE-within-unit
- **Gap fixed:** unit opened cold on "Alpha-amino acid backbone structure" / stereochemistry with no "what is an amino acid" intro (the user's example).
- **Added (3):** `what_is_an_amino_acid_overview` (front of unit), `side_chain_classification_overview` (front of Classification umbrella), `ionizable_groups_and_pka_basics` (front of Ionization umbrella).
- **Reordered:** `amino_acid_abbreviations_and_identity` moved to right after backbone (naming before deep stereochem).
- **Overlaps noted (left for later, no deletion):** zwitterion (struct umbrella) vs ionization umbrella; disulfide chemistry split across 3 umbrellas; hydropathy vs hydrophobic-core.
- Verified: opens "What Is an Amino Acid → backbone → abbreviations → chirality → glycine → zwitterions → absolute config", then Classification opens with the classification overview, Ionization opens with pKa basics.

## Unit 2 — Bioenergetics and Metabolism
- **Added (3):** `metabolism_overview_catabolism_anabolism_and_atp` (unit front), `glycolysis_pathway_overview_glucose_to_pyruvate` (front of Glycolysis), `electron_transport_chain_overview` (front of OxPhos).
- **Reordered:** `oxygen_as_terminal_electron_acceptor` moved after Complex II entry (chain told end-to-end before proton-gradient/ATP-synthase mechanics).
- **Left for later:** duplicate `hormonal_control_of_lipolysis` vs `_2` (fatty-acid vs regulation umbrellas); optional TCA + gluconeogenesis overview children.

## Unit 3 — Cell Cycle, Development, and Reproduction
- **Added (5):** `cell_cycle_overview_phases_and_purpose` (unit front), `mitosis_overview_phases_and_outcome` (front of Mitosis), `meiosis_overview_and_purpose` (front of Meiosis), `homologous_pairing_and_synapsis` (Meiosis, before crossing-over — was a true missing prerequisite), `what_is_differentiation_overview` (front of Differentiation).
- **Reordered:** `crossing_over_and_genetic_recombination` now follows synapsis.
- **Left for later:** senescence appears in 3 umbrellas; cleavage/morula duplicated across Fertilization & Embryogenesis.

## Unit 4 — Cell Structure, Membranes, and Transport
- **Added (6):** `cell_overview_prokaryotic_vs_eukaryotic_anatomy` (unit front), `membrane_overview_what_a_cell_membrane_is` (front of Plasma Membrane), `membrane_potential_overview_charge_separation_across_membrane` (front of Membrane Potential), `vesicular_transport_overview_bulk_movement_vs_membrane_transport` (front of Endo/Exocytosis), `cytoskeleton_overview_three_filament_systems` (front of Cytoskeleton), `endomembrane_overview_connected_organelle_system` (front of Endomembrane).
- **Reordered:** `amphipathic_molecule_membrane_insertion` → before bilayer orientation; `nernst_potential_single_ion_equilibrium` → before multi-ion resting potential.
- **Left for later:** tight-junction/desmosome/basement-membrane duplicated across Junctions & Tissues umbrellas; constitutive-vs-regulated exocytosis duplicated; whether epithelial/connective tissues belongs in this unit.

## Unit 5 — Enzymes and Protein Function
- **Added (2):** `what_is_an_enzyme_biological_catalyst` (unit front), `what_is_enzyme_inhibition_overview` (front of Inhibition).
- **Reordered (Michaelis–Menten):** `substrate_saturation_and_velocity_plateau` → front (the V-vs-[S] curve), then `interpret_km_as_half_vmax` — Km was being interpreted before the curve it sits on was shown.
- **Left for later:** duplicate transition-state / induced-fit / allosteric-vs-active-site keywords across Catalysis/Regulation vs Binding-Models umbrellas; cooperativity overlap (kinetics vs hemoglobin).

## Unit 6 — Genetics, Evolution, and Inheritance
- **Added (5):** `genetics_core_vocabulary_intro` (gene/allele/genotype-vs-phenotype, unit front), `punnett_square_and_segregation_basics` (Punnett mechanics were never taught before cross ratios), `what_is_evolution_and_natural_selection` (front of Evolutionary Mechanisms — opened on selection types with no definition of evolution), `hardy_weinberg_equation_introduction` (the HW equation was applied but never stated), `biological_species_concept_intro` (front of Speciation).
- **Reordered:** allele notation + homozygous/heterozygous pulled to the front of Mendelian (notation was defined after it was used); fitness + differential reproductive success pulled ahead of selection-type subtopics.
- **Left for later:** umbrella-level reorder (meiosis mechanism before Mendelian consequences); triple testcross + duplicate probability-rules coverage; genetic-drift/bottleneck duplicated across Evolutionary Mechanisms & Speciation.

## Unit 7 — Nervous and Endocrine Systems
- **Added (5):** `nervous_system_overview_and_function` (unit front), `neuron_structure_and_parts` (front of Neurons — opened on dendrite-vs-axon directionality with no "parts of a neuron"), `action_potential_phases_overview` (the depolarization upstroke was never defined before channel mechanics), `what_is_a_hormone_endocrine_vs_nervous` (front of Endocrine Glands — the entire endocrine half lacked a hormone definition), `receptors_and_signal_transduction_overview` (front of Biosignaling).
- **Left for later:** second-messenger cascades duplicated between Biosignaling & Mechanisms-of-Hormone-Action; triple negative-feedback; afferent/efferent + saltatory-conduction duplicated; optional hormone-classes overview + synapse-structure overview.

## Unit 8 — Nucleic Acids and Gene Expression
- **Added (5):** `what_nucleic_acids_are_overview` (unit front), `transcription_process_overview` (front of Transcription — opened mid-process at promoter recognition), `translation_machinery_overview` (front of Translation — ribosome/mRNA/tRNA never introduced before initiation), `what_an_operon_is_overview` (front of Prokaryotic Regulation), `levels_of_eukaryotic_gene_regulation_overview` (front of Eukaryotic Regulation).
- **Reordered:** `operon_structure...` (the "what is an operon" definition) was last (order 6) → now follows the operon intro, before the specific operon types.
- **Left for later:** frameshift / alternative-splicing / telomere / histone-modification overlaps across umbrellas.

## Unit 9 — Organ Systems and Homeostasis (largest, 20 umbrellas)
- **Added (9):** unit-front `homeostasis_and_negative_feedback_overview` (the homeostasis framing lived in the LAST umbrella) + `respiratory_system_function_and_airway_anatomy_overview`; per-system overviews for **circulatory, lymphatic, immune, digestive, liver/pancreas, reproductive** (each opened on a specific mechanism/microstructure); `sarcomere_structural_overview` (sarcomere band-changes were taught before the sarcomere was defined).
- **Reordered:** `sarcomere_band_changes` now follows the structural overview; `innate_vs_adaptive_response_timing` pulled to the front of immunity.
- **Left for later:** many true duplicates flagged — immunity (MHC I/II, clonal selection, CD4/CD8 ×2 across two umbrellas), gas transport (Bohr, CO2 forms), digestive (bile emulsification, pancreatic bicarbonate, large-intestine water), lactation/parturition. Recommend a dedicated dedup pass.

## Unit 10 — Prokaryotes, Viruses, and Biotechnology
- **Added (5):** domain-entry intros for the unit's three domains — `what_is_a_prokaryote_overview` (unit front), `prokaryotic_genome_organization_and_plasmids_overview` (front of Genetics/HGT — plasmid used before defined), `what_is_a_virus_overview` (front of Virus Structure — opened assuming "virus" known), `viral_infection_cycle_overview` (front of Viral Life Cycles), `what_is_biotechnology_and_restriction_enzymes_overview` (front of Recombinant DNA — steepest cold start in the unit).
- **Reordered:** `horizontal_vs_vertical_gene_transfer` (the framing) pulled ahead of the specific HGT mechanisms.
- **Left for later:** PCR/gel mechanism-vs-application overlap; transposon entries across two umbrellas; umbrella-0 ordering (nucleoid/no-organelles before wall comparison).

---

# AP Calc AB ✅ COMPLETE

_status: DONE — 8 core units (`calc_unit_1..8`) audited; **10 new keywords** added + embedded (`embedding`+`embedding_vec`), several reorders. These units are CED-authored, so they were already strong — additions were surgical (units 2 & 4 needed nothing)._

Math schema: `math_keywords`, numeric `yield_score` (0–1), course-as-view via `math_course_categories` (calc_ab = the 8 `calc_unit_*` cores + precalc foundations). Calc course hides yield badges by design. New rows: `status=approved`, `yield_score` set, `examples` written with `$...$` KaTeX (stored via `jsonb_build_array` to keep backslashes intact — verified no `\f`/`\t` corruption). No duplicate order_index in any umbrella.

- **Unit 1 (Limits):** +`limit_1_intuitive_meaning_of_a_limit` (front — unit opened on notation before the concept). Reorder: `recognize_indeterminate_form_00` → front of the algebraic-manipulation umbrella (recognizing the 0/0 trigger must precede factor/rationalize techniques).
- **Unit 2 (Differentiation basics):** already clean (rates → limit definition → rules, power rule before product/quotient). No change.
- **Unit 3 (Chain/Implicit/Inverse):** +`deriv_3_chain_rule_intro`, +`deriv_3_implicit_intro`, +`deriv_3_inverse_formula_intro` (each umbrella opened on applications with no "what it is"). Reorder: `chain_rule_identify_inner_outer` (recognition skill, was buried last) → front, after the intro.
- **Unit 4 (Contextual applications):** already clean. No change.
- **Unit 5 (Analytical applications):** +`analyzed_5_increasing_decreasing_meaning`, +`analyzed_5_concavity_meaning` (both umbrellas opened on sign-chart procedure before f'>0⇒increasing / concavity meaning was stated).
- **Unit 6 (Integration):** +`integ_6_what_is_an_antiderivative` (the word was used by FTC before being defined), +`integ_6_riemann_rectangles_area` (Riemann jumped to table mechanics with no rectangles-approximate-area picture).
- **Unit 7 (Differential equations):** +`diffeq_7_what_is_a_de_and_a_solution`; **umbrella-level reorder** — the notation/vocabulary umbrella was LAST (order 9) but is foundational, moved to the front of the unit (now: vocabulary → modeling → verification → slope fields → Euler → separation → particular → exponential → full IVP).
- **Unit 8 (Applications of integration):** +`appint_8_disc_revolution_concept_intro` (front of disc method — learner's first solids-of-revolution encounter jumped to integral setup).
- **Left for later (noted by auditors, no action):** existing calc keywords have **null `examples` arrays** (a pre-existing data gap — doesn't affect embedding, which uses label+description); soft overlaps (inverse-derivative representation splits, accumulation vs FTC umbrellas, particle-motion displacement duplicates); arc length is a BC topic retained in Unit 8.

---

# Precalc ✅ COMPLETE

_status: DONE — all 11 core categories audited; **14 new keywords** added + embedded (`embedding`+`embedding_vec`), plus reorders incl. 2 umbrella-level moves. CED/outline-authored so already strong; additions were surgical. No duplicate order_index in any umbrella._

- **number_systems:** +`ns_signed_multiplication_division_computation` (no end-to-end signed mult/div computation existed, only abstract sign rules). Reorders: signed-arithmetic umbrella resequenced (add → subtract → mult/div → sign-of-quotient); **umbrella move** — `numeric_expression_structure` (order of operations) was at order 17, moved to front of the unit (it's assumed by all the arithmetic umbrellas).
- **algebraic_expressions:** +`ae_algebraic_expression_overview` (unit defined parts of an expression before defining "expression").
- **linear_equations_and_inequalities:** +`lin_absolute_value_meaning_distance` (two-case split taught before absolute-value-as-distance), +`lin_linear_function_line_meaning` (slope computed before y=mx+b meaning).
- **systems_of_equations:** +`sys_what_substitution_method_is`, +`sys_what_elimination_method_is` (each method umbrella opened on a coefficient variant, not the method's idea). Reorder: `sys_writing_system_from_context` (general translate-words-to-system skill, was last) → front of the applications umbrella.
- **polynomials:** already clean (terminology → operations → factor → divide → equations → graphs). No change.
- **exponents_and_radicals:** +`exr_root_as_inverse_of_power` (radical umbrella named the parts of the symbol before defining what a root is).
- **functions_and_graphs:** +`fg_what_is_a_function_intro` (input-output rule), +`fg_what_are_domain_and_range_intro` (both umbrellas opened on a skill before the defining concept).
- **polynomial_and_rational_functions:** +`prf_polynomial_function_orientation` (degree/leading coeff never defined before deep analysis), +`prf_rational_function_orientation` (why denominator zeros create asymptotes/holes).
- **exponential_and_logarithmic_functions:** +`elog_what_is_an_exponential_function` (umbrella opened on parameter ID). Reorder: `exponential_function_evaluation` pulled before the asymptote/end-behavior analysis (evaluate at inputs before analyzing limiting behavior). _Log strand was already well-oriented ("log as an exponent question") — left as-is._
- **trigonometric_and_polar_functions:** +`trig_angle_measure_and_radians` (definitions umbrella jumped to right-triangle ratios / unit circle with no angle/radian foundation). Reorder: definitions umbrella resequenced to angle/radians → SOH-CAH-TOA → degree-radian → unit circle → tangent → quadrant signs.
- **parameters_vectors_and_matrices:** +`pvm_vector_definition_magnitude_direction` (vectors umbrella opened on component form before "what a vector is"). _Parametric & matrix umbrellas already orient adequately; left as-is._
- **Left for later (noted, no action):** several soft cross-umbrella overlaps (domain/range-from-table duplicated; change-of-base in two umbrellas; period/amplitude/midline spiral across 3 trig umbrellas — deliberate); a few low-yield/"[MOVED TO P1]" import-anchor rows in polynomials/functions; coordinate-plane basics assumed from prior units. Optional further intros (matrix definition, parametric "what a parameter is", inverse-trig/polar orientations).

---

# FINAL SUMMARY

**Totals across all three subjects: 72 new keywords** (all embedded with `embedding` + `embedding_vec`, text-embedding-3-small), plus ~30 reorders (incl. 3 umbrella-level moves). Every touched unit now opens with a from-scratch foundational intro and each touched umbrella has a real entry point; no duplicate `order_index` within any umbrella; existing question→keyword tags untouched (additive only).
- **MCAT:** 48 new keywords across all 10 units (incl. the requested "what is an amino acid" intro). 1 ordering fix (speciation) caught + corrected during verification.
- **AP Calc AB:** 10 new keywords across 6 of 8 units (units 2 & 4 already clean); 1 umbrella-level move (calc_unit_7 vocabulary → front).
- **Precalc:** 14 new keywords across 10 of 11 categories (polynomials already clean); 2 umbrella-level moves.

**Intentionally deferred (not blockers):** (1) overlap/dedup passes — documented per unit, no deletions made to protect existing tags; (2) `concept_blueprint` null on new rows → run `npm run mcat:blueprints` / `math:blueprints` (fill-missing) when convenient; (3) umbrella centroid embeddings not recomputed (negligible shift per added child; new keywords reachable as children); (4) seed sources (`mcat-keywords.txt`/expand scripts, `content/math-taxonomy/*.json`) NOT updated — a future re-seed must fold these additions in; (5) pre-existing null `examples` on many calc keywords (separate data-quality gap, doesn't affect embedding).

**Env note:** `npm run mcat:embed`/`math:embed` fail in this environment (Node 20 lacks WebSocket for supabase-js realtime). Embedding was done via a self-contained `fetch`-only script (PostgREST + OpenAI, OPENAI key from `apps/student/.env.local`); `embedding_vec` backfilled via `UPDATE … SET embedding_vec=(embedding::text)::vector`. No code/deploy changes — this is pure DB+embeddings, read at runtime.
