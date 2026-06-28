/**
 * UNIVERSAL SCOPE-CONTRACT LAYER (math + mcat, all generation paths).
 *
 * WHY
 * ---
 * Generated content (questions, similar questions, lessons, flashcards,
 * refreshers, figures) keeps DRIFTING OUT OF a keyword's scope — it reaches
 * forward into LATER keywords' topics (e.g. an "Introducing Limit Notation"
 * lesson illustrating with a removable-discontinuity hole, or a table-estimation
 * question on that same intro keyword — both belong to later keywords).
 *
 * The root cause: every UMBRELLA keyword and ~24 intro/"meaning" in_depth
 * keywords have a NULL `concept_blueprint`, so the generators (which only inject
 * a SCOPE CONTRACT when a blueprint is present) ran with NO contract at all and
 * the model was free to drift.
 *
 * THE FIX
 * -------
 * This module guarantees that EVERY keyword, for EVERY generation type, ALWAYS
 * has a strict in_scope / out_of_scope / boundary contract — derived
 * deterministically from the taxonomy when a stored blueprint is absent, and
 * AUGMENTED (forward-fenced) even when one is present. The result is the same
 * `ConceptBlueprint` shape consumed by `buildBlueprintBlock`, so the existing
 * prompt-level enforcement in every generator fires uniformly.
 *
 * DETERMINISTIC DERIVATION (MECE + forward-aware)
 * -----------------------------------------------
 *   IN SCOPE  = this topic's own children (umbrella → its in_depth subtopics),
 *               or the keyword's own label for a leaf keyword.
 *   OUT OF SCOPE = concepts OWNED BY OTHER KEYWORDS in the same category:
 *               sibling subtopics + other umbrellas. Items that come LATER in
 *               course order (higher order_index) are explicitly flagged
 *               "(later topic — not yet introduced)" so the model physically
 *               cannot reach forward into a topic the student hasn't reached.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Structural shape shared by math + mcat ConceptBlueprint. */
export interface DerivedBlueprint {
  in_scope_concepts: string[];
  in_scope_formulas: string[];
  out_of_scope: string[];
  key_terms: string[];
  boundary_statement: string;
}

/** A taxonomy row as needed for scope derivation. Pre-sorted by order_index. */
export interface ScopeRow {
  id: string;
  label: string;
  tier: string | null;
  parent_keyword_id: string | null;
  order_index?: number | null;
}

export interface ScopeKeyword {
  id: string;
  label: string;
  description?: string | null;
  tier?: string | null;
  parent_keyword_id?: string | null;
  category_id?: string | null;
  concept_blueprint?: unknown;
}

const OUT_OF_SCOPE_CAP = 28;
const LATER_PREFIX = "(later topic — not yet introduced) ";

function isValidStoredBlueprint(bp: unknown): bp is DerivedBlueprint {
  if (!bp || typeof bp !== "object") return false;
  const o = bp as Record<string, unknown>;
  return (
    Array.isArray(o.in_scope_concepts) &&
    o.in_scope_concepts.length > 0 &&
    Array.isArray(o.out_of_scope) &&
    typeof o.boundary_statement === "string"
  );
}

/**
 * Composite course-order rank for every row.
 *
 * `order_index` is scoped PER PARENT (an umbrella's children are 0,1,2…; a
 * different umbrella's children are also 0,1,2…), so a raw order_index compare
 * is meaningless across siblings. Real course order is:
 *   (umbrella's order_index, then the umbrella itself, then its children in order).
 * We encode that as umbrellaOrder*1000 + childOffset so "later" comparisons are
 * correct across the whole category.
 */
function rankMap(rows: ScopeRow[]): Map<string, number> {
  // umbrella id -> its order_index
  const umbrellaOrder = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.tier === "umbrella") umbrellaOrder.set(r.id, r.order_index ?? i);
  });
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.tier === "umbrella") {
      m.set(r.id, (r.order_index ?? 0) * 1000); // umbrella precedes its children
    } else {
      const uOrder = r.parent_keyword_id
        ? umbrellaOrder.get(r.parent_keyword_id) ?? 0
        : 0;
      m.set(r.id, uOrder * 1000 + (r.order_index ?? 0) + 1);
    }
  }
  return m;
}

/**
 * PURE derivation: build a scope contract for `kw` from the FULL set of keyword
 * rows in its category (umbrellas + in_depth), pre-sorted by order_index.
 *
 * Always returns a contract (never null) as long as there is at least one other
 * keyword to fence against; returns null only when the category is degenerate
 * (no siblings/umbrellas at all), in which case callers keep any stored value.
 */
