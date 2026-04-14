import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { AP_CALC_ASSESS_SYSTEM, buildAssessUserPrompt } from "@/lib/ai/prompts";

/**
 * Keep only keys in the pool, drop unknown keys, renormalize to sum 1.
 */
function normalizeTopicWeights(
  weights: unknown,
  poolIds: string[]
): Record<string, number> {
  const pool = new Set(poolIds);
  const raw: Record<string, number> = {};

  if (weights && typeof weights === "object" && !Array.isArray(weights)) {
    const w = weights as Record<string, number>;
    for (const [k, v] of Object.entries(w)) {
      if (!pool.has(k)) {
        console.warn("assess-problem: dropped topic_weight key not in pool:", k);
        continue;
      }
      const num = typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
      raw[k] = num;
    }
  }

  const positiveKeys = Object.keys(raw).filter((k) => raw[k] > 0);
  const sum = positiveKeys.reduce((s, k) => s + raw[k], 0);

  if (positiveKeys.length === 0 || sum <= 0) {
    const single = poolIds[0];
    if (!single) return {};
    return { [single]: 1 };
  }

  const out: Record<string, number> = {};
  for (const k of positiveKeys) {
    out[k] = raw[k] / sum;
  }
  return out;
}

/**
 * Keep only the top N topics by weight and renormalize.
 */
function clampTopN(weights: Record<string, number>, n: number): Record<string, number> {
  const entries = Object.entries(weights).filter(
    ([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0
  );
  if (entries.length <= n) return weights;
  entries.sort((a, b) => b[1] - a[1]);
  const kept = entries.slice(0, Math.max(1, n));
  const sum = kept.reduce((s, [, v]) => s + v, 0);
  if (sum <= 0) return { [kept[0]![0]]: 1 };
  const out: Record<string, number> = {};
  for (const [k, v] of kept) out[k] = v / sum;
  return out;
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  const supabaseKey = serviceRoleKey ?? anonKey;
  if (!supabaseKey) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }
  if (!openaiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  try {
    const body = await request.json();
    const {
      latex_content,
      solution_latex,
      choices,
      rubric,
      type,
      topicIds,
    } = body as {
      latex_content?: string;
      solution_latex?: string;
      choices?: string[];
      rubric?: string;
      type?: "multiple_choice" | "free_response";
      topicIds?: string[];
    };

    if (!latex_content || typeof latex_content !== "string") {
      return NextResponse.json({ error: "latex_content is required" }, { status: 400 });
    }
    if (!solution_latex || typeof solution_latex !== "string") {
      return NextResponse.json({ error: "solution_latex is required" }, { status: 400 });
    }
    if (!type || (type !== "multiple_choice" && type !== "free_response")) {
      return NextResponse.json({ error: "type must be multiple_choice or free_response" }, { status: 400 });
    }
    if (!Array.isArray(topicIds) || topicIds.length === 0) {
      return NextResponse.json({ error: "topicIds must be a non-empty array" }, { status: 400 });
    }

    const { data: topicRows, error: topicFetchError } = await supabase
      .from("topic_metadata")
      .select("id, name, description");

    if (topicFetchError || !topicRows?.length) {
      return NextResponse.json({ error: "No topics found" }, { status: 404 });
    }

    const catalogIds = new Set(topicRows.map((t) => t.id));
    const poolIds = topicIds.map(String).filter((id) => catalogIds.has(id));
    if (poolIds.length === 0) {
      return NextResponse.json({ error: "No valid topic ids in topicIds" }, { status: 400 });
    }

    const orderedPool = [...topicRows]
      .filter((t) => poolIds.includes(t.id))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    const topicLines = orderedPool
      .map((t) => {
        const name = (t.name ?? "").trim();
        const skill = (t.description ?? "").trim();
        if (name && skill) return `${t.id}: ${name} (${skill})`;
        if (name) return `${t.id}: ${name}`;
        return `${t.id}: ${skill || t.id}`;
      })
      .join("\n");

    const userPrompt = buildAssessUserPrompt({
      type,
      latexContent: latex_content,
      solutionLatex: solution_latex,
      choices: Array.isArray(choices) ? choices : undefined,
      rubric: typeof rubric === "string" ? rubric : undefined,
      topicLines,
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: AP_CALC_ASSESS_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "No response from OpenAI" }, { status: 500 });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON from OpenAI", raw: content }, { status: 500 });
    }

    if (!("difficulty" in parsed) || !("topic_weights" in parsed)) {
      return NextResponse.json(
        { error: "Invalid response: missing difficulty or topic_weights", raw: content },
        { status: 500 }
      );
    }

    const rawDifficulty = parsed.difficulty;
    const difficulty =
      typeof rawDifficulty === "number" && Number.isFinite(rawDifficulty)
        ? Math.min(5, Math.max(1, Math.round(rawDifficulty)))
        : 3;

    const normalizedWeights = normalizeTopicWeights(parsed.topic_weights, poolIds);
    const topic_weights = clampTopN(normalizedWeights, 4);

    return NextResponse.json({ difficulty, topic_weights });
  } catch (err) {
    console.error("assess-problem error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
