/**
 * POST /api/dev/lesson-lab/generate
 *
 * Dev-only. Two actions, over ALL content types (lesson | quiz | flashcards | refresher):
 *  - { action: "generate", system, contentType, keywordId, systemPrompt, model }
 *      → generate FRESH (never cached, never written) with the given system prompt
 *        + model. Returns { preview, raw, assembled_user_prompt, model }.
 *  - { action: "save", system, contentType, keywordId, raw, model }
 *      → write-back: lesson/refresher upsert, flashcards replace the deck, quiz
 *        inserts into the shared question pool. (The ONLY write path.)
 */
import { NextResponse } from "next/server";
import {
  LESSON_LAB_ENABLED,
  LAB_DEFAULT_MODEL,
  createLabClient,
  loadKeywordContext,
  generateLabContent,
  saveLabContent,
  defaultSystemPromptFor,
  labSlotKind,
  isLabSystem,
  isLabContentType,
  type LabContentType,
} from "@/lib/lessonLab";
import {
  promptSlot,
  setPromptOverride,
  deletePromptOverride,
} from "@/lib/promptOverrides";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!LESSON_LAB_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = (body.action as string) ?? "generate";
  const system = body.system;
  const keywordId = body.keywordId as string | undefined;
  const model = (body.model as string) || LAB_DEFAULT_MODEL;
  const ctParam = body.contentType;
  const contentType: LabContentType = isLabContentType(ctParam) ? ctParam : "lesson";

  if (!isLabSystem(system)) {
    return NextResponse.json({ error: "system must be 'math' or 'mcat'" }, { status: 400 });
  }

  const supabase = createLabClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // ── Universal-prompt write paths (no keyword needed) ─────────────────────────
  // save_prompt  → persist this content type's system prompt as the universal one;
  //                ALL generation (students included) then resolves override ?? source.
  // reset_prompt → delete the override → the slot reverts to its source constant.
  if (action === "save_prompt" || action === "reset_prompt") {
    const overview = body.overview === true;
    const slot = promptSlot(system, labSlotKind(contentType, overview));
    if (action === "reset_prompt") {
      const res = await deletePromptOverride(supabase, slot);
      return res.ok
        ? NextResponse.json({ ok: true, slot })
        : NextResponse.json({ error: res.error }, { status: 500 });
    }
    const prompt = body.systemPrompt;
    if (typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "systemPrompt required" }, { status: 400 });
    }
    const res = await setPromptOverride(supabase, slot, prompt);
    return res.ok
      ? NextResponse.json({ ok: true, slot })
      : NextResponse.json({ error: res.error }, { status: 500 });
  }

  if (!keywordId) {
    return NextResponse.json({ error: "keywordId required" }, { status: 400 });
  }

  const ctx = await loadKeywordContext(supabase, system, keywordId);
  if (!ctx) {
    return NextResponse.json({ error: `Keyword not found: ${keywordId}` }, { status: 404 });
  }

  if (action === "save") {
    const raw = body.raw;
    if (raw == null) {
      return NextResponse.json({ error: "raw payload required" }, { status: 400 });
    }
    const res = await saveLabContent(supabase, system, contentType, ctx, raw, model);
    return res.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: res.error }, { status: 500 });
  }

  // action === "generate" | "preview"
  const systemPrompt =
    typeof body.systemPrompt === "string" && body.systemPrompt.trim()
      ? (body.systemPrompt as string)
      : defaultSystemPromptFor(system, contentType);

  // preview = assemble the FULL prompt (system + user) WITHOUT calling the model.
  const previewOnly = action === "preview";

  try {
    const result = await generateLabContent(ctx, system, contentType, systemPrompt, model, previewOnly);
    return NextResponse.json({
      preview: previewOnly ? null : result.preview,
      raw: previewOnly ? null : result.raw,
      // The exact two messages the model receives.
      system_prompt_used: systemPrompt,
      assembled_user_prompt: result.assembled_user_prompt,
      model: result.model,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Generation failed", detail }, { status: 502 });
  }
}
