# MCAT Depth Standard

**Purpose:** Canonical guide for content depth on this platform. All flashcard, question, and lesson generators must follow this standard. A future session will encode these rules directly into prompts.

---

## The Core Principle

> **The MCAT is a mile wide and an inch deep.**

The AAMC's own framing: the exam tests *"deep knowledge of the most important foundational concepts"* — not breadth of memorized details. The word "deep" here means *deeply understood*, not *precisely memorized*. Students who can reason from principles outperform students who memorized more facts.

In practice:
- **Wide:** Covers biochemistry, molecular biology, cell biology, physiology, genetics, behavior, psychology, sociology, gen chem, orgo, and physics.
- **Shallow:** Within each area, the test wants *undergraduate-level understanding* — conceptual relationships, directional reasoning, approximate ranges, causal logic. Not research-level or medical-school-level precision.

**The test is a reasoning exam that requires content knowledge as raw material.** Content is needed so students can reason; precise figures are rarely the thing being tested.

---

## Gold-Standard Calibration: The MilesDown Anki Deck

The platform has 2,887 cards from the MilesDown deck in the `anki_cards` table. MilesDown is one of the most widely recommended MCAT Anki decks, known for covering exactly what appears on the real exam.

### What the deck includes (and how it handles numbers)

| Domain | How MilesDown handles it |
|--------|--------------------------|
| Amino acid pKa | **None** — zero cards with a decimal pKa value for any side chain. Cards instead test structure recognition ("This amino acid is Cysteine") or directional behavior ("High pH → fully deprotonated") |
| Enzyme kinetics (Km, Vmax) | **Qualitative only** — "Competitive inhibitor: Km↑, Vmax unchanged" — no numerical Km or Vmax values for any enzyme |
| ATP yield per carrier | **Kept** — NADH = 2.5 ATP, FADH₂ = 1.5 ATP. These are included because the *comparison* between NADH and FADH₂ is mechanistically important and the values are "nice" numbers. |
| Glycolysis net yield | **Kept as a formula** — "Requires 2 ATP, produces 4 ATP → net 2 ATP" — round, comparative |
| Enzyme regulation | **Qualitative with named enzymes** — "PFK is inhibited by ATP and citrate" (why it's inhibited matters; the specific Ki does not) |
| Pathway compartments | **Specific and required** — "Glycolysis: cytoplasm; Krebs cycle: mitochondrial matrix; β-oxidation: mitochondria" |
| Physical/chemical constants | **Exact values kept** — speed of light (3.0×10⁸), Avogadro's number (6.02×10²³), Planck's constant — these are universal constants, not biological approximations |
| NMR spectral ranges | **Ranges, not exact** — "Vinylic H: 4.5–6.5 ppm", "Aldehyde H: 9.7–10.0 ppm" |
| Bond angles | **Kept** — 109.5° for sp³ hybridization (exact, geometrically derived, not memorized as a fact) |

### What the deck completely avoids

- Decimal pKa values for individual amino acid side chains (no "Cys pKa ≈ 8.3", no "Asp pKa = 3.7")
- Exact Km or Vmax values for any specific enzyme
- Step-by-step pathway intermediates (glycolysis intermediate names, Krebs cycle intermediate names)
- Exact inhibition constants (Ki values)
- Full pathway ATP yield as a single exact number (uses per-carrier yield instead)
- Multi-step synthetic mechanisms
- Obscure enzyme names outside of rate-limiting / clinically significant cases

### The pattern

The deck tests: **recognition, classification, directional effects, causal relationships, compartment locations, qualitative rules.**

It does not test: **precise numeric constants of biochemical molecules**, unless those values are (a) round/memorable AND (b) the comparison between them is the mechanistic point.

---

## The Canonical Example: Thiol pKa

This is the exact case that triggered this standard.

**BAD (too deep):**
> "Thiol side chain: pKa ≈ 8.3"

Why it's wrong: The MCAT will never ask "what is the pKa of cysteine's thiol?" The decimal precision creates false precision on a fact the student doesn't need. It trains rote memorization of a number rather than understanding.

**GOOD (right depth):**
> "Cysteine's thiol side chain is ionizable — it can lose a proton near physiological pH, making cysteine weakly acidic among the amino acid side chains."

Or, in card format:
> Front: "Which amino acid has an ionizable side chain that can act as a nucleophile in enzyme active sites?"
> Back: "Cysteine — its thiol (–SH) can be deprotonated near physiological pH, forming a thiolate (–S⁻) that is an excellent nucleophile."

The good card tests: *recognition + functional consequence*. The bad card tests: *memorization of a decimal*.

---

## Section A: Flashcards

### What flashcards are for

Flashcards test **recognition and recall of discrete facts** — terms, classifications, associations, directional rules, named relationships. They are not problem-solving vehicles.

The MilesDown model: a flashcard should be answerable in one to three words or a short phrase. The front poses a cue; the back supplies the missing piece.

### Right depth for flashcards

**Include:**
- Classification: amino acid type (acidic, basic, nonpolar, polar-uncharged), which ones are ionizable vs. not
- Directional rules: "competitive inhibitor → Km↑, Vmax unchanged"
- Named relationships: "rate-limiting enzyme of glycolysis → PFK-1"
- Compartment facts: "β-oxidation occurs in the mitochondrial matrix"
- Qualitative charge state: "At pH 7.4, aspartate's side chain is deprotonated (negatively charged)"
- Round/comparative numbers: NADH = 2.5 ATP, FADH₂ = 1.5 ATP (because the comparison is the point)
- Named mechanisms: "competitive inhibitor binds at the active site"
- Key structural features: "Cysteine has a thiol side chain capable of disulfide bonding"
- Functional consequences of structure: "Proline's rigid ring interrupts α-helices"

**Exclude:**
- Decimal pKa values for individual amino acid side chains (no "pKa ≈ 8.3")
- Exact Km or Vmax numbers for any enzyme
- Specific inhibition constants (Ki)
- Multi-step pathway intermediate names (no listing all 10 glycolytic intermediates)
- Precise enzyme concentrations, rate constants, or equilibrium constants
- Obscure pathway enzymes without clinical or regulatory significance

### Ranges over exact values (flashcard rule)

When a numeric value matters for reasoning, state it as a RANGE or a COMPARISON, not a decimal.

| Topic | Too deep | Right depth |
|-------|----------|-------------|
| Cys side chain pKa | "pKa ≈ 8.3" | "ionizable near physiological pH; weakly acidic" |
| His side chain pKa | "pKa ≈ 6.0" | "pKa near 6 — can buffer at physiological pH; only amino acid that does so" |
| Asp/Glu pKa | "pKa = 3.7 / 4.2" | "strongly acidic; fully deprotonated (negative charge) at pH 7.4" |
| Lys/Arg pKa | "pKa = 10.7 / 12.1" | "strongly basic; fully protonated (positive charge) at pH 7.4" |
| Physiological pH | any decimal | "~7.4" (this is an acceptable approximation) |
| ATP yield (aerobic) | "36–38 ATP" or "32 ATP" | "~30 ATP total; aerobic >> anaerobic" |

**Exception — histidine:** the fact that His is the *only* amino acid whose pKa falls near physiological pH is MCAT-tested. The right card is: "Why can histidine buffer near physiological pH?" not "What is histidine's pKa?" The concept is tested, not the decimal.

### Card phrasing rules

1. **Ask about function, not definition.** "What makes cysteine uniquely reactive in enzyme active sites?" beats "Define thiol."
2. **Ask about consequences.** "What happens to Km when a competitive inhibitor is added?" beats "Define competitive inhibition."
3. **Ask about comparisons.** "Which produces more ATP per molecule: NADH or FADH₂?" beats "How much ATP does FADH₂ produce?"
4. **Avoid asking for exact numbers unless the number IS the concept.** NADH = 2.5 ATP is a number that exists to be compared to FADH₂ = 1.5 ATP. Cys pKa = 8.3 exists only as trivia.

### Flashcard format and length

Front: one focused cue (≤15 words). Back: one to three lines. If the back requires four or more sentences, split into multiple cards. Flashcards are not mini-lessons.

---

## Section B: Questions / Quizzes

Questions and quizzes test **application and reasoning** — whether the student can use knowledge to arrive at a conclusion, not whether they can recall a decimal.

### Right depth for questions

**Include:**
- Passage-based reasoning (infer from given data, not from memorized constants)
- Prediction questions: "If a competitive inhibitor is added, how does the Lineweaver-Burk plot change?"
- Mechanism application: "Why does a tertiary carbon favor SN1 over SN2?"
- Comparative reasoning: "Hexokinase vs. glucokinase — which acts as a glucose sensor in the liver? Why?"
- Charge-state reasoning: "At pH 5, is lysine's side chain protonated or deprotonated?" (requires knowing pKa is ~10 → protonated at pH 5)
- Pathway logic: "Under anaerobic conditions, why does lactate accumulate?"
- Clinical connections: "A patient with a G6PD deficiency takes an oxidizing drug. What happens to red blood cells?"

**Exclude:**
- Questions requiring recall of specific pKa decimals not provided in the passage
- Questions requiring exact Km or Vmax values not given in the stem
- Step-by-step mechanism reproduction (draw all arrow-pushing steps)
- Multi-step synthesis problems requiring recall of 4+ sequential reactions
- Obscure enzyme name recall outside of high-yield regulatory enzymes

### Numeric values in questions

If a question needs a number to reason with, **provide it in the stem or passage**. Do not write questions that can only be solved by recalling a decimal pKa, exact rate constant, or precise inhibition constant. The AAMC does this: passages supply values; reasoning is tested.

**BAD question:**
> "Cysteine has a thiol side chain with pKa ≈ 8.3. At pH 7.4, what fraction of cysteine residues are deprotonated?"
> (Tests memorization of 8.3 AND logarithm calculation — double over-precision)

**GOOD question:**
> "An enzyme active site contains a cysteine residue that must be in its thiolate (–S⁻) form to be catalytically active. At physiological pH of 7.4, would you expect this residue to be predominantly protonated or deprotonated, and does this support catalytic activity?"
> (Tests: thiol is ionizable near pH 7; thiolate is deprotonated form; reasoning about whether pH 7.4 favors the deprotonated state — no decimal needed)

### Difficulty calibration for questions

- **Easy:** recall + one-step reasoning ("What is the product when alcohol reacts with carboxylic acid?")
- **Medium:** two-step causal reasoning ("Why does glucokinase but not hexokinase act as a glucose sensor in the liver?")
- **Hard:** multi-concept integration from passage data ("Given the kinetic data in Figure 1, identify the inhibitor type and predict the effect on Vmax")

Avoid questions where difficulty comes from needing an obscure fact. Difficulty should come from reasoning complexity, not trivia depth.

---

## Section C: Lessons

Lessons are the one content type where conceptual depth can expand beyond the flashcard or question standard. A lesson should *build the mental model* that makes flashcards and questions answerable by reasoning, not memorization.

### Right depth for lessons

**Include:**
- The underlying *why* of a concept ("Why does competitive inhibition raise apparent Km? Because the inhibitor occupies the active site, so more substrate is needed to out-compete it and reach ½ Vmax.")
- Comparative frameworks ("NADH vs. FADH₂: NADH enters at Complex I, FADH₂ at Complex II — that's why NADH yields more ATP per molecule")
- Approximate ranges with explicit "why this range matters" ("Histidine's pKa is ~6 — close enough to physiological pH 7.4 that small pH shifts can flip it between charged and uncharged; that's what makes it a biological buffer")
- Pathway logic and regulation ("PFK-1 is the rate-limiting step of glycolysis because it's irreversible, is allosterically regulated, and is where the cell commits glucose to glycolysis")
- Clinical connections at the conceptual level ("G6PD deficiency impairs the pentose phosphate pathway → less NADPH → less glutathione → oxidative stress lyses RBCs")

**Exclude from lessons:**
- Exact pKa tables for all 20 amino acids (ranges and the key ionizable subset only)
- All 10 glycolytic enzyme names and all 8 Krebs cycle enzyme names (rate-limiting + regulatory only)
- Multi-step reaction mechanisms for non-MCAT reactions
- Research-level kinetic detail (Hill coefficients, specific turnover numbers, detailed allostery math)

### Lessons vs. flashcards: depth boundary

| Content | Lesson | Flashcard |
|---------|--------|-----------|
| Histidine pKa | "~6, close to physiological pH, making it a buffer residue; explained with Henderson-Hasselbalch logic" | "Why can His buffer at physiological pH? → pKa near 6, straddles pH 7.4" |
| Km meaning | Full explanation: substrate concentration at ½ Vmax, lower Km = higher affinity, analogy to affinity | "Lower Km → higher enzyme-substrate affinity" |
| Competitive inhibition | How it works mechanistically, why Km appears to change but Vmax doesn't, Lineweaver-Burk visual | "Competitive inhibitor: Km↑, Vmax unchanged" |
| Cysteine reactivity | Why thiol is ionizable near pH 7, thiolate as nucleophile, disulfide bonding, role in redox | "Cys thiol: ionizable near pH 7, forms disulfide bonds, acts as nucleophile" |

Lessons build the model. Flashcards test whether the key takeaway stuck.

---

## Numeric Value Decision Tree

Use this to decide whether to include a specific number in any content type:

```
Is this a universal physical constant (speed of light, Avogadro's, Planck's)?
  → YES: Include exact value. (These don't change and appear on reference sheets.)

Is this a round, comparative number where the comparison is the whole point?
  → YES: Include it. (NADH = 2.5 ATP, FADH₂ = 1.5 ATP — comparison IS the concept.)
  → NO: Continue.

Would a student need to recall this exact decimal to answer an MCAT question?
  → NO (the exam provides values in passages, or tests the concept not the number): Exclude.
  → MAYBE: Check — does the AAMC official content outline or a released MCAT question test it?
      → Confirmed tested: Include as a range or approximation, not a precise decimal.
      → Not confirmed: Exclude.

Is the number's significance conceptual or rote?
  → Conceptual (e.g., "pKa near 6 explains histidine's buffering role"): State as range, explain why the range matters.
  → Rote (e.g., "pKa = 8.3 for cysteine"): Exclude.
```

---

## High-Yield vs. Low-Yield Content Reference

### Always high-yield (include at MCAT depth)

- 7 ionizable amino acids and which are acidic vs. basic (not their exact pKas)
- Competitive / noncompetitive / uncompetitive inhibition effects on Km and Vmax
- PFK-1 as rate-limiting step of glycolysis, its regulators (ATP/citrate → inhibit; AMP/ADP → activate)
- Compartment locations of all major metabolic pathways
- Shuttle systems affecting mitochondrial NADH entry (malate-aspartate vs. glycerol-3-phosphate)
- Hexokinase vs. glucokinase Km difference and functional consequence
- Michaelis-Menten curve shape; what ½ Vmax defines
- Glycolysis net formula (glucose → 2 pyruvate + 2 ATP + 2 NADH)
- SN1 vs. SN2: primary/secondary/tertiary carbon, nucleophile strength, solvent effects
- E1 vs. E2: temperature, base strength, Zaitsev's rule
- MHC-I vs. MHC-II, CD8+ vs. CD4+ T cells
- Blood pathway (all chambers, valves, vessel types) — the full sequence is MCAT-tested

### Lower priority (concept only, skip exact detail)

- Exact pKa values for individual amino acid side chains beyond "acidic pKa << 7 → deprotonated at pH 7.4" and "basic pKa >> 7 → protonated at pH 7.4" and "His pKa ≈ 6 → buffers near pH 7"
- All 10 glycolytic enzyme names (only rate-limiting PFK-1 and the regulatory enzymes hexokinase/pyruvate kinase)
- All 8 Krebs cycle enzyme names (only isocitrate dehydrogenase as rate-limiting)
- Exact Ki values for any inhibitor
- Step-by-step beta-oxidation intermediates
- Individual reaction ΔG° values in metabolic pathways
- Bone and tissue anatomy beyond functional level

---

## Summary

### The core depth principle

**Test whether a student understands, not whether they memorized.** A student who can explain *why* cysteine is reactive at physiological pH knows more MCAT-relevant biochemistry than a student who memorized pKa = 8.3. Write content that trains the former.

### Per content type

| Type | Depth target | Numeric values | Phrasing |
|------|-------------|----------------|----------|
| **Flashcard** | One discrete fact, association, or directional rule | Ranges + comparisons only; no decimals for biochemical constants | Functional cues: "What does X do?" "What happens to Y when Z?" |
| **Question** | Two-step reasoning from concept to conclusion | Provide in stem if needed; never require recall of a decimal | Application, comparison, clinical connection; vary difficulty via reasoning complexity |
| **Lesson** | Full conceptual model with mechanism and analogy | Include approximate ranges with explanation of *why the range matters* | Teach the why; give students the framework that makes flashcards and questions answerable |

### The 10 most important rules

1. **Never test recall of a decimal pKa for an amino acid side chain.** State ionizability and direction (acidic/basic) instead.
2. **Histidine's pKa is the one exception** — but test the *concept* ("buffers near physiological pH") not the number.
3. **Enzyme kinetics = qualitative direction only.** Competitive: Km↑, Vmax unchanged. Noncompetitive: Vmax↓, Km unchanged. Uncompetitive: both↓. No Ki values, no specific Km numbers.
4. **NADH = 2.5 ATP, FADH₂ = 1.5 ATP** — keep these, the comparison between them is the point.
5. **Compartment locations are required and specific.** Students must know what happens where (cytoplasm vs. mitochondrial matrix vs. ER).
6. **If a question needs a number, supply it in the stem.** Never require recall of a biochemical constant to solve a question — the AAMC provides values in passages.
7. **Rate-limiting enzymes and their regulators are high-yield.** PFK-1 (glycolysis), isocitrate dehydrogenase (Krebs), glucose-6-phosphate dehydrogenase (PPP) — know the name, the regulator, the consequence.
8. **Flashcard fronts should ask about function or consequence**, not "what is the definition of X."
9. **Lessons can go deeper, but must emphasize the conceptual takeaway** — the reasoning principle a student needs to answer a question, not a list of facts.
10. **When in doubt, ask: would a wrong-answer choice on a real MCAT question require this fact?** If no, it's too deep.
