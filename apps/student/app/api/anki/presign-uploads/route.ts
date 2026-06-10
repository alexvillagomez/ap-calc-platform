import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key)
    return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const { paths } = (await request.json()) as { paths: string[] };
  if (!Array.isArray(paths) || paths.length === 0)
    return NextResponse.json({ error: "paths required" }, { status: 400 });

  const supabase = createClient(supabaseUrl, key);

  const BATCH = 50;
  const results: Array<{ path: string; signedUrl: string | null }> = [];

  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (path) => {
        const { data, error } = await supabase.storage
          .from("anki-media")
          .createSignedUploadUrl(path);
        return { path, signedUrl: error || !data ? null : data.signedUrl };
      })
    );
    results.push(...batchResults);
  }

  return NextResponse.json({ urls: results });
}
