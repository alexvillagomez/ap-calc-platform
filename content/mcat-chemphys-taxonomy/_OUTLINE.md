# MCAT Chemistry / Physics — Verbatim AAMC Content Outline (ground truth)

Transcribed from the AAMC "What's on the MCAT Exam?" (2020) **Chemical and Physical Foundations of Biological Systems** section, Foundational Concepts 4 & 5, content categories **4A–5E** (PDF pp. 58–74). Indentation = AAMC **Topic** → **Subtopic** → sub-subtopic. Course tags: **PHY** = intro physics, **GC** = general chemistry, **OC** = organic chemistry, **BC** = first-semester biochemistry, **BIO** = intro biology.

This section is built as **TWO platform sections**, by discipline:
- **`physics`** (keyword id prefix `ph_`) — categories **P1–P11**.
- **`chemistry`** (keyword id prefix `ch_`) — categories **C1–C13**.

AAMC content categories are NOT 1:1 with platform categories (e.g. 4A becomes four physics categories; 4E splits across physics & chemistry; the gas laws from 4B go to chemistry). Each platform category below lists its **verbatim AAMC subtopics** (regrouped from the 4A–5E tables) plus a **BOUNDARY** note. **Build only the category matching YOUR code.**

> **Depth reminder:** these are quantitative categories — **formulas are in scope** (see `_SPEC.md`). Put the core relation in the description/examples as `$...$` KaTeX. Keep universal constants; provide problem-specific numbers in stems, not in keywords; the **periodic table is provided on the exam** (test trends/skills, not memorization).

---

## GLOBAL cross-section coordination (do NOT duplicate — applies to every category)

The **Biology** section (`mcat_biology_*`, FC 1–3) already owns all biomolecule **biology**, physiology, and metabolism. Specifically, do NOT recreate, in any chem/phys category:
- **Protein/enzyme biology** — protein 3-D structure (secondary/tertiary/quaternary), conformational stability, denaturation/folding, nonenzymatic protein function, **enzyme catalysis, enzyme kinetics, Michaelis–Menten, competitive/noncompetitive inhibition, allosteric/covalent regulation**. (Biology owns enzymes.)
- **Bioenergetics / metabolism** — ATP/ΔG of hydrolysis as metabolism, electron carriers (NAD⁺/FAD), flavoproteins, biological oxidation-reduction as metabolism, fuel molecules. (Biology owns bioenergetics.)
- **Biomolecule biology** — the biological roles/function of carbohydrates, lipids, nucleic acids, amino acids/proteins. The **organic-chemistry angle** (functional groups, nomenclature, isomerism, stereochemistry, organic reactions/mechanisms) lives in the orgo categories C11/C12; the biology does not.
- **Organ biology** — circulatory/respiratory vessels & gas-exchange organs (Fluids P5 builds only the fluid physics); nerve-cell biology (myelin, nodes of Ranvier — Circuits P10 builds only circuit physics).

The chem/phys categories own: physics (mechanics, fluids, thermo/heat, waves/sound, optics, E&M, circuits, atomic/nuclear) and chemistry (atomic structure, bonding, IMFs, stoichiometry, gases/solutions, acids/bases, thermodynamics, kinetics, equilibrium, electrochemistry, organic chemistry, separations/spectroscopy).

---

# PHYSICS  (section = `physics`, id prefix `ph_`)

## P1 · Kinematics & Translational Motion  (order_index 0)
Source: 4A **Translational Motion (PHY)**.

- **Translational Motion (PHY)**
  - Units and dimensions
  - Vectors, components
  - Vector addition
  - Speed, velocity (average and instantaneous)
  - Acceleration

Build also (closely-related, intro-physics standard within scope): scalars vs. vectors; displacement vs. distance; the constant-acceleration kinematic equations; free fall under gravity ($g \approx 9.8\,\text{m/s}^2$); projectile motion (independent x/y); reading position–time and velocity–time graphs (slope/area).

