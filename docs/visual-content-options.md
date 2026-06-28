# Visual Content Options for Lodera — Diagrams, Chemistry & Graphs

*Exploratory doc — no code changes. Last updated 2026-06-24.*

This document evaluates approaches for adding pictures and diagrams to Lodera learning content (lessons, questions, flashcards) across three domains:

- **Chemistry** — molecular structures, reaction schemes, biochemical pathways (MCAT)
- **Biology** — pathway flowcharts, enzyme cascades, cell diagrams
- **Math / Physics** — function plots, free-body diagrams, slope fields, number lines

---

## Current Rendering Stack (what's already there)

Before evaluating options, it's worth noting what the app already does:

| Capability | Implementation | Where |
|---|---|---|
| Inline math ($...$, $$...$$) | KaTeX via `MathText.tsx` | All content |
| Function plots y=f(x) | `FunctionGraph` (pure SVG, client-side) | Math lessons/questions via `<FunctionGraph equation="..." rangeX="..." rangeY="..."/>` tag in text |
| Slope fields (ODE) | `SlopeField` (pure SVG) | Math content via `<SlopeField .../>` tag |
| ASCII→LaTeX normalization | `lib/scienceNotation.ts` | `H2O→$H_2O$`, `Vmax→$V_{max}$`, `CO2→$CO_2$` |
| Viz-tag embedding | `parseVizSegments` + `MathText` | Generator embeds XML-like tags in text; `MathText` renders them inline |

The **viz-tag pattern** is already established: generators embed `<FunctionGraph equation="x^2" rangeX="-3,3" rangeY="-1,10"/>` directly in lesson/question text, and `MathText` intercepts and renders it as an SVG. This is the natural extension point for any new visual type.

---

## Option 1 — AI Image Generation

**What it is:** Call an image model (DALL·E, Stable Diffusion, Flux, Imagen) to produce a PNG/JPEG of a requested diagram — "draw the electron transport chain", "draw a benzene ring".

**What it looks like in-product:** A generated `<img>` tag stored in Supabase Storage (or an external CDN URL) on the question/lesson row, rendered inline below the text.

### The Big Accuracy Problem

**AI image generation is unreliable for scientific diagrams.** This is not a minor caveat — it is a disqualifying flaw for most chemistry and biology use cases:

- **Molecular structures:** Current image models frequently draw benzene rings with wrong bond counts, attach atoms to the wrong neighbors, or place bond-line notation that is geometrically impossible. Chirality indicators (wedge/dash bonds) are routinely wrong.
- **Chemical equations:** Reaction arrows are decorative at best; stoichiometry and arrow direction cannot be trusted. Subscripts/superscripts on chemical formulas are guessed, not computed.
- **Biology pathways:** Complex multi-step cascades (e.g. glycolysis, electron transport chain) are drawn with components in the wrong order, missing steps, or entirely invented steps that look plausible.
- **MCAT depth:** The MCAT content on Lodera is deliberately precise (exact $K_m$, named enzymes, Lineweaver-Burk intercepts). An image model cannot be constrained to this precision — it hallucinates structures and pathways with high visual confidence and no accuracy signal.

There is currently no reliable way to verify AI image correctness programmatically. A wrong diagram in an MCAT question teaches misinformation at scale.

**When AI images are acceptable:** purely decorative/mood illustrations (a student studying, a lab setting), or very simple symbolic icons (an arrow, a flask icon) where factual accuracy doesn't matter. Do not use them for scientific structures.

| | |
|---|---|
| **Accuracy** | ❌ Unreliable for chemistry/biology; dangerous for MCAT content |
| **Cost** | $0.02–$0.08 per image (DALL·E 3); adds up if generated per-question |
| **Latency** | 5–15 s per image; kills the 0-to-question latency target |
| **Rendering** | Simple `<img>` — no deps |
| **Maintenance** | Images stored in blob storage; regenerating on prompt change is expensive and non-deterministic |
| **Data model** | `figure_url TEXT` column on `math_questions`/`mcat_questions`/lesson tables; separate asset pipeline needed |
| **Verdict** | ❌ Avoid for scientific content. Acceptable only for decorative illustrations. |

---

## Option 2 — mhchem (Chemical Equations via KaTeX)

**What it is:** `mhchem` is a KaTeX/MathJax extension specifically for chemical notation. It handles reaction arrows (`→`, `⇌`, `⇌`), state symbols, charges, isotopes, and reaction conditions — all typeset precisely. It is already available as `katex/contrib/mhchem`.

**What it looks like in-product:**

```
\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}
\ce{ATP ->[ATPase] ADP + P_i}
\ce{CO2 + H2O <=> H2CO3 <=> HCO3^- + H+}
```

