/**
 * POST /api/mcat/deck-plan
 *
 * Returns the ORDERED list of in_depth keyword decks for a scope, so the flashcard
 * walk can play decks in curriculum order and gloss over already-mastered ones.
 *
 * Scope (most specific wins):
 *   keyword_id (+ category_id)      → just that keyword's deck
 *   umbrella_id + category_id       → the umbrella's in_depth children, in order
 *   category_id                     → all the category's in_depth keywords, in order
 *   category_ids: string[]          → all in_depth across them, IN THE GIVEN ORDER
 *                                     (the client passes course categories in CED order)
 *
 * Each entry: { id, label, category_id, category_label, score, mastered, card_count }
 * ordered by (category order as given) then keyword order_index.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadTargetKeywords } from "@/lib/mcatTagging";

export const runtime = "nodejs";

const MASTERED_SCORE = 0.8;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await request.json()) as {
    session_id?: string;
    category_id?: string;
    category_ids?: string[];
    umbrella_id?: string;
    keyword_id?: string;
    /** MCAT-only: filter whole-course walk to this section. Default "biology". */
    section?: string;
  };

  const { session_id, category_id, umbrella_id, keyword_id } = body;
  if (!session_id) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  // Resolve ordered category list.
  let categoryIds: string[];
  if (Array.isArray(body.category_ids) && body.category_ids.length > 0) {
    categoryIds = body.category_ids;
  } else if (category_id) {
    categoryIds = [category_id];
  } else {
    // Whole-course stream: all categories that have keywords, in order_index order.
    // When a section is specified, restrict to that section only (default "biology").
    const sectionFilter = body.section ?? "biology";
    const { data: cats } = await supabase
      .from("mcat_categories")
      .select("id")
      .eq("section", sectionFilter)
      .order("order_index");
    categoryIds = (cats ?? []).map((c) => c.id as string);
  }

  const [keywords, statesRes, fcRes, catRes] = await Promise.all([
    loadTargetKeywords(supabase, categoryIds),
    supabase
      .from("mcat_student_keyword_states")
      .select("keyword_id, score, state")
      .eq("session_id", session_id),
    supabase
      .from("mcat_flashcards")
      .select("primary_keyword_id")
      .in("category_id", categoryIds)
      .eq("status", "active"),
    supabase.from("mcat_categories").select("id, label"),
  ]);

  const scoreByKw = new Map<string, number>();
  const stateByKw = new Map<string, string>();
  for (const s of statesRes.data ?? []) {
    scoreByKw.set(s.keyword_id as string, (s.score as number) ?? 0);
    stateByKw.set(s.keyword_id as string, (s.state as string) ?? "");
  }

  const cardCount = new Map<string, number>();
  for (const fc of fcRes.data ?? []) {
    const id = fc.primary_keyword_id as string | null;
    if (id) cardCount.set(id, (cardCount.get(id) ?? 0) + 1);
  }

  const catLabel = new Map<string, string>(
    (catRes.data ?? []).map((c) => [c.id as string, c.label as string])
  );

  // Apply keyword/umbrella scope filters (keywords already ordered).
  let scoped = keywords;
  if (keyword_id) {
    scoped = keywords.filter((k) => k.id === keyword_id);
  } else if (umbrella_id) {
    scoped = keywords.filter((k) => k.parent_keyword_id === umbrella_id);
  }

  const plan = scoped.map((k) => {
    const score = scoreByKw.get(k.id) ?? 0;
    const mastered =
      stateByKw.get(k.id) === "mastered" || score >= MASTERED_SCORE;
    return {
      id: k.id,
      label: k.label,
      category_id: k.category_id,
      category_label: catLabel.get(k.category_id) ?? k.category_id,
      score,
      mastered,
      card_count: cardCount.get(k.id) ?? 0,
    };
  });

  return NextResponse.json({ keywords: plan });
}
