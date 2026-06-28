/**
 * GET /api/dev/lesson-lab/keywords?system=math|mcat&course=precalc|calc_ab
 *
 * Dev-only. Returns the keyword picker data (categories + keywords) plus the
 * default system prompt and the model list, for the Lesson Lab page.
 */
import { NextResponse } from "next/server";
import {
  LESSON_LAB_ENABLED,
  LAB_MODELS,
  LAB_DEFAULT_MODEL,
  createLabClient,
  defaultSystemPromptFor,
  defaultOverviewPrompt,
  loadLabKeywords,
  isLabSystem,
  type LabCourse,
} from "@/lib/lessonLab";
import { getAllOverrides } from "@/lib/promptOverrides";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!LESSON_LAB_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const system = searchParams.get("system");
  const course = (searchParams.get("course") ?? "precalc") as LabCourse;
  if (!isLabSystem(system)) {
    return NextResponse.json({ error: "system must be 'math' or 'mcat'" }, { status: 400 });
  }

  const supabase = createLabClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const categories = await loadLabKeywords(supabase, system, course);

  // Saved UNIVERSAL overrides for this system, keyed by slot kind
  // (lesson | lesson_overview | quiz | flashcards | refresher). Absent key = no
  // override → the slot uses its source constant. The page seeds the editor from
  // override ?? source so it shows the live universal prompt.
  const allOverrides = await getAllOverrides();
  const overridePrompts: Record<string, string> = {};
  for (const kind of ["lesson", "lesson_overview", "quiz", "flashcards", "refresher"]) {
    const v = allOverrides[`${system}:${kind}`];
    if (typeof v === "string") overridePrompts[kind] = v;
  }

  return NextResponse.json({
    categories,
    // Saved universal overrides (only present for slots that have one).
    override_prompts: overridePrompts,
    // Source default prompts for each content type the lab can tune.
    default_prompts: {
      lesson: defaultSystemPromptFor(system, "lesson"),
      quiz: defaultSystemPromptFor(system, "quiz"),
      flashcards: defaultSystemPromptFor(system, "flashcards"),
      refresher: defaultSystemPromptFor(system, "refresher"),
    },
    // Overview-mode prompt for umbrella (topic) lessons — the lab swaps to this
    // when an umbrella is selected (math only; mcat falls back to the teaching prompt).
    default_overview_prompt: defaultOverviewPrompt(system),
    models: LAB_MODELS,
    default_model: LAB_DEFAULT_MODEL,
  });
}
