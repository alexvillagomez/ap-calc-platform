/**
 * /v2 — STATIC mock data for the Lodera Biology study app.
 *
 * This is the SINGLE source of all sample content rendered by the /v2 screens.
 * Every component is driven from these exports via props/state, so a later pass
 * can swap this module for real API data WITHOUT touching any markup.
 *
 * Shape overview (for the wiring pass):
 *   - QUESTION:        QuestionData   — the mitosis MCQ (stem, 4 choices, correctId, explanations, hint).
 *   - FLASHCARDS:      Flashcard[]    — the 4 PMAT flip cards (front term + back definition).
 *   - LESSON_STEPS:    LessonStep[]   — the 3-step inline/modal lesson (eyebrow/title/body/example).
 *   - MASTERY:         MasteryTopic[] — the "My progress" per-topic mastery list (name + pct).
 *   - TOPIC_TREE:      Topic[]        — the left-sidebar topic accordion (key/name + subtopics).
 *   - RELATED_LESSONS: RelatedLesson[]— the right-panel lesson cards (eyebrow/title, `current` flag).
 *   - REFRESHER:       RefresherData  — the refresher modal (title/subtitle + phase rows).
 *   - PROFILE:         ProfileData    — the profile dropdown (name/email/initials).
 */

export type ChoiceId = "A" | "B" | "C" | "D";

export interface Choice {
  id: ChoiceId;
  text: string;
}

export interface QuestionData {
  /** Eyebrow shown on related-lesson context, kept here for the wiring pass. */
  stem: string;
  choices: Choice[];
  correctId: ChoiceId;
  /** Heading shown in the explanation panel when the chosen answer is correct. */
  correctHeading: string;
  /** Body shown in the explanation panel when the answer is correct. */
  correctBody: string;
  /** Heading shown when the chosen answer is wrong. */
  wrongHeading: string;
  /** Body shown when the answer is wrong. */
  wrongBody: string;
  /** The "I don't know" hint line. */
  hint: string;
}

export const QUESTION: QuestionData = {
  stem: "During which phase of mitosis do sister chromatids separate and migrate toward opposite poles of the cell?",
  choices: [
    { id: "A", text: "Prophase" },
    { id: "B", text: "Metaphase" },
    { id: "C", text: "Anaphase" },
    { id: "D", text: "Telophase" },
  ],
  correctId: "C",
  correctHeading: "Correct — Anaphase",
  correctBody:
    "In anaphase the cohesin proteins holding sister chromatids together are cleaved, and spindle microtubules pull each chromatid to opposite poles. At metaphase the chromatids are still aligned at the metaphase plate — the most common mix-up.",
  wrongHeading: "Not quite — the answer is C, Anaphase",
  wrongBody:
    "Separation happens in anaphase: cohesin is cleaved and spindle fibers pull the sister chromatids to opposite poles. At metaphase the chromosomes are still lined up at the metaphase plate, one step earlier.",
  hint: "The chromosomes line up at the metaphase plate first — which phase pulls them apart right after?",
};

export interface Flashcard {
  front: string;
  back: string;
}

export const FLASHCARDS: Flashcard[] = [
  { front: "Prophase", back: "Chromosomes condense and become visible; the nuclear envelope breaks down and the mitotic spindle begins to form." },
  { front: "Metaphase", back: "Chromosomes align single-file along the metaphase plate at the cell's equator, attached to spindle fibers at their centromeres." },
  { front: "Anaphase", back: "Cohesin is cleaved; sister chromatids separate and are pulled toward opposite poles of the cell by shortening spindle microtubules." },
  { front: "Telophase", back: "Two new nuclear envelopes reform around the separated chromosomes, which begin to decondense, as the cell prepares to divide." },
];

/** Chip label shown above the flashcard. */
export const FLASHCARD_TAG = "Cell Division · Mitosis";

export interface LessonStep {
  /** Brand-600 eyebrow above the title (shared across steps). */
  eyebrow: string;
  title: string;
  /** Computer Modern Serif body prose. */
  body: string;
  /** EXAMPLE callout body. */
  example: string;
}

export const LESSON_EYEBROW = "MITOSIS & THE CELL CYCLE";

