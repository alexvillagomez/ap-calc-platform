/**
 * Template card helpers for the MCAT Biology generation system.
 * Fetches grounding material from the MileDown anki deck stored in anki_cards.
 */
import { SupabaseClient } from "@supabase/supabase-js";

// Maps mcat category ids → MileDown anki tag prefixes
export const CATEGORY_TO_TAG_PREFIXES: Record<string, string[]> = {
  mcat_biology_amino_acids_and_proteins: [
    "MileDown::Biochemistry::Amino_Acids",
    "MileDown::Biochemistry::Proteins",
  ],
  mcat_biology_enzymes_and_protein_function: [
    "MileDown::Biochemistry::Enzymes",
    "MileDown::Biochemistry::Biosignaling",
  ],
  mcat_biology_nucleic_acids_and_gene_expression: [
    "MileDown::Biochemistry::DNA_and_RNA",
  ],
  mcat_biology_genetics_evolution_and_inheritance: [
    "MileDown::Biology::Genetics",
  ],
  mcat_biology_bioenergetics_and_metabolism: [
    "MileDown::Biochemistry::Metabolism",
    "MileDown::Biochemistry::Lipid_Metabolism",
    "MileDown::Biochemistry::Carbohydrates",
    "MileDown::Biochemistry::Lipids",
  ],
  mcat_biology_cell_structure_membranes_and_transport: [
    "MileDown::Biology::Parts_of_Cell",
    "MileDown::Biology::Cytoskeleton",
    "MileDown::Biology::Tissues",
  ],
  mcat_biology_prokaryotes_viruses_and_biotechnology: [
    "MileDown::Biology::Viruses_and_Bacteria",
  ],
  mcat_biology_cell_cycle_development_and_reproduction: [
    "MileDown::Biology::Development",
    "MileDown::Biology::Reproduction",
  ],
  mcat_biology_nervous_and_endocrine_systems: [
    "MileDown::Biology::Nervous_System",
    "MileDown::Biology::Endocrine",
  ],
  mcat_biology_organ_systems_and_homeostasis: [
    "MileDown::Biology::Cardiovascular_System",
    "MileDown::Biology::Muscular_System",
    "MileDown::Biology::Respiratory_System",
    "MileDown::Biology::Tissues",
  ],
  mcat_psychsoc_6a_sensing_the_environment: ["MileDown::Behavioral::Sensation_and_Perception", "MileDown::Behavioral::Attention"],
  mcat_psychsoc_6b_making_sense_of_the_environment: ["MileDown::Behavioral::Cognition", "MileDown::Behavioral::Memory", "MileDown::Behavioral::Language", "MileDown::Behavioral::Intelligence", "MileDown::Behavioral::Consciousness", "MileDown::Behavioral::Attention"],
  mcat_psychsoc_6c_responding_to_the_world: ["MileDown::Behavioral::Emotion", "MileDown::Behavioral::Emotions", "MileDown::Behavioral::Stress"],
  mcat_psychsoc_7a_individual_influences_on_behavior: ["MileDown::Behavioral::Biology_and_Behavior", "MileDown::Behavioral::Personality", "MileDown::Behavioral::Disorders", "MileDown::Behavioral::Motivation", "MileDown::Behavioral::Development"],
  mcat_psychsoc_7b_social_processes_and_behavior: ["MileDown::Behavioral::Social"],
  mcat_psychsoc_7c_attitude_and_behavior_change: ["MileDown::Behavioral::Learning", "MileDown::Behavioral::Attitudes"],
  mcat_psychsoc_8a_self_identity: ["MileDown::Behavioral::Identity"],
  mcat_psychsoc_8b_social_thinking: ["MileDown::Behavioral::Social"],
  mcat_psychsoc_8c_social_interactions: ["MileDown::Behavioral::Social", "MileDown::Behavioral::Behavior"],
  mcat_psychsoc_9a_understanding_social_structure: ["MileDown::Behavioral::Social"],
  mcat_psychsoc_9b_demographic_characteristics: ["MileDown::Behavioral::Social"],
  mcat_psychsoc_10a_social_inequality: ["MileDown::Behavioral::Social"],
  // ─── Physics (MileDown::Physics::* + the physics equation sheet) ───
  mcat_physics_p1_kinematics_translational_motion: ["MileDown::Physics::Kinematics", "MileDown::Physics::Mathematics", "MileDown::All_MCAT_Equations::Physics"],
  mcat_physics_p2_forces_newton_s_laws: ["MileDown::Physics::Dynamics", "MileDown::Physics::Mechanics", "MileDown::All_MCAT_Equations::Physics"],
  mcat_physics_p3_equilibrium_torque_center_of_mass: ["MileDown::Physics::Mechanics", "MileDown::Physics::Dynamics", "MileDown::All_MCAT_Equations::Physics"],
  mcat_physics_p4_work_energy_power: ["MileDown::Physics::Work", "MileDown::Physics::Energy", "MileDown::Physics::Mechanics", "MileDown::All_MCAT_Equations::Physics"],
  mcat_physics_p5_fluids: ["MileDown::Physics::Fluids", "MileDown::All_MCAT_Equations::Physics"],
  mcat_physics_p6_thermodynamics_heat: ["MileDown::Physics::Thermodynamics", "MileDown::All_MCAT_Equations::Physics"],
  mcat_physics_p7_periodic_motion_waves_sound: ["MileDown::Physics::Waves", "MileDown::Physics::Sound", "MileDown::All_MCAT_Equations::Physics"],
  mcat_physics_p8_light_geometrical_optics: ["MileDown::Physics::Light", "MileDown::All_MCAT_Equations::Physics"],
  mcat_physics_p9_electrostatics_magnetism: ["MileDown::Physics::Electrostatics", "MileDown::Physics::Magnetism", "MileDown::All_MCAT_Equations::Physics"],
  mcat_physics_p10_circuits: ["MileDown::Physics::Circuits", "MileDown::All_MCAT_Equations::Physics"],
  mcat_physics_p11_atomic_nuclear_phenomena: ["MileDown::Physics::Nuclear_Phenomena", "MileDown::All_MCAT_Equations::Physics"],
  // ─── General Chemistry (MileDown::General_Chemistry::* + the gen-chem equation sheet) ───
  mcat_chemistry_c1_atomic_structure_periodic_trends: ["MileDown::General_Chemistry::Atomic_Structure", "MileDown::General_Chemistry::Periodic_Table"],
  mcat_chemistry_c2_bonding_molecular_structure: ["MileDown::General_Chemistry::Bonding"],
  mcat_chemistry_c3_intermolecular_forces_phases: ["MileDown::General_Chemistry::Intermolecular_Forces"],
  mcat_chemistry_c4_stoichiometry_reaction_types: ["MileDown::General_Chemistry::Compounds", "MileDown::General_Chemistry::REDOX", "MileDown::All_MCAT_Equations::Gen_Chem"],
  mcat_chemistry_c5_gases_solutions: ["MileDown::General_Chemistry::Gases", "MileDown::General_Chemistry::Solutions", "MileDown::All_MCAT_Equations::Gen_Chem"],
  mcat_chemistry_c6_acids_bases: ["MileDown::General_Chemistry::Acids_and_Bases", "MileDown::All_MCAT_Equations::Gen_Chem"],
  mcat_chemistry_c7_chemical_thermodynamics: ["MileDown::General_Chemistry::Thermochemistry", "MileDown::All_MCAT_Equations::Gen_Chem"],
  mcat_chemistry_c8_chemical_kinetics: ["MileDown::General_Chemistry::Chemical_Kinetics", "MileDown::All_MCAT_Equations::Gen_Chem"],
  mcat_chemistry_c9_chemical_equilibrium: ["MileDown::General_Chemistry::Equilibrium", "MileDown::All_MCAT_Equations::Gen_Chem"],
  mcat_chemistry_c10_electrochemistry_redox: ["MileDown::General_Chemistry::Electrochemistry", "MileDown::General_Chemistry::REDOX", "MileDown::All_MCAT_Equations::Gen_Chem"],
  // ─── Organic Chemistry (MileDown::OChem::*) ───
  mcat_chemistry_c11_organic_chemistry_structure_bonding_stereochemistry: ["MileDown::OChem::Isomers", "MileDown::OChem::Nomenclature", "MileDown::OChem::Molecules", "MileDown::OChem::Bonding", "MileDown::OChem::Amino_Acids"],
  mcat_chemistry_c12_organic_chemistry_reactions_mechanisms: ["MileDown::OChem::Reactions", "MileDown::OChem::Aldehydes_and_Ketones", "MileDown::OChem::Alcohols", "MileDown::OChem::Carboxylic_Acids", "MileDown::OChem::Carboxylic_Acid_Derivatives"],
  mcat_chemistry_c13_separations_purification_spectroscopy: ["MileDown::OChem::Separations", "MileDown::OChem::Spectroscopy"],
};

