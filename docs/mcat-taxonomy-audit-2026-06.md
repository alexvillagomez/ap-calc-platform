# MCAT Biology Taxonomy Audit — 2026-06-26

Full MECE/coverage audit of the `mcat_*` Biology keyword taxonomy against the **entire** AAMC "What's on the MCAT Exam?" content outline (2020). Driven by an expert-manager + per-category subagent fan-out.

## Decisions (locked with the user)
- **Scope:** maximal AAMC fidelity, overwrite freely. Anchor = Bio/Biochem section (FC 1–3 = content categories 1A–3B). Plus two cross-section biology areas the AAMC tests: **lipid structure** (5D/3A/2A — currently absent) and **sensory-organ biology** (6A BIO parts only; psychophysics/perception excluded).
- **Granularity:** keep keywords VERY narrow (one testable skill each); split bundled keywords; add liberally; complete coverage. Discretion on merges, bias to narrow.
- **Mechanics:** direct SQL to Supabase (no migration files). Keep 10 categories; new topics become umbrellas inside them. New keywords get embeddings (`mcat:embed`) + concept blueprints + yield (`mcat:blueprints`) so they go live.
- **Depth:** mile-wide-inch-deep (recognition/classification/directional/qualitative; no decimal pKa, no exact Km/Vmax/Ki, no pathway-intermediate memorization).

## Cross-category resolutions
- "Nonenzymatic Protein Functions" umbrella **stays in Enzymes & Protein Function** (category name covers it).
- Meiosis: **mechanics** → Cell Cycle ("Meiosis and Gametogenesis"); **genetic-variability angle** → Genetics. (Reconciled after Wave 2.)
- Cancer: **gene-regulation failure** (oncogenes/tumor suppressors) → Nucleic Acids; **cell-cycle checkpoint loss** → Cell Cycle.
- "Evidence DNA is genetic material" experiments → Genetics; "DNA stores/transmits information" molecular role → Nucleic Acids.

---

## Change log by category
(applied via direct SQL; counts + notable changes)

### Cat 0 — Amino Acids & Proteins ✅ APPLIED
- +8 in_depth: `recognize_amino_acid_from_structure`, `amino_acid_name_to_class_recall` (per-residue polarity — user priority), `histidine_side_chain_near_physiological_ph` (split from basic), `amino_acid_one_and_three_letter_codes`, `essential_vs_nonessential_amino_acids`, `alpha_amino_acid_synthesis_strecker_gabriel` (low), `protein_solubility_minimum_at_pi`, `protein_3d_structure_overview` (intro).
- Re-scoped: `amino_acid_abbreviations_and_identity` (→ "the 20 set"), `basic_side_chains` (Lys/Arg only), `amino_acid_chirality_and_l_configuration` (D/L vs R/S), `side_chain_pka_and_protonation_state` (boundary).
- Decision: nonenzymatic protein fn stays in Enzymes category.

### Cat 1 — Enzymes & Protein Function ✅ APPLIED
- +1 umbrella `enzyme_classification_ec` with 7 children (intro + 6 EC classes — biggest AAMC gap).
- +temperature/pH-on-activity (2); +5 umbrella intros; +`hemoglobin_cooperative_sigmoidal_binding` (split); +`b_vitamin_coenzyme_identities`.
- Re-scoped 8 (removed "calculate" from rate/efficiency; split inhibition vs regulation; tightened induced-fit/active-site-microenv/oxygen-transport).
- Deleted 2 dups: `allosteric_vs_active_site_binding`, `transition_state_stabilization_vs_substrate_binding`.

### Cat 2 — Nucleic Acids & Gene Expression ✅ APPLIED
- +cancer cluster (`cancer_as_gene_regulation_failure_overview` intro, `oncogenes_and_gain_of_function`, `tumor_suppressor_loss_of_function`) — was entirely missing.
- +`watson_crick_double_helix_model`, `dna_as_carrier_of_genetic_information`, `mrna_trna_rrna_roles`, `intron_function_and_evolutionary_importance`, `noncoding_rna_regulatory_roles`.
- Re-scoped telomere (mechanism vs structure) & histone (structure vs regulation); fixed eukaryotic-multiple-origins.
- Deleted 2 dups: `reading_frame_shift_effects`, `alternative_splicing_exon_combinations`.

