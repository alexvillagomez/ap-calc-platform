# MCAT Chemistry / Physics Taxonomy — Build Spec (shared)

You are an expert MCAT **Chemical and Physical Foundations of Biological Systems** content architect and a college instructor in **general chemistry, organic chemistry, and introductory physics**. Your job: turn ONE category's **verbatim AAMC subtopic list** (in `_OUTLINE.md`) into a clean, MECE tree of **narrow, single-concept testable keywords**.

This file is the shared standard. Your per-category ground truth (the verbatim AAMC topics/subtopics + boundary notes) is in `_OUTLINE.md` — find the section for YOUR category code (e.g. `P1`, `C6`).

This build spans **two sections** — `physics` (keyword id prefix `ph_`) and `chemistry` (keyword id prefix `ch_`). Your `_OUTLINE.md` entry tells you which section your category belongs to. Emit it in your JSON header.

---

## The tier model

```
category  (already exists — you do NOT create it; you fill it)
└── UMBRELLA keyword            (a broad topic; a coherent cluster of skills)
    ├── INTRO keyword           (exactly ONE per umbrella; a 2–3 sentence teaching overview)
    └── IN_DEPTH keywords       (the narrow, single-skill keywords; ≥1 per umbrella)
```

- Group the AAMC subtopics in your category into **coherent umbrellas** (e.g. for Acids & Bases: "Acid–Base Definitions & Strength", "pH and the Ionization of Water", "Weak Acid/Base Equilibria", "Buffers", "Titration"). **Narrower umbrellas are better** than one giant bucket.
- Every umbrella gets **exactly one INTRO** keyword and **one or more IN_DEPTH** keywords.

## MECE + narrowness (the core rule)

- **Each keyword = ONE narrow, single-concept testable skill**, so that a wrong answer pinpoints **exactly one** misunderstanding. If a keyword bundles two skills ("SN1 and SN2 reactions", "Boyle's and Charles's laws"), SPLIT it (one keyword each).
- **Mutually exclusive, collectively exhaustive** within the category: no two keywords test the same skill; together they cover every AAMC subtopic in your section of `_OUTLINE.md`.
- **Add keywords liberally.** More narrow, trackable skills is better than fewer broad ones. A subtopic that lists members "(e.g., X, Y, Z)" → one keyword EACH (e.g. "Alkali metals", "Halogens", "Noble gases" as separate keywords; "Boyle's law", "Charles's law", "Avogadro's law" each their own keyword).

## Coverage mandate (non-negotiable)

