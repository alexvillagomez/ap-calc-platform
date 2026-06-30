# MCAT Depth Standard Calibration

**Purpose:** Establish a concrete, audit-ready depth standard that grounds MCAT content at the rigor AAMC expects — neither under-prepared nor over-deep — ensuring consistency across 2,769+ keywords and enabling auditors to judge "deep enough" using reproducible heuristics.

**Foundational Framework:** Four depth levels (L1–L4) reflect AAMC's approach to progressive mastery.

**Two axes, both binding.** This document sets the **cognitive LEVEL (L1–L4) and COMPLETENESS** of a keyword — how far the reasoning goes and whether the full in-scope set is covered. It operates WITH `docs/mcat-depth-standard.md`, which sets **NUMERIC PRECISION** (MilesDown-calibrated: ranges/directions over decimals — no decimal $pK_a$/$K_m$/$V_{max}$/$K_i$; keep round comparatives like NADH = 2.5 vs FADH₂ = 1.5 ATP; no exhaustive pathway-intermediate lists). When assigning depth, satisfy BOTH: reach the right LEVEL without breaching the PRECISION ceiling. **"Deeper" means more causal/directional reasoning and fuller in-scope coverage — NOT more memorized decimals or longer intermediate lists.**

---

## Per-Discipline Depth Norms

### Biochemistry
- **Official Scope:** First-semester undergraduate biochemistry (AAMC content outline); introductory level with application to novel mechanisms.
- **Depth Ceiling:** Qualitative relationships and foundational mechanisms. **Quantitative examples are illustrative only** (no decimal Km/Vmax/Ki memorization; directional relationships suffice: low Km = high affinity, Vmax scales with enzyme concentration).
- **L1:** Recognize enzyme, substrate, product, cofactor roles.
- **L2:** Directional Michaelis–Menten: substrate concentration → velocity relationship; Km as affinity proxy; inhibition types and their effects on Km vs Vmax.
- **L3:** Two-step mechanism (E + S ⇌ ES → E + P), rate-limiting step, steady-state assumptions — why Vmax depends on [E] but Km does not.
- **L4:** Apply novel pathway reasoning: given a passage enzyme mutant or inhibitor, predict consequence for substrate depletion, product formation, coupled reaction flux.

