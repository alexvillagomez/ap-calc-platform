/**
 * Shared figure-guidance prompt blocks injected into the math + MCAT generators
 * (problem AND quiz-question paths, plus lessons).
 *
 * Figures are emitted as inline viz-tags / markdown inside the SAME text fields the
 * model already writes (stem, solution/explanation, lesson body). The shared
 * content renderer (`MathText`) intercepts them, so a figure renders wherever
 * content renders — problems AND quiz questions — with no per-page wiring.
 *
 * Rendering is fully DETERMINISTIC (KaTeX/mhchem, SmilesDrawer, Mermaid) — there is
 * NO AI image generation. Therefore the model must emit only ACCURATE, VERIFIABLE
 * structures/SMILES/DSL, and must NOT force a figure where plain text suffices.
 */

/** Figures available to MCAT Biology/Biochemistry content. */
export const MCAT_FIGURE_RULE = `FIGURES — render deterministically from the text you emit (no AI images), so emit ONLY content you are CERTAIN is correct (a wrong figure teaches misinformation). MANDATORY on a visual subtopic (omitting it is a DEFECT), never forced onto a conceptual/text one:
  • a specific MOLECULE / functional group → <Molecule smiles="..." caption="name"/>;
  • a REACTION / equilibrium / redox step → an mhchem $\\ce{...}$ equation;
  • a PATHWAY / cascade / regulation loop / cell-cycle flow → a <Mermaid>graph LR; ...</Mermaid> diagram;
  • experimental/kinetics DATA or a comparison → a markdown pipe table.

SYNTAX:
• mhchem: wrap \\ce{...} in $...$. Arrows -> (forward) <=> (equilibrium) ->[catalyst]; charges ^- ^+ ^2+; states (aq),(s). e.g. "$\\ce{CO2 + H2O <=> H2CO3 <=> HCO3^- + H+}$".
• SMILES: renders an accurate skeletal formula with stereochemistry when you write @/@@. Emit the SMILES for THIS content's molecule — never reflexively glycine. For CHIRALITY you MUST show a chiral residue (glycine is the only achiral standard amino acid — never use it for a stereocenter). Amino-acid caption: PLAIN ASCII, name the molecule + the α carbon's four groups, e.g. caption="L-alanine — α carbon bonded to H, NH2, COOH, CH3 → chiral". Standard PubChem SMILES (α carbon = central [C@@H]): glycine "C(C(=O)O)N" (achiral) · L-alanine "C[C@@H](C(=O)O)N" · L-serine "C([C@@H](C(=O)O)N)O" · L-cysteine "C([C@@H](C(=O)O)N)S" · L-valine "CC(C)[C@@H](C(=O)O)N" · L-phenylalanine "c1ccc(cc1)C[C@@H](C(=O)O)N" · L-aspartate "C([C@@H](C(=O)O)N)C(=O)O" · D-glucose "C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O". When unsure of a structure, name it in prose — NEVER guess a SMILES. Put a <Molecule/> tag on its OWN line, never mid-sentence; write no meta-commentary about it.
• Mermaid: short node names; labels/arrows are exactly what you write. e.g. <Mermaid>graph LR; Glucose-->G6P-->F16BP-->Pyruvate</Mermaid>.
• Table: GitHub-style pipes; cells may contain $...$ math.

One figure per item at most (unless inherently about several structures). Plain text-only items remain perfectly valid.`;

/** Figures available to AP Precalc / Calculus AB math content. */
export const MATH_FIGURE_RULE = `FIGURES — render deterministically from the text you emit (no AI images), so emit only mathematically-correct content. MANDATORY when the content is about a function's SHAPE, a transformation, intervals/intercepts, an ASYMPTOTE, end behavior, or a DISCONTINUITY/HOLE/JUMP (omitting it is a DEFECT — never just say "there is a hole/asymptote" with no graph); never add one to purely symbolic work (factoring, simplifying, solving). Kinds:
1. <FunctionGraph equation="x^2-1" rangeX="-3,3" rangeY="-2,8"/> — use * for multiply, ^ for power (2*x not 2x). Mark notable points (filled): points="(2,3);max". Mark HOLES (open circles): graph the SIMPLIFIED curve, hole where undefined — e.g. a removable discontinuity of $f(x)=\\frac{x^2-1}{x-1}$ (simplifies to $x+1$, hole at $x=1$): <FunctionGraph equation="x+1" rangeX="-3,4" rangeY="-2,5" holes="1,2"/>.
2. <SlopeField equation="x*y" rangeX="-3,3" rangeY="-3,3"/> — first-order ODE direction fields.
3. DATA TABLE — GitHub-style pipe table for tabulated data ($x$/$f(x)$, Riemann sums, related-rates givens); cells may contain $...$.
4. CHEMISTRY (rare, applied word problems) — wrap \\ce{...} in $...$, e.g. "$\\ce{2H2 + O2 -> 2H2O}$".

Never force a figure where prose/symbols are clearer; text-only items remain valid.`;

/**
 * LESSON-ONLY figure rule for AP Precalc / Calc AB lessons.
 *
 * Deliberately the OPPOSITE default of the problem/flashcard rule above: a figure
 * is NEVER mandatory and is included ONLY when it makes the ONE idea on this page
 * clearer than words alone could. A decorative "here's the function" graph is a
 * DEFECT. This replaced an old "you MUST include a graph on visual topics" mandate
 * that produced confusing, idea-free parabolas (e.g. on an intro-to-limit page).
 */
export const MATH_LESSON_FIGURE_RULE = `FIGURES IN LESSONS — OPTIONAL, and the default is NO figure.
A figure renders deterministically from a tag you emit (no AI images). Include one ONLY when a picture makes THIS page's single idea clearer than words alone — and then it must be built to SHOW that exact idea, annotated, not a decorative curve. A graph that does not directly illustrate the sentence next to it is a DEFECT; omit it.
• Ask before adding one: "does seeing this make the idea click faster than reading it?" If not, use prose.
• When you DO add a <FunctionGraph .../>, annotate it to show the idea: mark the approached value / notable point with points="x,y;label", and a removable discontinuity with holes="x,y" (graph the simplified curve, open circle at the undefined point). Use * for multiply, ^ for power (2*x, not 2x). Emit the tag inline as PLAIN TEXT — it is NOT bare LaTeX, do not wrap it in $...$.
• A data table (markdown pipe table) is often clearer than a graph for "what value is the function heading toward" — prefer it when you want the student to read a trend in numbers.
• Never add a figure to a purely symbolic/definitional page (factoring, simplifying, notation, applying a rule). Most lesson pages need no figure at all.
A correct, idea-free lesson with NO figure is far better than one padded with a confusing graph.`;

/**
 * LESSON-ONLY figure rule for MCAT Biology lessons. Same philosophy: figures are
 * optional and earn their place by clarifying the ONE idea on the page.
 */
export const MCAT_LESSON_FIGURE_RULE = `FIGURES IN LESSONS — OPTIONAL, default NONE. Include one (a tag you emit, rendered deterministically) ONLY when a picture makes THIS page's single idea clearer than words, and then it must directly illustrate that idea — a figure that doesn't show the exact thing the sentence next to it describes is a DEFECT. Emit only content you are certain is correct: a MOLECULE → <Molecule smiles="..." caption="..."/> (plain-ASCII caption; for chirality a CHIRAL residue, never glycine); a REACTION → mhchem $\\ce{...}$; a PATHWAY/cascade → <Mermaid>graph LR; ...</Mermaid>; comparative DATA → a markdown table. Put the tag on its OWN line, no meta-commentary. A correct figure-free lesson beats one padded with a confusing figure.`;