export const LESSON_STEPS: LessonStep[] = [
  {
    eyebrow: LESSON_EYEBROW,
    title: "Why Cells Divide",
    body: "Cells divide to grow, to replace worn-out or damaged tissue, and — in single-celled organisms — to reproduce. Mitosis is the kind of division that produces two daughter cells genetically identical to the parent, each with a full, faithful copy of every chromosome. Before a cell can divide, it first duplicates its DNA so that each daughter receives one complete set.",
    example: "A scraped knee heals because skin cells at the wound edge undergo mitosis, producing new cells identical to the ones that were lost.",
  },
  {
    eyebrow: LESSON_EYEBROW,
    title: "The Four Phases — PMAT",
    body: "Mitosis proceeds through four phases, remembered as PMAT. In prophase the chromosomes condense and the nuclear envelope dissolves. In metaphase they line up along the metaphase plate. In anaphase the sister chromatids are pulled apart to opposite poles. In telophase two new nuclei reform and the cell prepares to split.",
    example: "Picture a tug-of-war: metaphase is the moment both teams are lined up and ready; anaphase is the instant the rope snaps and each side is dragged to its own corner.",
  },
  {
    eyebrow: LESSON_EYEBROW,
    title: "Checkpoints & the Cell Cycle",
    body: "Mitosis is just one part of the larger cell cycle, which also includes interphase — the long stretch where the cell grows and copies its DNA. Checkpoints act as quality-control gates: they halt the cycle if the DNA is damaged or improperly copied, preventing errors from being passed on. When these controls fail, unchecked division can lead to cancer.",
    example: "The G2/M checkpoint refuses to let a cell enter mitosis until every chromosome has been fully and correctly replicated — like a flight that won't take off until all safety checks pass.",
  },
];

export interface MasteryTopic {
  name: string;
  /** Mastery percent, 0–100. */
  pct: number;
}

export const MASTERY: MasteryTopic[] = [
  { name: "Cell Division", pct: 64 },
  { name: "Cell Structure", pct: 92 },
  { name: "DNA & Replication", pct: 78 },
  { name: "Genetics & Heredity", pct: 45 },
  { name: "Photosynthesis", pct: 30 },
  { name: "Cellular Respiration", pct: 12 },
  { name: "Evolution", pct: 0 },
];

export interface Topic {
  key: string;
  name: string;
  subtopics: string[];
}

export const TOPIC_TREE: Topic[] = [
  { key: "cell-division", name: "Cell Division", subtopics: ["Mitosis", "Meiosis", "The Cell Cycle", "Checkpoints"] },
  { key: "cell-structure", name: "Cell Structure", subtopics: [] },
  { key: "dna-replication", name: "DNA & Replication", subtopics: [] },
  { key: "genetics-heredity", name: "Genetics & Heredity", subtopics: [] },
  { key: "photosynthesis", name: "Photosynthesis", subtopics: [] },
  { key: "cellular-respiration", name: "Cellular Respiration", subtopics: [] },
  { key: "evolution", name: "Evolution", subtopics: [] },
];

export interface RelatedLesson {
  /** Small uppercase eyebrow above the title. */
  eyebrow: string;
  title: string;
  /** The first card is the current/active one (brand-tinted). */
  current?: boolean;
}

export const RELATED_LESSONS: RelatedLesson[] = [
  { eyebrow: "CURRENT · CELL DIVISION", title: "Mitosis & the Cell Cycle", current: true },
  { eyebrow: "CELL DIVISION", title: "Meiosis & Genetic Variation" },
  { eyebrow: "CELL DIVISION", title: "Regulation of the Cell Cycle" },
];

export interface RefresherRow {
  term: string;
  definition: string;
  /** When true the term renders in success green (the answer phase). */
  highlight?: boolean;
}

export interface RefresherData {
  title: string;
  subtitle: string;
  rows: RefresherRow[];
}

export const REFRESHER: RefresherData = {
  title: "Refresher",
  subtitle: "Mitosis & the Cell Cycle",
  rows: [
    { term: "Prophase", definition: "Chromosomes condense; nuclear envelope dissolves." },
    { term: "Metaphase", definition: "Chromosomes line up at the metaphase plate." },
    { term: "Anaphase", definition: "Sister chromatids split to opposite poles.", highlight: true },
    { term: "Telophase", definition: "Two nuclei reform; the cell prepares to divide." },
  ],
};

export interface ProfileData {
  initials: string;
  name: string;
  email: string;
}

export const PROFILE: ProfileData = {
  initials: "AC",
  name: "Alex Chen",
  email: "alex@northstar.edu",
};

/** STUDY mode switcher labels (multi-select). */
export const STUDY_MODES = ["Lessons", "Flashcards", "Questions"] as const;
export type StudyMode = (typeof STUDY_MODES)[number];
