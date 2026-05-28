import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateAndStoreMasteryQuiz } from "@/lib/learnGenerator";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const { keyword } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);

  // Primary source: rag_examples with this keyword and low difficulty
  const { data: ragRows } = await supabase
    .from("rag_examples")
    .select("id, latex_content, choices, correct_index, difficulty, solution_latex, keyword_weights")
    .eq("course", "precalc")
    .not("choices", "is", null)
    .not("solution_latex", "is", null)
    .neq("solution_latex", "")
    .lte("difficulty", 2.5)
    .order("difficulty", { ascending: true })
    .limit(20);

  // Filter to rows that contain the keyword
  const ragFiltered = (ragRows ?? []).filter((row: { keyword_weights: Record<string, number> }) => {
    const kws = row.keyword_weights ?? {};
    return keyword in kws;
  });

  if (ragFiltered.length >= 3) {
    // Use up to 4 rag_examples as quiz problems
    const problems = ragFiltered.slice(0, 4).map((row: {
      id: string;
      latex_content: string;
      choices: string[];
      correct_index: number;
      difficulty: number;
      solution_latex: string;
    }) => ({
      id: row.id,
      keyword_id: keyword,
      latex_content: row.latex_content,
      choices: row.choices,
      correct_index: row.correct_index,
      difficulty: row.difficulty,
      solution_latex: row.solution_latex,
    }));
    return NextResponse.json({ problems });
  }

  // Secondary source: learn_mastery_quiz_problems
  const { data, error } = await supabase
    .from("learn_mastery_quiz_problems")
    .select("id, keyword_id, latex_content, choices, correct_index, difficulty, solution_latex")
    .eq("keyword_id", keyword)
    .order("difficulty");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data && data.length > 0) return NextResponse.json({ problems: data });

  // Generation fallback
  const { data: kw } = await supabase
    .from("learn_keywords")
    .select("id, label, description, topic_id")
    .eq("id", keyword)
    .maybeSingle();

  if (!kw) return NextResponse.json({ error: `Keyword not found: ${keyword}` }, { status: 404 });

  const rows = await generateAndStoreMasteryQuiz(supabase, kw);
  if (!rows) return NextResponse.json({ error: "Generation failed" }, { status: 500 });

  return NextResponse.json({ problems: rows });
}