### Organic Chemistry
- **Official Scope:** Introductory organic (one semester typical); mechanism-driven rather than memorized product lists.
- **Depth Ceiling:** Reaction mechanism logic, substitution/elimination decision tree, no complex multi-step syntheses or obscure rearrangements.
- **L1:** Recognize nucleophile, electrophile, leaving group; identify substrate class (1°, 2°, 3°).
- **L2:** Directional decision framework (substrate structure + solvent type → SN1 vs SN2); regioselectivity (Markovnikov's), stereochemistry (inversion/retention for mechanism type).
- **L3:** Full two-step SN1 (carbocation formation + nucleophile attack); single-step SN2 (backside attack, inversion); why steric hindrance blocks SN2 on tertiary.
- **L4:** Passage-driven reasoning: given a substrate, reagent, solvent, predict product, rate outcome, stereochemistry; resolve competing mechanisms.

### Biology (Non-Biochemistry)
- **Official Scope:** Introductory cell/molecular/physiology (majors-level); classification + mechanism-dependent ("mile wide, inch deep").
- **Depth Ceiling:** Foundational processes (photosynthesis steps, immune response cascade), named structures and their function; no exhaustive cell-biology minutiae.
- **L1:** Recognize and classify: cell types, organelle functions, tissue types, organ systems, species examples.
- **L2:** Directional pathway logic: glycolysis energy yield, immune response escalation (innate → adaptive), DNA replication fork → daughter strands, hormone feedback loop sign (negative acceleration).
- **L3:** Pathway LOGIC + regulation (NOT exhaustive intermediate lists): net yield + rate-limiting/regulatory step + the *why* (e.g. glycolysis nets 2 ATP + 2 NADH + 2 pyruvate, PFK-1 is the committed rate-limiting step; β-oxidation occurs in the matrix) — naming all 10 glycolytic intermediates is OVER-depth (see `docs/mcat-depth-standard.md`). Include immune B/T-cell roles, meiosis vs mitosis distinctions, the transcription→translation flow.
- **L4:** Integration: multi-system regulation (sympathetic + hormonal response to stress), passage-driven novel pathway reasoning (atypical mutant, drug target, evolutionary pressure).

### General Chemistry
- **Official Scope:** Introductory general chemistry (one year typical); quantitative for equilibrium, kinetics, thermodynamics; qualitative for bonding and solution chemistry.
- **Depth Ceiling:** Conceptual gas laws, equilibrium shifts, rate laws, Le Chatelier principle; calculation of pH, pKa, buffer capacity when passage provides values; no titration curve derivations.
- **L1:** Recognize bond types, oxidation states, acid/base roles, reaction classification (redox, acid-base, precipitation).
- **L2:** Directional: heat flow in endothermic/exothermic, equilibrium shift on stress, rate dependence on activation energy and concentration, buffer capacity reason (conjugate pair).
- **L3:** Mechanism: collision theory, rate law from elementary steps, Gibbs free energy and spontaneity (ΔG = ΔH − TΔS), Henderson-Hasselbalch application.
- **L4:** Passage reasoning: coupled reactions and energy coupling, buffer zone selection for given pH range, non-standard redox prediction via E° tables and Nernst.

### Physics
- **Official Scope:** Introductory physics (mechanics, waves, thermodynamics at biological scale); qualitative reasoning and directional application prioritized over heavy computation.
- **Depth Ceiling:** Core equations (F = ma, energy conservation, wave speed, Doppler direction) applied to biological systems (blood flow, muscle force, sound/light sensory), not advanced topics like relativity.
- **L1:** Recognize force types, energy forms, wave behavior, optical/acoustic phenomena.
- **L2:** Directional: terminal velocity in fluids (viscosity + gravity balance), work-energy theorem, power as energy rate, Doppler shift direction.
- **L3:** Multi-step derivation: projectile motion from kinematic equations; fluid dynamics (continuity equation, Bernoulli, pressure-velocity inverse); simple harmonic motion for resonance.
- **L4:** Passage reasoning: blood-flow pressure gradient with tube radius and viscosity, hearing threshold vs frequency, vision correction optics.

### Psychology/Sociology
- **Official Scope:** Introductory behavioral sciences (first semester typical); breadth over depth ("mile wide, inch deep"); terminology density is high, concept application to social context required.
- **Depth Ceiling:** Named theories and core definitions (operant conditioning 2×2, attachment theory, social identity), no detailed statistical analysis or primary-literature evaluation.
- **L1:** Recognize and define: theory name, key terms (e.g., "token economy," "in-group bias," "working memory"), exemplar phenomena.
- **L2:** Directional principle: positive/negative reinforcement difference, attribution bias direction (actor vs observer), arousal-performance (Yerkes-Dodson inverted-U).
- **L3:** Mechanism: operant conditioning full 2×2 (punishment types, reinforcement schedules, extinction), stages of moral development, prejudice acquisition via modeling and reinforcement.
- **L4:** Application: passage scenario with social/behavioral context; apply theory to predict outcome or explain observed behavior.

---

## Topic-Type → Depth-Level Mapping Rules

These rules drive consistent assignment of target depth and enable audit judgment.

| Topic Type | Typical L-Target | Rules & Calibration |
|-----------|-----------------|-------------------|
| **Classification/Taxonomy** (e.g., amino acid types, immune cell subtypes, vitamin families) | L2 | MUST enumerate FULL set (no omissions); understand distinguishing features + functional consequence. "Vitamin A/D solubility" → L2 requires understanding lipophilicity + absorption, not just listing. |
| **Named Regulatory Mechanism** (e.g., negative feedback, allosteric inhibition, operant conditioning) | L3 | Full logic flow: input → sensor → response → outcome, with directional reasoning (why negative feedback stabilizes, how allosteric changes binding affinity). |
| **Quantitative Relationship** (e.g., Michaelis–Menten, pH-pKa, Henderson-Hasselbalch) | L2–L3 | Directional relationships (low Km = high affinity, Vmax ∝ [E]) + recognize effect-variable mappings; NO rote decimal memorization. Calculation permitted only if passage provides numerical values. |
| **Multi-System Feedback** (e.g., HPA axis, immune cascade, thermoregulation) | L4 | Decompose into owned L1–L3 parts (recognize hormones, understand directional feedback, trace multi-step cascade); integrate across systems for novel scenario. |
| **Reaction Mechanism** (org chem, biochemistry) | L2–L3 | L2 = decision tree (substrate type + conditions → mechanism prediction). L3 = full arrow-pushing, intermediate structure, stereochemistry logic. |
| **Passage-Dependent Applied Reasoning** | L4 | Requires L1–L3 mastery of foundation; apply to novel organism, mutant, drug, or evolutionary scenario; integration across multiple concepts. |
| **Memorizable Atomic Fact** (e.g., "oxytocin triggers milk letdown," "lac operon repressed by lactose absence") | L1 | Isolated fact; no mechanism required. Use sparingly; most "facts" are better taught as L2–L3 directional principles. |

---

## "Deep Enough" Audit Checklist

Apply per keyword to judge whether stored content meets the target depth level.

### For All Keywords
- [ ] Content aligns with target depth L1–L4 assigned via taxonomy.
- [ ] No under-depth: L3 keywords do NOT collapse to L1 definitions (mechanism must be present).
- [ ] No over-depth: L2 keywords do NOT include mechanistic derivations or quantitative calculations beyond directional reasoning.
- [ ] Prerequisite coverage: if keyword depends on prior concepts, those are taught or referenced at appropriate depth.

### For Classification/Taxonomy (L2 Target)
- [ ] Full set enumerated (e.g., all 20 amino acids if teaching amino acid families; all immune-cell types in scope).
- [ ] Distinguishing feature + functional consequence stated for each member (not just listing).
- [ ] Relationship to umbrella category explicit (why "these 5 are grouped").

### For Mechanisms (L3 Target)
- [ ] Step-by-step logic shown: input → sensor → step 1 → step 2 → outcome.
- [ ] Directionality explicit (e.g., "increased CO₂ → decreased pH → increased H⁺ [directional], which drives bicarbonate formation [mechanism]").
- [ ] Intermediates named (enzyme-substrate complex, carbocation, etc.) and role explained.
- [ ] Why-questions answerable: "Why does Vmax increase if [E] increases?" answered, not assumed.

### For Quantitative Relationships (L2–L3)
- [ ] If L2: directional statement present ("low Km means high affinity"). Passage-provided numerical examples optional.
- [ ] If L3: mechanistic foundation shown (why Km reflects substrate concentration at half Vmax; what Michaelis–Menten assumptions enable). Decimal-precision memorization NOT required.
- [ ] No isolated equations without conceptual grounding.

### For Multi-System Feedback (L4 Target)
- [ ] Each L1–L3 component is independently sound (hormones named and roles clear; feedback direction stated; each link has a reason).
- [ ] System-level integration shown: how does signal propagate? Where is negative feedback? What breaks it?
- [ ] Novel scenario reasoning is supported (given a mutation or drug, the explanation traces impact through multiple components).

### For Psychology/Sociology (L1–L4, "Mile Wide, Inch Deep")
- [ ] Terminology consistent with standard textbooks (AAMC-aligned sources like UWorld, Kaplan).
- [ ] Concept definition clear; application examples provided (e.g., "positive reinforcement = outcome that increases behavior; example: praise after correct answer").
- [ ] Breadth: does content cover related adjacent concepts? (e.g., operant conditioning covers all 4 quadrants; social identity covers in-group, out-group, in-group bias).
- [ ] Depth: does content explain mechanism or just name it? (L2 = directional principle; L3 = process logic; L4 = integration with social context).

### For Organic Chemistry Mechanisms (L2–L3)
- [ ] Decision framework present (SN1 vs SN2: substrate class, solvent, leaving group).
- [ ] If L3: arrow-pushing shown, intermediate structure, stereochemistry outcome (inversion/retention).
- [ ] Reasoning for rate, regioselectivity, or product selectivity explained (not just stated).

---

## Consistency Audits & Red Flags

**Under-Depth Symptoms:**
- Definition-only content (no mechanism, no reasoning, no consequence).
- Keyword taught in isolation (missing prerequisite or umbrella context).
- L1/L2 label on keywords that should be L3/L4 (e.g., "gluconeogenesis" taught as fact, not as reverse-glycolysis logic).

**Over-Depth Symptoms:**
- Quantitative precision not in scope (e.g., "exact Km = 2.3 mM" memorization when directional suffices).
- Advanced topics beyond AAMC scope (quantum mechanics in physics, advanced statistics in psych).
- Single-topic deep dives at expense of breadth (e.g., enzyme kinetics 3000-word treatise, missing inhibition and Vmax variations).

**Consistency Failure:**
- Same concept taught at different depths in different keywords (e.g., "feedback inhibition" explained fully in one keyword, undefined in another).
- Related keywords out of sync (e.g., "SN1 mechanism" is L3 but "carbocation" is L1; should be L2 minimum).

---

## References & Calibration Sources

- **AAMC Official Content Outline** — official scope and emphasis language ("first-semester," "introductory," "concepts taught in…").
- **UWorld MCAT QBank + Explanations** — depth reflected in question design and answer reasoning; mechanism-over-memorization standard.
- **Kaplan MCAT Books** — representative third-party depth standard; used alongside UWorld as benchmark.
- **OpenStax Biology/Chemistry Texts** — introductory undergraduate depth ceiling; used to gauge L1–L3 scope.
- **Student Discussion Consensus** (SDN, r/MCAT) — where "felt under-prepared" and "wasted effort" feedback converges; signals depth miscalibration.

---

**Last Audited:** 2026-06-30  
**Scope:** 2,769 MCAT keywords (Biology, Psychology/Sociology, Chemistry, Physics sections)  
**Apply:** Use checklist per keyword on content review; flag under/over depth via audit workflow.
