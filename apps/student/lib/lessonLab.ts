/**
 * Lesson Lab — shared server logic for the dev-only lesson tuning route
 * (app/dev/lesson-lab). Lets us iterate on the math + MCAT lesson SYSTEM PROMPTS
 * live: generate a lesson with an arbitrary (edited) system prompt + model, render
 * it with the real student renderer, compare against the stored lesson, and — only
 * on explicit request — replace the stored lesson.
 *
 * NEVER touches the lesson cache on generate (always fresh, never writes). The only
 * write path is `replaceStoredLesson`, behind the page's explicit "Replace" button.
 *
 * Gated: only usable when LESSON_LAB_ENABLED (dev/localhost) — the routes 404 in prod.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  generateMathLesson,
  generateMathQuestions,
  generateMathFlashcards,
  MATH_LESSON_SYSTEM,
  MATH_LESSON_OVERVIEW_SYSTEM,
  QUESTION_SYSTEM as MATH_QUESTION_SYSTEM,
  FLASHCARD_SYSTEM as MATH_FLASHCARD_SYSTEM,
} from "@/lib/mathGenerator";
import {
  generateMcatLesson,
  generateMcatQuestions,
  generateMcatFlashcards,
  MCAT_LESSON_SYSTEM,
  QUESTION_SYSTEM as MCAT_QUESTION_SYSTEM,
  FLASHCARD_SYSTEM as MCAT_FLASHCARD_SYSTEM,
} from "@/lib/mcatGenerator";
import {
  generateRefresherPreview,
  defaultRefresherSystem,
} from "@/lib/refresherGenerator";
import { enrichQuestionsInBackground } from "@/lib/questionEnrichment";
import { outlineContextForCategory as mathOutline } from "@/lib/mathContentOutline";
import { outlineContextForCategory as mcatOutline } from "@/lib/mcatContentOutline";
import { sectionFromId } from "@/lib/mcatSection";
import { resolveScopeContract } from "@/lib/scopeContract";
import { loadLessonNeighbors, type LessonNeighbor } from "@/lib/lessonNeighbors";
import { fetchAllPages } from "@/lib/mathPagedQuery";
import { type PromptSlotKind } from "@/lib/promptOverrides";

export type LabSystem = "math" | "mcat";
export type LabCourse = "precalc" | "calc_ab";
/** The four content types the lab can tune (each its own generator + prompt). */
export type LabContentType = "lesson" | "quiz" | "flashcards" | "refresher";

export function isLabContentType(v: unknown): v is LabContentType {
  return v === "lesson" || v === "quiz" || v === "flashcards" || v === "refresher";
}

/**
 * The override slot kind for a content type. A math umbrella lesson uses the
 * separate OVERVIEW prompt, so `overview` splits "lesson" → "lesson_overview".
 */
export function labSlotKind(
  contentType: LabContentType,
  overview: boolean
): PromptSlotKind {
  return contentType === "lesson" && overview ? "lesson_overview" : contentType;
}

/** Dev gate — the lab is for local prompt tuning, never production students. */
export const LESSON_LAB_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.LESSON_LAB_ENABLED === "1";

/** Default model used when the page does not override it. */
export const LAB_DEFAULT_MODEL = "gpt-5.4-mini";

/** Model choices offered in the lab dropdown. */
export const LAB_MODELS = ["gpt-5.4-mini", "gpt-5.4", "gemini-3.5-flash"] as const;

const KEYWORDS_TABLE: Record<LabSystem, "math_keywords" | "mcat_keywords"> = {
  math: "math_keywords",
  mcat: "mcat_keywords",
};
const LESSONS_TABLE: Record<LabSystem, "math_lessons" | "mcat_lessons"> = {
  math: "math_lessons",
  mcat: "mcat_lessons",
};
const QUESTIONS_TABLE: Record<LabSystem, "math_questions" | "mcat_questions"> = {
  math: "math_questions",
  mcat: "mcat_questions",
};
const FLASHCARDS_TABLE: Record<LabSystem, "math_flashcards" | "mcat_flashcards"> = {
  math: "math_flashcards",
  mcat: "mcat_flashcards",
};
const REFRESHERS_TABLE: Record<LabSystem, "math_refreshers" | "mcat_refreshers"> = {
  math: "math_refreshers",
  mcat: "mcat_refreshers",
};

