"use client";

import { useState, Fragment } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type KeywordResult = {
  id: string;
  name: string;
  description: string;
  category: string;
  similarity: number;
  source?: "category_anchor" | "global";
};

type TagResult = {
  id: string;
  name: string;
  description: string;
  category: string;
  similarity: number;
};

type CategoryResult = {
  id: string;
  name: string;
  description: string;
  order_index: number;
  similarity: number;
};

const TAG_CATEGORY_LABELS: Record<string, string> = {
  action_tags: "Action",
  representation_tags: "Representation",
  problem_style_tags: "Style",
};

const TAG_CATEGORY_COLORS: Record<string, string> = {
  action_tags: "bg-violet-100 text-violet-700",
  representation_tags: "bg-sky-100 text-sky-700",
  problem_style_tags: "bg-orange-100 text-orange-700",
};

function SimilarityBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.75 ? "bg-green-500" :
    score >= 0.55 ? "bg-blue-500" :
    score >= 0.40 ? "bg-yellow-500" : "bg-gray-200";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-gray-500 font-mono">{score.toFixed(4)}</span>
    </div>
  );
}

export default function KeywordTestPage() {
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [kwResults, setKwResults] = useState<KeywordResult[]>([]);
  const [tagResults, setTagResults] = useState<TagResult[]>([]);
  const [catResults, setCatResults] = useState<CategoryResult[]>([]);
  const [kwMeta, setKwMeta] = useState<{ searched: number; tagCount: number } | null>(null);
  const [catMeta, setCatMeta] = useState<{ searched: number } | null>(null);
  const [topCategory, setTopCategory] = useState<{ id: string; name: string; similarity: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);

  async function run() {
    if (!problem.trim()) return;
    setLoading(true);
    setError(null);
    setKwResults([]);
    setTagResults([]);
    setCatResults([]);
    setKwMeta(null);
    setCatMeta(null);
    setTopCategory(null);
    setHasRun(true);

    try {
      const [kwRes, catRes] = await Promise.all([
        fetch("/api/learn/keyword-similarity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ problem }),
        }),
        fetch("/api/learn/category-similarity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ problem }),
        }),
      ]);

      const kwData = await kwRes.json() as {
        results?: KeywordResult[];
        tags?: TagResult[];
        total_keywords_searched?: number;
        total_tags_searched?: number;
        top_category?: { id: string; name: string; similarity: number } | null;
        error?: string;
      };
      const catData = await catRes.json() as { results?: CategoryResult[]; total_categories_searched?: number; error?: string };

      if (!kwRes.ok && !catRes.ok) { setError(kwData.error ?? catData.error ?? "Both requests failed"); return; }

      setKwResults(kwData.results ?? []);
      setTagResults(kwData.tags ?? []);
      setKwMeta(kwRes.ok ? { searched: kwData.total_keywords_searched ?? 0, tagCount: kwData.total_tags_searched ?? 0 } : null);
      setTopCategory(kwData.top_category ?? null);
      setCatResults(catData.results ?? []);
      setCatMeta(catRes.ok ? { searched: catData.total_categories_searched ?? 0 } : null);

      if (!kwRes.ok) toast.warning(`Keywords: ${kwData.error ?? "failed"}`);
      if (!catRes.ok) toast.warning(`Categories: ${catData.error ?? "failed"}`);
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function embedAll() {
    setEmbedding(true);
    try {
      const res = await fetch("/api/learn/embed-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embed_categories: true }),
      });
      const data = await res.json() as { embedded?: number; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Embed failed"); return; }
      toast.success(`Embedded ${data.embedded ?? 0} categories`);
    } catch {
      toast.error("Embed failed");
    } finally {
      setEmbedding(false);
    }
  }

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Similarity Test</h1>
          <p className="text-sm text-gray-500 mt-1">
            Returns the 15 best-matching keywords, 10 most applicable tags, and top categories.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={embedAll} disabled={embedding} className="flex-shrink-0 text-xs">
          {embedding ? <><Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1.5" />Embedding…</> : "Embed all categories"}
        </Button>
      </div>

      {/* Input */}
      <div className="space-y-3">
        <Textarea
          placeholder="Paste a problem here…"
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          rows={4}
          className="font-mono text-sm"
        />
        <Button onClick={run} disabled={loading || !problem.trim()}>
          {loading ? <><Loader2Icon className="h-4 w-4 animate-spin mr-2" />Searching…</> : "Search"}
        </Button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Results — 3 columns */}
      {hasRun && !loading && (kwResults.length > 0 || tagResults.length > 0 || catResults.length > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Keywords (15) */}
          <div className="xl:col-span-1 space-y-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Top {kwResults.length} Keywords</h2>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {topCategory && (
                  <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                    Anchored: <strong>{topCategory.name}</strong>
                    {topCategory.similarity > 0 && ` (${topCategory.similarity.toFixed(3)})`}
                  </span>
                )}
                {kwMeta && <span className="text-xs text-gray-400">{kwMeta.searched} keywords searched</span>}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {kwResults.map((r, i) => {
                const isLastAnchor = r.source === "category_anchor" && kwResults[i + 1]?.source !== "category_anchor";
                return (
                  <Fragment key={r.id}>
                    <div className="px-3 py-2.5 flex items-start gap-2 hover:bg-gray-50">
                      <span className="text-xs text-gray-300 tabular-nums w-4 flex-shrink-0 pt-0.5">{i + 1}</span>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-medium text-gray-900 leading-tight">{r.name}</p>
                          {r.source === "category_anchor" && (
                            <span className="text-[9px] font-semibold bg-blue-100 text-blue-700 px-1 py-0.5 rounded uppercase tracking-wide">Anchor</span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400 leading-snug line-clamp-2">{r.description}</p>
                        <SimilarityBar score={r.similarity} />
                      </div>
                    </div>
                    {isLastAnchor && (
                      <div className="px-3 py-1 bg-gray-50 flex items-center gap-2">
                        <div className="flex-1 border-t border-dashed border-gray-300" />
                        <span className="text-[9px] text-gray-400 uppercase tracking-wide flex-shrink-0">Global</span>
                        <div className="flex-1 border-t border-dashed border-gray-300" />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>

          {/* Tags (10) */}
          <div className="xl:col-span-1 space-y-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Top {tagResults.length} Tags</h2>
              {kwMeta && <p className="text-xs text-gray-400 mt-0.5">{kwMeta.tagCount} tags searched</p>}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {tagResults.map((t, i) => (
                <div key={t.id} className="px-3 py-2.5 flex items-start gap-2 hover:bg-gray-50">
                  <span className="text-xs text-gray-300 tabular-nums w-4 flex-shrink-0 pt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-medium text-gray-900 leading-tight">{t.name}</p>
                      {t.category && (
                        <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded", TAG_CATEGORY_COLORS[t.category] ?? "bg-gray-100 text-gray-500")}>
                          {TAG_CATEGORY_LABELS[t.category] ?? t.category}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 leading-snug line-clamp-2">{t.description}</p>
                    <SimilarityBar score={t.similarity} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div className="xl:col-span-1 space-y-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Top {catResults.length} Categories</h2>
              {catMeta && <p className="text-xs text-gray-400 mt-0.5">{catMeta.searched} categories searched</p>}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {catResults.map((r, i) => (
                <div key={r.id} className="px-3 py-2.5 flex items-start gap-2 hover:bg-gray-50">
                  <span className="text-xs text-gray-300 tabular-nums w-4 flex-shrink-0 pt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-xs font-medium text-gray-900 leading-tight">{r.name}</p>
                    <p className="text-[10px] text-gray-400 leading-snug line-clamp-2">{r.description}</p>
                    <SimilarityBar score={r.similarity} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasRun && !loading && kwResults.length === 0 && tagResults.length === 0 && catResults.length === 0 && !error && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-8 text-center space-y-2">
          <p className="text-sm text-amber-800 font-medium">No embedded content found.</p>
          <p className="text-xs text-amber-700">Go to <a href="/keywords" className="underline">Keyword Engine</a> to generate and embed keywords first.</p>
        </div>
      )}
    </div>
  );
}
