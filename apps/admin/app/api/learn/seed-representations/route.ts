import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const REPRESENTATION_KEYWORDS = [
  {
    id: "symbolic",
    label: "Symbolic",
    description: "The problem is represented mainly with mathematical symbols, such as expressions, equations, inequalities, formulas, functions, systems, or notation.",
    examples: ["Solve 3x - 7 = 14.", "Simplify 4x + 7x - 3.", "Factor x^2 + 7x + 12."],
  },
  {
    id: "verbal",
    label: "Verbal",
    description: "The problem is represented mainly in words rather than symbols. Use this for math phrases, descriptions, definitions, or worded relationships.",
    examples: ["Write an expression for five less than twice a number.", "A number is increased by 7 and then doubled.", "The sum of two consecutive integers is 41."],
  },
  {
    id: "contextual",
    label: "Contextual",
    description: "The problem is represented through a real or realistic situation with quantities, units, constraints, or interpretation. Use this when context affects setup, meaning, domain, or reasonableness.",
    examples: ["A ticket costs 12 dollars plus a 5 dollar service fee.", "A ball is launched from a height of 6 feet.", "A store discounts an item by 20%."],
  },
  {
    id: "graphical",
    label: "Graphical",
    description: "The problem uses a graph, coordinate plane, curve, line, number line, shaded region, or plotted visual as part of the mathematical representation.",
    examples: ["Identify the x-intercepts from the graph.", "Graph x <= 3 on a number line.", "Sketch the parabola y = (x - 2)^2 + 1."],
  },
  {
    id: "tabular",
    label: "Tabular",
    description: "The problem uses values organized in a table, input-output chart, frequency table, two-way table, or finite-difference table.",
    examples: ["Determine whether the table represents a linear relationship.", "Find f(4) from the input-output table.", "Use the frequency table to find a probability."],
  },
  {
    id: "diagram",
    label: "Diagram",
    description: "The problem uses a non-graph visual such as a geometric figure, labeled shape, tree diagram, flowchart, measurement diagram, or visual layout.",
    examples: ["Find the missing side length from the diagram.", "Use the tree diagram to find the probability.", "Determine the area of the shaded figure."],
  },
  {
    id: "exact_form",
    label: "Exact form",
    description: "The expected mathematical representation keeps values exact using fractions, radicals, pi, logarithms, or symbolic expressions rather than rounded decimals.",
    examples: ["Find the exact value of sin(pi/3).", "Solve x^2 - 2 = 0 exactly.", "Give the answer in simplest radical form."],
  },
  {
    id: "approximate_form",
    label: "Approximate form",
    description: "The expected mathematical representation is rounded, estimated, or given as a decimal approximation rather than left in exact symbolic form.",
    examples: ["Approximate the solution to the nearest tenth.", "Round the answer to two decimal places.", "Estimate sqrt(47)."],
  },
] as const;

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !key) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const supabase = createClient(supabaseUrl, key);
  const openai = new OpenAI({ apiKey: openaiKey });

  // Batch embed all keywords in one call
  const texts = REPRESENTATION_KEYWORDS.map(
    (kw) => `${kw.label}: ${kw.description} Examples: ${kw.examples.join("; ")}`
  );

  const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: texts });
  const embeddings = embRes.data.map((e) => e.embedding);

  const rows = REPRESENTATION_KEYWORDS.map((kw, i) => ({
    id: kw.id,
    name: kw.label,
    label: kw.label,
    description: kw.description,
    examples: kw.examples,
    category_id: "representations",
    topic_id: "representations",
    tier: "in_depth" as const,
    status: "approved" as const,
    embedding: embeddings[i]!,
  }));

  const { error } = await supabase
    .from("learn_keywords")
    .upsert(rows, { onConflict: "id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ seeded: rows.length });
}
