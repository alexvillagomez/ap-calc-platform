/**
 * Official AAMC "What's on the MCAT Exam?" content outline (Biological and
 * Biochemical Foundations of Living Systems), keyed by our mcat_category id.
 *
 * Source: AAMC content outline (2020), Foundational Concepts 1–3, content
 * categories 1A–3B. Used to GROUND question/flashcard generation so generated
 * content matches the scope, depth, and canonical topics the real MCAT tests.
 * Course tags from the outline: BIO = intro biology, BC = first-semester
 * biochemistry, GC = general chemistry, OC = organic chemistry.
 */

export interface OutlineEntry {
  /** AAMC content category code, e.g. "1A". */
  code: string;
  /** Content category title. */
  title: string;
  /** One-line scope statement from the AAMC narrative. */
  focus: string;
  /** Canonical AAMC topics/subtopics for this category (verbatim-faithful). */
  topics: string[];
}

export const MCAT_CONTENT_OUTLINE: Record<string, OutlineEntry> = {
  mcat_biology_amino_acids_and_proteins: {
    code: "1A",
    title: "Structure and function of proteins and their constituent amino acids",
    focus:
      "Structural and functional complexity of proteins derived from their amino acids, the covalently bonded sequence, and the 3-D structures proteins adopt in an aqueous environment.",
    topics: [
      "Amino acids — absolute configuration at the α position; amino acids as dipolar ions; classifications (acidic/basic, hydrophobic/hydrophilic)",
      "Amino acid reactions — sulfur linkage for cysteine and cystine; peptide linkage (polypeptides and proteins); hydrolysis",
      "Protein structure — primary, secondary, tertiary (role of proline, cystine, hydrophobic bonding), quaternary structure",
      "Conformational stability — denaturation and folding; hydrophobic interactions; solvation layer (entropy)",
      "Separation techniques — isoelectric point; electrophoresis",
      "Non-enzymatic protein function — binding, immune system, motors",
    ],
  },
  mcat_biology_enzymes_and_protein_function: {
    code: "1A",
    title: "Enzyme structure, function, and control (Structure and function of proteins, 1A)",
    focus:
      "Enzyme catalysis — mechanistic considerations, kinetics, models of enzyme-substrate interaction, and regulation.",
    topics: [
      "Enzyme structure and function — function in catalyzing biological reactions; classification by reaction type; reduction of activation energy; substrates and enzyme specificity",
      "Models — active-site model; induced-fit model",
      "Mechanism of catalysis — cofactors; coenzymes; water-soluble vitamins; effects of local conditions on enzyme activity",
      "Kinetics — general (catalysis); Michaelis–Menten; cooperativity; effects of local conditions",
      "Control of enzyme activity — feedback regulation",
      "Inhibition — competitive, noncompetitive, mixed, uncompetitive (effects on Km and Vmax)",
      "Regulatory enzymes — allosteric enzymes; covalently modified enzymes; zymogen",
    ],
  },
  mcat_biology_nucleic_acids_and_gene_expression: {
    code: "1B",
    title: "Transmission of genetic information from the gene to the protein",
    focus:
      "Molecular mechanisms that transfer sequence-specific biological information between biopolymers, ultimately resulting in protein synthesis.",
    topics: [
      "Nucleic acid structure and function — nucleotides/nucleosides; sugar-phosphate backbone; purine/pyrimidine residues; DNA double helix (Watson–Crick); base-pairing specificity (A-T, G-C); denaturation, reannealing, hybridization",
      "DNA replication — semiconservative mechanism; specific enzymes; origins of replication; replicating the ends of DNA molecules",
      "Repair of DNA — repair during replication; repair of mutations",
      "Genetic code — central dogma (DNA→RNA→protein); triplet code; codon-anticodon; degeneracy and wobble; missense/nonsense codons; initiation/termination; mRNA",
      "Transcription — tRNA and rRNA; mechanism; mRNA processing in eukaryotes (introns, exons); ribozymes, spliceosomes, snRNPs/snRNAs",
      "Translation — roles of mRNA/tRNA/rRNA; ribosome structure; initiation/termination cofactors; post-translational modification",
      "Eukaryotic chromosome organization — chromosomal proteins; single-copy vs repetitive DNA; supercoiling; hetero- vs euchromatin; telomeres, centromeres",
      "Control of gene expression — prokaryotic (operon, Jacob–Monod, repression, positive control); eukaryotic (transcriptional regulation, transcription factors, gene amplification, splicing, chromatin, DNA methylation, noncoding RNAs); cancer as failure of cellular controls (oncogenes, tumor suppressors)",
      "Recombinant DNA and biotechnology — gene cloning; restriction enzymes; DNA libraries; cDNA; hybridization; PCR; gel electrophoresis and Southern blotting; DNA sequencing; analyzing gene expression; stem cells; safety and ethics",
    ],
  },
  mcat_biology_genetics_evolution_and_inheritance: {
    code: "1C",
    title:
      "Transmission of heritable information from generation to generation and the processes that increase genetic diversity",
    focus:
      "Mechanisms that transmit heritable information and the evolutionary processes that generate and act on genetic variation.",
    topics: [
      "Mendelian concepts — phenotype/genotype; gene; locus; allele (single and multiple); homo-/heterozygosity; wild-type; recessiveness; complete dominance; co-dominance; incomplete dominance, leakage, penetrance, expressivity; gene pool",
      "Meiosis and genetic variability — significance of meiosis; meiosis vs mitosis; segregation of genes (independent assortment, linkage, recombination: single/double crossovers, synaptonemal complex, tetrad); sex-linkage; sex determination; cytoplasmic/extranuclear inheritance",
      "Mutation — general concept (error in DNA sequence); types (base substitution, inversion, addition, deletion, translocation, mispairing); advantageous vs deleterious; inborn errors of metabolism; mutagens and carcinogens; genetic drift",
      "Analytic methods — Hardy–Weinberg principle; testcross (parental, F1, F2 generations); gene mapping (crossover frequencies); biometry/statistical methods",
      "Evolution — natural selection (fitness, differential reproduction, group selection, evolutionary success); speciation (polymorphism, adaptation, inbreeding, outbreeding, bottlenecks); evolutionary time and genome change",
    ],
  },
  mcat_biology_bioenergetics_and_metabolism: {
    code: "1D",
    title: "Principles of bioenergetics and fuel molecule metabolism",
    focus:
      "Biomolecules and regulated pathways involved in harvesting chemical energy stored in fuel molecules — the driving force for cellular processes.",
    topics: [
      "Principles of bioenergetics — thermodynamics; free energy/Keq; equilibrium constant and ΔG°; Le Châtelier's principle; endo-/exothermic reactions; spontaneous reactions and ΔG°; phosphoryl group transfers and ATP (ATP hydrolysis ΔG ≪ 0); biological oxidation-reduction (half-reactions, soluble electron carriers, flavoproteins)",
      "Carbohydrates — nomenclature and classification; absolute configuration; cyclic structure and conformations of hexoses; epimers and anomers; hydrolysis of the glycoside linkage; mono-, di-, polysaccharides",
      "Glycolysis, gluconeogenesis, and the pentose phosphate pathway — aerobic glycolysis (substrates/products); feeder pathways (glycogen, starch); fermentation (anaerobic glycolysis); gluconeogenesis; PPP; net molecular and energetic results",
      "Principles of metabolic regulation — regulation of metabolic pathways (dynamic steady state); regulation of glycolysis and gluconeogenesis; glycogen metabolism (allosteric and hormonal control); analysis of metabolic control",
      "Citric acid cycle — acetyl-CoA production; reactions of the cycle (substrates/products); regulation; net results",
      "Metabolism of fatty acids and proteins — fatty acid description; digestion, mobilization, transport of fats; oxidation (saturated/unsaturated); ketone bodies; anabolism of fats; biosynthesis of lipids/polysaccharides; protein metabolism",
      "Oxidative phosphorylation — electron transport chain and ATP synthesis; electron transfer in mitochondria (NADH/NADPH, flavoproteins, cytochromes); ATP synthase and chemiosmotic coupling (proton-motive force); regulation; mitochondria, apoptosis, oxidative stress",
      "Hormonal regulation and integration of metabolism — hormone structure/function; tissue-specific metabolism; hormonal regulation of fuel metabolism; obesity and body mass",
    ],
  },
  mcat_biology_cell_structure_membranes_and_transport: {
    code: "2A",
    title:
      "Assemblies of molecules, cells, and groups of cells within single cellular and multicellular organisms",
    focus:
      "Composition, structure, and function of cell membranes; membrane-bound organelles; cytoskeleton; transport energetics; cell-cell junctions; tissues.",
    topics: [
      "Plasma membrane — general function in containment; composition (phospholipids, steroids, waxes, protein components); fluid mosaic model; membrane dynamics",
      "Solute transport across membranes — thermodynamic considerations; osmosis (osmotic pressure, colligative properties); passive transport; active transport; sodium/potassium pump",
      "Membrane components — channels; membrane potential; membrane receptors; exocytosis and endocytosis; intercellular junctions (gap junctions, tight junctions, desmosomes)",
      "Membrane-bound organelles and eukaryotic cells — defining characteristics; nucleus (compartmentalization, nucleolus, nuclear envelope/pores); mitochondria (ATP production, inner/outer membranes, self-replication); lysosomes; endoplasmic reticulum (rough/smooth); Golgi apparatus; peroxisomes",
      "Cytoskeleton — microfilaments; microtubules; intermediate filaments; cilia and flagella; centrioles, microtubule-organizing centers",
      "Tissues formed from eukaryotic cells — epithelial cells; connective tissue cells",
    ],
  },
  mcat_biology_prokaryotes_viruses_and_biotechnology: {
    code: "2B",
    title: "The structure, growth, physiology, and genetics of prokaryotes and viruses",
    focus:
      "Classification, structure, growth, physiology, and genetics of prokaryotes (and how they differ from eukaryotes) and the structure and life cycles of viruses.",
    topics: [
      "Cell theory — history and development; impact on biology",
      "Classification and structure of prokaryotic cells — prokaryotic domains (Archaea, Bacteria); classification by shape (bacilli, spirilli, cocci); lack of nuclear membrane and typical organelles; cell wall; flagellar propulsion",
      "Growth and physiology of prokaryotic cells — reproduction by fission; genetic adaptability and antibiotic resistance; exponential growth; anaerobic/aerobic variants; parasitic and symbiotic; chemotaxis",
      "Genetics of prokaryotic cells — plasmids, extragenomic DNA; transformation; conjugation; transposons",
      "Virus structure — general characteristics (nucleic acid + protein, enveloped/nonenveloped); lack organelles and nucleus; bacteriophage structure; genomic content (RNA or DNA); size relative to bacteria/eukaryotes",
      "Viral life cycle — self-replication within a host cell; generalized phage/animal virus cycles (attachment, penetration, replication, self-assembly, release); transduction; retrovirus life cycle (integration, reverse transcriptase, HIV); prions and viroids",
    ],
  },
  mcat_biology_cell_cycle_development_and_reproduction: {
    code: "2C",
    title: "Processes of cell division, differentiation, and specialization",
    focus:
      "The cell cycle; causes, genetics, and properties of cancer; meiosis and gametogenesis; and mechanisms governing cell specialization and differentiation.",
    topics: [
      "Mitosis — mitotic process (prophase, metaphase, anaphase, telophase, interphase); mitotic structures (centrioles, asters, spindles; chromatids, centromeres, kinetochores; nuclear membrane breakdown); phases of the cell cycle (G0, G1, S, G2, M); growth arrest; control of cell cycle; loss of cell-cycle control in cancer",
      "Biosignaling — oncogenes, apoptosis",
      "Reproductive system — gametogenesis by meiosis; ovum and sperm (differences in formation/morphology, relative contribution); reproductive sequence (fertilization, implantation, development, birth)",
      "Embryogenesis — stages of early development (fertilization, cleavage, blastula, gastrulation: cell movements, primary germ layers endoderm/mesoderm/ectoderm, neurulation); major structures from germ layers; neural crest; environment-gene interaction",
      "Mechanisms of development — cell specialization (determination, differentiation, tissue types); cell-cell communication; cell migration; pluripotency/stem cells; gene regulation in development; programmed cell death; regenerative capacity; senescence and aging",
    ],
  },
  mcat_biology_nervous_and_endocrine_systems: {
    code: "3A",
    title:
      "Structure and functions of the nervous and endocrine systems and ways these systems coordinate the organ systems",
    focus:
      "Structure, function, and integration of the nervous and endocrine systems, including nerve cells, signaling, and feedback control.",
    topics: [
      "Nervous system structure and function — high-level control/integration; organization of the vertebrate nervous system; sensor and effector neurons; sympathetic and parasympathetic (antagonistic control); reflexes (feedback loop, reflex arc, spinal cord/supraspinal circuits); integration with endocrine system (feedback control)",
      "Nerve cell — cell body, dendrites, axon; myelin sheath, Schwann cells; nodes of Ranvier; synapse and synaptic activity (transmitter molecules); resting potential (electrochemical gradient); action potential (threshold, all-or-none, Na/K pump); excitatory/inhibitory fibers (summation, frequency of firing); glial cells/neuroglia",
      "Biosignaling — gated ion channels (voltage-gated, ligand-gated); receptor enzymes; G-protein-coupled receptors",
      "Endocrine system — hormones and their sources (function, glands, hormone types, neuroendocrinology); mechanisms of hormone action (cellular mechanisms, transport via blood, target-tissue specificity, integration with nervous system, regulation by second messengers)",
    ],
  },
  mcat_biology_organ_systems_and_homeostasis: {
    code: "3B",
    title: "Structure and integrative functions of the main organ systems",
    focus:
      "Structure and function of the major organ systems (respiratory, circulatory, lymphatic, immune, digestive, excretory, reproductive, muscle, skeletal, skin) and their integrated roles in homeostasis.",
    topics: [
      "Respiratory system — gas exchange, thermoregulation; structure of lungs and alveoli; breathing mechanisms (diaphragm, differential pressure, surface tension); particulate filtration; alveolar gas exchange (diffusion, partial pressure, Henry's Law); pH control; regulation by nervous control (CO2 sensitivity)",
      "Circulatory system — four-chambered heart; systolic/diastolic pressure; pulmonary and systemic circulation; arteries/arterioles/veins (structure, pressure, flow); capillary beds (gas/solute/heat exchange, peripheral resistance); composition of blood (plasma, cells, erythrocyte production, plasma volume); coagulation; oxygen transport (hemoglobin, hematocrit, oxygen affinity); CO2 transport; nervous and endocrine control",
      "Lymphatic system — structure; fluid distribution; transport of proteins/glycerides; lymphocyte production; return of materials to blood",
      "Immune system — innate vs adaptive immunity; T- and B-lymphocytes; macrophages/phagocytes; tissues (bone marrow, spleen, thymus, lymph nodes); antigen/antibody; antigen presentation; clonal selection; antibody structure; self vs nonself, autoimmunity; major histocompatibility complex",
      "Digestive system — ingestion (saliva, esophagus); stomach (low pH, gastric juice, enzymes); liver (bile production, blood glucose regulation, detoxification); bile/gallbladder; pancreas (enzymes); small intestine (absorption, villi, enzymes); large intestine (water absorption, bacterial flora); rectum; muscular control (peristalsis); endocrine and enteric nervous control",
      "Excretory system — roles in homeostasis (blood pressure, osmoregulation, acid-base, nitrogenous waste); kidney structure (cortex, medulla); nephron structure (glomerulus, Bowman's capsule, proximal tubule, loop of Henle, distal tubule, collecting duct); urine formation (filtration, secretion/reabsorption, concentration, counter-current multiplier); storage and elimination",
      "Muscle system — functions (support, circulatory assistance, thermoregulation); three muscle types (striated, smooth, cardiac); contraction (T-tubule, contractile apparatus actin/myosin/crossbridges/sliding filament, sarcomeres I/A bands and M/Z lines, troponin/tropomyosin, calcium regulation); fiber type; nervous control (motor neurons, neuromuscular junction)",
      "Skeletal system — functions (rigidity/support, calcium storage, protection); bone types and joints; bone structure (calcium-protein matrix, cellular composition); cartilage; ligaments/tendons; endocrine control",
      "Skin system — structure (layer differentiation, impermeability); homeostasis and osmoregulation; thermoregulation (hair, fat layer, sweat glands)",
      "Reproductive system — male/female structures (gonads, genitalia); hormonal control (sexual development, reproductive cycle, pregnancy/parturition/lactation)",
    ],
  },
};

/**
 * Build a compact grounding block for the generation prompt for a given
 * category. Returns "" when the category is unknown (generation still works).
 */
export function outlineContextForCategory(categoryId: string): string {
  const e = MCAT_CONTENT_OUTLINE[categoryId];
  if (!e) return "";
  return [
    `OFFICIAL AAMC MCAT CONTENT OUTLINE — Content Category ${e.code}: ${e.title}`,
    `Scope: ${e.focus}`,
    `Canonical topics the real MCAT tests for this area:`,
    ...e.topics.map((t) => `  • ${t}`),
  ].join("\n");
}
