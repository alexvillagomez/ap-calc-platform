/**
 * Normalizes an array of weighted labels so their weights sum to 1.
 * Applied outside the LLM as a post-processing step.
 * If all weights are 0 or the array is empty, returns the array unchanged.
 */
export function normalizeWeights<T extends { weight: number }>(items: T[]): T[] {
  if (items.length === 0) return items;
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return items;
  return items.map((item) => ({ ...item, weight: Math.round((item.weight / total) * 10000) / 10000 }));
}

/**
 * Normalizes a Record<string, number> keyword_weights map so values sum to 1.
 */
export function normalizeWeightsMap(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights).filter(([, v]) => v > 0);
  if (entries.length === 0) return weights;
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total <= 0) return weights;
  return Object.fromEntries(entries.map(([k, v]) => [k, Math.round((v / total) * 10000) / 10000]));
}
