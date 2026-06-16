/**
 * GET /api/math/refresher/[keywordId]
 *
 * Returns a SHORT refresher ({ rule_latex, example_latex }) for a math keyword.
 * Cache-first against math_refreshers; on miss, generate via OpenAI, store, return.
 *
 * FAIL-SOFT: if the math_refreshers table is missing (migration not yet applied)
 * or generation fails, returns status 200 with { rule_latex: null, example_latex:
 * null, error } so the client degrades gracefully rather than erroring.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  generateAndStoreRefresher,
  RefresherGenError,
} from "@/lib/refresherGenerator";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ keywordId: string }> }
) {
  const { keywordId } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json(
      { rule_latex: null, example_latex: null, error: "Supabase not configured" },
      { status: 200 }
    );
  }

  const supabase = createClient(supabaseUrl, key);

  // 1. Cache lookup — fail-soft if the table doesn't exist yet.
  const { data: cached, error: cacheError } = await supabase
    .from("math_refreshers")
    .select("keyword_id, rule_latex, example_latex")
    .eq("keyword_id", keywordId)
    .maybeSingle();

  if (!cacheError && cached) {
    return NextResponse.json({
      keyword_id: cached.keyword_id,
      rule_latex: cached.rule_latex,
      example_latex: cached.example_latex,
    });
  }

  // 2. Load keyword metadata for generation.
  const { data: kw, error: kwError } = await supabase
    .from("math_keywords")
    .select("id, label, description")
    .eq("id", keywordId)
    .maybeSingle();

  if (kwError || !kw) {
    return NextResponse.json(
      {
        rule_latex: null,
        example_latex: null,
        error: `Keyword not found: ${keywordId}`,
      },
      { status: 200 }
    );
  }

  // 3. Generate + store.
  try {
    const generated = await generateAndStoreRefresher(supabase, "math", kw);
    if (!generated) {
      return NextResponse.json(
        {
          rule_latex: null,
          example_latex: null,
          error: "invalid model output",
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ keyword_id: keywordId, ...generated });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error(`math refresher generation failed for ${keywordId}:`, detail);
    const status = err instanceof RefresherGenError ? err.status : 502;
    // Surface a structured error; keep 200 so the client never breaks on this.
    return NextResponse.json(
      { rule_latex: null, example_latex: null, error: detail, status },
      { status: 200 }
    );
  }
}
