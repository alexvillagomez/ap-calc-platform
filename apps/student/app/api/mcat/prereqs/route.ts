/**
 * GET /api/mcat/prereqs?keyword_id=&category_id=
 *
 * Returns a small "See also" list of prerequisite TOPICS for the current MCAT
 * topic so a student can jump to a quick flashcard refresher on foundations they're
 * shaky on. MCAT has no structured prereq-edge table, but its taxonomy is ordered
 * pedagogically (a category's umbrellas build on each other in order_index order),
 * so the prerequisites of a topic are the EARLIER topics in its unit; for the first
 * topic of a unit we fall back to the previous unit's last topic.
 *
 * Each item links to that topic's flashcards (the quickest recall refresher).
 *
 * Response: { prereqs: [{ id, label, href }] }  (≤3, fail-soft → []).
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type UmbrellaRow = { id: string; label: string; order_index: number; category_id: string };

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return NextResponse.json({ prereqs: [] });

  const { searchParams } = new URL(request.url);
  const keywordId = searchParams.get("keyword_id");
  let categoryId = searchParams.get("category_id");

  const supabase = createClient(supabaseUrl, key);

  try {
    // Resolve current category + current umbrella from the keyword.
    let currentUmbrellaId: string | null = null;
    if (keywordId) {
      const { data: kw } = await supabase
        .from("mcat_keywords")
        .select("id, category_id, tier, parent_keyword_id")
        .eq("id", keywordId)
        .maybeSingle();
      if (kw) {
        categoryId = (kw.category_id as string) ?? categoryId;
        currentUmbrellaId =
          (kw.tier as string) === "umbrella"
            ? (kw.id as string)
            : ((kw.parent_keyword_id as string | null) ?? null);
      }
    }
    if (!categoryId) return NextResponse.json({ prereqs: [] });

    // All umbrellas in this category, in curriculum order.
    const { data: umbRows } = await supabase
      .from("mcat_keywords")
      .select("id, label, order_index, category_id")
      .eq("category_id", categoryId)
      .eq("tier", "umbrella")
      .eq("status", "approved")
      .order("order_index");
    const umbrellas = (umbRows ?? []) as UmbrellaRow[];

    const mk = (u: { id: string; label: string; category_id: string }) => ({
      id: u.id,
      label: u.label,
      href: `/mcat/${u.category_id}/flashcards?umbrella=${encodeURIComponent(
        u.id
      )}&label=${encodeURIComponent(u.label)}`,
    });

    // Earlier topics in the same unit are the prerequisites.
    const curIdx = currentUmbrellaId
      ? umbrellas.findIndex((u) => u.id === currentUmbrellaId)
      : umbrellas.length; // unknown → treat as "after all" so earlier = all
    if (curIdx > 0) {
      const earlier = umbrellas.slice(Math.max(0, curIdx - 2), curIdx);
      return NextResponse.json({ prereqs: earlier.reverse().map(mk) });
    }

    // First topic of the unit → fall back to the previous unit's last topic.
    const { data: catRows } = await supabase
      .from("mcat_categories")
      .select("id, order_index")
      .order("order_index");
    const cats = catRows ?? [];
    const myIdx = cats.findIndex((c) => c.id === categoryId);
    if (myIdx > 0) {
      const prevCatId = cats[myIdx - 1]!.id as string;
      const { data: prevUmb } = await supabase
        .from("mcat_keywords")
        .select("id, label, order_index, category_id")
        .eq("category_id", prevCatId)
        .eq("tier", "umbrella")
        .eq("status", "approved")
        .order("order_index", { ascending: false })
        .limit(1);
      if (prevUmb && prevUmb.length > 0) {
        return NextResponse.json({ prereqs: [mk(prevUmb[0] as UmbrellaRow)] });
      }
    }

    return NextResponse.json({ prereqs: [] });
  } catch {
    return NextResponse.json({ prereqs: [] });
  }
}
