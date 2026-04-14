import type { TopicWeights } from "@ap-calc/types";

/** Build full-catalog relevance: every known subtopic id → weight (0 if absent in sparse). */
export function expandSubtopicRelevance(
  allTopicIds: string[],
  sparseWeights: Record<string, number>
): TopicWeights {
  const out: TopicWeights = {};
  for (const id of allTopicIds) {
    const v = sparseWeights[id];
    out[id] = typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  }
  return out;
}
