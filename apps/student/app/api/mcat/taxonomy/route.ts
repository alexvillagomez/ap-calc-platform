import { NextResponse } from "next/server";
import { getReadClient } from "@/lib/supabaseRead";
import { cached } from "@/lib/serverCache";

export const runtime = "nodejs";

// Shared, slow-changing MCAT taxonomy (categories + keywords) is cached for
// 5 minutes. Per-session keyword states are NEVER cached (per-user data).
const TAXONOMY_TTL_MS = 5 * 60 * 1000;

type TaxonomyBase = {
  categories: Record<string, unknown>[];
  keywords: Record<string, unknown>[];
};

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

  // Read-only queries go to the read replica when SUPABASE_REPLICA_URL is set.
  const supabase = getReadClient();

  // Shared taxonomy is identical for every MCAT user → cache it.
  let base: TaxonomyBase;
  try {
    base = await cached<TaxonomyBase>("mcat:taxonomy", TAXONOMY_TTL_MS, async () => {
      const [categoriesRes, keywordsRes] = await Promise.all([
        supabase
          .from("mcat_categories")
          .select("id, section, label, description, order_index")
          .order("order_index"),
        supabase
          .from("mcat_keywords")
          .select(
            "id, category_id, label, description, tier, parent_keyword_id, order_index, yield_level"
          )
          .eq("status", "approved")
          .order("order_index"),
      ]);

      if (categoriesRes.error) {
        throw new Error(categoriesRes.error.message);
      }

      return {
        categories: categoriesRes.data ?? [],
        keywords: keywordsRes.data ?? [],
      };
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: detail }, { status: 500 });
  }

  const categoriesRes = { data: base.categories, error: null };
  const keywordsRes = { data: base.keywords, error: null };

  // Load keyword states for session if provided (per-user — NOT cached)
  const stateMap: Map<
    string,
    {
      score: number | null;
      total_attempts: number;
      correct_attempts: number;
      dont_know_count: number;
      state: string | null;
    }
  > = new Map();

  if (sessionId) {
    const { data: states } = await supabase
      .from("mcat_student_keyword_states")
      .select(
        "keyword_id, score, total_attempts, correct_attempts, dont_know_count, state"
      )
      .eq("session_id", sessionId);

    if (states) {
      for (const s of states) {
        stateMap.set(s.keyword_id as string, {
          score: (s.score as number | null) ?? null,
          total_attempts: (s.total_attempts as number) ?? 0,
          correct_attempts: (s.correct_attempts as number) ?? 0,
          dont_know_count: (s.dont_know_count as number) ?? 0,
          state: (s.state as string) ?? null,
        });
      }
    }
  }

  const keywords = keywordsRes.data ?? [];

  // Group keywords by category
  const kwByCategory = new Map<string, typeof keywords>();
  for (const kw of keywords) {
    const catId = kw.category_id as string;
    if (!kwByCategory.has(catId)) kwByCategory.set(catId, []);
    kwByCategory.get(catId)!.push(kw);
  }

  const categories = (categoriesRes.data ?? []).map((cat) => {
    const catKws = kwByCategory.get(cat.id as string) ?? [];

    // Sort: umbrella first, then in_depth, each by order_index
    const sorted = [...catKws].sort((a, b) => {
      const tierOrder = (t: string) => (t === "umbrella" ? 0 : 1);
      const tDiff = tierOrder(a.tier as string) - tierOrder(b.tier as string);
      if (tDiff !== 0) return tDiff;
      return ((a.order_index as number) ?? 0) - ((b.order_index as number) ?? 0);
    });

    // ── Flat keywords array (original shape, for backward compat) ──────────
    const flatKeywords = sorted.map((kw) => {
      const st = stateMap.get(kw.id as string);
      const score = st?.score ?? null;
      const state = st?.state ?? null;
      const needsLesson =
        !st ||
        state === "needs_lesson" ||
        (score !== null && score < 0.35);
      return {
        id: kw.id,
        label: kw.label,
        description: kw.description,
        tier: kw.tier,
        parent_keyword_id: kw.parent_keyword_id ?? null,
        yield_level: (kw.yield_level as "high" | "medium" | "low" | null) ?? null,
        score,
        total_attempts: st?.total_attempts ?? 0,
        correct_attempts: st?.correct_attempts ?? 0,
        dont_know_count: st?.dont_know_count ?? 0,
        state,
        needs_lesson: needsLesson,
      };
    });

    // ── Umbrella tree ──────────────────────────────────────────────────────
    const umbrellaKws = sorted.filter((kw) => kw.tier === "umbrella");
    const inDepthKws = sorted.filter((kw) => kw.tier === "in_depth");

    // Build a map: umbrella_id → in_depth keywords
    const inDepthByUmbrella = new Map<string, typeof inDepthKws>();
    for (const kw of inDepthKws) {
      const parentId = kw.parent_keyword_id as string | null;
      if (parentId) {
        if (!inDepthByUmbrella.has(parentId)) inDepthByUmbrella.set(parentId, []);
        inDepthByUmbrella.get(parentId)!.push(kw);
      }
    }

    const umbrellas = umbrellaKws.map((umb) => {
      const umbSt = stateMap.get(umb.id as string);
      const umbScore = umbSt?.score ?? null;
      const umbState = umbSt?.state ?? null;

      const children = (inDepthByUmbrella.get(umb.id as string) ?? []).map((kw) => {
        const st = stateMap.get(kw.id as string);
        const score = st?.score ?? null;
        const state = st?.state ?? null;
        const needsLesson =
          !st ||
          state === "needs_lesson" ||
          (score !== null && score < 0.35);
        return {
          id: kw.id,
          label: kw.label,
          description: kw.description,
          yield_level: (kw.yield_level as "high" | "medium" | "low" | null) ?? null,
          score,
          total_attempts: st?.total_attempts ?? 0,
          correct_attempts: st?.correct_attempts ?? 0,
          dont_know_count: st?.dont_know_count ?? 0,
          state,
          needs_lesson: needsLesson,
        };
      });

      // implied_score = average of children scores where total_attempts > 0
      const attempted = children.filter(
        (c) => c.total_attempts > 0 && c.score !== null
      );
      const impliedScore =
        attempted.length > 0
          ? attempted.reduce((acc, c) => acc + (c.score as number), 0) /
            attempted.length
          : null;

      // Aggregated yield_level from children: high > medium > low > null
      let umbrellaYieldLevel: "high" | "medium" | "low" | null = null;
      if (children.some((c) => c.yield_level === "high")) {
        umbrellaYieldLevel = "high";
      } else if (children.some((c) => c.yield_level === "medium")) {
        umbrellaYieldLevel = "medium";
      } else if (children.some((c) => c.yield_level === "low")) {
        umbrellaYieldLevel = "low";
      }

      return {
        id: umb.id,
        label: umb.label,
        description: umb.description,
        yield_level: umbrellaYieldLevel,
        score: umbScore,
        total_attempts: umbSt?.total_attempts ?? 0,
        correct_attempts: umbSt?.correct_attempts ?? 0,
        dont_know_count: umbSt?.dont_know_count ?? 0,
        state: umbState,
        implied_score: impliedScore,
        children,
      };
    });

    return {
      id: cat.id,
      label: cat.label,
      description: cat.description,
      order_index: cat.order_index,
      // Backward-compat flat keywords array
      keywords: flatKeywords,
      // New umbrella tree
      umbrellas,
    };
  });

  // Honest per-question counts from the attempt log (NOT the summed-per-keyword
  // totals, which over-count a question by its number of tagged keywords).
  let questionsAnswered = 0;
  let correctAnswers = 0;
  if (sessionId) {
    const { count: total } = await supabase
      .from("mcat_question_attempts")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    const { count: corr } = await supabase
      .from("mcat_question_attempts")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("correct", true);
    questionsAnswered = total ?? 0;
    correctAnswers = corr ?? 0;
  }

  return NextResponse.json({
    categories,
    questions_answered: questionsAnswered,
    correct_answers: correctAnswers,
  });
}
