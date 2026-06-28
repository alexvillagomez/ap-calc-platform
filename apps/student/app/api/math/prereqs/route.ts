/**
 * GET /api/math/prereqs?keyword_id=&category_id=&course=
 *
 * Returns the prerequisite UNITS for the current topic — a small "See also" list
 * so a student can jump to a refresher on a prerequisite they're shaky on. Sourced
 * from the structured `math_prereq_edges` (category-level prereqs: a row
 * from_category_id → to_category_id means `from` is a prerequisite of `to`).
 *
 * Cross-course aware: a calc topic whose prerequisite is a precalc unit links into
 * whichever course actually contains that unit (the current course if it's a
 * member — calc bundles the precalc foundations — otherwise precalc).
 *
 * Response: { prereqs: [{ id, label, course, href, note }] }  (≤3, fail-soft → []).
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { MathCourse } from "@/lib/mathTypes";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ prereqs: [] });
  }

  const { searchParams } = new URL(request.url);
  const keywordId = searchParams.get("keyword_id");
  let categoryId = searchParams.get("category_id");
  const course = (searchParams.get("course") ?? "precalc") as MathCourse;

  const supabase = createClient(supabaseUrl, key);

  try {
    // Resolve the current category from the keyword if not given directly.
    if (!categoryId && keywordId) {
      const { data: kw } = await supabase
        .from("math_keywords")
        .select("category_id")
        .eq("id", keywordId)
        .maybeSingle();
      categoryId = (kw?.category_id as string | undefined) ?? null;
    }
    if (!categoryId) return NextResponse.json({ prereqs: [] });

    // Prerequisite categories: rows whose `to` is the current category.
    const { data: edges } = await supabase
      .from("math_prereq_edges")
      .select("from_category_id, strength, note")
      .eq("to_category_id", categoryId)
      .order("strength", { ascending: false })
      .limit(6);

    const prereqCatIds = [
      ...new Set((edges ?? []).map((e) => e.from_category_id as string)),
    ].filter((id) => id !== categoryId);
    if (prereqCatIds.length === 0) return NextResponse.json({ prereqs: [] });

    // Labels + which course to link each prereq into.
    const [{ data: cats }, { data: memberships }] = await Promise.all([
      supabase.from("math_categories").select("id, label").in("id", prereqCatIds),
      supabase
        .from("math_course_categories")
        .select("course, category_id")
        .in("category_id", prereqCatIds),
    ]);

    const labelOf = new Map((cats ?? []).map((c) => [c.id as string, c.label as string]));
    const coursesOf = new Map<string, Set<string>>();
    for (const m of memberships ?? []) {
      const cid = m.category_id as string;
      if (!coursesOf.has(cid)) coursesOf.set(cid, new Set());
      coursesOf.get(cid)!.add(m.course as string);
    }
    const noteOf = new Map(
      (edges ?? []).map((e) => [e.from_category_id as string, (e.note as string) ?? ""])
    );

    const prereqs = prereqCatIds
      .map((cid) => {
        const label = labelOf.get(cid);
        if (!label) return null;
        const memberCourses = coursesOf.get(cid) ?? new Set<string>();
        // Prefer the current course (calc bundles precalc foundations); else precalc.
        const linkCourse = memberCourses.has(course)
          ? course
          : memberCourses.has("precalc")
            ? "precalc"
            : course;
        return {
          id: cid,
          label,
          course: linkCourse,
          href: `/math/${linkCourse}/${cid}`,
          note: noteOf.get(cid) ?? "",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, 3);

    return NextResponse.json({ prereqs });
  } catch {
    return NextResponse.json({ prereqs: [] });
  }
}