export function deriveScopeFromRows(
  kw: ScopeKeyword,
  rows: ScopeRow[]
): DerivedBlueprint | null {
  if (rows.length === 0) return null;

  const rank = rankMap(rows);
  const selfRank = rank.get(kw.id) ?? Number.MAX_SAFE_INTEGER;
  const umbrellas = rows.filter((r) => r.tier === "umbrella");
  const isUmbrella = kw.tier === "umbrella";

  // Tag an out-of-scope label as "later" when it comes after kw in course order.
  const fence = (r: ScopeRow): string => {
    const isLater = (rank.get(r.id) ?? 0) > selfRank;
    return isLater ? `${LATER_PREFIX}${r.label}` : r.label;
  };

  let inScope: string[];
  const outRows: ScopeRow[] = [];

  if (isUmbrella) {
    const children = rows.filter((r) => r.parent_keyword_id === kw.id);
    inScope = children.length > 0 ? children.map((r) => r.label) : [kw.label];
    // Other umbrellas (their whole subtree) are out of scope.
    for (const u of umbrellas) if (u.id !== kw.id) outRows.push(u);
  } else {
    // in_depth (or leaf): own scope; siblings under the same umbrella + other
    // umbrellas are out of scope. Later siblings are the critical forward-drift
    // case (e.g. intro-limit-notation must not use removable discontinuity).
    inScope = [kw.label];
    for (const r of rows) {
      if (r.id === kw.id) continue;
      const sameParent =
        r.parent_keyword_id === kw.parent_keyword_id &&
        kw.parent_keyword_id != null;
      const otherUmbrella = r.tier === "umbrella" && r.id !== kw.parent_keyword_id;
      if (sameParent || otherUmbrella) outRows.push(r);
    }
  }

  // Build labels: later items flagged, dedup, cap (later items kept first so the
  // forward fence is never truncated away).
  const seen = new Set<string>();
  const later: string[] = [];
  const earlier: string[] = [];
  for (const r of outRows) {
    const label = fence(r);
    if (seen.has(label)) continue;
    seen.add(label);
    (label.startsWith(LATER_PREFIX) ? later : earlier).push(label);
  }
  const outScope = [...later, ...earlier].slice(0, OUT_OF_SCOPE_CAP);
  if (outScope.length === 0) return null;

  const boundary =
    `This content covers ONLY the "${kw.label}" topic. The explanation, every ` +
    `worked EXAMPLE, every QUESTION, every FLASHCARD, and any FIGURE must use ONLY ` +
    `ideas that belong to this topic. Do NOT introduce a technique, special case, ` +
    `notation, or concept owned by another topic in the OUT OF SCOPE list — and ` +
    `NEVER reach forward into a "(later topic — not yet introduced)" item, because ` +
    `the student has not learned it yet. Pick the SIMPLEST illustration that stays ` +
    `inside this topic (e.g. for an introductory limit-notation lesson, show the ` +
    `limit as the value a continuous function approaches; do NOT use a hole / ` +
    `removable discontinuity, factor-and-cancel, or a table of values — those are ` +
    `later topics).`;

  return {
    in_scope_concepts: inScope,
    in_scope_formulas: [],
    out_of_scope: outScope,
    key_terms: [],
    boundary_statement: boundary,
  };
}

/**
 * Merge a real stored blueprint with the deterministically-derived contract:
 * keep the stored in_scope/formulas/key_terms/boundary (authored, precise), but
 * AUGMENT out_of_scope with the derived sibling + later-topic labels so even a
 * blueprinted keyword is forward-fenced (stored blueprints rarely enumerate the
 * later topics they must not reach into).
 */
export function mergeContract(
  stored: DerivedBlueprint,
  derived: DerivedBlueprint | null
): DerivedBlueprint {
  if (!derived) return stored;
  const seen = new Set(stored.out_of_scope.map((s) => s.toLowerCase().trim()));
  const merged = [...stored.out_of_scope];
  for (const item of derived.out_of_scope) {
    const key = item.replace(LATER_PREFIX, "").toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return {
    ...stored,
    out_of_scope: merged.slice(0, OUT_OF_SCOPE_CAP),
    boundary_statement:
      stored.boundary_statement +
      " Do NOT reach forward into any later topic listed as out of scope.",
  };
}

/**
 * Resolve the scope contract for a single keyword, ALWAYS returning a usable
 * contract (stored-merged, or derived). Used by single-keyword paths (lesson,
 * refresher). Multi-keyword paths should use `attachScopeContracts` to avoid a
 * query per keyword.
 */
export async function resolveScopeContract(
  supabase: SupabaseClient,
  table: "math_keywords" | "mcat_keywords",
  kw: ScopeKeyword
): Promise<DerivedBlueprint | null> {
  if (!kw.category_id) {
    return isValidStoredBlueprint(kw.concept_blueprint)
      ? (kw.concept_blueprint as DerivedBlueprint)
      : null;
  }

  const { data } = await supabase
    .from(table)
    .select("id, label, tier, parent_keyword_id, order_index")
    .eq("category_id", kw.category_id)
    .order("order_index");
  const rows = (data ?? []) as ScopeRow[];

  const derived = deriveScopeFromRows(kw, rows);

  if (isValidStoredBlueprint(kw.concept_blueprint)) {
    return mergeContract(kw.concept_blueprint as DerivedBlueprint, derived);
  }
  return derived;
}

/**
 * Attach an always-present scope contract to each keyword in a category-grouped
 * set, IN MEMORY (no extra queries). `allRows` is the full keyword set for the
 * categories (umbrellas + in_depth), pre-sorted by order_index — exactly what
 * `loadTargetKeywords` already fetches before it filters down to the served
 * tier. Mutates nothing; returns the resolved contract per keyword id.
 */
export function buildContractsForSet<
  T extends ScopeKeyword & { category_id?: string | null }
>(targets: T[], allRows: (ScopeRow & { category_id?: string | null })[]): Map<string, DerivedBlueprint> {
  const byCat = new Map<string, ScopeRow[]>();
  for (const r of allRows) {
    const cat = r.category_id ?? "";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(r);
  }
  const out = new Map<string, DerivedBlueprint>();
  for (const kw of targets) {
    const rows = byCat.get(kw.category_id ?? "") ?? [];
    const derived = deriveScopeFromRows(kw, rows);
    if (isValidStoredBlueprint(kw.concept_blueprint)) {
      out.set(kw.id, mergeContract(kw.concept_blueprint as DerivedBlueprint, derived));
    } else if (derived) {
      out.set(kw.id, derived);
    }
  }
  return out;
}
