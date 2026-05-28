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
    .select("keyword_id, state, in_depth_score, umbrella_score, consecutive_correct, total_attempts, spaced_review_due_at")
    .eq("session_id", sessionId);

  if (statesErr) {
    return NextResponse.json({ error: statesErr.message }, { status: 500 });
  }

  // Fetch all approved in-depth keywords with their categories
  const { data: keywords, error: kwErr } = await supabase
    .from("learn_keywords")
    .select("id, label, name, category_id, tier")
    .eq("status", "approved")
    .eq("tier", "in_depth");

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

  // Group keywords by category
  type KeywordEntry = {
    id: string;
    label: string;
    state: string;
    in_depth_score: number;
    total_attempts: number;
    spaced_review_due_at: string | null;
  };

  type CategoryGroup = {
    category_id: string;
    category_name: string;
    keywords: KeywordEntry[];
    mastered_count: number;
    total_count: number;
  };

  const grouped = new Map<string, CategoryGroup>();

  for (const kw of keywords ?? []) {
    const catId = kw.category_id as string;
    if (!grouped.has(catId)) {
      grouped.set(catId, {
        category_id: catId,
        category_name: categoryMap.get(catId) ?? catId,
        keywords: [],
        mastered_count: 0,
        total_count: 0,
      });
    }
    const group = grouped.get(catId)!;
    const st = stateMap.get(kw.id);
    const entry: KeywordEntry = {
      id: kw.id,
      label: (kw.label ?? kw.name ?? kw.id) as string,
      state: st?.state ?? "not_started",
      in_depth_score: st?.in_depth_score ?? 0,
      total_attempts: st?.total_attempts ?? 0,
      spaced_review_due_at: st?.spaced_review_due_at ?? null,
    };
    group.keywords.push(entry);
    group.total_count++;
    if (entry.state === "mastered") group.mastered_count++;
  }

  // Only return categories that the student has interacted with
  const result = Array.from(grouped.values()).filter((g) =>
    g.keywords.some((k) => k.state !== "not_started")
  );

  // Summary stats
  const totalMastered = result.reduce((sum, g) => sum + g.mastered_count, 0);
  const totalAttempted = result.reduce((sum, g) => sum + g.total_count, 0);
  const inProgress = result.reduce(
    (sum, g) => sum + g.keywords.filter((k) => k.state === "in_progress").length,
    0
  );

  return NextResponse.json({
    categories: result,
    summary: {
      total_mastered: totalMastered,
      total_attempted: totalAttempted,
      in_progress: inProgress,
      categories_started: result.length,
    },
  });
}
