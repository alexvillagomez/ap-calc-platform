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
