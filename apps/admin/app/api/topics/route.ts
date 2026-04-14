import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const CONFIG_ERROR_MESSAGE =
  "Supabase is not configured. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) are set in apps/admin/.env.local.";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    return NextResponse.json(
      { error: CONFIG_ERROR_MESSAGE },
      { status: 500 }
    );
  }

  const key = serviceRoleKey ?? anonKey;
  if (!key) {
    return NextResponse.json(
      { error: CONFIG_ERROR_MESSAGE },
      { status: 500 }
    );
  }

  if (!serviceRoleKey && anonKey) {
    console.warn(
      "Topics API: using anon key; set SUPABASE_SERVICE_ROLE_KEY for service-role access"
    );
  }

  const supabase = createClient(supabaseUrl, key);
  const { data, error } = await supabase
    .from("topic_metadata")
    .select("id, name, description")
    .order("id");

  if (error) {
    console.error("Topics API error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  console.log("Topics fetched:", data?.length ?? 0, "rows", data ?? []);
  return NextResponse.json(data ?? []);
}
