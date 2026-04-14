import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ProblemInsert } from "@ap-calc/types";
import { expandSubtopicRelevance } from "@/lib/subtopicRelevance";

async function fetchAllTopicIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("topic_metadata").select("id");
  if (error || !data?.length) return [];
  return data.map((r: { id: unknown }) => String(r.id));
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await request.json();
    const {
      latex_content,
      solution_latex,
      choices,
      correct_index,
      difficulty,
      topic_weights,
      rubric,
      type,
    } = body;

    if (!latex_content || !solution_latex || difficulty == null) {
      return NextResponse.json(
        { error: "Missing required fields: latex_content, solution_latex, difficulty" },
        { status: 400 }
      );
    }

    const sparseWeights: Record<string, number> =
      topic_weights && typeof topic_weights === "object" && !Array.isArray(topic_weights)
        ? (topic_weights as Record<string, number>)
        : {};

    const hasPositiveWeight = Object.values(sparseWeights).some(
      (v) => typeof v === "number" && Number.isFinite(v) && v > 0
    );
    if (!hasPositiveWeight) {
      return NextResponse.json(
        { error: "Missing or invalid topic_weights (need at least one positive weight)" },
        { status: 400 }
      );
    }

    const catalogIds = await fetchAllTopicIds(supabase);
    const idUniverse = catalogIds.length > 0 ? catalogIds : Object.keys(sparseWeights);
    const subtopic_relevance = expandSubtopicRelevance(idUniverse, sparseWeights);

    const insertPayload: ProblemInsert = {
      latex_content: String(latex_content),
      solution_latex: String(solution_latex),
      difficulty: Number(difficulty),
      topic_weights: sparseWeights,
      subtopic_relevance,
      avg_rating: null,
      rating_count: 0,
      status: "pending_review",
      type: type === "free_response" ? "free_response" : "multiple_choice",
    };

    if (insertPayload.type === "multiple_choice") {
      insertPayload.choices = Array.isArray(choices) ? choices : null;
      insertPayload.correct_index =
        correct_index != null ? Number(correct_index) : null;
    } else {
      insertPayload.choices = null;
      insertPayload.correct_index = null;
      insertPayload.rubric =
        rubric != null && typeof rubric === "string" ? rubric : null;
    }

    const { data, error } = await supabase
      .from("problems")
      .insert(insertPayload as Record<string, unknown>)
      .select("id, avg_rating, rating_count")
      .single();

    if (error) {
      console.error("problems insert error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const row = data as { id: string; avg_rating: number | null; rating_count: number | null };

    return NextResponse.json({
      id: row.id,
      avg_rating: row.avg_rating ?? null,
      rating_count: row.rating_count ?? 0,
    });
  } catch (err) {
    console.error("problems API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
