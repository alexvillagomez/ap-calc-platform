/**
 * Seed topic_metadata table from packages/constants/topics.json
 * Uses SUPABASE_SERVICE_ROLE_KEY for full access.
 *
 * Run: npm run seed:topics
 * Requires: SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in .env.local
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface TopicRow {
  id: string;
  name: string;
  description: string;
}

interface TopicsJsonRow {
  id: string;
  unit?: string;
  name: string;
  description: string;
}

async function seedTopics() {
  const topicsPath = join(__dirname, "..", "packages", "constants", "topics.json");
  const raw = readFileSync(topicsPath, "utf-8");
  const topics: TopicsJsonRow[] = JSON.parse(raw);

  const rows: TopicRow[] = topics.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
  }));

  const { error } = await supabase.from("topic_metadata").upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("Upsert failed:", error);
    process.exit(1);
  }

  console.log(`Upserted ${rows.length} topics into topic_metadata`);
}

seedTopics();
