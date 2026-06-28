/**
 * Course Engine — shared embedding + tagging primitives.
 *
 * `cosineSimilarity` and `tagByEmbedding` were bit-for-bit identical in
 * `lib/mathTagging.ts` and `lib/mcatTagging.ts`. They live here once and are
 * re-exported by both so there is a single implementation. `embedTextRaw` is the
 * shared OpenAI call; the per-course tagging modules wrap it in their typed
 * generator error (MathGenError / McatGenError) to preserve the soft-fail contract.
 *
 * `loadTargetKeywords` is intentionally NOT here: it genuinely differs per course
 * (math paginates + filters by course membership and reads `yield_score`; mcat is
 * single-shot and reads `yield_level`). Those stay in the per-course modules.
 */
import OpenAI from "openai";

// ─── Cosine similarity ──────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Embedding (raw) ────────────────────────────────────────────────────────────

/** Distinguishes "no API key" from "request failed" so callers can map to a status. */
export class EmbeddingError extends Error {
  constructor(message: string, public kind: "no_key" | "request_failed") {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Embed text via text-embedding-3-small. Throws EmbeddingError on failure; the
 * per-course tagging modules catch and rethrow as their typed generator error.
 */
export async function embedTextRaw(text: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new EmbeddingError("OPENAI_API_KEY not set", "no_key");
  const client = new OpenAI({ apiKey: key });
  try {
    const res = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    });
    return res.data[0].embedding;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EmbeddingError(`Embedding request failed: ${msg}`, "request_failed");
  }
}

// ─── Tagging by embedding ───────────────────────────────────────────────────────

/**
 * Tag an embedding against a keyword pool.
 * Returns normalized weights for top-4 keywords with sim > 0.25.
 * Falls back to top-2 (no threshold) if none pass.
 * Returns {} if no keyword has a valid array embedding.
 */
export function tagByEmbedding(
  embedding: number[],
  keywords: { id: string; embedding: unknown }[]
): Record<string, number> {
  const withEmbed = keywords.filter(
    (k) => Array.isArray(k.embedding) && (k.embedding as unknown[]).length > 0
  );
  if (withEmbed.length === 0) return {};

  const scored = withEmbed
    .map((kw) => ({
      id: kw.id,
      sim: cosineSimilarity(embedding, kw.embedding as number[]),
    }))
    .sort((a, b) => b.sim - a.sim);

  // Top 4 with threshold
  let top = scored.slice(0, 4).filter((k) => k.sim > 0.25);

  // Fallback: top 2 regardless of threshold
  if (top.length === 0) {
    top = scored.slice(0, 2);
  }

  if (top.length === 0) return {};

  const total = top.reduce((acc, k) => acc + k.sim, 0);
  if (total === 0) return {};

  return Object.fromEntries(top.map((k) => [k.id, k.sim / total]));
}
