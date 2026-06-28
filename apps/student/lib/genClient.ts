/**
 * Provider-routing factory for content-generation clients.
 *
 * Every supported model speaks the OpenAI Chat Completions API, so we return an
 * OpenAI SDK client pointed at the right endpoint + key based on the model id:
 *   - gemini-* → Google Gemini via its OpenAI-compatible endpoint (GEMINI_API_KEY)
 *   - everything else (gpt-*) → OpenAI (OPENAI_API_KEY)
 *
 * Used by the math / MCAT / refresher generators so the dev Content Lab can A/B a
 * model across providers just by picking it in the dropdown. To add a provider
 * (e.g. GLM/Zhipu) later, add a branch here with its base URL + key — no caller
 * changes needed.
 */
import OpenAI from "openai";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

/** OpenAI-compatible client for the given model id, routed to the right provider. */
export function clientForModel(model: string): OpenAI {
  if (model.startsWith("gemini")) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY not set");
    return new OpenAI({ apiKey: key, baseURL: GEMINI_BASE_URL });
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey: key });
}