export function defaultSystemPrompt(system: LabSystem): string {
  return system === "math" ? MATH_LESSON_SYSTEM : MCAT_LESSON_SYSTEM;
}

/** Default system prompt for a given content type (the source string the lab seeds). */
export function defaultSystemPromptFor(
  system: LabSystem,
  contentType: LabContentType
): string {
  switch (contentType) {
    case "quiz":
      return system === "math" ? MATH_QUESTION_SYSTEM : MCAT_QUESTION_SYSTEM;
    case "flashcards":
      return system === "math" ? MATH_FLASHCARD_SYSTEM : MCAT_FLASHCARD_SYSTEM;
    case "refresher":
      return defaultRefresherSystem(system);
    case "lesson":
    default:
      return defaultSystemPrompt(system);
  }
}

/** Whether a content type supports a per-keyword "stored" item to compare against. */
export function contentTypeHasStored(contentType: LabContentType): boolean {
  return contentType !== "quiz"; // quiz questions live in a pool, not one unit/keyword
}

/**
 * Default OVERVIEW-mode prompt (umbrella/topic keywords). Math has a dedicated
 * brief-overview prompt; MCAT has no overview mode yet (Phase 1 is math-only), so
 * it falls back to the normal teaching prompt.
 */
export function defaultOverviewPrompt(system: LabSystem): string {
  return system === "math" ? MATH_LESSON_OVERVIEW_SYSTEM : MCAT_LESSON_SYSTEM;
}

/** Service-role client (bypasses RLS) for the dev lab routes. Null if unconfigured. */
export function createLabClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export function isLabSystem(v: unknown): v is LabSystem {
  return v === "math" || v === "mcat";
}

// ─── Keyword picker data ──────────────────────────────────────────────────────

export interface LabKeyword {
  id: string;
  label: string;
  tier: string | null;
  parent_keyword_id: string | null;
  /** Per-parent order; -1 marks an intro keyword (opens its umbrella). */
  order_index: number | null;
}
export interface LabCategory {
  category_id: string;
  category_label: string;
  order_index: number;
  /** MCAT section (biology|psych_soc|chemistry|physics); null for math. */
  section: string | null;
  keywords: LabKeyword[];
}

/** Display order of the MCAT sections in the picker (Bio → Psych → Chem → Physics). */
const MCAT_SECTION_RANK: Record<string, number> = {
  biology: 0,
  psych_soc: 1,
  chemistry: 2,
  physics: 3,
};

interface KwRow {
  id: string;
  category_id: string;
  label: string;
  tier: string | null;
  parent_keyword_id: string | null;
  order_index: number | null;
}

/** Categories (with their keywords) for the picker tree/search. */
export async function loadLabKeywords(
  supabase: SupabaseClient,
  system: LabSystem,
  course: LabCourse
): Promise<LabCategory[]> {
  if (system === "math") {
    const { data: memberships, error: mErr } = await supabase
      .from("math_course_categories")
      .select("category_id, order_index")
      .eq("course", course)
      .order("order_index");
    if (mErr || !memberships?.length) return [];
    const categoryIds = memberships.map((m) => m.category_id as string);

    const [catsRes, keywords] = await Promise.all([
      supabase
        .from("math_categories")
        .select("id, label, order_index")
        .in("id", categoryIds),
      fetchAllPages<KwRow>((from, to) =>
        supabase
          .from("math_keywords")
          .select("id, category_id, label, tier, parent_keyword_id, order_index")
          .in("category_id", categoryIds)
          .order("order_index")
          .order("id") // stable tiebreaker — order_index collides, paginating without it drops/dupes rows
          .range(from, to)
      ),
    ]);
    const cats = (catsRes.data ?? []) as { id: string; label: string; order_index: number | null }[];
    return groupKeywords(cats, keywords, memberships as { category_id: string; order_index: number | null }[]);
  }

  // MCAT — categories grouped/ordered BY SECTION (each section restarts order_index
  // at 0, so a raw order_index sort interleaves the 4 sections). Composite order =
  // sectionRank*1000 + order_index keeps each section contiguous and in CED order.
  const [catsRes, kwRes] = await Promise.all([
    supabase.from("mcat_categories").select("id, label, order_index, section"),
    fetchAllPages<KwRow>((from, to) =>
      supabase
        .from("mcat_keywords")
        .select("id, category_id, label, tier, parent_keyword_id, order_index")
        .eq("status", "approved")
        .order("order_index")
        .order("id") // stable tiebreaker — order_index collides, paginating without it drops/dupes rows
        .range(from, to)
    ),
  ]);
  const rawCats = (catsRes.data ?? []) as {
    id: string;
    label: string;
    order_index: number | null;
    section: string | null;
  }[];
  const cats = rawCats.map((c) => ({
    id: c.id,
    label: c.label,
    section: c.section,
    order_index: (MCAT_SECTION_RANK[c.section ?? ""] ?? 9) * 1000 + (c.order_index ?? 0),
  }));
  return groupKeywords(cats, kwRes, null);
}

