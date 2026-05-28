import { NextResponse } from "next/server";
import { createGenClient, GEN_MODEL } from "@/lib/ai/genClient";

export const runtime = "nodejs";
export const maxDuration = 60;

type ProblemType = { name: string; description: string };

export async function POST(request: Request): Promise<Response> {

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("pdf");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing pdf field" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let pdfText: string;
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    pdfText = result.text ?? "";
  } catch (err) {
    console.error("pdf-parse error:", err);
    return NextResponse.json({ error: "Failed to extract PDF text" }, { status: 500 });
  }

  if (pdfText.trim().length < 50) {
    return NextResponse.json(
      { error: "Could not extract text from this PDF. Please use a text-searchable PDF or paste the content manually." },
      { status: 400 }
    );
  }

  const openai = createGenClient();

  let parsed: { problemTypes?: ProblemType[] };
  try {
    const completion = await openai.chat.completions.create({
      model: GEN_MODEL,
      max_completion_tokens: 16000,
      messages: [
        {
          role: "system",
          content:
            "You are a JSON extractor. Parse the provided document and return a structured JSON object. Return only valid JSON, no markdown.",
        },
        {
          role: "user",
          content: `Extract every distinct problem type or skill from the text below.

Rules:
- If the document is organized in sections or categories (e.g. "Exponents and Radicals", "Functions") with sub-items or bullet points, treat EACH individual sub-item as a separate problem type. Do NOT group multiple skills into one item.
- Include the section/category name as context by prefixing it to the name field (e.g. "Exponents — Negative Exponents").
- If items are already flat (no hierarchy), extract each one directly.
- name: short descriptive title using the document's exact wording (5–10 words), prefixed with category if applicable
- description: the specific mathematical skill being tested, worded to be directly useful for generating a practice problem (1–2 sentences)

Return exactly one JSON object: { "problemTypes": [ { "name": "...", "description": "..." } ] }

Document text:
${pdfText}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    parsed = JSON.parse(content) as { problemTypes?: ProblemType[] };
  } catch (err) {
    console.error("GPT parse error:", err);
    return NextResponse.json({ error: "Failed to extract problem types from PDF" }, { status: 500 });
  }

  if (!Array.isArray(parsed.problemTypes) || parsed.problemTypes.length === 0) {
    return NextResponse.json({ error: "No problem types found in the document" }, { status: 400 });
  }

  const problemTypes: ProblemType[] = parsed.problemTypes.map((pt) => ({
    name: typeof pt.name === "string" ? pt.name.trim() : "Unnamed",
    description: typeof pt.description === "string" ? pt.description.trim() : "",
  }));

  return NextResponse.json({ problemTypes });
}
