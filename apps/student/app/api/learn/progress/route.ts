import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  // Fetch all keyword states for this session
  const { data: states, error: statesErr } = await supabase
    .from("learn_student_keyword_states")
    .select("keyword_id, state, in_depth_score, consecutive_correct, total_attempts, spaced_review_due_at")
    .eq("session_id", sessionId);

  if (statesErr) {
    return NextResponse.json({ error: statesErr.message }, { status: 500 });
  }

  // Fetch all approved umbrella + in-depth keywords with their categories/parents
  const { data: keywords, error: kwErr } = await supabase
    .from("learn_keywords")
    .select("id, label, name, category_id, tier, parent_keyword_id")
    .eq("status", "approved")
    .in("tier", ["umbrella", "in_depth"]);

  if (kwErr) {
    return NextResponse.json({ error: kwErr.message }, { status: 500 });
  }

  // Fetch all categories for labels
  const { data: categories } = await supabase
    .from("learn_categories")
    .select("id, name")
    .order("order_index", { ascending: true });

  const stateMap = new Map(
    (states ?? []).map((s) => [s.keyword_id, s])
  );

  const categoryMap = new Map(
    (categories ?? []).map((c) => [c.id, c.name as string])
  );

  // A score backed by fewer than this many attempts is flagged as low-sample
  // so students/teachers don't over-trust it.
  const LOW_SAMPLE_THRESHOLD = 5;

  // Build a 3-level tree: category -> umbrella keyword -> individual (in_depth) skill
  type KeywordEntry = {
    id: string;
    label: string;
    state: string;
    in_depth_score: number | null;
    tested: boolean;
    total_attempts: number;
    low_sample: boolean;
    spaced_review_due_at: string | null;
  };

  type UmbrellaGroup = {
    id: string;
    label: string;
    umbrella_score: number | null;
    total_attempts: number;
    low_sample: boolean;
    mastered_count: number;
    total_count: number;
    keywords: KeywordEntry[];
  };

  type CategoryGroup = {
    category_id: string;
    category_name: string;
    category_score: number | null;
    mastered_count: number;
    total_count: number;
    umbrellas: UmbrellaGroup[];
  };

  const allKeywords = keywords ?? [];
  const umbrellaKeywords = allKeywords.filter((kw) => kw.tier === "umbrella");
  const inDepthKeywords = allKeywords.filter((kw) => kw.tier === "in_depth");

  const umbrellaGroups = new Map<string, UmbrellaGroup>();
  for (const kw of umbrellaKeywords) {
    umbrellaGroups.set(kw.id, {
      id: kw.id,
      label: (kw.label ?? kw.name ?? kw.id) as string,
      umbrella_score: null,
      total_attempts: 0,
      low_sample: false,
      mastered_count: 0,
      total_count: 0,
      keywords: [],
    });
  }

  for (const kw of inDepthKeywords) {
    const parentId = kw.parent_keyword_id as string | null;
    const umbrella = parentId ? umbrellaGroups.get(parentId) : undefined;
    if (!umbrella) continue; // skip orphaned in-depth keywords with no umbrella parent

    const st = stateMap.get(kw.id);
    const totalAttempts = st?.total_attempts ?? 0;
    const tested = totalAttempts > 0;
    const entry: KeywordEntry = {
      id: kw.id,
      label: (kw.label ?? kw.name ?? kw.id) as string,
      state: st?.state ?? "not_started",
      in_depth_score: tested ? (st?.in_depth_score ?? null) : null,
      tested,
      total_attempts: totalAttempts,
      low_sample: tested && totalAttempts < LOW_SAMPLE_THRESHOLD,
      spaced_review_due_at: st?.spaced_review_due_at ?? null,
    };
    umbrella.keywords.push(entry);
    umbrella.total_count++;
    if (entry.state === "mastered") umbrella.mastered_count++;
  }

  // Each umbrella's score is the average of the in_depth scores of the
  // skills nested directly under it; umbrellas with nothing tested stay null.
  for (const umbrella of umbrellaGroups.values()) {
    const tested = umbrella.keywords.filter((k) => k.tested && k.in_depth_score != null);
    umbrella.total_attempts = umbrella.keywords.reduce((sum, k) => sum + k.total_attempts, 0);
    umbrella.umbrella_score = tested.length > 0
      ? tested.reduce((sum, k) => sum + (k.in_depth_score as number), 0) / tested.length
      : null;
    umbrella.low_sample = umbrella.umbrella_score != null && umbrella.total_attempts < LOW_SAMPLE_THRESHOLD;
  }

  // Group umbrellas by category
  const grouped = new Map<string, CategoryGroup>();
  for (const kw of umbrellaKeywords) {
    const catId = kw.category_id as string;
    if (!grouped.has(catId)) {
      grouped.set(catId, {
        category_id: catId,
        category_name: categoryMap.get(catId) ?? catId,
        category_score: null,
        mastered_count: 0,
        total_count: 0,
        umbrellas: [],
      });
    }
    const group = grouped.get(catId)!;
    const umbrella = umbrellaGroups.get(kw.id)!;
    group.umbrellas.push(umbrella);
    group.mastered_count += umbrella.mastered_count;
    group.total_count += umbrella.total_count;
  }

  // A category's score is the average of its tested umbrella scores.
  for (const group of grouped.values()) {
    const tested = group.umbrellas
      .filter((u) => u.umbrella_score != null)
      .map((u) => u.umbrella_score as number);
    group.category_score = tested.length > 0
      ? tested.reduce((a, b) => a + b, 0) / tested.length
      : null;
  }

  // Only return categories that the student has interacted with
  const result = Array.from(grouped.values()).filter((g) =>
    g.umbrellas.some((u) => u.keywords.some((k) => k.state !== "not_started"))
  );

  // The report is only unlocked once enough umbrella keywords have a confident
  // sample size — otherwise the tree could mislead with mostly-untested data.
  // /demo currently only exercises the Polynomials category, so the gate is
  // scoped to that category's umbrellas rather than every umbrella in the DB —
  // otherwise a student could never clear the bar from a single-category run.
  const gatingUmbrellas = umbrellaKeywords.filter((kw) => kw.category_id === "polynomials");
  const totalUmbrellas = gatingUmbrellas.length;
  const sampledUmbrellas = gatingUmbrellas.filter(
    (kw) => (umbrellaGroups.get(kw.id)?.total_attempts ?? 0) >= LOW_SAMPLE_THRESHOLD
  ).length;
  const reportUnlocked = totalUmbrellas > 0 && sampledUmbrellas / totalUmbrellas >= 0.5;

  // Summary stats
  const totalMastered = result.reduce((sum, g) => sum + g.mastered_count, 0);
  const totalAttempted = result.reduce((sum, g) => sum + g.total_count, 0);
  const inProgress = result.reduce(
    (sum, g) => sum + g.umbrellas.reduce(
      (uSum, u) => uSum + u.keywords.filter((k) => k.state === "in_progress").length,
      0
    ),
    0
  );

  return NextResponse.json({
    categories: result,
    report_unlocked: reportUnlocked,
    sampled_umbrellas: sampledUmbrellas,
    total_umbrellas: totalUmbrellas,
    summary: {
      total_mastered: totalMastered,
      total_attempted: totalAttempted,
      in_progress: inProgress,
      categories_started: result.length,
    },
  });
}