Renders as beautifully typeset chemical equations with proper arrows, subscripts, superscripts, equilibrium arrows, and conditions above arrows — identical to textbook notation.

**Integration effort:** Low. Add `import 'katex/contrib/mhchem'` to the KaTeX setup in `MathText.tsx`, then treat `\ce{...}` blocks the same as existing `$...$` LaTeX. Generators can be prompted to emit `$\ce{...}$` for any chemical equation.

**What it does NOT do:** 2D structural diagrams (no benzene ring, no skeletal formula, no Newman projection). It handles the symbolic/equation layer only — think of it as LaTeX for reaction equations, not for molecular pictures.

| | |
|---|---|
| **Accuracy** | ✅ Fully deterministic — same as LaTeX math |
| **Cost** | Free (client-side rendering, no API call) |
| **Latency** | Zero (renders synchronously with the rest of MathText) |
| **Rendering** | KaTeX — same visual quality as existing math; no new deps beyond `katex/contrib/mhchem` |
| **Maintenance** | Stored as text (`\ce{...}`) in the question/lesson string — no asset pipeline |
| **Data model** | No schema change; generators emit `\ce{...}` in the existing text fields |
| **Verdict** | ✅ Highest priority / lowest friction. Enables proper chemical equation rendering immediately. |

---

## Option 3 — SMILES-Based Molecular Structure Rendering

**What it is:** Molecular structures are stored as SMILES strings (e.g., `c1ccccc1` = benzene; `CC(=O)Oc1ccccc1C(=O)O` = aspirin) and rendered client-side into 2D skeletal drawings. SMILES is a chemist-standard string format — a structure's SMILES is a fact, not a generation, so it can be verified against databases.

**Key libraries:**

- **SmilesDrawer** (JS/browser, no server deps) — pure JavaScript SMILES → SVG/Canvas renderer. Small bundle (~150 KB). Actively maintained. Renders skeletal formulas, ring systems, stereo bonds, aromatic rings.
- **RDKit.js** (WebAssembly port of RDKit) — industry-standard chemistry library; much heavier (~8 MB WASM bundle), but can also enumerate stereoisomers, compute properties, validate structures.
- **Ketcher** (open-source, by EPAM) — full interactive structure editor (like ChemDraw); can render read-only. Very heavy (~10 MB) — overkill for display-only use.

**Recommended: SmilesDrawer.** Smallest footprint, sufficient for display, browser-only, no server call.

**What it looks like in-product:** A `<MoleculeStructure smiles="c1ccccc1" width={200} height={150}/>` component, similar to how `<FunctionGraph>` works today. Generators (or a lookup table) emit `<MoleculeStructure smiles="CC(=O)Oc1ccccc1C(=O)O"/>` tags in lesson/question text; `MathText` or a parallel renderer intercepts and renders the 2D structure.

**Accuracy model:**

The SMILES string itself is a verifiable fact — you can look up aspirin's SMILES from PubChem and it will always be `CC(=O)Oc1ccccc1C(=O)O`. The *rendering* of that SMILES into a 2D diagram is deterministic (same input → same picture every time). So accuracy is guaranteed IF the SMILES string is correct. Two sources:

1. **Static lookup table** for the ~200 molecules the MCAT actually tests (amino acids, common lipids, glucose, ATP/ADP, common drugs, neurotransmitters) — copy SMILES from PubChem (free, public domain).
2. **LLM-emit with PubChem verification** — generator emits `smiles: "..."` as a structured field; a post-generation step fetches PubChem by CID to validate. Incorrect SMILES would be rejected.

**Reaction schemes (arrows between structures):** SmilesDrawer renders individual molecules; multi-step reactions with arrows need a second layer. Options: (a) lay out multiple `<MoleculeStructure>` components in a flex row with an SVG arrow between them, (b) use mhchem for the equation part + SmilesDrawer for the structures (complementary, not competing).

| | |
|---|---|
| **Accuracy** | ✅ Deterministic rendering from correct SMILES; SMILES verifiable via PubChem |
| **Cost** | Free client-side; PubChem validation API is free; one-time curation cost for lookup table |
| **Latency** | SmilesDrawer renders synchronously (<5 ms) from the SMILES string stored in the content |
| **Rendering** | SVG (SmilesDrawer output); responsive, theme-able, no raster artifacts |
| **Maintenance** | SMILES strings are stable facts; library updates are routine JS deps |
| **Data model** | SMILES stored as a field in the viz tag: `<MoleculeStructure smiles="..."/>` in lesson/question text, OR as a separate `figure_smiles TEXT` column on `mcat_questions`/lesson tables |
| **Verdict** | ✅ Right approach for MCAT chemistry structures. Medium effort (SmilesDrawer integration + SMILES lookup table for common molecules). |

---

## Option 4 — Mermaid (Flowcharts for Biology Pathways)

