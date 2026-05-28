import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const SYSTEM_PROMPT = `You are a math tutor. Generate a single one-line tip for a student who is currently struggling with a specific skill.

Return exactly one JSON object: { "tip_latex": string }

Rules:
- tip_latex: ONE short KaTeX string targeting the most common mistake for this keyword.
- Maximum 20 words total. Short enough to read in 5 seconds.
- Prose in \\text{}, math symbols outside \\text{}.
- Start with \\text{Remember: } or \\text{Tip: } or \\text{Watch out: }.
- No markdown. Return raw JSON only.`;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !openaiKey) {
    return NextResponse.json({ error: "Missing configuration" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  const body = (await request.json()) as { keyword_id: string; force?: boolean };
  const { keyword_id, force = false } = body;

  if (!keyword_id) {
    return NextResponse.json({ error: "keyword_id required" }, { status: 400 });
  }

  const { data: kw } = await supabase
    .from("learn_keywords")
    .select("id, label, description")
    .eq("id", keyword_id)
    .single();

  if (!kw) {
    return NextResponse.json({ error: `Keyword not found: ${keyword_id}` }, { status: 404 });
  }

  if (!force) {
    const { data: existing } = await supabase
      .from("learn_tips")
      .select("id")
      .eq("keyword_id", keyword_id)
      .maybeSingle();
    if (existing) return NextResponse.json({ status: "exists", id: existing.id });
  }

  const userPrompt = `Generate a tip for keyword: ${kw.id}\nLabel: ${kw.label}\nCommon mistake context: ${kw.description ?? "(none)"}`;

  let parsed: { tip_latex: string };
  try {
    const completion = await openai.chat.completions.create({
      model: "gemini-3.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });
    const content = completion.choices[0]?.message?.content ?? "{}";
    parsed = JSON.parse(content) as typeof parsed;
  } catch (err) {
    console.error("tip generation error:", err);
    return NextResponse.json({ error: "OpenAI generation failed" }, { status: 500 });
  }

  if (!parsed.tip_latex) {
    return NextResponse.json({ error: "Invalid response from model" }, { status: 500 });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("learn_tips")
    .upsert(
      { keyword_id, tip_latex: parsed.tip_latex, model: "gemini-3.5-flash" },
      { onConflict: "keyword_id" }
    )
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ status: "generated", id: inserted?.id, tip_latex: parsed.tip_latex });
}