### Cat 3 — Genetics, Evolution & Inheritance ✅ APPLIED
- +17: intros (sex-linkage, mutation, non-mendelian, gene-mapping); codominance vs incomplete-dominance split; inversion/translocation split; founder effect; chi-square; evidence-DNA experiments; gene-pool; wild-type; transcription/translation errors; advantageous/deleterious/neutral; inborn errors; natural-vs-group selection; evolutionary-success; synaptonemal/tetrad.
- Re-scoped 9 (drift/bottleneck/founder boundaries; chiasmata vs synaptonemal; multiple-alleles ABO; genome-change → molecular clock; evolution-intro trim; nondisjunction).
- Deleted 4 dups (testcross, probability, drift+bottleneck, linkage triplications).
- ⏳ DEFERRED: meiosis-mechanics relocation Genetics→Cell Cycle (resolved in Wave 2).

### Cat 4 — Bioenergetics & Metabolism ✅ APPLIED
- +NEW umbrella `lipid_structure_and_classification` (intro + 10: FA structure/saturation, TAG, saponification, phospholipid, sphingolipid, wax, steroid/cholesterol, terpenes, fat-soluble vitamins, prostaglandins) — fills the cross-section lipid hole.
- +21 in-umbrella: carb classification/D-L/named sugars/keto-enol/glycosidic (7), Le Châtelier + endo/exo (2), aerobic-vs-anaerobic glycolysis + feeder entry (2), PDH regulation, ATP-per-carrier + net-ATP total + mito-ROS/apoptosis + mobile carriers (4), FA synthesis + ACC (2), non-template synthesis + Cori cycle (2).
- Deleted dup `hormonal_control_of_lipolysis_2`.

### Cat 5 — Cell Structure, Membranes & Transport ✅ APPLIED
- +11: `lysosome_hydrolytic_enzyme_compartment` (was missing as an organelle), `membrane_receptor_ligand_recognition`, `tonicity_classification_and_cell_volume` (split from osmosis), `osmotic_pressure_and_colligative_basis`, `transport_free_energy_and_spontaneity`, `membrane_fluidity_temperature_and_saturation`, + 5 umbrella intros.
- Re-scoped osmosis (water-flow only), cristae (structure), actin (composition).
- Deleted 6: 4 cross-umbrella dups (active-transport, electrochem-gradient, tight-junction, basement-membrane) + `secretory_pathway_constitutive_vs_regulated_exocytosis` + `atp_synthase_chemiosmotic_coupling` (OXPHOS → owned by Bioenergetics).

### Cat 6 — Prokaryotes, Viruses & Biotechnology ✅ APPLIED
- +10: `transduction_phage_mediated_gene_transfer` (completes the HGT quartet — was missing in two AAMC spots), `gram_positive_vs_gram_negative_cell_wall`, `prokaryotic_domains_bacteria_vs_archaea`, `pharmaceutical_protein_production`, `bioremediation_environmental_cleanup`, + 5 umbrella intros.
- Cell theory kept in Cell Structure (single owner). Transposon pair kept with sharpened boundaries.

### Cat 7 — Cell Cycle, Development & Reproduction ✅ APPLIED
- +13: centrioles/asters, sperm-vs-ovum morphology + contribution, four primary tissue types, ecto/meso/endoderm derivatives (split), intrinsic-vs-extrinsic apoptosis, + 5 umbrella intros.
- **Meiosis MECE swap:** deleted mechanics keywords from Genetics (homolog/sister separation, reductional/equational) — covered here; deleted variability dups from Cell Cycle (crossing-over, independent-assortment, synapsis) — owned by Genetics. Added reductional/equational naming to `ploidy_changes_through_meiosis`.
- Deleted `oncogene_gain_of_function_vs_tumor_suppressor_loss` (cat 2 owns it) + `stem_cell_potency_levels` dup + `germ_layer_to_tissue_derivative_matching` (split).

### Cat 8 — Nervous & Endocrine + NEW Sensory ✅ APPLIED
- +NEW umbrella `sensory_systems_and_transduction` (intro + 10: receptor types, eye, photoreceptors, ear, hair cells, vestibular, taste, smell, somatosensation, proprioception) — 6A biology only, psychophysics excluded per scope decision.
- +15: Nernst/concentration-cell (electrochemistry was entirely missing), 6 gland→hormone identity keywords (thyroid/parathyroid/adrenal/pancreas/pineal/gonad — products were missing), neurotransmitter identity, 3-hormone-class recognition, + 5 umbrella intros. Moved AP-overview to front.
- Deleted 6 dups: 3 second-messenger cascades (owned by biosignaling umbrella), afferent/efferent, endocrine-feedback, posterior-pituitary.

