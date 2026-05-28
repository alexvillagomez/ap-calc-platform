import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type GenerateResult = { keyword_id: string; type: string; status: string; error?: string };

async function callGenerate(baseUrl: string, path: string, body: Record<string, unknown>): Promise<GenerateResult> {
  const keyword_id = body.keyword_id as string;
  const type = path.split("/").pop() ?? path;
  try {
    const res = await fetch(`${baseUrl}/api/learn/generate/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { status?: string; error?: string };
    return { keyword_id, type, status: data.status ?? (res.ok ? "ok" : "error"), error: data.error };
  } catch (err) {
    return { keyword_id, type, status: "error", error: String(err) };
  }
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const body = (await request.json()) as { topic_id: string; force?: boolean };
  const { topic_id, force = false } = body;

  if (!topic_id) {
    return NextResponse.json({ error: "topic_id required" }, { status: 400 });
  }

  // Fetch all in-depth keywords for this topic
  const { data: keywords, error: kwErr } = await supabase
    .from("learn_keywords")
    .select("id, label")
    .eq("topic_id", topic_id)
    .eq("tier", "in_depth")
    .order("order_index");

  if (kwErr || !keywords || keywords.length === 0) {
    return NextResponse.json({ error: `No in-depth keywords found for topic: ${topic_id}` }, { status: 404 });
  }

  // Determine base URL for internal calls
  const host = request.headers.get("host") ?? "localhost:3001";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const results: GenerateResult[] = [];

  // For each keyword, generate: lesson, refresher, tip, problems (difficulties 1-3), mastery-quiz
  // Run keywords sequentially to avoid overwhelming the API
  for (const kw of keywords) {
    const kwId = kw.id;

    // Lesson, refresher, tip in parallel
    const [lessonRes, refresherRes, tipRes] = await Promise.all([
      callGenerate(baseUrl, "lesson", { keyword_id: kwId, force }),
      callGenerate(baseUrl, "refresher", { keyword_id: kwId, force }),
      callGenerate(baseUrl, "tip", { keyword_id: kwId, force }),
    ]);
    results.push(lessonRes, refresherRes, tipRes);

    // Practice problems at difficulties 1, 2, 3 (sequentially)
    for (const diff of [1, 2, 3]) {
      const probRes = await callGenerate(baseUrl, "problems", { keyword_id: kwId, difficulty: diff, count: 3, force });
      results.push(probRes);
    }

    // Mastery quiz
    const quizRes = await callGenerate(baseUrl, "mastery-quiz", { keyword_id: kwId, force });
    results.push(quizRes);
  }

  const errors = results.filter((r) => r.status === "error");
  const generated = results.filter((r) => r.status === "generated");
  const existed = results.filter((r) => r.status === "exists");

  return NextResponse.json({
    topic_id,
    keywords_processed: keywords.length,
    generated: generated.length,
    already_existed: existed.length,
    errors: errors.length,
    error_details: errors.length > 0 ? errors : undefined,
  });
}
