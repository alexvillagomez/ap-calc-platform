/**
 * scopeIds — the keyword identity + per-keyword scope block injected into every
 * generator's user prompt (lesson / quiz / flashcards / refresher, math + MCAT).
 *
 * The generators are pure (no DB), so — like `promptOverrides.resolveSystemPrompt`
 * — this module creates its own service-role client and is cached, letting every
 * generator self-populate the block from just the keyword id (no caller changes).
 *
 * For each target keyword we surface:
 *   - key_terms          (blueprint) → the essential vocabulary the content must name/cover
 *   - in_scope_concepts  (blueprint) → the only ideas to cover for this keyword
 *   - out_of_scope       (blueprint) → later / separate topics the content must NOT cover
 *   - ALREADY COVERED    (curriculum) → earlier-in-order neighbor keyword LABELS the
 *                          student has already learned — assume them, build on them,
 *                          never re-define/re-derive (stops a lesson re-teaching its
 *                          prerequisites, e.g. glycine re-explaining chirality).
 * Fail-open: any error → empty fields.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cached } from "@/lib/serverCache";

export type ScopeSystem = "math" | "mcat";

const TABLE: Record<ScopeSystem, "math_keywords" | "mcat_keywords"> = {
  math: "math_keywords",
  mcat: "mcat_keywords",
};

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function examplesToText(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    const s = raw.filter(Boolean).join("; ");
    return s || null;
  }
  if (typeof raw === "string" && raw.trim()) return raw;
  return null;
}

/** Coerce a blueprint JSON field into a clean string[] (trimmed, no empties). */
function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
}

export interface KeywordScopeInfo {
  examples: string | null;
  /** Essential vocabulary of this keyword (concept_blueprint.key_terms). */
  keyTerms: string[];
  /** The only ideas to cover for this keyword (concept_blueprint.in_scope_concepts). */
  inScope: string[];
  /** Later / separate topics to NOT cover (concept_blueprint.out_of_scope). */
  outOfScope: string[];
  /** Earlier-in-curriculum neighbor LABELS — already taught, assume & build on. */
  alreadyCovered: string[];
  /**
   * MCAT only — complete enumeration of facts the content MUST teach/test, none
   * dropped (concept_blueprint.must_state_facts). Empty for math keywords (which
   * have no must_state_facts field) — renders nothing when empty.
   */
  mustStateFacts: string[];
  /**
   * MCAT only — the single most common wrong-answer pattern for this keyword
   * (concept_blueprint.common_trap). Null/empty = omit from prompt.
   */
  commonTrap: string | null;
}

const EMPTY_INFO: KeywordScopeInfo = {
  examples: null,
  keyTerms: [],
  inScope: [],
  outOfScope: [],
  alreadyCovered: [],
  mustStateFacts: [],
  commonTrap: null,
};

/** Fields needed to rank a keyword in curriculum order. */
type RankFields = {
  tier: string | null;
  parent_keyword_id: string | null;
  order_index: number | null;
};

interface KwLite extends RankFields {
  id: string;
  label: string;
}

/**
 * Curriculum rank within a category: an umbrella sits at the head of its block,
 * its children follow. umbrella → umbOrder*1000; child → parentUmbOrder*1000 + 1 +
 * order_index. Comparable across the whole category so "before/after the target"
 * is a single numeric compare. (order_index resets PER PARENT, so a raw compare is
 * wrong — the composite rank is required.)
 */
function curriculumRank(k: RankFields, umbOrder: Map<string, number>): number {
  if (k.tier === "umbrella") return (k.order_index ?? 0) * 1000;
  const uo = k.parent_keyword_id ? umbOrder.get(k.parent_keyword_id) ?? 0 : 0;
  return uo * 1000 + 1 + (k.order_index ?? 0);
}

/**
 * For one keyword: its examples + authored scope contract (key terms, in-scope,
 * out-of-scope) plus the LABELS of earlier-in-order neighbors (same-umbrella
 * siblings + other umbrellas in the category) the student has already covered.
 * Cached per (system, keyword) — taxonomy is static, 5-min TTL.
 */
