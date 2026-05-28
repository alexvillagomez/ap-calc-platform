import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const SYSTEM_PROMPT = `You are building a keyword taxonomy for an adaptive math education platform covering pre-calculus through AP Calculus AB.

Given a content category, generate an exhaustive MECE (mutually exclusive, collectively exhaustive) list of the specific sub-skills a student must master within that category.

Return exactly one JSON object: { "keywords": [ Keyword, ... ] }

Each Keyword:
{
  "id": string,
  "name": string,
  "description": string,
  "examples": string[]
}

Field rules:
- id: stable snake_case identifier. Should be self-explanatory when read alone.
- name: human-readable, 2-6 words, title case

DESCRIPTION RULES (critical — read carefully):
The description must sound like a search query for the core math pattern, not a textbook definition or lesson note.
- Describe only the exact math idea named by the keyword. Do not drift into neighboring concepts.
- Do not use action verbs like "understand" or "identify" unless essential to the concept itself.
- Do not mention representations (graph, table, equation, verbal) unless the keyword is specifically about that representation.
- Do not describe how the problem is asked or what data is given.
- Be concise but complete enough to identify the exact skill.
- Write in concrete, problem-facing language — like a search query that would match problems containing that concept.
Good: "Simplifying a quotient of powers with the same base by subtracting exponents, such as x^7/x^3 or a^m/a^n."
Bad: "Students should understand how to divide expressions with exponents using the quotient rule."

EXAMPLES RULES:
- 2-4 short mathematical expressions or forms that define when this keyword applies.
- Only include examples that sharpen the meaning — do not include unrelated cases just to be broad.
Good: ["5x^{-3}", "(a^{-2})/(b^3)", "2^{-4}"]
Bad: ["when the base is the same", "common problem type"]

Generate 12-25 keywords. Each must be a DISTINCT, atomic skill.
No markdown. Return raw JSON only.`;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const { category_id } = (await request.json()) as { category_id: string };
  if (!category_id) return NextResponse.json({ error: "category_id required" }, { status: 400 });

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  const { data: cat } = await supabase
    .from("learn_categories")
    .select("id, name, description")
    .eq("id", category_id)
    .single();

  if (!cat) return NextResponse.json({ error: `Category not found: ${category_id}` }, { status: 404 });

  const userPrompt = `Category ID: ${cat.id}\nCategory Name: ${cat.name}\nCategory Description: ${cat.description}\n\nGenerate the complete keyword list.`;

  let parsed: { keywords: unknown[] };
  try {
    const completion = await openai.chat.completions.create({
      model: "gemini-3.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    parsed = JSON.parse(text) as typeof parsed;
  } catch (err) {
    console.error("generate-category-keywords error:", err);
    return NextResponse.json({ error: "OpenAI generation failed" }, { status: 500 });
  }

  if (!Array.isArray(parsed.keywords) || parsed.keywords.length === 0) {
    return NextResponse.json({ error: "Model returned no keywords" }, { status: 500 });
  }

  // Validate and normalise each keyword
  type RawKw = { id?: string; name?: string; description?: string; examples?: string[] };
  const keywords = (parsed.keywords as RawKw[])
    .filter((k) => k.id && k.name && k.description)
    .map((k) => ({
      id: String(k.id).toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
      name: String(k.name).trim(),
      description: String(k.description).trim(),
      examples: Array.isArray(k.examples) ? k.examples.map(String) : [],
      category: cat.id,
    }));

  return NextResponse.json({ keywords, category: cat });
}
