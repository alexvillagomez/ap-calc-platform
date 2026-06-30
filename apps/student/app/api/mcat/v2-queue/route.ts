/**
 * /api/mcat/v2-queue — persist the /v2 single-page app's upcoming serve queue.
 *
 * The /v2 serve loop keeps a small buffer of the next 1–3 items it will show
 * (questions / flashcards / lessons it already fetched or generated). Saving
 * that buffer onto the session row lets the NEXT session — on ANY device, since
 * the session id is the user's uid — render the first item instantly, with no
 * taxonomy fetch and no on-the-fly generation. This is the boot-speed win.
 *
 *   GET  ?session_id=<uid>            → { queue: SavedQueueItem[] }
 *   POST { session_id, queue }        → { ok: true }
 *
 * The queue is opaque to the server (a JSON blob of already-built items); the
 * client validates/uses it. Stored on student_sessions.v2_queue (jsonb).
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/** Cap stored items — the client only ever needs the next couple. */
const MAX_QUEUE = 3;

function serviceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return null;
  return createClient(supabaseUrl, key);
}

export async function GET(request: Request) {
  const supabase = serviceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  const { data } = await supabase
    .from("student_sessions")
    .select("v2_queue")
    .eq("id", sessionId)
    .maybeSingle();

  const raw = data?.v2_queue;
  const queue = Array.isArray(raw) ? raw.slice(0, MAX_QUEUE) : [];
  return NextResponse.json({ queue });
}

export async function POST(request: Request) {
  const supabase = serviceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    session_id?: string;
    queue?: unknown;
  };
  const { session_id, queue } = body;
  if (!session_id) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  const trimmed = Array.isArray(queue) ? queue.slice(0, MAX_QUEUE) : [];

  // The session anchor row always exists by the time we serve (getOrCreate runs
  // first), so a plain UPDATE is enough; ignore the (rare) missing-row case.
  const { error } = await supabase
    .from("student_sessions")
    .update({ v2_queue: trimmed })
    .eq("id", session_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
