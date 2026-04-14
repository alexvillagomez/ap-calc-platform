import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const { id: problemId } = await context.params;
  if (!problemId) {
    return NextResponse.json({ error: "Missing problem id" }, { status: 400 });
  }

  let body: { rater_id?: string; rating?: number; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rater_id = typeof body.rater_id === "string" && body.rater_id.trim() ? body.rater_id.trim() : null;
  const rating = body.rating != null ? Number(body.rating) : NaN;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;

  if (!rater_id) {
    return NextResponse.json({ error: "rater_id is required" }, { status: 400 });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "rating must be an integer 1–5" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error: upsertError } = await supabase.from("problem_ratings").upsert(
    {
      problem_id: problemId,
      rater_id,
      rating,
      notes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "problem_id,rater_id" }
  );

  if (upsertError) {
    console.error("problem_ratings upsert:", upsertError);
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const { data: agg, error: aggError } = await supabase
    .from("problem_ratings")
    .select("rating")
    .eq("problem_id", problemId);

  if (aggError || !agg?.length) {
    return NextResponse.json({ error: aggError?.message ?? "Failed to load ratings" }, { status: 500 });
  }

  const sum = agg.reduce((s, row) => s + Number(row.rating), 0);
  const rating_count = agg.length;
  const avg_rating = Math.round((sum / rating_count) * 1000) / 1000;

  const { error: updateError } = await supabase
    .from("problems")
    .update({ avg_rating, rating_count })
    .eq("id", problemId);

  if (updateError) {
    console.error("problems rating aggregate update:", updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ avg_rating, rating_count });
}
