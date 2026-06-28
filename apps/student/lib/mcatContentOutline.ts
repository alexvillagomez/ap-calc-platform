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
      "Lipid structure and classification (BIO/BC/OC) — storage (triacylglycerols, free fatty acids/saponification); structural (phospholipids/phosphatids, sphingolipids, waxes); signals/cofactors (steroids/cholesterol, terpenes & terpenoids, fat-soluble vitamins, prostaglandins)",
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
      "Sensory systems — BIOLOGY only (AAMC 6A): sensory receptor types & transduction; eye structure and photoreceptors; ear structure and auditory hair cells; vestibular sense; taste & smell chemoreception; somatosensation/nociception; proprioception. (Perception/psychophysics — thresholds, Weber's law, signal detection — is tested in the Psych/Soc section, out of scope here.)",
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
  mcat_psychsoc_6a_sensing_the_environment: {
    code: "6A",
    title: "Sensing the environment",
    focus:
      "The psychology of sensation and perception — psychophysics, thresholds, signal detection, sensory adaptation, perceptual processing (bottom-up/top-down, parallel processing, feature detection), perceptual organization, and Gestalt principles. Sensory-organ anatomy and receptor/transduction biology are owned by the Biology section; this category covers perception as psychology, not anatomy.",
    topics: [
      "Sensory processing and psychophysics — sensation; absolute and difference thresholds; Weber's Law; signal detection theory (hits, misses, false alarms, criteria); sensory adaptation; subliminal stimuli",
      "Sensory receptors — sensory pathways; types of sensory receptors",
      "Vision processing — visual pathways in the brain; parallel processing; feature detection",
      "Hearing processing — auditory processing and auditory pathways in the brain",
      "Other senses — somatosensation (pain perception); taste; smell (olfactory cells as chemoreceptors; pheromones; olfactory pathways in the brain); kinesthetic sense; vestibular sense",
      "Perception — bottom-up vs top-down processing; perceptual organization (depth, form, motion, constancy); Gestalt principles (figure-ground, proximity, similarity, closure, continuity, common fate)",
    ],
  },
  mcat_psychsoc_6b_making_sense_of_the_environment: {
    code: "6B",
    title: "Making sense of the environment",
    focus:
      "Cognition — attention, cognitive development, problem-solving and decision-making, intelligence, consciousness (states, sleep, drugs), memory (encoding/storage/retrieval/forgetting/synaptic basis), and language.",
    topics: [
      "Attention — selective attention; divided attention",
      "Cognition and cognitive development — information-processing model; Piaget's stages; cognitive changes in late adulthood; role of culture and heredity/environment on cognitive development; biological factors that affect cognition",
      "Problem-solving and decision-making — types of problem-solving; barriers (fixation, functional fixedness, mental set, confirmation bias); approaches (algorithm, heuristic, trial-and-error, insight, intuition); heuristics and biases (availability, representativeness, overconfidence, belief perseverance, framing, anchoring)",
      "Intelligence — theories of intelligence; influence of heredity and environment; variations in intellectual ability",
      "Consciousness — states (alertness, sleep stages/cycles/circadian rhythms/dreaming/sleep-wake disorders, hypnosis and meditation); consciousness-altering drugs (types, effects on nervous system/behavior; drug addiction and the reward pathway)",
      "Memory — encoding (processes that aid encoding); storage (sensory, working, long-term; semantic networks and spreading activation); retrieval (recall, recognition, relearning; retrieval cues; role of emotion; processes that aid retrieval); forgetting (decay, interference, memory construction and source monitoring; aging/Alzheimer's/Korsakoff's); synaptic basis of memory (neural plasticity, long-term potentiation)",
      "Language — theories of language development (learning, nativist, interactionist); influence of language on cognition; brain areas that control language and speech (Broca's area, Wernicke's area)",
    ],
  },
  mcat_psychsoc_6c_responding_to_the_world: {
    code: "6C",
    title: "Responding to the world",
    focus:
      "Emotion and stress — components, theories, biological bases, appraisal, outcomes, and management.",
    topics: [
      "Emotion — three components (cognitive, physiological, behavioral); universal emotions; adaptive role of emotion",
      "Theories of emotion — James-Lange theory; Cannon-Bard theory; Schachter-Singer two-factor theory",
      "Biological bases of emotion — brain regions involved in emotion generation/experience; role of the limbic system; emotion and the autonomic nervous system; physiological markers of emotion",
      "Stress — nature of stress (appraisal: primary vs secondary; types of stressors: cataclysmic events, personal; effects on psychological functions)",
      "Stress outcomes and response — physiological responses (general adaptation syndrome: alarm, resistance, exhaustion); emotional responses; behavioral responses",
      "Managing stress — exercise, relaxation, spirituality, and other coping strategies",
    ],
  },
  mcat_psychsoc_7a_individual_influences_on_behavior: {
    code: "7A",
    title: "Individual influences on behavior",
    focus:
      "Biological bases of behavior (nervous/endocrine systems, behavioral genetics, physiological development), personality theories, psychological disorders, motivation, and attitudes — at the behavioral-neuroscience/intro-psych level.",
    topics: [
      "Biological bases of behavior — neurons and reflex arc (functional level); neurotransmitters and their influence on behavior; peripheral nervous system (somatic vs autonomic; sympathetic vs parasympathetic); CNS organization (brain divisions: forebrain, midbrain, hindbrain; key structures mapped to behavior; lateralization; methods to study the brain: EEG, fMRI, PET, lesion studies; spinal cord); endocrine system components and effects on behavior; behavioral genetics (genes, temperament, heredity; adaptive value; heredity–environment interaction); human physiological development (prenatal, motor, adolescent)",
      "Personality theories — psychoanalytic; humanistic; trait perspective; social cognitive; biological; behaviorist; situational approach",
      "Psychological disorders — understanding disorders (biomedical vs biopsychosocial approaches; classification; rates); types (anxiety disorders, OCD, trauma/stressor-related, somatic symptom, bipolar, depressive disorders, schizophrenia, dissociative disorders, personality disorders); biological bases of nervous system disorders (schizophrenia, depression, Alzheimer's, Parkinson's, stem cell therapy)",
      "Motivation — factors influencing motivation (instinct, arousal, drives, needs); theories (drive reduction, incentive, cognitive, need-based); biological and sociocultural motivators (hunger, sex drive, substance addiction)",
      "Attitudes — components (cognitive, affective, behavioral); link between attitudes and behavior; processes by which behavior influences attitudes (foot-in-the-door, role-playing); processes by which attitudes influence behavior; cognitive dissonance theory",
    ],
  },
  mcat_psychsoc_7b_social_processes_and_behavior: {
    code: "7B",
    title: "Social processes that influence human behavior",
    focus:
      "How the presence of others, group decision-making, social norms and deviance, and socialization shape behavior.",
    topics: [
      "Presence of others and individual behavior — social facilitation; deindividuation; bystander effect; social loafing; social control; peer pressure; conformity (Asch); obedience (Milgram)",
      "Group decision-making — group polarization; groupthink",
      "Normative and nonnormative behavior — social norms (sanctions; folkways, mores, and taboos; anomie); deviance (differential association, labeling theory, strain theory; primary vs secondary deviance); collective behavior (fads, mass hysteria, riots)",
      "Socialization — agents of socialization (family, mass media, peers, workplace)",
    ],
  },
  mcat_psychsoc_7c_attitude_and_behavior_change: {
    code: "7C",
    title: "Attitude and behavior change",
    focus:
      "Learning (habituation, associative, observational) and theories of attitude and behavior change.",
    topics: [
      "Habituation and dishabituation",
      "Classical conditioning — neutral, conditioned, and unconditioned stimuli/responses; processes (acquisition, extinction, spontaneous recovery, generalization, discrimination); role of cognitive processes; biological predispositions and instinctive drift",
      "Operant conditioning — shaping and extinction; types of reinforcement (positive, negative, primary, conditional); reinforcement schedules (fixed-ratio, variable-ratio, fixed-interval, variable-interval); punishment; escape and avoidance learning",
      "Observational learning — modeling; mirror neurons; role of the brain in vicarious emotions; applications to explaining behavior",
      "Theories of attitude and behavior change — elaboration likelihood model (central vs peripheral routes); social cognitive theory; factors that affect attitude change (changing behavior, message/target characteristics, social factors)",
    ],
  },
  mcat_psychsoc_8a_self_identity: {
    code: "8A",
    title: "Self-identity",
    focus:
      "Self-concept, self-identity, social identity, and identity formation — including the roles of self-esteem, self-efficacy, locus of control, social factors, and culture.",
    topics: [
      "Self-concept and self-identity — self-esteem; self-efficacy; locus of control; different types of identities (race/ethnicity, gender, age, sexual orientation, class)",
      "Formation of identity — theories of identity development (gender identity, moral development/Kohlberg, psychosexual stages/Freud, psychosocial stages/Erikson)",
      "Social influences on identity formation — influence of individuals (imitation; looking-glass self/Cooley; role-taking/Mead: the 'I' and the 'me', generalized other); influence of groups (reference group)",
      "Cultural and socialization influences on identity formation",
    ],
  },
  mcat_psychsoc_8b_social_thinking: {
    code: "8B",
    title: "Social thinking",
    focus:
      "Attribution processes, prejudice and bias, and stereotype-related processes.",
    topics: [
      "Attribution — attributional processes (dispositional vs situational attribution; fundamental attribution error; actor-observer bias; self-serving bias; role of culture in attributions); how self-perceptions shape perceptions of others; how perceptions of the environment shape perceptions of others",
      "Prejudice and bias — processes that contribute to prejudice (power, prestige, and class; role of emotion; role of cognition); stereotypes; stigma; ethnocentrism vs cultural relativism",
      "Stereotype processes — self-fulfilling prophecy; stereotype threat",
    ],
  },
  mcat_psychsoc_8c_social_interactions: {
    code: "8C",
    title: "Social interactions",
    focus:
      "Elements of social interaction (status, role, groups, networks, organizations), self-presentation, social behavior, and discrimination.",
    topics: [
      "Elements of social interaction — status (achieved vs ascribed); role (role conflict, role strain, role exit); groups (primary vs secondary; in-group vs out-group; group size: dyads and triads); networks; organizations (formal organization; bureaucracy: ideal-type characteristics, iron law of oligarchy, McDonaldization)",
      "Self-presentation — expressing and detecting emotion (role of gender and culture); impression management; front-stage vs back-stage self (dramaturgical approach); verbal and nonverbal communication; animal signals and communication",
      "Social behavior — attraction; aggression; attachment (secure, avoidant, anxious); altruism; social support; biological explanations of social behavior in animals (foraging, mating behavior/mate choice, game theory, inclusive fitness/kin selection, reciprocal altruism)",
      "Discrimination — individual vs institutional discrimination; relationship between prejudice and discrimination; how power, prestige, and class facilitate discrimination",
    ],
  },
  mcat_psychsoc_9a_understanding_social_structure: {
    code: "9A",
    title: "Understanding social structure",
    focus:
      "Sociological theory, social institutions (education, family, religion, government/economy, health/medicine), and culture.",
    topics: [
      "Theoretical approaches — microsociology vs macrosociology; functionalism; conflict theory; symbolic interactionism; social constructionism; exchange-rational choice; feminist theory",
      "Education — hidden curriculum; teacher expectancy; educational segregation and stratification",
      "Family — forms of kinship; diversity in family forms; marriage and divorce; violence in the family (child, elder, spousal abuse)",
      "Religion — religiosity; types of religious organizations (church, sect, cult, denomination); religion and social change (modernization, secularization, fundamentalism)",
      "Government and economy — power and authority (Weber: traditional, charismatic, rational-legal); comparative economic and political systems; division of labor",
      "Health and medicine — medicalization; the sick role (Parsons); delivery of health care; illness experience; social epidemiology",
      "Culture — elements of culture (beliefs, language, rituals, symbols, values); material vs symbolic culture; culture lag; culture shock; assimilation; multiculturalism; subcultures and countercultures; mass media and popular culture; evolution and human culture; transmission and diffusion",
    ],
  },
  mcat_psychsoc_9b_demographic_characteristics: {
    code: "9B",
    title: "Demographic characteristics and processes",
    focus:
      "Demographic structure of society (age, gender, race/ethnicity, immigration, sexual orientation) and demographic shifts/social change (theories of demographic change, population dynamics, social movements, globalization, urbanization).",
    topics: [
      "Age — aging and the life course; age cohorts; social significance of aging",
      "Gender — sex vs gender; social construction of gender; gender segregation",
      "Race and ethnicity — social construction of race; racialization; racial formation",
      "Immigration status — patterns of immigration; intersections with race and ethnicity",
      "Sexual orientation",
      "Demographic change — Malthusian theory vs demographic transition; population growth and decline (projections, population pyramids); fertility, migration, and mortality (total/crude/age-specific rates; patterns; push and pull factors in migration)",
      "Social movements — relative deprivation; organization; movement strategies and tactics",
      "Globalization — contributing factors (communication technology, economic interdependence); perspectives on globalization; social changes (civil unrest, terrorism)",
      "Urbanization — industrialization and urban growth; suburbanization and urban decline; gentrification and urban renewal",
    ],
  },
  mcat_psychsoc_10a_social_inequality: {
    code: "10A",
    title: "Social inequality",
    focus:
      "Spatial inequality, social class and stratification, social mobility, poverty, and health/health care disparities.",
    topics: [
      "Spatial inequality — residential segregation; neighborhood safety and violence; environmental justice (location and exposure to health risks)",
      "Social class and stratification — social class and socioeconomic status; class consciousness vs false consciousness; cultural capital vs social capital; social reproduction; power, privilege, and prestige; intersectionality (race, gender, age); socioeconomic gradient in health; global inequalities",
      "Social mobility — intergenerational vs intragenerational mobility; vertical vs horizontal mobility; meritocracy",
      "Poverty — relative vs absolute poverty; social exclusion (segregation and isolation)",
      "Health disparities — class, gender, and race inequalities in health outcomes",
      "Health care disparities — class, gender, and race inequalities in access to and quality of health care",
    ],
  },

  // ─── Chemical & Physical Foundations — PHYSICS (FC4/FC5, section='physics') ───
  mcat_physics_p1_kinematics_translational_motion: {
    code: "P1",
    title: "Kinematics & Translational Motion",
    focus: "Describing translational motion: units/dimensions, vectors, displacement, velocity, acceleration, and constant-acceleration kinematics.",
    topics: [
      "Units and dimensions; dimensional analysis; scalars vs vectors",
      "Vectors — components, vector addition, the right-hand rule (dot/cross products not required)",
      "Speed and velocity (average and instantaneous); displacement vs distance",
      "Acceleration; the constant-acceleration kinematic equations",
      "Free fall (g) and projectile motion; position–time and velocity–time graphs",
    ],
  },
  mcat_physics_p2_forces_newton_s_laws: {
    code: "P2",
    title: "Forces & Newton's Laws",
    focus: "Forces and Newton's three laws governing motion.",
    topics: [
      "Newton's first law and inertia",
      "Newton's second law, F = ma; free-body diagrams",
      "Newton's third law (equal and opposite forces)",
      "Friction, static and kinetic",
      "Weight (W = mg), normal force, tension; gravitation (F = Gm1m2/r²); uniform circular motion and centripetal force",
    ],
  },
  mcat_physics_p3_equilibrium_torque_center_of_mass: {
    code: "P3",
    title: "Equilibrium, Torque & Center of Mass",
    focus: "Static equilibrium of forces and torques; center of mass.",
    topics: [
      "Translational equilibrium — vector analysis of forces on a point object (ΣF = 0)",
      "Torque (τ = rF sinθ), lever arms; rotational equilibrium (Στ = 0)",
      "Center of mass / center of gravity",
      "Stable vs unstable equilibrium",
    ],
  },
  mcat_physics_p4_work_energy_power: {
    code: "P4",
    title: "Work, Energy & Power",
    focus: "Work, mechanical energy, conservation of energy, and power.",
    topics: [
      "Work done by a constant force, W = Fd cosθ; mechanical advantage",
      "Work–kinetic energy theorem; conservative forces",
      "Kinetic energy KE = ½mv²",
      "Potential energy — gravitational (mgh) and spring (½kx²); conservation of energy",
      "Power and units",
    ],
  },
  mcat_physics_p5_fluids: {
    code: "P5",
    title: "Fluids",
    focus: "Fluid statics and dynamics relevant to circulation and gas exchange (organ biology stays in Biology).",
    topics: [
      "Density and specific gravity",
      "Buoyancy and Archimedes' principle",
      "Hydrostatic pressure — Pascal's law; P = ρgh",
      "Viscosity and Poiseuille flow; continuity (Av = constant); turbulence",
      "Surface tension",
      "Bernoulli's equation; Venturi effect and pitot tube",
    ],
  },
  mcat_physics_p6_thermodynamics_heat: {
    code: "P6",
    title: "Thermodynamics & Heat",
    focus: "The physics of heat and the laws of thermodynamics (heat transfer, calorimetry, PV work, phase changes, engines).",
    topics: [
      "Thermodynamic system and state functions; Zeroth law and temperature",
      "First law (energy conservation); PV-diagram work (area under the curve)",
      "Second law and entropy (disorder; relative entropy of gas/liquid/solid)",
      "Calorimetry — heat capacity, specific heat (Q = mcΔT); latent heat of fusion/vaporization (Q = mL); phase diagrams",
      "Heat transfer — conduction, convection, radiation; thermal expansion",
      "Thermodynamic processes (isothermal/adiabatic/isobaric/isochoric); heat engines and efficiency",
    ],
  },
  mcat_physics_p7_periodic_motion_waves_sound: {
    code: "P7",
    title: "Periodic Motion, Waves & Sound",
    focus: "Oscillations, mechanical waves, and sound.",
    topics: [
      "Periodic motion — amplitude, frequency, phase; simple harmonic motion (mass–spring, pendulum)",
      "Transverse vs longitudinal waves; wavelength and propagation speed (v = fλ); superposition, standing waves, harmonics, beats",
      "Sound — production; relative speed in solids/liquids/gases; intensity and decibels (log scale); attenuation",
      "Doppler effect; pitch; resonance in pipes and strings; ultrasound; shock waves",
    ],
  },
  mcat_physics_p8_light_geometrical_optics: {
    code: "P8",
    title: "Light & Geometrical Optics",
    focus: "Wave optics and geometrical optics; light and the EM spectrum.",
    topics: [
      "Interference (Young's double-slit); thin films; diffraction (grating, single-slit, X-ray); polarization (linear/circular)",
      "EM radiation — speed c, perpendicular E and B fields; EM spectrum; photon energy E = hf; visible spectrum and color",
      "Reflection (θi = θr); refraction and Snell's law (n1 sinθ1 = n2 sinθ2); dispersion; total internal reflection",
      "Spherical mirrors (center of curvature, focal length, real/virtual images)",
      "Thin lenses (1/p + 1/q = 1/f; converging/diverging; diopters); lens combinations; aberration; optical instruments and the human eye",
    ],
  },
  mcat_physics_p9_electrostatics_magnetism: {
    code: "P9",
    title: "Electrostatics & Magnetism",
    focus: "Electric charge, fields, potential, and magnetism.",
    topics: [
      "Charge, conductors, insulators, charge conservation",
      "Coulomb's law (F = kq1q2/r²)",
      "Electric field E (field lines; field of a charge distribution)",
      "Electrostatic energy and electric potential at a point in space",
      "Magnetic field B; motion of charged particles in magnetic fields; Lorentz force (F = qvB sinθ)",
    ],
  },
  mcat_physics_p10_circuits: {
    code: "P10",
    title: "Circuits",
    focus: "DC circuit elements — current, resistance, capacitance, and circuit analysis.",
    topics: [
      "Current (I = ΔQ/Δt), sign conventions; EMF and voltage; terminal voltage and internal resistance",
      "Resistance — Ohm's law (I = V/R); resistors in series/parallel; resistivity (ρ = RA/L); Kirchhoff's junction and loop rules",
      "Electric power (P = IV = I²R)",
      "Capacitance — parallel-plate capacitor, energy stored, series/parallel, dielectrics",
      "Conductivity (metallic and electrolytic); meters",
    ],
  },
  mcat_physics_p11_atomic_nuclear_phenomena: {
    code: "P11",
    title: "Atomic & Nuclear Phenomena",
    focus: "The atomic nucleus, radioactivity, and the quantum/emission physics of the atom.",
    topics: [
      "Atomic number and weight; protons, neutrons, isotopes; nuclear forces and binding energy",
      "Radioactive decay — α, β, γ; half-life, exponential decay, semi-log plots",
      "Mass spectrometer and mass spectroscopy",
      "Ground vs excited states; absorption and emission line spectra; Bohr atom",
      "Heisenberg uncertainty principle; photoelectric effect",
    ],
  },

  // ─── Chemical & Physical Foundations — CHEMISTRY (FC4/FC5, section='chemistry') ───
  mcat_chemistry_c1_atomic_structure_periodic_trends: {
    code: "C1",
    title: "Atomic Structure & Periodic Trends",
    focus: "Electronic structure of atoms and periodic trends (the periodic table is provided on the exam).",
    topics: [
      "Electronic structure — orbital structure of hydrogen, principal quantum number n, quantum numbers, electrons per orbital; s/p/d orbital shapes",
      "Electron configuration (conventional notation); Pauli exclusion, Aufbau, Hund's rule; ion configurations",
      "Paramagnetism and diamagnetism; effective nuclear charge",
      "Periodic groups — alkali metals, alkaline earth metals, halogens, noble gases, transition metals, representative elements, metals vs nonmetals, oxygen group",
      "Periodic trends — valence electrons; first/second ionization energy; electron affinity; electronegativity; atomic and ionic radius",
    ],
  },
  mcat_chemistry_c2_bonding_molecular_structure: {
    code: "C2",
    title: "Bonding & Molecular Structure",
    focus: "Covalent bonding, Lewis structures, molecular geometry, and polarity.",
    topics: [
      "Lewis electron-dot formulas — resonance structures, formal charge, Lewis acids and bases",
      "Partial ionic character — electronegativity and charge distribution; dipole moment",
      "σ and π bonds; hybrid orbitals (sp³, sp², sp) and geometries; VSEPR shapes (NH3, H2O, CO2); delocalized electrons/resonance",
      "Multiple bonding — effect on bond length and energy; rigidity",
      "Ionic vs covalent vs metallic bonding; octet rule and exceptions; bond order; bond vs molecular polarity",
    ],
  },
  mcat_chemistry_c3_intermolecular_forces_phases: {
    code: "C3",
    title: "Intermolecular Forces & Phases",
    focus: "Intermolecular forces and how they govern physical properties and states of matter.",
    topics: [
      "Hydrogen bonding",
      "Dipole–dipole interactions; ion–dipole",
      "Van der Waals / London dispersion forces; ranking IMF strength",
      "Effect of IMFs on physical properties (boiling/melting point, vapor pressure, viscosity, surface tension, solubility)",
      "States of matter and phase transitions (melting, freezing, vaporization, condensation, sublimation, deposition)",
    ],
  },
  mcat_chemistry_c4_stoichiometry_reaction_types: {
    code: "C4",
    title: "Stoichiometry & Reaction Types",
    focus: "Quantitative composition, balancing chemical equations, and reaction classification.",
    topics: [
      "Molecular weight; empirical vs molecular formula; percent composition by mass; density",
      "Mole concept and Avogadro's number; mole–mass–particle conversions",
      "Oxidation numbers; common oxidizing and reducing agents; disproportionation",
      "Writing and balancing chemical equations (including redox); limiting reactants; theoretical and percent yield",
      "Reaction types — combination, decomposition, single/double displacement, combustion, neutralization, precipitation, redox",
    ],
  },
  mcat_chemistry_c5_gases_solutions: {
    code: "C5",
    title: "Gases & Solutions",
    focus: "Gas laws and kinetic theory; solution composition.",
    topics: [
      "Absolute temperature (Kelvin); pressure and the mercury barometer; molar volume (22.4 L/mol at STP)",
      "Ideal gas law (PV = nRT); Boyle's, Charles's, Avogadro's, Gay-Lussac/combined laws",
      "Kinetic molecular theory; heat capacity at constant V and P; Boltzmann's constant; Graham's law of effusion",
      "Real gases — qualitative deviation and the Van der Waals equation; partial pressure, mole fraction, Dalton's law",
      "Solutions — common ion names/formulas/charges; hydration and the hydronium ion; concentration units (molarity, molality, mole fraction, mass percent); dilution; electrolytes",
    ],
  },
  mcat_chemistry_c6_acids_bases: {
    code: "C6",
    title: "Acids & Bases",
    focus: "Acid–base equilibria, buffers, and titration.",
    topics: [
      "Brønsted–Lowry acids/bases; conjugate acid–base pairs",
      "Ionization of water (Kw = 10⁻¹⁴); pH and pOH; pH of pure water",
      "Strong vs weak acids and bases; Ka, Kb, pKa, pKb; calculating pH; polyprotic acids",
      "Hydrolysis of salts and pH of salt solutions",
      "Buffers and the Henderson–Hasselbalch equation; common buffer systems",
      "Titration — indicators, neutralization, titration curves, equivalence/half-equivalence points, redox titration",
    ],
  },
  mcat_chemistry_c7_chemical_thermodynamics: {
    code: "C7",
    title: "Chemical Thermodynamics",
    focus: "Thermochemistry of reactions — enthalpy, entropy, free energy, and spontaneity.",
    topics: [
      "Endothermic vs exothermic reactions; enthalpy H; standard heats of reaction and formation",
      "Hess's law of heat summation; bond dissociation energy and heats of formation",
      "Entropy change of a reaction (ΔS)",
      "Free energy G; ΔG = ΔH − TΔS; spontaneity (sign of ΔG); temperature dependence",
      "Relationship of free energy and equilibrium (ΔG° = −RT ln K)",
    ],
  },
  mcat_chemistry_c8_chemical_kinetics: {
    code: "C8",
    title: "Chemical Kinetics",
    focus: "Reaction rates, rate laws, and catalysis (general chemistry; enzyme kinetics belongs to Biology).",
    topics: [
      "Reaction rate; rate law, rate constant, reaction order; determining order from data",
      "Rate-determining step; reaction mechanisms (elementary steps, intermediates)",
      "Activation energy; activated complex/transition state; reaction-coordinate (energy) diagrams",
      "Temperature dependence and the Arrhenius equation",
      "Catalysts (lower Ea, not ΔG); kinetic vs thermodynamic control",
    ],
  },
  mcat_chemistry_c9_chemical_equilibrium: {
    code: "C9",
    title: "Chemical Equilibrium",
    focus: "Reversible reactions, equilibrium constants, Le Châtelier's principle, and solubility equilibria.",
    topics: [
      "Law of mass action; equilibrium constant (Kc, Kp); reaction quotient Q vs K",
      "Le Châtelier's principle (concentration, pressure/volume, temperature)",
      "Relationship of K and ΔG° (ΔG° = −RT ln K)",
      "Solubility product Ksp; molar solubility; Qsp and precipitation",
      "Common-ion effect; complex-ion formation and solubility; solubility and pH",
    ],
  },
  mcat_chemistry_c10_electrochemistry_redox: {
    code: "C10",
    title: "Electrochemistry & Redox",
    focus: "Electrochemical cells, reduction potentials, and the Nernst equation.",
    topics: [
      "Electrolytic cells — electrolysis, anode/cathode, electrolyte, Faraday's law; oxidation/reduction at electrodes",
      "Galvanic (voltaic) cells — half-reactions, reduction potentials, cell potential, direction of electron flow",
      "Standard reduction potentials (E°cell = E°cathode − E°anode); ΔG° = −nFE°; the Nernst equation",
      "Concentration cells; balancing redox half-reactions",
      "Batteries — lead-storage and nickel-cadmium",
    ],
  },
  mcat_chemistry_c11_organic_chemistry_structure_bonding_stereochemistry: {
    code: "C11",
    title: "Organic Chemistry — Structure, Bonding & Stereochemistry",
    focus: "Organic structure, functional groups, nomenclature, isomerism, and stereochemistry (biomolecule biology is owned by Biology).",
    topics: [
      "Functional-group identification and IUPAC nomenclature",
      "Isomers — structural, conformational; stereoisomers (enantiomers, diastereomers, cis–trans)",
      "Chirality and stereocenters; meso compounds; optical activity and specific rotation; R/S and E/Z configuration",
      "Fischer, Newman, and chair projections; hybridization; degrees of unsaturation; aromaticity (Hückel)",
      "Amino acids (α-carbon configuration, zwitterion, classification, isoelectric point); carbohydrate structure (D/L, cyclic forms, anomers, epimers)",
      "Lipid structural types (triacylglycerols, fatty acids, phospholipids, sphingolipids, waxes, fat-soluble vitamins, steroids, prostaglandins); nucleotide composition; aromatic heterocycles",
    ],
  },
  mcat_chemistry_c12_organic_chemistry_reactions_mechanisms: {
    code: "C12",
    title: "Organic Chemistry — Reactions & Mechanisms",
    focus: "Organic reactions and mechanisms across functional-group families.",
    topics: [
      "Substitution — SN1 vs SN2; elimination — E1 vs E2 and Zaitsev",
      "Alcohols — oxidation, substitution, protection, mesylates/tosylates",
      "Aldehydes/ketones — nucleophilic addition (acetal/hemiacetal, imine/enamine, hydride, cyanohydrin); oxidation; enolate chemistry (aldol, keto-enol, kinetic vs thermodynamic enolate)",
      "Carboxylic acids and derivatives — ester/amide/anhydride formation; nucleophilic acyl substitution; transesterification; hydrolysis; reduction; decarboxylation; relative reactivity; β-lactam strain",
      "Biomolecule reactions — amino-acid synthesis (Strecker, Gabriel), peptide-bond and disulfide formation, saponification, glycoside hydrolysis",
      "Phenol/quinone 2-electron redox; aromatic heterocycle reactivity; reaction-energy diagrams",
    ],
  },
  mcat_chemistry_c13_separations_purification_spectroscopy: {
    code: "C13",
    title: "Separations, Purification & Spectroscopy",
    focus: "Separating and purifying mixtures and identifying molecular structure by spectroscopy.",
    topics: [
      "Extraction (solute distribution between immiscible solvents); distillation",
      "Chromatography — column (gas-liquid, HPLC), paper, thin-layer; size-exclusion, ion-exchange, affinity",
      "Protein/peptide separation — electrophoresis; quantitative analysis",
      "Racemic mixtures and separation of enantiomers",
      "IR spectroscopy (characteristic group absorptions, fingerprint region); UV-Vis (π→π*/n→π* transitions, conjugation, complementary color, indicators); NMR (chemical shift, equivalent protons, spin-spin splitting)",
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
