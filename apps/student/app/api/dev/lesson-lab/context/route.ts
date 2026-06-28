/**
 * GET /api/dev/lesson-lab/context?system=math|mcat&keywordId=...
 *
 * Dev-only. For a selected keyword, returns the stored ("live") lesson for the
 * compare column, plus the scope/neighbor context that feeds the generator (so the
 * page can show, read-only, exactly what the model is told and diagnose drift).
 */
import { NextResponse } from "next/server";
import {
  LESSON_LAB_ENABLED,
  createLabClient,
  loadKeywordContext,
  loadStoredContent,
  isLabSystem,
  isLabContentType,
  type LabContentType,
} from "@/lib/lessonLab";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!LESSON_LAB_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const system = searchParams.get("system");
  const keywordId = searchParams.get("keywordId");
  const ctParam = searchParams.get("contentType");
  const contentType: LabContentType = isLabContentType(ctParam) ? ctParam : "lesson";
  if (!isLabSystem(system)) {
    return NextResponse.json({ error: "system must be 'math' or 'mcat'" }, { status: 400 });
  }
  if (!keywordId) {
    return NextResponse.json({ error: "keywordId required" }, { status: 400 });
  }

  const supabase = createLabClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const ctx = await loadKeywordContext(supabase, system, keywordId);
  if (!ctx) {
    return NextResponse.json({ error: `Keyword not found: ${keywordId}` }, { status: 404 });
  }
  const stored = await loadStoredContent(supabase, system, contentType, keywordId);

  return NextResponse.json({
    keyword_id: ctx.keyword_id,
    keyword_label: ctx.keyword_label,
    description: ctx.description,
    examples: ctx.examples ?? null,
    tier: ctx.tier, // "umbrella" → overview-mode lesson
    neighbors: ctx.neighbors,
    blueprint: ctx.blueprint,
    // { preview: LabPreview|null, model, generated_at } — normalized for rendering.
    stored,
  });
}