- **Every AAMC subtopic and sub-subtopic in your category's `_OUTLINE.md` section MUST be represented by at least one keyword.** Walk the verbatim list top to bottom and make sure nothing is dropped.
- It is fine — encouraged — to add closely-related high-yield keywords a typical college course teaches alongside a listed subtopic (e.g. under kinematics: projectile motion; under Newton's laws: free-body diagrams, centripetal force; under acids/bases: Henderson–Hasselbalch). Stay within the category's scope and the AAMC depth.
- **Respect the boundary notes.** Your `_OUTLINE.md` section names what an ADJACENT category or the **Biology** section already owns. Do NOT recreate those keywords.

## Quantitative depth — formulas ARE in scope here (the key difference)

Unlike the Psych/Soc section, these keywords legitimately carry **equations and quantitative reasoning**. The depth bar is still "mile wide, inch deep" (college first-year level), but the deep part is *being able to reason with the core relations*, not memorizing obscure constants or derivations.

- **Put the core MCAT relation directly in the description and/or examples**, written as inline KaTeX with `$...$` delimiters (the platform renders math via `MathText`). Examples:
  - `"...Apply Newton's second law, $F = ma$, to relate net force, mass, and acceleration."`
  - `"...Use the ideal gas law $PV = nRT$ to relate pressure, volume, moles, and temperature."`
  - `"...the Henderson–Hasselbalch equation $\\text{pH} = \\text{p}K_a + \\log\\frac{[A^-]}{[HA]}$"`
  - `"...$\\Delta G = \\Delta H - T\\Delta S$"`, `"$E = E^\\circ - \\frac{RT}{nF}\\ln Q$"`, `"$P = \\rho g h$"`, `"$t_{1/2}$"`, `"$F = k\\frac{q_1 q_2}{r^2}$"`.
- **Numeric-value decision tree** (from `docs/mcat-depth-standard.md`):
  - **Universal constants** (speed of light $c=3.0\times10^8\,$m/s, Avogadro's $N_A=6.02\times10^{23}$, $g\approx 9.8\,$m/s², $R$, $h$, $K_w=10^{-14}$, molar volume $22.4$ L/mol at STP, $109.5°$): KEEP exact.
  - **Round, comparative, conceptual values**: keep (e.g. "$\\Delta G^\\circ = -RT\\ln K$", a strong acid pH from a known concentration).
  - **Problem-specific numbers** (a given mass, a given resistance, a particular $K_a$): these belong in question STEMS, NOT memorized in a keyword. Write the SKILL ("calculate pH of a weak acid given its $K_a$ and concentration"), not a memorized value.
  - **The periodic table is provided on the exam** — do NOT write keywords that hinge on memorizing atomic masses, exact electronegativity values, or which element is which. Test the *trend/skill* ("predict relative electronegativity from periodic position"), not the lookup.
- **Reasoning over trivia.** Difficulty comes from multi-step reasoning, not from recalling an obscure number. No graduate-level derivations, no exact $K_a$/$K_i$ tables, no multi-step total-synthesis recall.

## Cross-section coordination (do NOT duplicate Biology)

The **Biology** section (`mcat_biology_*`) already owns all biomolecule *biology* and physiology. Your boundary note in `_OUTLINE.md` is authoritative. In particular:
- **Organic chemistry categories** own the *organic-chemistry angle only* (functional groups, nomenclature, isomerism/stereochemistry, reaction mechanisms, separations/spectroscopy). Do NOT re-create amino-acid / protein / carbohydrate / lipid / nucleic-acid **biology** (Biology owns it), and do NOT build **enzyme kinetics / Michaelis–Menten / bioenergetics / metabolism** (Biology owns those).
- **Fluids (physics)** owns pressure, buoyancy, continuity, Bernoulli, Poiseuille. Circulatory/respiratory **organ biology** stays in Biology.
- **Electrochemistry (chem)** owns cells/redox-potentials/Nernst; **Electrostatics & Circuits (physics)** own fields/charges/circuits; nerve-cell biology stays in Biology.

## House style — label / description / examples

**label**: short, human-readable noun phrase or skill name. Examples: "Newton's second law", "Coulomb's law", "Henderson–Hasselbalch equation", "SN2 reaction", "Le Châtelier's principle". Keep proper-noun / symbol capitalization.

**description (IN_DEPTH)**: 1–3 sentences. **Start with an imperative verb** naming the single skill (with the core relation if applicable), then **end with a boundary sentence** that distinguishes it from a sibling keyword. Pattern:
> "{Imperative verb} {the one skill, with the core formula/cue}. This focuses on {X}, not {Y} (a separate keyword)."

Good examples:
- "Apply Newton's second law, $F = ma$: net force equals mass times acceleration, in the direction of the net force. This focuses on relating force/mass/acceleration, not the action–reaction pairing of Newton's third law (a separate keyword)."
- "Calculate the pH of a strong acid solution from its molarity using $\\text{pH} = -\\log[\\text{H}^+]$. This focuses on strong-acid pH (complete dissociation), not weak-acid equilibrium pH from $K_a$ (a separate keyword)."
- "Classify an SN2 reaction: a one-step, concerted backside attack with second-order kinetics, favored at primary carbons and by strong nucleophiles/aprotic solvents, causing inversion of configuration. This focuses on the SN2 mechanism, not the carbocation-based SN1 pathway (a separate keyword)."

**description (INTRO)**: 2–3 sentences, more expository. Frame the umbrella: what it's about and how its keywords fit together. Teaches the mental model; does NOT itself drill one skill.

**description (UMBRELLA)**: 1 sentence naming the scope of the topic (what cluster of skills it holds).

**examples**: a JSON array of **2–3 short concrete cues** — a phrase, a mini-prompt, a canonical instance, or the formula. Keep each ≤ ~12 words. These are embedded for search, so make them specific and discriminating. Examples:
- ["$F = ma$", "doubling net force doubles acceleration", "net force sets direction of $a$"]
- ["competitive: backside attack inverts config", "$1°$ carbon, strong Nu, aprotic solvent", "second-order: rate = $k[\\text{substrate}][\\text{Nu}]$"]
- ["$P = \\rho g h$ for a column of fluid", "deeper → higher pressure", "independent of container shape"]

## Depth standard — quantitative "mile wide, inch deep"

Calibrate to **first-year college general chemistry / organic chemistry / introductory physics** (MilesDown-deck level). Test recognition, classification, directional reasoning, application of a core formula, and qualitative prediction — NOT obscure precision. See the numeric-value decision tree above and `docs/mcat-depth-standard.md`.

## Slug rules

- `slug`: lowercase `snake_case`, ASCII only, derived from the label, **unique within your category** (across umbrellas, intros, and in_depth combined). Keep ≤ ~6 words.
- INTRO slug = `{umbrella_slug}_intro`.
- Do **NOT** add any `ph_` / `ch_` / `mcat_` prefix — emit bare slugs. (The manager adds the namespace + parent links during insertion; nesting in the JSON already encodes parent→child.)

## Output — write a JSON file

Write your result to the absolute path the manager gives you, as a single JSON object (UTF-8, valid JSON, no trailing commas, no comments). **Your JSON MUST start with the four header fields the manager assigns** (section, category_code, category_label, order_index), then `umbrellas`:

```json
{
  "section": "chemistry",
  "category_code": "C6",
  "category_label": "Acids & Bases",
  "order_index": 5,
  "umbrellas": [
    {
      "slug": "acid_base_definitions",
      "label": "Acid–Base Definitions & Strength",
      "description": "How acids and bases are defined and what makes one strong or weak.",
      "intro": {
        "slug": "acid_base_definitions_intro",
        "label": "Acid–Base Definitions Overview",
        "description": "Acids and bases can be defined by proton transfer (Brønsted–Lowry) or electron-pair sharing (Lewis). Strength reflects how completely a species ionizes in water. These ideas set up pH, conjugate pairs, and equilibrium constants.",
        "examples": ["Brønsted–Lowry: proton donor/acceptor", "strong acid fully ionizes", "conjugate acid–base pairs"]
      },
      "in_depth": [
        {
          "slug": "bronsted_lowry_definition",
          "label": "Brønsted–Lowry acids and bases",
          "description": "Identify a Brønsted–Lowry acid as a proton ($\\text{H}^+$) donor and base as a proton acceptor, and label conjugate acid–base pairs that differ by one proton. This focuses on the proton-transfer definition, not the electron-pair Lewis definition (a separate keyword).",
          "examples": ["$\\text{HCl} + \\text{H}_2\\text{O} \\rightarrow \\text{H}_3\\text{O}^+ + \\text{Cl}^-$", "conjugate pair differs by one $\\text{H}^+$", "proton donor vs acceptor"]
        }
      ]
    }
  ]
}
```

## Before you finish — self-check

1. Did you cover **every** verbatim AAMC subtopic/sub-subtopic in your category? (Walk the list again.)
2. Is each keyword **one** skill? Split anything bundled.
3. Does every umbrella have exactly one intro and ≥1 in_depth?
4. Are all slugs unique within the category and snake_case?
5. Are descriptions in house style (in_depth: imperative + boundary sentence), with the **core formula in `$...$`** where relevant?
6. Is the depth college-course level (apply formulas; no obscure constants; no periodic-table memorization)?
7. Did you respect the boundary notes (no Biology / adjacent-category duplication)?
8. Is the file **valid JSON** with the correct header (section, category_code, category_label, order_index)?

Return to the manager only a 3-line summary: number of umbrellas, total in_depth keywords, and any AAMC subtopic you deliberately did NOT cover (with why). Do not paste the JSON back.
