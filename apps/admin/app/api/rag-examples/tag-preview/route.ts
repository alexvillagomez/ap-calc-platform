import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { autoTagKeywords } from "@/lib/ai/keywordTagger";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !openaiKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  const body = (await request.json()) as {
    latex_content: string;
    solution_latex: string;
    correct_index?: number;
    wrong_answer_data?: { index: number; description: string }[];
    topic_description?: string;
    action_description?: string;
    representation_description?: string;
    prerequisite_description?: string;
  };

  if (!body.latex_content?.trim() || !body.solution_latex?.trim()) {
    return NextResponse.json({ error: "latex_content and solution_latex are required" }, { status: 400 });
  }

  const wrongAnswerDescriptions: (string | null)[] = Array.from({ length: 4 }, (_, i) => {
    if (i === body.correct_index) return null;
    return body.wrong_answer_data?.find((w) => w.index === i)?.description ?? null;
  });

  try {
    const result = await autoTagKeywords(
      openai,
      body.latex_content,
      body.solution_latex,
      supabase,
      undefined,
      wrongAnswerDescriptions,
      body.correct_index,
      body.topic_description,
      body.action_description,
      body.representation_description,
      body.prerequisite_description,
    );

    // Strip embeddings from wrong_answer_data before returning (too large)
    const wrong_answer_data = result.wrong_answer_data.map(({ description, keyword_weights }) => ({
      description,
      keyword_weights,
    }));

    return NextResponse.json({
      keyword_weights: result.keyword_weights,
      action_weights: result.action_weights,
      representation_weights: result.representation_weights,
      prerequisite_weights: result.prerequisite_weights,
      wrong_answer_data,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