**What it is:** Mermaid is a text-based diagramming tool that renders flowcharts, sequence diagrams, and state machines from a simple DSL. It is the standard for pathway diagrams in documentation and well-supported in the browser.

**What it looks like in-product:**

```
graph LR
  Glucose --> G6P --> F6P --> F1_6BP
  F1_6BP --> DHAP & G3P
  G3P --> Pyruvate
```

Renders as a clean left-to-right flowchart of glycolysis (or any pathway). Labels and arrows are precisely what the generator specifies — no hallucination risk because the structure is author-controlled.

**What it handles well:**
- Metabolic pathways (glycolysis, Krebs cycle, etc.)
- Signal transduction cascades (kinase → substrate → transcription factor)
- Cell cycle checkpoints
- Enzyme regulation flowcharts (activator/inhibitor loops)
- Physics decision trees (FBD reasoning, circuit analysis flow)

**What it does NOT handle:** Molecular structures (still need SMILES for those), precise anatomical drawings, or 3D representations.

**Integration:** Dynamic import `mermaid` (lazy-loaded, ~900 KB); render Mermaid DSL strings to SVG on the client. The same viz-tag pattern: generator emits `<Mermaid diagram="graph LR; ..."/>` in lesson text; `MathText` renders it.

**Generator constraint:** The model must emit valid Mermaid DSL. This is achievable — Mermaid's syntax is simple enough for GPT-class models to produce reliably. Verification: render client-side and catch parse errors (Mermaid throws on invalid syntax).

| | |
|---|---|
| **Accuracy** | ✅ Deterministic rendering; accuracy depends on the DSL the generator emits (checkable at render time) |
| **Cost** | Free client-side; no API cost |
| **Latency** | First render requires Mermaid WASM/JS to load (lazy-import amortizes this); subsequent renders fast |
| **Rendering** | SVG via Mermaid; clean, themeable |
| **Maintenance** | Diagrams are stored as DSL strings; editing is trivial |
| **Data model** | Embedded as `<Mermaid diagram="..."/>` tag in lesson/question text |
| **Verdict** | ✅ Strong fit for biology pathway diagrams and multi-step cascades. Medium effort. |

---

## Option 5 — Curated / Static Asset Libraries

**What it is:** License a set of pre-drawn scientific diagrams (e.g., HHMI BioInteractive, OpenStax, WikiMedia Commons CC-BY assets) and index them to keywords. The keyword "Electron Transport Chain" maps to a vetted diagram image.

**What it looks like in-product:** An `<img src="/assets/diagrams/etc.svg">` keyed to a `diagram_id` field on the lesson/question row.

**Pros:**
- Highest accuracy (expert-drawn, reviewed)
- No generation latency
- No hallucination risk
- Can include complex anatomical/cellular diagrams that no programmatic renderer handles

**Cons:**
- **Coverage gap** — licensed sets cover common topics but Lodera's MCAT taxonomy has 741 in-depth keywords; a static set will be sparse and inconsistent
- **Curation labor** — someone must find, license, resize, and tag each asset to the right keywords; ongoing as taxonomy grows
- **License complexity** — CC-BY requires attribution; commercial licenses cost money; HHMI BioInteractive allows educational use but not commercial redistribution
- **No inline integration** — assets live outside the text flow; questions referencing a static diagram must be written around it

**Best use:** A small set of "cornerstone" diagrams (cell membrane, ATP synthase, DNA double helix, amino acid generic structure) that appear in many lessons. Not a scalable solution for the full taxonomy.

| | |
|---|---|
| **Accuracy** | ✅ Expert-drawn |
| **Cost** | Curation time; possible licensing fees |
| **Latency** | None (static) |
| **Rendering** | `<img>` or inline `<svg>` |
| **Maintenance** | High — must curate and update as taxonomy changes |
| **Data model** | `diagram_asset_id TEXT` FK to an assets table, or a `diagram_url TEXT` field |
| **Verdict** | ⚠️ Useful for a curated short-list of cornerstone diagrams. Not a scalable solution. |

---

## Option 6 — Math/Physics Graphs (Already Partially Implemented)

**What it is:** The app already has `FunctionGraph` (y=f(x) plots) and `SlopeField` components, embedded as viz-tags in generator output. This covers most AP Calculus visual needs.

**Gaps to fill:**

- **Parametric curves** — `x(t), y(t)` for motion problems. Could extend `FunctionGraph` with a `parametric` mode.
- **Free-body diagrams** — Physics needs labeled force arrows on a block. Currently not implemented. A deterministic SVG-based `FreeBodDiagram` component taking JSON-specified forces (angle, magnitude, label) would be fully accurate.
- **Number lines** — For precalc interval notation, limit intuition. Simple SVG, trivial to add.
- **Bar/pie charts** — Statistics problems. Could use a lightweight chart component (Recharts already in many Next.js stacks, or a raw SVG chart).
- **Coordinate geometry** — Points, line segments, polygons; `FunctionGraph` handles some of this via the `points` prop but doesn't draw arbitrary shapes.