function groupKeywords(
  cats: { id: string; label: string; order_index: number | null; section?: string | null }[],
  keywords: KwRow[],
  memberships: { category_id: string; order_index: number | null }[] | null
): LabCategory[] {
  const orderOf = new Map<string, number>();
  if (memberships) memberships.forEach((m) => orderOf.set(m.category_id, m.order_index ?? 0));
  const byCat = new Map<string, KwRow[]>();
  for (const k of keywords) {
    if (!byCat.has(k.category_id)) byCat.set(k.category_id, []);
    byCat.get(k.category_id)!.push(k);
  }
  return cats
    .map((c): LabCategory => ({
      category_id: c.id,
      category_label: c.label,
      order_index: orderOf.get(c.id) ?? c.order_index ?? 0,
      section: c.section ?? null,
      keywords: orderKeywordsHierarchically(byCat.get(c.id) ?? []),
    }))
    .filter((c) => c.keywords.length > 0)
    .sort((a, b) => a.order_index - b.order_index);
}

/**
 * Curriculum order for the picker: each umbrella followed by ITS in_depth
 * children, every list sorted by `order_index` (intro = -1 sorts first). A flat
 * `order_index` sort is WRONG because order_index resets per parent, so an
 * in_depth child can collide with an umbrella — we sort within each parent group.
 */
function orderKeywordsHierarchically(rows: KwRow[]): LabKeyword[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenOf = new Map<string, KwRow[]>();
  const tops: KwRow[] = [];
  for (const r of rows) {
    const pid = r.parent_keyword_id;
    if (pid && byId.has(pid)) {
      let arr = childrenOf.get(pid);
      if (!arr) childrenOf.set(pid, (arr = []));
      arr.push(r);
    } else {
      tops.push(r);
    }
  }
  const byOrder = (a: KwRow, b: KwRow) =>
    (a.order_index ?? 0) - (b.order_index ?? 0) || a.label.localeCompare(b.label);
  tops.sort(byOrder);
  childrenOf.forEach((list) => list.sort(byOrder));

  const toKw = (r: KwRow): LabKeyword => ({
    id: r.id,
    label: r.label,
    tier: r.tier,
    parent_keyword_id: r.parent_keyword_id,
    order_index: r.order_index,
  });
  const out: LabKeyword[] = [];
  const emitted = new Set<string>();
  for (const top of tops) {
    out.push(toKw(top));
    emitted.add(top.id);
    for (const child of childrenOf.get(top.id) ?? []) {
      out.push(toKw(child));
      emitted.add(child.id);
    }
  }
  // Any leftovers (children whose parent wasn't in this category) — append in order.
  for (const r of rows) if (!emitted.has(r.id)) out.push(toKw(r));
  return out;
}

// ─── Per-keyword context (scope contract + neighbors + stored lesson) ─────────

export interface KeywordContext {
  keyword_id: string;
  keyword_label: string;
  description: string;
  examples?: string;
  /** Keyword tier — drives overview-vs-teaching lesson mode (umbrella → overview). */
  tier: string | null;
  /** Category id — needed for quiz/flashcard write-back inserts. */
  category_id: string;
  outlineContext?: string;
  neighbors: LessonNeighbor[];
  /** Resolved scope contract (stored blueprint merged with derived forward fence). */
  blueprint: unknown;
}

