import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

interface CompleteBody {
  accountId?: string;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = (await req.json()) as CompleteBody;
  const { accountId } = body;

  if (!accountId || typeof accountId !== "string") {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, key);

  try {
    const { data: account, error: selectError } = await supabase
      .from("student_accounts")
      .select("diagnostic_completed_at")
      .eq("id", accountId)
      .maybeSingle();

    if (selectError) {
      // Column may not exist pre-migration — degrade gracefully
      return NextResponse.json({ ok: false });
    }

    if (!account) {
      return NextResponse.json({ ok: false });
    }

    if (account.diagnostic_completed_at != null) {
      return NextResponse.json({ ok: true, alreadyCompleted: true });
    }

    const completedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("student_accounts")
      .update({ diagnostic_completed_at: completedAt })
      .eq("id", accountId);

    if (updateError) {
      return NextResponse.json({ ok: false });
    }

    return NextResponse.json({ ok: true, diagnosticCompletedAt: completedAt });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
