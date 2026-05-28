import OpenAI from "openai";

export const GEN_MODEL = "gpt-5.4-mini";

export function createGenClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({ apiKey: key });
}