export async function loadKeywordContext(
  supabase: SupabaseClient,
  system: LabSystem,
  keywordId: string
): Promise<KeywordContext | null> {
  const table = KEYWORDS_TABLE[system];
  const { data: kwRow } = await supabase
    .from(table)
    .select("id, label, description, examples, category_id, concept_blueprint, tier, parent_keyword_id")
    .eq("id", keywordId)
    .maybeSingle();
  if (!kwRow) return null;

  const examplesText = Array.isArray(kwRow.examples)
    ? (kwRow.examples as string[]).filter(Boolean).join("; ")
    : ((kwRow.examples as string | null) ?? undefined);

  const outlineContext = (system === "math" ? mathOutline : mcatOutline)(
    kwRow.category_id as string
  );

  const storedBlueprint = (kwRow.concept_blueprint as unknown) ?? null;
  const contract = await resolveScopeContract(supabase, table, {
    id: kwRow.id as string,
    label: kwRow.label as string,
    description: (kwRow.description as string) ?? "",
    tier: (kwRow.tier as string | null) ?? null,
    parent_keyword_id: (kwRow.parent_keyword_id as string | null) ?? null,
    category_id: kwRow.category_id as string,
    // resolveScopeContract is shared across both blueprint shapes
    concept_blueprint: storedBlueprint as never,
  });

  const neighbors = await loadLessonNeighbors(supabase, table, {
    id: kwRow.id as string,
    category_id: kwRow.category_id as string,
    parent_keyword_id: (kwRow.parent_keyword_id as string | null) ?? null,
  });

  return {
    keyword_id: kwRow.id as string,
    keyword_label: kwRow.label as string,
    description: (kwRow.description as string) ?? "",
    examples: examplesText,
    tier: (kwRow.tier as string | null) ?? null,
    category_id: kwRow.category_id as string,
    outlineContext,
    neighbors,
    blueprint: (contract as unknown) ?? storedBlueprint,
  };
}

// ─── Stored lesson (the "current / live" side of the compare) ─────────────────

export async function loadStoredLesson(
  supabase: SupabaseClient,
  system: LabSystem,
  keywordId: string
): Promise<{ micro_steps: unknown; model: string | null; generated_at: string | null } | null> {
  const { data } = await supabase
    .from(LESSONS_TABLE[system])
    .select("micro_steps, model, generated_at")
    .eq("keyword_id", keywordId)
    .maybeSingle();
  if (!data) return null;
  return {
    micro_steps: data.micro_steps,
    model: (data.model as string | null) ?? null,
    generated_at: (data.generated_at as string | null) ?? null,
  };
}

// ─── Generate (ALWAYS fresh, NEVER cached) ────────────────────────────────────

export interface LabGenerateResult {
  micro_steps: unknown;
  assembled_user_prompt: string;
  system_prompt_used: string;
  model: string;
}

export async function generateLabLesson(
  ctx: KeywordContext,
  system: LabSystem,
  systemPrompt: string,
  model: string
): Promise<LabGenerateResult> {
  let assembled = "";
  const onUserPrompt = (p: string) => {
    assembled = p;
  };
  const kwMeta = {
    id: ctx.keyword_id,
    label: ctx.keyword_label,
    description: ctx.description,
    examples: ctx.examples,
    blueprint: ctx.blueprint as never,
    tier: ctx.tier,
  };

  const lesson =
    system === "math"
      ? await generateMathLesson(kwMeta, ctx.outlineContext, undefined, {
          systemPrompt,
          model,
          neighbors: ctx.neighbors,
          onUserPrompt,
        })
      : await generateMcatLesson(kwMeta, ctx.outlineContext, {
          systemPrompt,
          model,
          neighbors: ctx.neighbors,
          onUserPrompt,
        });

  return {
    micro_steps: lesson.micro_steps,
    assembled_user_prompt: assembled,
    system_prompt_used: systemPrompt,
    model,
  };
}

// ─── Replace the stored lesson (explicit, the ONLY write path) ────────────────