type TemplateCard = { id: string; plain_text: string };

/**
 * Fetch anki_cards rows that match the category's tag prefixes.
 * tags column may be a postgres text[] or jsonb array — we fetch broadly
 * then filter in JS to be safe.
 */
export async function fetchTemplateCards(
  supabase: SupabaseClient,
  categoryId: string,
  keywordLabels: string[],
  limit = 6
): Promise<TemplateCard[]> {
  const prefixes = CATEGORY_TO_TAG_PREFIXES[categoryId];
  if (!prefixes || prefixes.length === 0) return [];

  // Fetch up to ~400 rows; tags may be stored as text[] or jsonb.
  // We use .overlaps() for text[] — if it fails (jsonb), we fall back.
  let rows: Array<{ id: string; plain_text: string; tags: unknown }> = [];

  const { data: arrayData, error: arrayError } = await supabase
    .from("anki_cards")
    .select("id, plain_text, tags")
    .overlaps("tags", prefixes)
    .not("plain_text", "is", null)
    .limit(400);

  if (!arrayError && arrayData && arrayData.length > 0) {
    rows = arrayData as typeof rows;
  } else {
    // Fallback: fetch all cards and filter in JS (handles jsonb tags)
    const { data: allData } = await supabase
      .from("anki_cards")
      .select("id, plain_text, tags")
      .not("plain_text", "is", null)
      .limit(400);

    if (allData) {
      rows = (allData as typeof rows).filter((card) => {
        const tags = card.tags;
        if (!tags) return false;
        // Normalize to string array regardless of storage format
        let tagArr: string[] = [];
        if (Array.isArray(tags)) {
          tagArr = tags.map(String);
        } else if (typeof tags === "string") {
          try {
            const parsed = JSON.parse(tags);
            tagArr = Array.isArray(parsed) ? parsed.map(String) : [tags];
          } catch {
            tagArr = [tags];
          }
        }
        return prefixes.some((prefix) =>
          tagArr.some((t) => t.startsWith(prefix))
        );
      });
    }
  }

  if (rows.length === 0) return [];

  // Rank by naive term overlap between plain_text and keyword labels
  const kwTerms = keywordLabels
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3);

  type Ranked = TemplateCard & { _score: number };
  const ranked: Ranked[] = rows
    .filter((r) => r.plain_text?.trim())
    .map((r) => {
      const text = r.plain_text.toLowerCase();
      const score = kwTerms.reduce(
        (acc, term) => acc + (text.includes(term) ? 1 : 0),
        0
      );
      return { id: r.id, plain_text: r.plain_text, _score: score };
    });

  ranked.sort((a, b) => b._score - a._score);

  // Return top (limit-2) best-matching + 2 random for variety
  const topN = Math.max(0, limit - 2);
  const top = ranked.slice(0, topN);
  const remainder = ranked.slice(topN);
  const random2: Ranked[] = [];
  for (let i = 0; i < 2 && remainder.length > 0; i++) {
    const idx = Math.floor(Math.random() * remainder.length);
    random2.push(remainder.splice(idx, 1)[0]);
  }

  return [...top, ...random2].slice(0, limit).map(({ id, plain_text }) => ({
    id,
    plain_text,
  }));
}
