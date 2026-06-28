import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const DESCRIPTION_SYSTEM = `You are writing embedding descriptions for a math taxonomy used in an AP Calculus and precalculus adaptive practice system.

For each keyword ID I provide, write a concise description optimized for embedding-based similarity matching against problem text.

CRITICAL RULES:
- The description must sound like the core math pattern that appears in a problem — not a textbook definition, lesson note, or action instruction.
- Stay strictly within the bounds of the keyword. Do not drift into neighboring concepts.
- Do not use action verbs like "understand", "identify", "learn", or "know" — describe the math concept itself.
- Do not mention representations (graph, table, multiple choice) unless the keyword is specifically about that representation.
- Do not describe problem setups or what data is given unless that IS the concept.
- Write in concrete, problem-facing language — like a search query that would match problems containing that concept.
- Be concise but complete enough to uniquely identify the skill.

NAME RULES:
- Convert the snake_case id to a human-readable name (2-6 words, title case).

EXAMPLES RULES:
- 2-4 short mathematical expressions or forms that sharpen the meaning of the keyword.
- Only examples that help distinguish this keyword from neighbors.

Return exactly one JSON object:
{ "keywords": [ { "id": string, "name": string, "description": string, "examples": string[] } ] }

Good description example:
quotient_rule_for_exponents → "Simplifying a quotient of powers with the same base by subtracting exponents, such as x^7/x^3, a^m/a^n, or 5^8/5^2."

vertical_shifts → "Changing a function by adding or subtracting a constant outside the function, which moves the graph up or down, such as f(x)+3, y=x^2-4, or g(x)-7."

Bad description example:
"Students should be able to apply the quotient rule for exponents to simplify expressions."

No markdown. Return raw JSON only.`;

type CategoryInput = {
  id: string;
  name: string;
  keywords: string[];
};

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const body = (await request.json()) as {
    categories: CategoryInput[];
    clear_existing?: boolean;
    category_id?: string; // process a single category
  };

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  // Optionally clear all existing keywords
  if (body.clear_existing) {
    await supabase.from("learn_keywords").delete().neq("id", "___never___");
  }

  const toProcess = body.category_id
    ? body.categories.filter((c) => c.id === body.category_id)
    : body.categories;

  const results: { category: string; saved: number; error?: string }[] = [];

  for (const cat of toProcess) {
    // Upsert the category into learn_categories
    await supabase
      .from("learn_categories")
      .upsert({ id: cat.id, name: cat.name, description: cat.name }, { onConflict: "id" });

    // Build the keyword list for this category
    const kwList = cat.keywords.join(", ");
    const userPrompt = `Category: ${cat.id} (${cat.name})\n\nGenerate descriptions for these keywords:\n${kwList}`;

    let parsed: { keywords?: { id: string; name: string; description: string; examples: string[] }[] };
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-5.4-mini",
        messages: [
          { role: "system", content: DESCRIPTION_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });
      const text = completion.choices[0]?.message?.content ?? "{}";
      parsed = JSON.parse(text) as typeof parsed;
    } catch (err) {
      console.error(`bulk-generate: failed for ${cat.id}`, err);
      results.push({ category: cat.id, saved: 0, error: "Generation failed" });
      continue;
    }

    const generated = parsed.keywords ?? [];

    // Merge: use generated description/name/examples; fall back to snake_case name if missing
    const rows = cat.keywords.map((kwId) => {
      const gen = generated.find((g) => g.id === kwId);
      return {
        id: kwId,
        name: gen?.name ?? kwId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        label: gen?.name ?? kwId,
        description: gen?.description ?? "",
        examples: gen?.examples ?? [],
        category_id: cat.id,
        topic_id: cat.id,
        tier: "in_depth" as const,
        status: "approved" as const,
      };
    });

    const { error: upsertErr } = await supabase
      .from("learn_keywords")
      .upsert(rows, { onConflict: "id" });

    if (upsertErr) {
      results.push({ category: cat.id, saved: 0, error: upsertErr.message });
    } else {
      results.push({ category: cat.id, saved: rows.length });
    }
  }

  const totalSaved = results.reduce((a, r) => a + r.saved, 0);
  const errors = results.filter((r) => r.error);

  return NextResponse.json({ results, total_saved: totalSaved, errors: errors.length });
}