export async function replaceStoredLesson(
  supabase: SupabaseClient,
  system: LabSystem,
  keywordId: string,
  microSteps: unknown,
  model: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(LESSONS_TABLE[system])
    .upsert(
      { keyword_id: keywordId, micro_steps: microSteps, model },
      { onConflict: "keyword_id" }
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ─── Generalized content (quiz / flashcards / refresher / lesson) ─────────────
//
// One lab, four content types. Each maps to a real generator and (where it makes
// sense) a stored table. `preview` is a normalized shape the page renders with the
// real MathText renderer; `raw` is the native generator output the save path writes.

export interface LabQuizItem {
  stem: string;
  choices: string[];
  correct_index: number;
  explanation: string;
  difficulty: number;
}
export interface LabFlashcardItem {
  front: string;
  back: string;
}
export type LabPreview =
  | { kind: "lesson"; micro_steps: unknown }
  | { kind: "quiz"; questions: LabQuizItem[] }
  | { kind: "flashcards"; flashcards: LabFlashcardItem[] }
  | { kind: "refresher"; rule_latex: string; example_latex: string };

export interface LabContentResult {
  preview: LabPreview;
  /** Native generator output, sent back verbatim to the save path. */
  raw: unknown;
  assembled_user_prompt: string;
  model: string;
}

// Lab quiz: content-driven count — generate as many questions as the keyword's
// in-scope concepts actually support. A narrow topic may yield just a few; a
// broad one may yield many. QUIZ_SAFETY_CAP is an upper guard only, never a
// target the model should pad to reach.
const QUIZ_SAFETY_CAP = 20;
const FLASHCARD_PREVIEW_COUNT = 10;

/**
 * Lab quiz batch directive (routed into the generator's BATCH DIVERSITY slot).
 * (1) COVER every in-scope concept/sub-idea (one question per concept; combine
 * closely related ones; skip nothing), (2) PREFER distinct coverage but never
 * sacrifice a question's quality or correctness to make it different — a good,
 * correct, in-scope question beats a forced-different worse one, and (3)
 * deliberately SPAN difficulty easy→hard, each question's `difficulty` set to
 * its true load.
 */
const LAB_QUIZ_DIVERSITY =
  "Together the questions must COVER EVERY in-scope concept/sub-idea of this keyword (one question per concept; combine closely related ones; skip nothing). PREFER distinct coverage but never sacrifice a question's quality or correctness to make it different — a good, correct, in-scope question beats a forced-different worse one. Deliberately SPAN the difficulty range: include clearly EASY single-step items, MEDIUM application items, and HARD multi-step items, and set each question's difficulty field (about 0.30 easy → 0.80 hard) to its true cognitive load.";

/** The stored ("live") item for the compare column. Quiz has none (pool, not a unit). */
export async function loadStoredContent(
  supabase: SupabaseClient,
  system: LabSystem,
  contentType: LabContentType,
  keywordId: string
): Promise<{ preview: LabPreview | null; model: string | null; generated_at: string | null }> {
  if (contentType === "lesson") {
    const stored = await loadStoredLesson(supabase, system, keywordId);
    return {
      preview: stored ? { kind: "lesson", micro_steps: stored.micro_steps } : null,
      model: stored?.model ?? null,
      generated_at: stored?.generated_at ?? null,
    };
  }
  if (contentType === "refresher") {
    const { data } = await supabase
      .from(REFRESHERS_TABLE[system])
      .select("rule_latex, example_latex, model, generated_at")
      .eq("keyword_id", keywordId)
      .maybeSingle();
    return {
      preview: data
        ? { kind: "refresher", rule_latex: (data.rule_latex as string) ?? "", example_latex: (data.example_latex as string) ?? "" }
        : null,
      model: (data?.model as string | null) ?? null,
      generated_at: (data?.generated_at as string | null) ?? null,
    };
  }
  if (contentType === "flashcards") {
    const cols = system === "math" ? "front_latex, back_latex" : "front, back";
    const { data } = await supabase
      .from(FLASHCARDS_TABLE[system])
      .select(cols)
      .eq("primary_keyword_id", keywordId)
      .eq("status", "active");
    const cards = (data ?? []) as Array<Record<string, unknown>>;
    const flashcards: LabFlashcardItem[] = cards.map((c) =>
      system === "math"
        ? { front: String(c.front_latex ?? ""), back: String(c.back_latex ?? "") }
        : { front: String(c.front ?? ""), back: String(c.back ?? "") }
    );
    return {
      preview: flashcards.length ? { kind: "flashcards", flashcards } : null,
      model: null,
      generated_at: null,
    };
  }
  // quiz — questions live in a shared pool, no single stored unit per keyword
  return { preview: null, model: null, generated_at: null };
}

/** Generate FRESH content of any type (never cached). Returns preview + raw. */
export async function generateLabContent(
  ctx: KeywordContext,
  system: LabSystem,
  contentType: LabContentType,
  systemPrompt: string,
  model: string,
  // When true, assemble the user prompt and return WITHOUT calling the model.
  // Used by the lab's "Preview prompt" — `assembled_user_prompt` is the full
  // user message; `preview`/`raw` come back empty.
  previewOnly = false
): Promise<LabContentResult> {
  let assembled = "";
  const onUserPrompt = (p: string) => {
    assembled = p;
  };
  const kwMeta = {
    id: ctx.keyword_id,
    label: ctx.keyword_label,
    description: ctx.description,
    blueprint: ctx.blueprint as never,
  };

  if (contentType === "lesson") {
    const lessonMeta = { ...kwMeta, examples: ctx.examples, tier: ctx.tier };
    const lesson =
      system === "math"
        ? await generateMathLesson(lessonMeta, ctx.outlineContext, undefined, {
            systemPrompt,
            model,
            neighbors: ctx.neighbors,
            onUserPrompt,
            previewOnly,
          })
        : await generateMcatLesson(lessonMeta, ctx.outlineContext, {
            systemPrompt,
            model,
            neighbors: ctx.neighbors,
            onUserPrompt,
            previewOnly,
          });
    return {
      preview: { kind: "lesson", micro_steps: lesson.micro_steps },
      raw: lesson.micro_steps,
      assembled_user_prompt: assembled,
      model,
    };
  }

  if (contentType === "quiz") {
    if (system === "math") {
      const qs = await generateMathQuestions({
        keywords: [kwMeta],
        count: QUIZ_SAFETY_CAP,
        difficultyTier: "medium",
        diversityDirective: LAB_QUIZ_DIVERSITY,
        outlineContext: ctx.outlineContext,
        systemPrompt,
        model,
        onUserPrompt,
        previewOnly,
      });
      const questions = qs.map((q) => ({
        stem: q.stem_latex,
        choices: q.choices as string[],
        correct_index: q.correct_index,
        explanation: q.solution_latex,
        difficulty: q.difficulty,
      }));
      return { preview: { kind: "quiz", questions }, raw: qs, assembled_user_prompt: assembled, model };
    }
    const qs = await generateMcatQuestions({
      keywords: [kwMeta],
      templateCards: [],
      count: QUIZ_SAFETY_CAP,
      difficultyTier: "medium",
      diversityDirective: LAB_QUIZ_DIVERSITY,
      outlineContext: ctx.outlineContext,
      systemPrompt,
      model,
      onUserPrompt,
      previewOnly,
    });
    const questions = qs.map((q) => ({
      stem: q.stem,
      choices: q.choices as string[],
      correct_index: q.correct_index,
      explanation: q.explanation,
      difficulty: q.difficulty,
    }));
    return { preview: { kind: "quiz", questions }, raw: qs, assembled_user_prompt: assembled, model };
  }

  if (contentType === "flashcards") {
    if (system === "math") {
      const cards = await generateMathFlashcards({
        keywords: [kwMeta],
        count: FLASHCARD_PREVIEW_COUNT,
        outlineContext: ctx.outlineContext,
        systemPrompt,
        model,
        onUserPrompt,
        previewOnly,
      });
      const flashcards = cards.map((c) => ({ front: c.front_latex, back: c.back_latex }));
      return { preview: { kind: "flashcards", flashcards }, raw: cards, assembled_user_prompt: assembled, model };
    }
    const cards = await generateMcatFlashcards({
      keywords: [kwMeta],
      templateCards: [],
      count: FLASHCARD_PREVIEW_COUNT,
      outlineContext: ctx.outlineContext,
      systemPrompt,
      model,
      onUserPrompt,
      previewOnly,
    });
    const flashcards = cards.map((c) => ({ front: c.front, back: c.back }));
    return { preview: { kind: "flashcards", flashcards }, raw: cards, assembled_user_prompt: assembled, model };
  }

  // refresher
  const refMeta = {
    id: ctx.keyword_id,
    label: ctx.keyword_label,
    description: ctx.description,
    examples: ctx.examples,
    blueprint: ctx.blueprint as never,
  };
  const refresher = await generateRefresherPreview(system, refMeta, {
    systemPrompt,
    model,
    onUserPrompt,
    previewOnly,
  });
  return {
    preview: {
      kind: "refresher",
      rule_latex: refresher?.rule_latex ?? "",
      example_latex: refresher?.example_latex ?? "",
    },
    raw: refresher ?? { rule_latex: "", example_latex: "" },
    assembled_user_prompt: assembled,
    model,
  };
}

/**
 * Write-back for the lab. Lesson + refresher upsert per keyword; flashcards replace
 * the keyword's deck; quiz inserts into the shared pool ("save to pool") + enriches.
 */
export async function saveLabContent(
  supabase: SupabaseClient,
  system: LabSystem,
  contentType: LabContentType,
  ctx: KeywordContext,
  raw: unknown,
  model: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (contentType === "lesson") {
      return await replaceStoredLesson(supabase, system, ctx.keyword_id, raw, model);
    }

    if (contentType === "refresher") {
      const r = (raw ?? {}) as { rule_latex?: string; example_latex?: string };
      const { error } = await supabase.from(REFRESHERS_TABLE[system]).upsert(
        {
          keyword_id: ctx.keyword_id,
          rule_latex: r.rule_latex ?? "",
          example_latex: r.example_latex ?? "",
          model,
        },
        { onConflict: "keyword_id" }
      );
      return error ? { ok: false, error: error.message } : { ok: true };
    }

    if (contentType === "flashcards") {
      // Replace the keyword's deck: drop the existing active cards, insert the new set.
      const cards = (raw as Array<Record<string, unknown>>) ?? [];
      if (cards.length === 0) return { ok: false, error: "No cards to save." };
      await supabase.from(FLASHCARDS_TABLE[system]).delete().eq("primary_keyword_id", ctx.keyword_id);
      const rows = cards.map((c) =>
        system === "math"
          ? {
              category_id: ctx.category_id,
              front_latex: c.front_latex,
              back_latex: c.back_latex,
              keyword_weights: c.keyword_weights ?? { [ctx.keyword_id]: 1 },
              primary_keyword_id: ctx.keyword_id,
              generated_by: model,
              status: "active",
            }
          : {
              section: sectionFromId(ctx.category_id),
              category_id: ctx.category_id,
              front: c.front,
              back: c.back,
              keyword_weights: c.keyword_weights ?? { [ctx.keyword_id]: 1 },
              primary_keyword_id: ctx.keyword_id,
              generated_by: model,
              status: "active",
            }
      );
      const { error } = await supabase.from(FLASHCARDS_TABLE[system]).insert(rows);
      return error ? { ok: false, error: error.message } : { ok: true };
    }

    // quiz → save to the shared question pool, then enrich (embeddings/tags) in bg.
    const qs = (raw as Array<Record<string, unknown>>) ?? [];
    if (qs.length === 0) return { ok: false, error: "No questions to save." };
    const rows = qs.map((q) =>
      system === "math"
        ? {
            category_id: ctx.category_id,
            stem_latex: q.stem_latex,
            choices: q.choices,
            correct_index: q.correct_index,
            solution_latex: q.solution_latex,
            hint_latex: q.hint_latex,
            keyword_weights: q.keyword_weights,
            difficulty: q.difficulty,
            source: "generated",
            status: "active",
          }
        : {
            section: sectionFromId(ctx.category_id),
            category_id: ctx.category_id,
            stem: q.stem,
            choices: q.choices,
            correct_index: q.correct_index,
            explanation: q.explanation,
            keyword_weights: q.keyword_weights,
            difficulty: q.difficulty,
            generated_by: model,
            status: "active",
          }
    );
    const { data: inserted, error } = await supabase
      .from(QUESTIONS_TABLE[system])
      .insert(rows)
      .select("id");
    if (error) return { ok: false, error: error.message };
    const ids = ((inserted ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length) enrichQuestionsInBackground(supabase, system, ids);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}
