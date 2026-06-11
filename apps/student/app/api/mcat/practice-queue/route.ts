/**
 * GET /api/mcat/practice-queue?session_id=&category_id=[&umbrella_id=][&keyword_id=]
 * Returns the practice queue and spaced-review pool for a session/category.
 *
 * Scope precedence:
 *   keyword_id  → single-keyword queue (parent umbrella resolved for labels)
 *   umbrella_id → in_depth children of that umbrella (fallback: umbrella itself)
 *   (none)      → whole-category (unchanged)
 *
 * review_pool is always whole-category regardless of scope.
 *
 * Response:
 * {
 *   queue: [{
 *     id, label, description, umbrella_id, umbrella_label, score, state,
 *     total_attempts, needs_lesson
 *   }],
 *   review_pool: [{ id, label, score, spaced_review_due_at }]
 * }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadTargetKeywords } from "@/lib/mcatTagging";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");
  const categoryId = searchParams.get("category_id");
  const umbrellaId = searchParams.get("umbrella_id");
  const keywordId = searchParams.get("keyword_id");

  if (!sessionId || !categoryId) {
    return NextResponse.json(
      { error: "session_id and category_id are required" },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // 1. Load all target keywords for the category (in_depth preferred)
  const allKeywords = await loadTargetKeywords(supabase, [categoryId]);
  if (allKeywords.length === 0) {
    return NextResponse.json(
      { error: "Unknown category or no keywords seeded for it" },
      { status: 404 }
    );
  }

  // Build a fast lookup set of valid keyword ids in this category
  const categoryKeywordIds = new Set(allKeywords.map((k) => k.id));

  // 2. Build umbrella lookup (needed for labels regardless of scope)
  const umbrellaMap = new Map<string, { id: string; label: string }>();
  const { data: umbrellaRows } = await supabase
    .from("mcat_keywords")
    .select("id, label")
    .eq("category_id", categoryId)
    .eq("tier", "umbrella")
    .eq("status", "approved");
  for (const u of umbrellaRows ?? []) {
    umbrellaMap.set(u.id as string, {
      id: u.id as string,
      label: u.label as string,
    });
  }

  // 3. Resolve the scoped keyword set for the QUEUE
  //    (review_pool always uses whole-category keywords)
  let queueKeywords = allKeywords;

  if (keywordId) {
    // Single-keyword scope — validate it belongs to this category
    const match = allKeywords.find((k) => k.id === keywordId);
    if (!match) {
      return NextResponse.json(
        { error: "keyword_id not found in this category" },
        { status: 404 }
      );
    }
    queueKeywords = [match];
  } else if (umbrellaId) {
    // Validate the umbrella belongs to this category
    if (!umbrellaMap.has(umbrellaId)) {
      return NextResponse.json(
        { error: "umbrella_id not found in this category" },
        { status: 404 }
      );
    }

    // Restrict to in_depth children of this umbrella
    const children = allKeywords.filter(
      (k) => k.parent_keyword_id === umbrellaId
    );

    if (children.length > 0) {
      queueKeywords = children;
    } else {
      // No in_depth children — fall back to the umbrella keyword itself if it
      // is present in allKeywords (it may be there when the category has no
      // in_depth tier at all), otherwise fetch it directly.
      const umbrellaKw = allKeywords.find((k) => k.id === umbrellaId);
      if (umbrellaKw) {
        queueKeywords = [umbrellaKw];
      } else {
        // Fetch the umbrella row directly (it may have been excluded by
        // loadTargetKeywords when in_depth exist elsewhere in the category)
        const { data: umbRow } = await supabase
          .from("mcat_keywords")
          .select(
            "id, label, description, tier, parent_keyword_id, category_id, embedding, concept_blueprint"
          )
          .eq("id", umbrellaId)
          .eq("status", "approved")
          .maybeSingle();
        queueKeywords = umbRow
          ? [
              {
                id: umbRow.id as string,
                label: umbRow.label as string,
                description: (umbRow.description as string) ?? "",
                tier: umbRow.tier as string,
                parent_keyword_id:
                  (umbRow.parent_keyword_id as string | null) ?? null,
                category_id: umbRow.category_id as string,
                embedding: umbRow.embedding,
                concept_blueprint: umbRow.concept_blueprint ?? null,
              },
            ]
          : allKeywords; // last-resort: whole category
      }
    }
  }

  // 4. Load keyword states for this session — fetch for all category keywords
  //    so review_pool (whole-category) can be built correctly.
  const { data: states } = await supabase
    .from("mcat_student_keyword_states")
    .select(
      "keyword_id, score, total_attempts, correct_attempts, dont_know_count, state, spaced_review_due_at"
    )
    .eq("session_id", sessionId)
    .in("keyword_id", [...categoryKeywordIds]);

  const stateMap = new Map<
    string,
    {
      score: number | null;
      total_attempts: number;
      correct_attempts: number;
      dont_know_count: number;
      state: string | null;
      spaced_review_due_at: string | null;
    }
  >();
  for (const s of states ?? []) {
    stateMap.set(s.keyword_id as string, {
      score: s.score as number | null,
      total_attempts: (s.total_attempts as number) ?? 0,
      correct_attempts: (s.correct_attempts as number) ?? 0,
      dont_know_count: (s.dont_know_count as number) ?? 0,
      state: (s.state as string) ?? null,
      spaced_review_due_at: (s.spaced_review_due_at as string) ?? null,
    });
  }

  // 5. Build queue (scoped) and review_pool (whole-category)
  const queueItems: {
    id: string;
    label: string;
    description: string;
    umbrella_id: string | null;
    umbrella_label: string | null;
    score: number | null;
    state: string | null;
    total_attempts: number;
    needs_lesson: boolean;
  }[] = [];

  const reviewItems: {
    id: string;
    label: string;
    score: number | null;
    spaced_review_due_at: string | null;
  }[] = [];

  // review_pool: whole-category
  for (const kw of allKeywords) {
    const st = stateMap.get(kw.id);
    const score = st?.score ?? null;
    const state = st?.state ?? null;
    const totalAttempts = st?.total_attempts ?? 0;
    const spacedReviewDueAt = st?.spaced_review_due_at ?? null;

    if (
      totalAttempts > 0 &&
      (state === "mastered" || (score !== null && score >= 0.5))
    ) {
      reviewItems.push({
        id: kw.id,
        label: kw.label,
        score,
        spaced_review_due_at: spacedReviewDueAt,
      });
    }
  }

  // queue: scoped keyword set
  for (const kw of queueKeywords) {
    const st = stateMap.get(kw.id);
    const score = st?.score ?? null;
    const state = st?.state ?? null;
    const totalAttempts = st?.total_attempts ?? 0;

    const needsLesson =
      !st || state === "needs_lesson" || (score !== null && score < 0.35);

    // Umbrella id/label from parent_keyword_id
    const umbrellaEntry = kw.parent_keyword_id
      ? (umbrellaMap.get(kw.parent_keyword_id) ?? null)
      : null;

    // Queue: exclude mastered
    if (state === "mastered") continue;

    queueItems.push({
      id: kw.id,
      label: kw.label,
      description: kw.description,
      umbrella_id: umbrellaEntry?.id ?? null,
      umbrella_label: umbrellaEntry?.label ?? null,
      score,
      state,
      total_attempts: totalAttempts,
      needs_lesson: needsLesson,
    });
  }

  // Sort queue by score asc, tiebreak total_attempts asc; cap at 40
  queueItems.sort((a, b) => {
    const aScore = a.score ?? 0.5;
    const bScore = b.score ?? 0.5;
    if (Math.abs(aScore - bScore) > 0.001) return aScore - bScore;
    return a.total_attempts - b.total_attempts;
  });

  return NextResponse.json({
    queue: queueItems.slice(0, 40),
    review_pool: reviewItems,
  });
}