> **BOUNDARY:** Force concepts (Newton's laws, friction) → **P2**. Vector analysis of forces in equilibrium and torque → **P3**. Work/energy → **P4**.

## P2 · Forces & Newton's Laws  (order_index 1)
Source: 4A **Force (PHY)** (excluding center of mass → P3).

- **Force (PHY)**
  - Newton's First Law, inertia
  - Newton's Second Law ($F = ma$)
  - Newton's Third Law, forces equal and opposite
  - Friction, static and kinetic
  - Center of mass  *(→ built in **P3**, see boundary)*

Build also (closely-related, within scope): free-body diagrams; mass vs. weight ($W = mg$); normal force; tension; Newton's law of universal gravitation ($F = G\frac{m_1 m_2}{r^2}$); uniform circular motion & centripetal force ($F_c = \frac{mv^2}{r}$); applications on inclines.

> **BOUNDARY:** **Center of mass**, torque, and static-equilibrium force balance → **P3**. Work/energy/power → **P4**. Kinematics (velocity/acceleration) → **P1**.

## P3 · Equilibrium, Torque & Center of Mass  (order_index 2)
Source: 4A **Equilibrium (PHY)** + center of mass (from 4A Force).

- **Equilibrium (PHY)**
  - Vector analysis of forces acting on a point object  *(translational equilibrium, $\sum F = 0$)*
  - Torques, lever arms  *(rotational equilibrium, $\sum \tau = 0$)*
- **(from Force, PHY)** Center of mass

Build also (within scope): first and second conditions of equilibrium; torque $\tau = rF\sin\theta$; stable vs. unstable equilibrium; locating the center of mass / center of gravity of simple systems.

> **BOUNDARY:** Newton's laws & friction → **P2**. Mechanical advantage of simple machines and all work/energy → **P4**.

## P4 · Work, Energy & Power  (order_index 3)
Source: 4A **Work (PHY)** + **Energy of Point Object Systems (PHY)**.

- **Work (PHY)**
  - Work done by a constant force: $W = Fd\cos\theta$
  - Mechanical advantage
  - Work–Kinetic Energy Theorem
  - Conservative forces
- **Energy of Point Object Systems (PHY)**
  - Kinetic Energy: $KE = \tfrac{1}{2}mv^2$; units
  - Potential Energy
    - $PE = mgh$ (gravitational, local)
    - $PE = \tfrac{1}{2}kx^2$ (spring)
  - Conservation of energy
  - Power, units

> **BOUNDARY:** Forces → **P2**; torque/equilibrium → **P3**; spring oscillation/SHM dynamics → **P7** (periodic motion). Here = work, energy forms, conservation, mechanical advantage, power.

## P5 · Fluids  (order_index 4)
Source: 4B **Fluids (PHY)** (the fluid physics only).

- **Fluids (PHY)**
  - Density, specific gravity
  - Buoyancy, Archimedes' Principle
  - Hydrostatic pressure
    - Pascal's Law
    - Hydrostatic pressure; $P = \rho g h$ (pressure vs. depth)
  - Viscosity: Poiseuille Flow
  - Continuity equation ($A\cdot v = \text{constant}$)
  - Concept of turbulence at high velocities
  - Surface tension
  - Bernoulli's equation
  - Venturi effect, pitot tube

> **BOUNDARY:** The 4B **Circulatory System (BIO)** subtopic ("Arterial and venous systems; pressure and flow characteristics") is **organ biology — Biology owns it**; build only fluid physics applied to flow. The 4B **Gas Phase (GC, PHY)** gas laws / KMT / ideal & real gases → **C5** (chemistry). Thermodynamics/heat → **P6**.

## P6 · Thermodynamics & Heat  (order_index 5)
Source: 5E **Energy Changes in Chemical Reactions — Thermochemistry, Thermodynamics (GC, PHY)** — the **physics treatment** (heat, temperature, the laws, PV work, heat transfer, calorimetry, phase changes, engines).

- **Energy Changes — Thermodynamics (PHY portions)**
  - Thermodynamic system – state function
  - Zeroth Law – concept of temperature
  - First Law – conservation of energy in thermodynamic processes
  - PV diagram: work done = area under or enclosed by curve (PHY)
  - Second Law – concept of entropy (entropy as a measure of "disorder"; relative entropy for gas, liquid, and crystal states)
  - Measurement of heat changes (calorimetry), heat capacity, specific heat
  - Heat transfer – conduction, convection, radiation (PHY)
  - Coefficient of expansion (PHY)
  - Heat of fusion, heat of vaporization  *(latent heat, $Q = mL$)*
  - Phase diagram: pressure and temperature

Build also (within scope): $Q = mc\Delta T$ calorimetry; thermodynamic processes (isothermal, adiabatic, isobaric, isochoric); heat engines & efficiency (Carnot, conceptual); thermal equilibrium / direction of heat flow.

> **BOUNDARY:** The **chemical** thermodynamics — enthalpy of reaction/formation $\Delta H$, entropy change of a reaction $\Delta S$, Hess's law, bond-dissociation energies, free energy $\Delta G$, spontaneity $\Delta G^\circ$ — → **C7** (chemistry). Intermolecular forces & states of matter (qualitative) → **C3**. Here = the physics of heat & the laws of thermodynamics.

## P7 · Periodic Motion, Waves & Sound  (order_index 6)
Source: 4A **Periodic Motion (PHY)** + 4D **Sound (PHY)**.

- **Periodic Motion (PHY)**
  - Amplitude, frequency, phase
  - Transverse and longitudinal waves: wavelength and propagation speed
- **Sound (PHY)**
  - Production of sound
  - Relative speed of sound in solids, liquids, and gases
  - Intensity of sound, decibel units, log scale
  - Attenuation (damping)
  - Doppler Effect: moving sound source or observer, reflection of sound from a moving object
  - Pitch
  - Resonance in pipes and strings
  - Ultrasound
  - Shock waves

Build also (within scope): simple harmonic motion (mass–spring, simple pendulum), period/frequency, the wave relation $v = f\lambda$, superposition & interference, standing waves & harmonics, beats.

> **BOUNDARY:** Light / electromagnetic waves & geometrical optics → **P8**. Spring potential energy → **P4**.

## P8 · Light & Geometrical Optics  (order_index 7)
Source: 4D **Light, Electromagnetic Radiation (PHY)** + **Geometrical Optics (PHY)**.

- **Light, Electromagnetic Radiation (PHY)**
  - Concept of Interference; Young's double-slit experiment
  - Thin films, diffraction grating, single-slit diffraction
  - Other diffraction phenomena, X-ray diffraction
  - Polarization of light: linear and circular
  - Properties of electromagnetic radiation
    - Velocity equals constant $c$, in vacuo
    - EM radiation consists of perpendicularly oscillating electric and magnetic fields; direction of propagation is perpendicular to both
  - Classification of electromagnetic spectrum, photon energy $E = hf$
  - Visual spectrum, color
- **Geometrical Optics (PHY)**
  - Reflection from plane surface: angle of incidence equals angle of reflection
  - Refraction, refractive index $n$; Snell's law: $n_1\sin\theta_1 = n_2\sin\theta_2$
  - Dispersion, change of index of refraction with wavelength
  - Conditions for total internal reflection
  - Spherical mirrors (center of curvature; focal length; real and virtual images)
  - Thin lenses (converging and diverging lenses; $\frac{1}{p} + \frac{1}{q} = \frac{1}{f}$, with sign conventions; lens strength, diopters)
  - Combination of lenses
  - Lens aberration
  - Optical instruments, including the human eye

> **BOUNDARY:** The **chemistry** of absorption spectra — IR, UV-Vis, NMR ("Molecular Structure and Absorption Spectra (OC)") — → **C13**. Photoelectric effect & atomic emission/absorption line spectra (Bohr) → **P11**.

## P9 · Electrostatics & Magnetism  (order_index 8)
Source: 4C **Electrostatics (PHY)** + **Magnetism (PHY)**.

- **Electrostatics (PHY)**
  - Charge, conductors, charge conservation
  - Insulators
  - Coulomb's Law  ($F = k\frac{q_1 q_2}{r^2}$)
  - Electric field $E$ (field lines; field due to a charge distribution)
  - Electrostatic energy, electric potential at a point in space
- **Magnetism (PHY)**
  - Definition of magnetic field $B$
  - Motion of charged particles in magnetic fields; Lorentz force ($F = qvB\sin\theta$)

> **BOUNDARY:** Circuit elements (current, resistance, capacitance, EMF) → **P10**. Electrochemical cells & reduction potentials → **C10** (chemistry).

## P10 · Circuits  (order_index 9)
Source: 4C **Circuit Elements (PHY)**.

- **Circuit Elements (PHY)**
  - Current $I = \Delta Q / \Delta t$, sign conventions, units
  - Electromotive force, voltage
  - Resistance
    - Ohm's Law: $I = V/R$
    - Resistors in series
    - Resistors in parallel
    - Resistivity: $\rho = R\cdot A / L$
  - Capacitance
    - Parallel-plate capacitor
    - Energy of a charged capacitor
    - Capacitors in series
    - Capacitors in parallel
    - Dielectrics
  - Conductivity (metallic; electrolytic)
  - Meters

Build also (within scope): electric power dissipation $P = IV = I^2R$; combining resistors/capacitors; the EMF source / internal resistance concept.

> **BOUNDARY:** Electrostatics/magnetism (fields, charges, forces) → **P9**. The electrochemistry of **batteries** (lead-storage, Ni-Cd, half-cells) → **C10**. Nerve-cell biology (myelin sheath, nodes of Ranvier — 4C "Specialized Cell — Nerve Cell (BIO)") → **Biology**.

## P11 · Atomic & Nuclear Phenomena  (order_index 10)
Source: 4E **Atomic Nucleus (PHY, GC)** + the physics/quantum-emission parts of 4E **Electronic Structure**.

- **Atomic Nucleus (PHY, GC)**
  - Atomic number, atomic weight
  - Neutrons, protons, isotopes
  - Nuclear forces, binding energy
  - Radioactive decay
    - α, β, γ decay
    - Half-life, exponential decay, semi-log plots
  - Mass spectrometer
  - Mass spectroscopy
- **Electronic Structure — physics/quantum parts**
  - Ground state, excited states
  - Absorption and emission line spectra
  - Bohr atom
  - Heisenberg Uncertainty Principle
  - Photoelectric effect

> **BOUNDARY:** Electron configuration / quantum numbers / orbitals / Pauli / paramagnetism–diamagnetism / effective nuclear charge / periodic-table classification & periodic trends → **C1** (chemistry). Here = the nucleus, radioactivity, mass spectrometry, and the quantum/emission physics of the atom.

---

# CHEMISTRY  (section = `chemistry`, id prefix `ch_`)

## C1 · Atomic Structure & Periodic Trends  (order_index 0)
Source: 4E **Electronic Structure** (GC parts) + **The Periodic Table — Classification (GC)** + **— Variations of Chemical Properties (GC)**.

- **Electronic Structure (GC parts)**
  - Orbital structure of the hydrogen atom, principal quantum number $n$, number of electrons per orbital (GC)
  - Use of the Pauli Exclusion Principle
  - Paramagnetism and diamagnetism
  - Conventional notation for electronic structure (GC)  *(electron configuration)*
  - Effective nuclear charge (GC)
- **The Periodic Table — Classification of Elements Into Groups by Electronic Structure (GC)**
  - Alkali metals
  - Alkaline earth metals: their chemical characteristics
  - Halogens: their chemical characteristics
  - Noble gases: their physical and chemical characteristics
  - Transition metals
  - Representative elements
  - Metals and nonmetals
  - Oxygen group
- **The Periodic Table — Variations of Chemical Properties with Group and Row (GC)**
  - Valence electrons
  - First and second ionization energy (definition; prediction from electronic structure for elements in different groups or rows)
  - Electron affinity (definition; variation with group and row)
  - Electronegativity (definition; comparative values for some representative elements and important groups)
  - Electron shells and the sizes of atoms  *(atomic radius trend)*
  - Electron shells and the sizes of ions  *(ionic radius trend)*

Build also (within scope): the four quantum numbers ($n, \ell, m_\ell, m_s$); s/p/d orbital shapes; Aufbau principle & Hund's rule; electron configurations of ions; the relationship of valence configuration to group.

> **BOUNDARY:** Emission/absorption line spectra, Bohr model, photoelectric effect, Heisenberg, the nucleus → **P11**. The periodic table is **provided** on the exam — test trends/skills, not memorized values.

## C2 · Bonding & Molecular Structure  (order_index 1)
Source: 5B **Covalent Bond (GC)** (the bonding/structure parts; stereochemistry of covalent molecules → C11).

- **Covalent Bond (GC)**
  - Lewis electron-dot formulas
    - Resonance structures
    - Formal charge
    - Lewis acids and bases
  - Partial ionic character
    - Role of electronegativity in determining charge distribution
    - Dipole moment
  - σ and π bonds
    - Hybrid orbitals: $sp^3, sp^2, sp$, and respective geometries
    - Valence shell electron pair repulsion (VSEPR) and the prediction of shapes of molecules (e.g., $\text{NH}_3$, $\text{H}_2\text{O}$, $\text{CO}_2$)
    - Structural formulas for molecules involving H, C, N, O, F, S, P, Si, Cl
    - Delocalized electrons and resonance in ions and molecules
  - Multiple bonding
    - Effect on bond length and bond energies
    - Rigidity in molecular structure

Build also (within scope): ionic vs. covalent vs. metallic bonding; the octet rule and exceptions; bond order; bond polarity vs. molecular polarity (net dipole).

> **BOUNDARY:** Stereochemistry of covalently bonded molecules — isomers, R/S, E/Z, optical activity (5B, OC) — → **C11**. Intermolecular forces → **C3**.

## C3 · Intermolecular Forces & Phases  (order_index 2)
Source: 5B **Liquid Phase — Intermolecular Forces (GC)** + states of matter.

- **Liquid Phase — Intermolecular Forces (GC)**
  - Hydrogen bonding
  - Dipole interactions  *(dipole–dipole)*
  - Van der Waals' forces (London dispersion forces)

Build also (within scope): ion–dipole interactions; ranking IMF strength; how IMFs determine physical properties (boiling/melting point, vapor pressure, viscosity, surface tension, "like dissolves like" solubility); the three states of matter and phase-transition terminology (melting, freezing, vaporization, condensation, sublimation, deposition).

> **BOUNDARY:** Covalent bonding & VSEPR shapes → **C2**. **Phase diagrams (P–T), latent heat (heat of fusion/vaporization), calorimetry** → **P6** (physics). Here = the IMFs themselves and their qualitative effect on properties/phases.

## C4 · Stoichiometry & Reaction Types  (order_index 3)
Source: 4E **Stoichiometry (GC)**.

- **Stoichiometry (GC)**
  - Molecular weight
  - Empirical vs. molecular formula
  - Metric units commonly used in the context of chemistry
  - Description of composition by percent mass
  - Mole concept, Avogadro's number $N_A$
  - Definition of density
  - Oxidation number
    - Common oxidizing and reducing agents
    - Disproportionation reactions
  - Description of reactions by chemical equations
    - Conventions for writing chemical equations
    - Balancing equations, including redox equations
    - Limiting reactants
    - Theoretical yields

Build also (within scope): assigning oxidation states (rules); reaction-type classification (combination/synthesis, decomposition, single- & double-displacement, combustion, neutralization, precipitation, redox); mole–mass–particle conversions; stoichiometric (mole-ratio) calculations; percent yield.

> **BOUNDARY:** Electrochemical cells, reduction potentials, Nernst → **C10** (here = oxidation-number bookkeeping & balancing redox equations only). Acid–base reactions → **C6**. Equilibrium/solubility → **C9**. The periodic table is provided.

## C5 · Gases & Solutions  (order_index 4)
Source: 4B **Gas Phase (GC, PHY)** + 5A **Ions in Solutions (GC, BC)** + the solution-composition parts of 5A **Solubility (GC)**.

- **Gas Phase (GC, PHY)**
  - Absolute temperature, K, Kelvin scale
  - Pressure, simple mercury barometer
  - Molar volume at 0°C and 1 atm = 22.4 L/mol
  - Ideal gas
    - Definition
    - Ideal Gas Law: $PV = nRT$
    - Boyle's Law: $PV = \text{constant}$
    - Charles' Law: $V/T = \text{constant}$
    - Avogadro's Law: $V/n = \text{constant}$
  - Kinetic Molecular Theory of Gases
    - Heat capacity at constant volume and at constant pressure (PHY)
    - Boltzmann's Constant (PHY)
  - Deviation of real-gas behavior from the Ideal Gas Law
    - Qualitative
    - Quantitative (Van der Waals' Equation)
  - Partial pressure, mole fraction
  - Dalton's Law relating partial pressure to composition
- **Ions in Solutions (GC, BC)**
  - Anion, cation: common names, formulas, and charges for familiar ions (e.g., $\text{NH}_4^+$ ammonium, $\text{PO}_4^{3-}$ phosphate, $\text{SO}_4^{2-}$ sulfate)
  - Hydration, the hydronium ion
- **Solubility (GC) — solution-composition parts**
  - Units of concentration (e.g., molarity)

Build also (within scope): the combined gas law & Gay-Lussac's law; STP; gas density from $PV=nRT$; Graham's law of effusion; molarity / molality / mole fraction / mass percent; dilution ($M_1V_1 = M_2V_2$); dissolution & solvation; electrolytes (strong/weak/non).

> **BOUNDARY:** Acid–base equilibria, buffers, titration → **C6**. **Solubility-product ($K_{sp}$) equilibria, common-ion effect, complex-ion & pH effects on solubility → C9** (Chemical Equilibrium). KMT physics of heat capacity → keep qualitative here; calorimetry/heat → **P6**.

## C6 · Acids & Bases  (order_index 5)
Source: 5A **Acid-Base Equilibria (GC, BC)** + **Titration (GC)**.

- **Acid-Base Equilibria (GC, BC)**
  - Brønsted-Lowry definition of acid, base
  - Ionization of water
    - $K_w$, its approximate value ($K_w = [\text{H}^+][\text{OH}^-] = 10^{-14}$ at 25°C, 1 atm)
    - Definition of pH: pH of pure water
  - Conjugate acids and bases (e.g., $\text{NH}_4^+$ and $\text{NH}_3$)
  - Strong acids and bases (e.g., nitric, sulfuric)
  - Weak acids and bases (e.g., acetic, benzoic)
    - Dissociation of weak acids and bases with or without added salt
    - Hydrolysis of salts of weak acids or bases
    - Calculation of pH of solutions of salts of weak acids or bases
  - Equilibrium constants $K_a$ and $K_b$: $\text{p}K_a$, $\text{p}K_b$
  - Buffers
    - Definition and concepts (common buffer systems)
    - Influence on titration curves
- **Titration (GC)**
  - Indicators
  - Neutralization
  - Interpretation of the titration curves
  - Redox titration

Build also (within scope): pH/pOH relationship ($\text{pH}+\text{pOH}=14$); calculating pH of strong vs. weak acids/bases; the Henderson–Hasselbalch equation; polyprotic acids; equivalence vs. half-equivalence point (where $\text{pH}=\text{p}K_a$).

> **BOUNDARY:** The **Lewis** acid/base definition is built with Lewis structures in **C2**; here = the Brønsted–Lowry / Arrhenius proton treatment. $K_{sp}$/solubility equilibria → **C9**. The redox bookkeeping behind a redox titration → **C4/C10**; the titration technique/curve is here.

## C7 · Chemical Thermodynamics  (order_index 6)
Source: 5E **Energy Changes in Chemical Reactions — Thermochemistry, Thermodynamics (GC, PHY)** — the **chemistry treatment** ($\Delta H$, $\Delta S$, $\Delta G$, Hess, spontaneity).

- **Energy Changes — Thermochemistry (GC portions)**
  - Endothermic, exothermic reactions (GC)
    - Enthalpy, $H$, and standard heats of reaction and formation
    - Hess' Law of Heat Summation
  - Bond dissociation energy as related to heats of formation (GC)
  - Free energy: $G$ (GC)
  - Spontaneous reactions and $\Delta G^\circ$ (GC)
  - Second Law applied to reactions  *(entropy change of a reaction, $\Delta S$)*

Build also (within scope): $\Delta G = \Delta H - T\Delta S$ and predicting spontaneity (sign of $\Delta G$); standard enthalpy/entropy/free energy of formation; estimating $\Delta H_{rxn}$ from bond energies; how temperature flips spontaneity; the relation $\Delta G^\circ = -RT\ln K$ (the bridge to equilibrium, also in C9).

> **BOUNDARY:** The **physics** of heat — temperature, the laws of thermodynamics framed physically, PV work, heat transfer, calorimetry mechanics, latent heat, phase diagrams, heat engines — → **P6**. Kinetics → **C8**; equilibrium constant math → **C9**. Here = reaction thermochemistry: $\Delta H$, $\Delta S$, $\Delta G$, Hess, bond energies, spontaneity.

## C8 · Chemical Kinetics  (order_index 7)
Source: 5E **Rate Processes in Chemical Reactions — Kinetics and Equilibrium (GC)** — the **kinetics** portion.

- **Rate Processes — Kinetics**
  - Reaction rate
  - Dependence of reaction rate on concentration of reactants
    - Rate law, rate constant
    - Reaction order
  - Rate-determining step
  - Dependence of reaction rate on temperature
    - Activation energy
      - Activated complex or transition state
      - Interpretation of energy profiles showing energies of reactants, products, activation energy, and $\Delta H$ for the reaction
    - Use of the Arrhenius Equation
  - Kinetic control vs. thermodynamic control of a reaction
  - Catalysts

Build also (within scope): determining rate law/order from data; reaction mechanisms (elementary steps, intermediates); how a catalyst lowers $E_a$ without changing $\Delta G$; reading a reaction-energy (coordinate) diagram.

> **BOUNDARY:** **ENZYME kinetics — Michaelis–Menten, competitive/noncompetitive inhibition, enzyme catalysis — is Biology; do NOT build it here.** Equilibrium → **C9**; thermodynamics ($\Delta G$, $\Delta H$) → **C7**.

## C9 · Chemical Equilibrium  (order_index 8)
Source: 5E **Rate Processes — Kinetics and Equilibrium (GC)** (equilibrium portion) + 5A **Solubility (GC)** ($K_{sp}$ equilibria).

- **Rate Processes — Equilibrium**
  - Equilibrium in reversible chemical reactions
    - Law of Mass Action
    - Equilibrium Constant
    - Application of Le Châtelier's Principle
  - Relationship of the equilibrium constant and $\Delta G^\circ$  ($\Delta G^\circ = -RT\ln K$)
- **Solubility (GC) — equilibrium parts**
  - Solubility product constant; the equilibrium expression $K_{sp}$
  - Common-ion effect, its use in laboratory separations
    - Complex ion formation
    - Complex ions and solubility
    - Solubility and pH

Build also (within scope): writing $K_{eq}$ ($K_c$, $K_p$) expressions; the reaction quotient $Q$ vs. $K$ to predict shift direction; molar solubility ↔ $K_{sp}$ calculations.

> **BOUNDARY:** Kinetics (rate law, Arrhenius, catalysts) → **C8**. Thermodynamics ($\Delta G/\Delta H/\Delta S$) → **C7**. Acid-dissociation constants $K_a/K_b$ → **C6** (here = general $K_{eq}$ and the solubility $K_{sp}$).

## C10 · Electrochemistry & Redox  (order_index 9)
Source: 4C **Electrochemistry (GC)**.

- **Electrochemistry (GC)**
  - Electrolytic cell
    - Electrolysis
    - Anode, cathode
    - Electrolyte
    - Faraday's Law relating amount of elements deposited (or gas liberated) at an electrode to current
    - Electron flow; oxidation and reduction at the electrodes
  - Galvanic or Voltaic cells
    - Half-reactions
    - Reduction potentials; cell potential
    - Direction of electron flow
  - Concentration cell
  - Batteries
    - Electromotive force, voltage
    - Lead-storage batteries
    - Nickel-cadmium batteries

Build also (within scope): standard reduction potentials & $E^\circ_{cell} = E^\circ_{cathode} - E^\circ_{anode}$; the Nernst equation $E = E^\circ - \frac{RT}{nF}\ln Q$; relating $\Delta G^\circ = -nFE^\circ$; balancing redox half-reactions; galvanic vs. electrolytic comparison; mnemonics (OIL RIG; "an ox / red cat").

> **BOUNDARY:** The **physics** of electrostatics/circuits (fields, current, resistance, capacitance) → **P9/P10**. Oxidation-number assignment & balancing plain redox equations → **C4**. Here = electrochemical **cells**, potentials, and the electrochemistry of batteries.

## C11 · Organic Chemistry — Structure, Bonding & Stereochemistry  (order_index 10)
Source: 5B **Stereochemistry of covalently bonded molecules (OC)** + the **structure/identification** parts of 5D (organic angle only).

- **Stereochemistry of covalently bonded molecules (OC)** (from 5B)
  - Isomers
    - Structural isomers
    - Stereoisomers (e.g., diastereomers, enantiomers, cis–trans isomers)
    - Conformational isomers
  - Polarization of light, specific rotation  *(optical activity)*
  - Absolute and relative configuration
    - Conventions for writing R and S forms
    - Conventions for writing E and Z forms
- **5D — structure/identification (organic angle only)**
  - Functional-group identification & IUPAC **nomenclature** basics across families (alcohols, aldehydes/ketones, carboxylic acids and derivatives, amines, ethers, phenols, etc. — the "Description: Nomenclature/Physical properties" sub-subtopics)
  - **Amino acids: description (OC, BC)** — absolute configuration at the α position; dipolar ions (zwitterion); classification (acidic/basic; hydrophilic/hydrophobic); isoelectric point (the acid–base/structure concept)
  - **Carbohydrates (OC): Description** — nomenclature & classification, common names; absolute configuration (D/L); cyclic structure and conformations of hexoses; epimers and anomers
  - **Lipids (BC, OC): Description, types** — structural identification of triacylglycerols, free fatty acids, phospholipids/phosphatids, sphingolipids, waxes, fat-soluble vitamins, steroids, prostaglandins
  - **Nucleotides and Nucleic Acids: composition (organic level)** — sugar-phosphate backbone; pyrimidine/purine residues
  - **Polycyclic and Heterocyclic Aromatic Compounds (OC, BC)** — structure/aromaticity of biological aromatic heterocycles

Build also (within scope): chirality & stereocenters; meso compounds; Fischer & Newman projections; hybridization in organic molecules; degrees of unsaturation; aromaticity (Hückel 4n+2) at the recognition level; chair/Newman conformational analysis.

> **BOUNDARY (critical):** **Biology owns** the *biology* of amino acids/proteins/carbs/lipids/nucleic acids — protein secondary/tertiary/quaternary structure, conformational stability, denaturing/folding, nonenzymatic protein function, and all metabolism/enzymes. Build only the **organic structure**: functional groups, nomenclature, isomerism, stereochemistry, chirality. Organic **reactions/mechanisms** → **C12**. Spectroscopy & separations → **C13**.

## C12 · Organic Chemistry — Reactions & Mechanisms  (order_index 11)
Source: the **reaction** parts of 5D (OC), across functional-group families.

- **Amino acids — synthesis (OC)**: Strecker synthesis; Gabriel synthesis
- **Peptides and proteins — reactions**: sulfur linkage for cysteine and cystine (disulfide); peptide-bond (amide) formation; hydrolysis (BC)
- **Carbohydrates — reactions (OC)**: hydrolysis of the glycoside linkage; keto-enol tautomerism of monosaccharides; disaccharides/polysaccharides linkage (BC)
- **Lipids — reactions**: free fatty acids — saponification
- **Aldehydes and Ketones (OC)**
  - Nucleophilic addition reactions at the C=O bond (acetal, hemiacetal; imine, enamine; hydride reagents; cyanohydrin)
  - Oxidation of aldehydes
  - Reactions at adjacent positions — enolate chemistry (keto-enol tautomerism / α-racemization; aldol condensation, retro-aldol; kinetic vs. thermodynamic enolate)
  - General principles (effect of substituents on C=O reactivity; steric hindrance; acidity of α-H; carbanions)
- **Alcohols (OC)**
  - Physical properties (acidity, hydrogen bonding)
  - Reactions: oxidation; substitution reactions ($\text{S}_\text{N}1$ or $\text{S}_\text{N}2$); protection of alcohols; preparation of mesylates and tosylates
- **Carboxylic Acids (OC)**
  - Physical properties (acidity)
  - Carboxyl-group reactions (amides/lactam, esters/lactone, anhydride formation; reduction; decarboxylation); reactions at the 2-position (substitution)
- **Acid Derivatives (Anhydrides, Amides, Esters) (OC)**
  - Reactions: nucleophilic substitution; transesterification; hydrolysis of amides
  - General principles (relative reactivity of acid derivatives; steric effects; electronic effects; strain, e.g., β-lactams)
- **Phenols (OC, BC)**: oxidation and reduction (e.g., hydroquinones, ubiquinones) — biological 2e⁻ redox centers
- **Polycyclic and Heterocyclic Aromatic Compounds (OC, BC)**: reactivity of biological aromatic heterocycles (conceptual)

Build also (within scope): $\text{S}_\text{N}1$ vs. $\text{S}_\text{N}2$ mechanism (rate order, substrate, nucleophile, solvent, stereochemistry); E1 vs. E2 & Zaitsev (closely related); nucleophilic acyl substitution mechanism; common reducing agents ($\text{NaBH}_4$ vs. $\text{LiAlH}_4$); reading organic reaction-energy diagrams.

> **BOUNDARY:** Functional-group identification, nomenclature, isomerism, stereochemistry/chirality → **C11**. Spectroscopy & separations → **C13**. **Enzyme mechanisms & biomolecule biology → Biology.**

## C13 · Separations, Purification & Spectroscopy  (order_index 12)
Source: 5C **Separations and Purifications (OC, BC)** + 4D **Molecular Structure and Absorption Spectra (OC)**.

- **Separations and Purifications (OC, BC)**
  - Extraction: distribution of solute between two immiscible solvents
  - Distillation
  - Chromatography: basic principles involved in the separation process
    - Column chromatography (gas-liquid chromatography; high-pressure liquid chromatography)
    - Paper chromatography
    - Thin-layer chromatography
  - Separation and purification of peptides and proteins (BC)
    - Electrophoresis
    - Quantitative analysis
    - Chromatography (size-exclusion; ion-exchange; affinity)
  - Racemic mixtures, separation of enantiomers (OC)
- **Molecular Structure and Absorption Spectra (OC)** (from 4D)
  - Infrared region (intramolecular vibrations and rotations; recognizing common characteristic group absorptions, fingerprint region)
  - Visible region (GC) (absorption in the visible region gives complementary color, e.g. carotene; effect of structural changes on absorption, e.g. indicators)
  - Ultraviolet region (π-electron and nonbonding electron transitions; conjugated systems)
  - NMR spectroscopy (protons in a magnetic field; equivalent protons; spin-spin splitting)

> **BOUNDARY:** The **physics** of light/optics (interference, diffraction, refraction, lenses, the EM spectrum) → **P8**. **Mass spectrometry** (m/z, the atomic/nuclear tool) → **P11**. Here = separating/purifying mixtures and identifying molecular structure from IR/UV-Vis/NMR spectra.
