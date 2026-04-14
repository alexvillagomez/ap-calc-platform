/**
 * Difficulty narratives and FRQ archetypes for exam-prep generation (see prompts.ts).
 */

/** FRQ user prompt: full-sentence difficulty instructions. */
export const DIFFICULTY_NARRATIVE: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Create a problem that should be easily solved given understanding of course content.",
  2: "Create a problem that can be solved given a moderate understanding of course content.",
  3: "Create a problem that can be solved with a moderate understanding of course content with some computational difficulty or a simple application of course content.",
  4: "Create a problem that is computationally difficult to solve or requires a moderate application of course content.",
  5: "Create a problem that is computationally difficult or requires a complicated application of course content.",
};

/** MCQ user prompt: phrase after “that is **…**” (same wording as getMcqDifficultyReferenceLine). */
export const MCQ_DIFFICULTY_PHRASE: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "easily solved given simple understanding of course content",
  2: "can be solved given a moderate understanding of course content",
  3: "can be solved with a moderate understanding of course content with some computational difficulty or a simple application of course content.",
  4: "computationally difficult to solve or requires a moderate application of course content",
  5: "computationally difficult or requires a complicated application of course content.",
};

function clampDifficultyLevel(level: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(level))) as 1 | 2 | 3 | 4 | 5;
}

/** One line for the selected level only (top of MCQ user message). */
export function getMcqDifficultyReferenceLine(level: number): string {
  const n = clampDifficultyLevel(level);
  return `Difficulty ${n}: ${MCQ_DIFFICULTY_PHRASE[n]}`;
}

export type FrqTypeLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type FrqArchetype = {
  id: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  label: string;
  /** Injected into the user prompt as the archetype-specific task line. */
  instruction: string;
  frqType: FrqTypeLetter;
};

/** Maps to TYPE A–G in the FRQ system guide. Calculator is never allowed (enforced in prompts + route). */
export const FRQ_ARCHETYPES: FrqArchetype[] = [
  {
    id: 1,
    label: "Rate in / rate out (accumulation)",
    instruction:
      "Create an FRQ in the style of applied rate in/rate out or accumulation: tabular and/or formula model, Riemann sums, interpretation with units, MVT-style reasoning, or accumulation — all with exact, hand-computable values (no calculator).",
    frqType: "A",
  },
  {
    id: 2,
    label: "Motion",
    instruction:
      "Create an FRQ on straight-line motion: position, velocity, acceleration, direction change, distance or displacement via integrals — with exact values and clear units (no calculator).",
    frqType: "B",
  },
  {
    id: 3,
    label: "Interpreting graphs (derivative graph)",
    instruction:
      "Create an FRQ where students interpret a graph (often of f' or f): extrema, intervals, accumulation, limits, or related behavior — no calculator; geometry and reasoning should be hand-friendly.",
    frqType: "D",
  },
  {
    id: 4,
    label: "Area and volume",
    instruction:
      "Create an FRQ on area between curves and/or volumes (cross-sections, disks, washers) — setup and evaluation where asked must use exact arithmetic (no calculator).",
    frqType: "G",
  },
  {
    id: 5,
    label: "Table questions",
    instruction:
      "Create an FRQ centered on tabular data: chain rule, composite functions, FTC, derivatives from tables — all computable exactly from the given table (no calculator).",
    frqType: "E",
  },
  {
    id: 6,
    label: "Differential equations",
    instruction:
      "Create an FRQ on a differential equation with applied context: slope field, linearization, separation of variables, or verification — no calculator; use hand-solvable forms.",
    frqType: "C",
  },
  {
    id: 7,
    label: "Implicit differentiation / related rates",
    instruction:
      "Create an FRQ with an implicit curve and/or related rates: find dy/dx, tangents, horizontal/vertical tangents, or rates along the curve — no calculator.",
    frqType: "F",
  },
];

export function getDifficultyNarrative(level: number): string {
  return DIFFICULTY_NARRATIVE[clampDifficultyLevel(level)];
}

export function getMcqDifficultyPhrase(level: number): string {
  return MCQ_DIFFICULTY_PHRASE[clampDifficultyLevel(level)];
}

export function pickRandomFrqArchetype(): FrqArchetype {
  const i = Math.floor(Math.random() * FRQ_ARCHETYPES.length);
  return FRQ_ARCHETYPES[i]!;
}

export function getFrqArchetypeById(id: number): FrqArchetype | undefined {
  return FRQ_ARCHETYPES.find((a) => a.id === id);
}
