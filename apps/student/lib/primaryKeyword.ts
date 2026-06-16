/**
 * Returns the keyword id with the highest weight in a question/card's
 * `keyword_weights` map, or null if the map is empty/missing. Used to pick the
 * single "primary" topic a QuestionToolbar acts on (lesson, refresher, priority).
 */
export function primaryKeywordId(
  weights: Record<string, number> | null | undefined
): string | null {
  if (!weights) return null;
  let best: string | null = null;
  let bestVal = -Infinity;
  for (const [id, w] of Object.entries(weights)) {
    if (w > bestVal) {
      bestVal = w;
      best = id;
    }
  }
  return best;
}
