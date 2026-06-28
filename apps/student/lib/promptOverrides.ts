/**
 * promptOverrides — the "universal prompt" layer behind the Content Lab.
 *
 * Each generation SYSTEM PROMPT (math/mcat × lesson | lesson_overview | quiz |
 * flashcards | refresher) has a SOURCE constant in the generator file. That
 * constant is the built-in default. The Content Lab can save an OVERRIDE for any
 * slot into `prompt_overrides`; once saved, EVERY generation path that doesn't
 * pass an explicit `systemPrompt` resolves `override ?? constant`, so the lab edit
 * becomes universal (students get it too).
 *
 * The override map is cached (serverCache, short TTL) so the resolve lookup on the
 * hot generation path is ~free; saving/resetting invalidates the cache so the new
 * prompt takes effect immediately. Fail-open: any error → the source constant.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cached, invalidate } from "@/lib/serverCache";

export type LabSystem = "math" | "mcat";
export type PromptSlotKind =
  | "lesson"
  | "lesson_overview"
  | "quiz"
  | "flashcards"
  | "refresher";

/** Canonical override key: "{system}:{kind}", e.g. "math:lesson_overview". */
export function promptSlot(system: LabSystem, kind: PromptSlotKind): string {
  return `${system}:${kind}`;
}

const TABLE = "prompt_overrides";
const CACHE_KEY = "prompt_overrides:all";
const CACHE_TTL_MS = 30_000;

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** All saved overrides as { slot → prompt }. Cached; fail-open to {}. */
export async function getAllOverrides(): Promise<Record<string, string>> {
  try {
    return await cached(CACHE_KEY, CACHE_TTL_MS, async () => {
      const sb = serviceClient();
      if (!sb) return {};
      const { data, error } = await sb.from(TABLE).select("prompt_key, prompt");
      if (error || !data) return {};
      const map: Record<string, string> = {};
      for (const row of data as { prompt_key: string; prompt: string }[]) {
        if (row.prompt_key && typeof row.prompt === "string") {
          map[row.prompt_key] = row.prompt;
        }
      }
      return map;
    });
  } catch {
    return {};
  }
}

/**
 * Resolve the system prompt for a slot: the saved universal override if one
 * exists, otherwise the source-code constant `fallback`. This is the single call
 * every generator uses at its `opts.systemPrompt ?? <constant>` site.
 */
export async function resolveSystemPrompt(
  slot: string,
  fallback: string
): Promise<string> {
  const all = await getAllOverrides();
  const v = all[slot];
  return typeof v === "string" && v.trim() ? v : fallback;
}

/** Save (upsert) a universal override and invalidate the cache. */
export async function setPromptOverride(
  supabase: SupabaseClient,
  slot: string,
  prompt: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ prompt_key: slot, prompt, updated_at: new Date().toISOString() }, { onConflict: "prompt_key" });
  await invalidate(CACHE_KEY);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Delete a universal override (revert the slot to its source constant). */
export async function deletePromptOverride(
  supabase: SupabaseClient,
  slot: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).delete().eq("prompt_key", slot);
  await invalidate(CACHE_KEY);
  return error ? { ok: false, error: error.message } : { ok: true };
}