export async function loadKeywordScopeInfo(
  system: ScopeSystem,
  keywordId: string
): Promise<KeywordScopeInfo> {
  try {
    return await cached(`scopeids3:${system}:${keywordId}`, 300_000, async () => {
      const sb = serviceClient();
      if (!sb) return EMPTY_INFO;
      const tbl = TABLE[system];

      const { data: target } = await sb
        .from(tbl)
        .select("id, category_id, parent_keyword_id, tier, order_index, examples, concept_blueprint")
        .eq("id", keywordId)
        .maybeSingle();
      if (!target) return EMPTY_INFO;

      const bp = (target.concept_blueprint ?? {}) as Record<string, unknown>;

      // Earlier-in-curriculum neighbors → "ALREADY COVERED" (assume, build on).
      let q = sb
        .from(tbl)
        .select("id, tier, parent_keyword_id, order_index, label")
        .eq("category_id", target.category_id as string);
      if (system === "mcat") q = q.eq("status", "approved");
      const { data: rows } = await q;
      const all = (rows ?? []) as KwLite[];

      const umbOrder = new Map<string, number>();
      for (const k of all) if (k.tier === "umbrella") umbOrder.set(k.id, k.order_index ?? 0);

      const parent = (target.parent_keyword_id as string | null) ?? null;
      const targetUmb = target.tier === "umbrella" ? (target.id as string) : parent;
      const targetRank = curriculumRank(target as RankFields, umbOrder);

      const earlier: { label: string; r: number }[] = [];
      for (const k of all) {
        if (k.id === keywordId) continue;
        const isSibling = k.tier === "in_depth" && !!parent && k.parent_keyword_id === parent;
        const isUmbrella = k.tier === "umbrella" && k.id !== targetUmb;
        if (!isSibling && !isUmbrella) continue;
        const r = curriculumRank(k, umbOrder);
        if (r < targetRank && k.label?.trim()) earlier.push({ label: k.label.trim(), r });
      }
      earlier.sort((a, b) => a.r - b.r);

      return {
        examples: examplesToText(target.examples),
        keyTerms: toStringArray(bp.key_terms),
        inScope: toStringArray(bp.in_scope_concepts),
        outOfScope: toStringArray(bp.out_of_scope),
        alreadyCovered: earlier.map((x) => x.label),
        mustStateFacts: toStringArray(bp.must_state_facts),
        commonTrap:
          typeof bp.common_trap === "string" && bp.common_trap.trim()
            ? bp.common_trap.trim()
            : null,
      };
    });
  } catch {
    return EMPTY_INFO;
  }
}

/** Minimal keyword shape the identity block needs. */
export interface IdentityKeyword {
  id: string;
  label: string;
  description: string;
}

/**
 * The block embedded in every generator's user prompt. Each target keyword is
 * rendered self-contained (works for a single keyword or a batch):
 *   id / label / description / examples
 *   key terms        — the vocabulary to name & cover
 *   in scope         — the only ideas to cover
 *   out of scope     — later/separate topics to NOT cover (the forward fence)
 *   already covered  — earlier topics the student knows; assume & build on, never re-teach
 *
 * `keywordWeights` appends the "use only these ids in keyword_weights" note for
 * the quiz/flashcard generators (lessons/refreshers don't emit weights).
 */
export async function buildIdentityScopeBlock(
  system: ScopeSystem,
  keywords: IdentityKeyword[],
  opts?: { keywordWeights?: boolean; forFlashcards?: boolean }
): Promise<string> {
  if (keywords.length === 0) return "";
  const infos = await Promise.all(
    keywords.map((k) => loadKeywordScopeInfo(system, k.id))
  );

  // Collect MUST-STATE FACTS across all keywords to render as a top-level block
  // BEFORE the per-keyword list (generators see it first). Only MCAT keywords carry
  // must_state_facts; math keywords have empty arrays, so the block is never emitted
  // for math prompts — fully backward-compatible.
  const allMustStateFacts: string[] = [];
  const allCommonTraps: string[] = [];
  for (const inf of infos) {
    for (const f of inf.mustStateFacts) allMustStateFacts.push(f);
    if (inf.commonTrap) allCommonTraps.push(inf.commonTrap);
  }

  const mustStateBlock =
    allMustStateFacts.length > 0
      ? `MUST-STATE FACTS — the content MUST teach/test ALL of the following, none dropped. Omitting any item is a coverage failure:\n${allMustStateFacts.map((f) => `  • ${f}`).join("\n")}${allCommonTraps.length > 0 ? `\nCOMMON TRAP: ${allCommonTraps.join(" | ")}` : ""}\n\n`
      : "";

  const blocks = keywords
    .map((k, i) => {
      const inf = infos[i];
      const lines = [
        `  - id: "${k.id}"`,
        `    label: "${k.label}"`,
        `    description: "${k.description}"`,
      ];
      if (inf.examples && !opts?.forFlashcards) lines.push(`    examples: "${inf.examples}"`);
      if (inf.keyTerms.length)
        lines.push(
          opts?.forFlashcards
            ? `    memorizable terms (card only the atomic facts among these): ${inf.keyTerms.join("; ")}`
            : `    key terms: ${inf.keyTerms.join("; ")}`
        );
      if (inf.inScope.length)
        lines.push(
          opts?.forFlashcards
            ? `    in scope — the deck's ANSWERS (backs) must cover these facts, combining closely related into ONE card; they are what to recall, NOT front wording (keep fronts terse): ${inf.inScope.join("; ")}`
            : `    in scope — cover ONLY these: ${inf.inScope.join("; ")}`
        );
      if (inf.outOfScope.length)
        lines.push(`    out of scope (do NOT cover): ${inf.outOfScope.join("; ")}`);
      if (inf.alreadyCovered.length)
        lines.push(
          `    already covered (assume known; build on, never re-derive): ${inf.alreadyCovered.join("; ")}`
        );
      return lines.join("\n");
    })
    .join("\n");

  const plural = keywords.length > 1 ? "S" : "";
  const weightsNote = opts?.keywordWeights
    ? ` (use ONLY ${keywords.length > 1 ? "these ids" : "this id"} in keyword_weights)`
    : "";
  const header = `TARGET KEYWORD${plural} — generate ONLY for ${
    keywords.length > 1 ? "these" : "this"
  }${weightsNote}:`;

  return `${mustStateBlock}${header}\n${blocks}`;
}