### Cat 9 — Organ Systems & Homeostasis ✅ APPLIED
- +36 (incl. 12 umbrella intros): cardiac conduction pathway + SA-node + autonomic HR + systolic/diastolic + peripheral resistance (cardiac electrophysiology was missing); blood composition + bone marrow; Henry's law; antibody molecule structure; GI hormones + enteric NS + saliva + gut flora + SI subdivisions; lower urinary tract + kidney roles; slow/fast fibers + NMJ + oxygen-debt + muscle pump; bone cell types + remodeling + endo/exoskeleton; skin layers + subcutaneous fat; respiratory thermoregulation.
- Deleted 13 cross-umbrella dups (immune MHC/CD4-8/clonal, gas-transport CO2/Bohr, digestive bile/bicarbonate/LI-water, lactation, + 4 redundant integration re-teaches). Removed "Calculate" from hematocrit/sweat; re-scoped bone-mineral-storage.

---

## Final totals (after apply)
- **109 umbrellas** (+3: Lipid Structure, Enzyme Classification, Sensory Systems), **922 in_depth** keywords. 0 orphans, 0 duplicate labels within a category.
- ~176 new keywords (net of ~35 dedup deletes). Pipeline: `mcat:embed` (fill-missing embeddings) + `mcat:blueprints` (concept blueprint + yield).

## Deferred / notes (not blocking)
- A few low-risk dedups left in place to avoid losing unique content: `parturition_oxytocin_positive_feedback_2`, `hemoglobin_oxygen_saturation_vs_pao2` (no verified survivor). Reproductive gametogenesis/fertilization overlap between Cat 7 and Cat 9 left as-is (tolerable; refine later).
- `embedding_vec` (pgvector, used only by `/search`) backfilled from `embedding` after embed pass.
- `mcatContentOutline.ts` grounding already covers these areas at the category level; lipids/sensory are now in-taxonomy (and added to the outline file's 1D + 3A topic lists).

## Bugs found & fixed while wiring the expanded taxonomy
The expansion pushed `mcat_keywords` over **1000 rows (now 1043)**, which exposed three latent issues:
1. **`scripts/backfill-mcat-blueprints.ts`** — (a) used bare `createClient` → crashed on Node 20 (no native WebSocket); switched to the realtime-safe `createServiceClient` helper. (b) fetched all keywords in one query → silently dropped >1000th rows so ~26 keywords never got blueprints; now **paginated** (range loop + stable `id` tiebreaker).
2. **New keywords were inserted `status='active'` but the app filters `status='approved'`** → they'd be invisible in the browse/practice/progress UI. Fixed: all set to `approved` (1043 total).
3. **`/api/mcat/taxonomy` route and `loadTargetKeywords` (`lib/mcatTagging.ts`)** fetched all keywords un-paginated → would drop ~43 past the 1000 cap. Both now use `fetchAllPages` (`lib/mathPagedQuery.ts`).

## Verified final state
- 10 categories, **109 umbrellas, 934 in_depth**, all `status='approved'`.
- 0 missing embedding / embedding_vec / concept_blueprint / yield_level; 0 orphans; 0 duplicate labels within a category; 0 empty umbrellas.
- Per-category in_depth: AminoAcids 68, Enzymes 65, NucleicAcids 85, Genetics 88, Bioenergetics 116, CellStructure 86, Prokaryotes 85, CellCycle 75, Nervous 95, OrganSystems 171.
- New umbrellas populated: Enzyme Classification (7), Lipid Structure (11), Sensory Systems (11).
- Completeness critics (cats 0–4, 5–9): **no zero-coverage AAMC subtopics remain**; meiosis-variability lives in Genetics by design (covered "somewhere", MECE).

## Optional follow-ups (not done)
- `npm run mcat:audit-scope` to quarantine any of the 108 existing questions now out-of-scope vs their (re-scoped) keyword blueprints. Content pool is tiny + regenerates; left for a content pass.
- Regenerate `mcat_flashcards` if the deck should reflect new keywords (stored-preferred; existing 14 retagged in place).