All of these are pure SVG implementations — deterministic, no deps, no API calls, zero latency, no storage.

| | |
|---|---|
| **Accuracy** | ✅ Deterministic computation |
| **Cost** | Free |
| **Latency** | Zero |
| **Rendering** | SVG inline |
| **Data model** | Viz tags in existing text fields |
| **Verdict** | ✅ Extend the existing pattern. High ROI for math/physics coverage. |

---

## How a "Figure" Attaches to Generated Content

The existing pattern (`<FunctionGraph .../>` embedded in text) is the right model — here's how it generalizes:

**In text fields (lessons, question stems, flashcard backs):**

```
"The Krebs cycle proceeds as follows:

<Mermaid diagram=\"graph LR; Pyruvate-->AcetylCoA; AcetylCoA-->Citrate; ...\" />

Each turn of the cycle produces 3 NADH, 1 FADH2, and 1 GTP."
```

`MathText` (or a parallel content renderer) intercepts any `<VizTag>` and renders the appropriate component. Adding a new diagram type is:
1. Add a new component (e.g., `MoleculeStructure.tsx`)
2. Add its tag to `parseVizSegments.ts`
3. Add a branch in `MathText.tsx`
4. Update generator system prompts to emit the tag

**As a structured field on questions/flashcards:**

For questions where the diagram IS the question (e.g., "what is the molecule shown?"), a separate `figure` field on the row is cleaner:

```json
{
  "figure": {
    "type": "smiles",
    "value": "CC(=O)Oc1ccccc1C(=O)O",
    "caption": "Molecule A"
  }
}
```

Stored as `figure JSONB` on `mcat_questions`. The question renderer checks for `figure` and renders above the stem. This is cleaner than embedding the tag in the stem text when the figure is logically separate.

**Recommendation: use embedded viz-tags for inline figures, and a `figure JSONB` column for "the question is about this diagram" cases.**

---

## Summary and Recommendation

| Approach | Domain | Effort | Recommended |
|---|---|---|---|
| **mhchem** (KaTeX extension) | Chemistry equations, reaction arrows | Low | ✅ Do first |
| **Extend FunctionGraph** (parametric, number line, free-body) | Math/Physics | Low–Medium | ✅ Do alongside |
| **SmilesDrawer** (SMILES → 2D skeletal formula) | Chemistry structures | Medium | ✅ High value for MCAT |
| **Mermaid** (pathway flowcharts) | Biology pathways, cascades | Medium | ✅ High value for MCAT lessons |
| **Curated static assets** | Cornerstone diagrams (cell, DNA, etc.) | Low (small set) | ⚠️ Selective only |
| **AI image generation** | Decorative illustrations ONLY | Low | ❌ Never for scientific content |

### Recommended path

**Phase 1 — Zero/Low cost wins:**
1. Add `mhchem` to KaTeX setup — instantly correct chemical equation rendering for any `\ce{...}` blocks. Prompt generators to emit `$\ce{...}$` for all reaction equations.
2. Extend the existing math graph system with parametric curves, number lines, and a simple free-body diagram component (pure SVG). These cover the remaining math/physics gaps at zero extra runtime cost.

**Phase 2 — MCAT structural chemistry:**
3. Integrate **SmilesDrawer** as a `<MoleculeStructure smiles="..."/>` viz-tag component. Curate a SMILES lookup table for the ~100–200 molecules the MCAT tests (amino acids, neurotransmitters, nucleotides, common metabolites, steroids, common drugs). SMILES strings are pulled from PubChem — all free and public domain.
4. Update MCAT lesson/question generators to emit `<MoleculeStructure smiles="..."/>` for any molecular structure. Post-generation validation: re-parse the SMILES client-side; SmilesDrawer will throw on invalid SMILES.

**Phase 3 — Biology pathway diagrams:**
5. Integrate **Mermaid** as a `<Mermaid diagram="..."/>` viz-tag component (lazy-loaded). Update MCAT lesson generators to emit Mermaid DSL for multi-step pathways (glycolysis, Krebs, electron transport, signal cascades). This is the highest-impact upgrade for MCAT lesson richness.

**What to avoid:**
- AI image generation for any scientific content (accuracy is unacceptable for MCAT)
- RDKit.js (overkill; 8 MB WASM bundle for display-only use)
- Ketcher (interactive editor, not needed for read-only display)
- Full static asset library (coverage gap, curation burden; use only for 10–15 cornerstone diagrams if at all)
