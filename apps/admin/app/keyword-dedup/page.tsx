"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type KwInfo = {
  id: string;
  name: string;
  label?: string | null;
  description?: string | null;
  category_id?: string | null;
};

type Pair = {
  a: KwInfo;
  b: KwInfo;
  similarity: number;
  reasoning?: string;
};

type Decision = "keep_a" | "keep_b" | "keep_both";

type Category = { id: string; name: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SimilarityDot({ score }: { score: number }) {
  const color =
    score >= 0.92 ? "bg-red-500" :
    score >= 0.85 ? "bg-orange-400" : "bg-yellow-400";
  const dots = score >= 0.92 ? 3 : score >= 0.85 ? 2 : 1;
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-sm font-semibold tabular-nums text-gray-700">{score.toFixed(3)}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={cn("w-2 h-2 rounded-full", i < dots ? color : "bg-gray-200")} />
        ))}
      </div>
    </div>
  );
}

function KeywordCell({ kw, side, decision, onKeep }: {
  kw: KwInfo;
  side: "a" | "b";
  decision: Decision;
  onKeep: () => void;
}) {
  const kept = (side === "a" && decision !== "keep_b") || (side === "b" && decision !== "keep_a");
  const label = kept ? (decision === "keep_both" ? "✓ Kept" : "✓ Keeping") : "✗ Deleting";
  const labelColor = kept
    ? decision === "keep_both" ? "text-blue-600" : "text-green-600"
    : "text-red-500";

  return (
    <div className={cn(
      "flex-1 rounded-xl border p-4 space-y-2 transition-colors",
      !kept ? "opacity-50 border-red-200 bg-red-50" : "border-gray-200 bg-white"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-tight">{kw.name ?? kw.label ?? kw.id}</p>
          <p className="text-[10px] font-mono text-gray-400">{kw.id}</p>
        </div>
        <span className={cn("text-[10px] font-medium flex-shrink-0", labelColor)}>{label}</span>
      </div>
      {kw.description && (
        <p className="text-xs text-gray-500 leading-relaxed">{kw.description}</p>
      )}
      {kw.category_id && (
        <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded inline-block">
          {kw.category_id.replace(/_/g, " ")}
        </span>
      )}
      <button
        onClick={onKeep}
        className={cn(
          "text-xs px-3 py-1 rounded-lg border transition-colors w-full",
          kept && decision !== "keep_both"
            ? "bg-green-500 border-green-500 text-white font-medium"
            : "border-gray-200 text-gray-500 hover:border-green-400 hover:bg-green-50 hover:text-green-700"
        )}
      >
        {kept && decision !== "keep_both" ? "✓ Keeping this" : "Keep this one"}
      </button>
    </div>
  );
}

function PairCard({ pair, index, decision, onDecision }: {
  pair: Pair;
  index: number;
  decision: Decision;
  onDecision: (d: Decision) => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="font-mono">#{index + 1}</span>
        <span>·</span>
        <span>Similarity</span>
        {pair.reasoning && (
          <>
            <span>·</span>
            <span className="text-blue-500 italic">{pair.reasoning}</span>
          </>
        )}
      </div>

      <div className="flex items-stretch gap-3">
        <KeywordCell
          kw={pair.a}
          side="a"
          decision={decision}
          onKeep={() => onDecision("keep_a")}
        />

        <div className="flex flex-col items-center justify-center gap-2 flex-shrink-0 w-16">
          <SimilarityDot score={pair.similarity} />
          <button
            onClick={() => onDecision("keep_both")}
            className={cn(
              "text-[10px] px-2 py-1 rounded border transition-colors text-center",
              decision === "keep_both"
                ? "bg-blue-500 border-blue-500 text-white font-medium"
                : "border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-600"
            )}
          >
            {decision === "keep_both" ? "✓ Both" : "Keep both"}
          </button>
        </div>

        <KeywordCell
          kw={pair.b}
          side="b"
          decision={decision}
          onKeep={() => onDecision("keep_b")}
        />
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function KeywordDedupPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [catOrderMap, setCatOrderMap] = useState<Record<string, number>>({});
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [threshold, setThreshold] = useState(0.88);
  const [scanning, setScanning] = useState(false);
  const [autoResolving, setAutoResolving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [meta, setMeta] = useState<{ scanned: number; found: number } | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});

  useEffect(() => {
    fetch("/api/learn/categories")
      .then((r) => r.json())
      .then((d: { categories?: (Category & { order_index?: number })[] }) => {
        const cats = d.categories ?? [];
        setCategories(cats);
        // Build order_index map for auto-decision (earliest unit = lowest order_index)
        const map: Record<string, number> = {};
        cats.forEach((c) => { map[c.id] = c.order_index ?? 999; });
        setCatOrderMap(map);
      })
      .catch(() => {});
  }, []);

  async function scan() {
    setScanning(true);
    setPairs([]);
    setDecisions({});
    setMeta(null);
    try {
      const res = await fetch("/api/learn/find-duplicate-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threshold,
          ...(selectedCategory ? { category_id: selectedCategory } : { global: true }),
        }),
      });
      const data = await res.json() as {
        pairs?: Pair[];
        keywords_scanned?: number;
        pairs_found?: number;
        error?: string;
      };
      if (!res.ok) { toast.error(data.error ?? "Scan failed"); return; }

      const ps = data.pairs ?? [];
      setPairs(ps);
      setMeta({ scanned: data.keywords_scanned ?? 0, found: data.pairs_found ?? 0 });
      // Auto-decide: keep the keyword from the earliest category (lowest order_index).
      // If same category or no order info, default to keep_a.
      const defaults: Record<number, Decision> = {};
      ps.forEach((pair, i) => {
        const orderA = catOrderMap[pair.a.category_id ?? ""] ?? 999;
        const orderB = catOrderMap[pair.b.category_id ?? ""] ?? 999;
        defaults[i] = orderB < orderA ? "keep_b" : "keep_a";
      });
      setDecisions(defaults);

      if (ps.length === 0) toast.success("No duplicates found at this threshold");
    } catch {
      toast.error("Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function autoResolve() {
    setAutoResolving(true);
    setPairs([]);
    setDecisions({});
    setMeta(null);
    try {
      const res = await fetch("/api/learn/auto-resolve-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threshold,
          ...(selectedCategory ? { category_id: selectedCategory } : {}),
        }),
      });
      const data = await res.json() as {
        pairs?: (Pair & { decision: Decision; reasoning: string })[];
        keywords_scanned?: number;
        pairs_found?: number;
        error?: string;
      };
      if (!res.ok) { toast.error(data.error ?? "Auto-resolve failed"); return; }

      const ps = data.pairs ?? [];
      // Store reasoning in the pair objects for display
      setPairs(ps as Pair[]);
      setMeta({ scanned: data.keywords_scanned ?? 0, found: data.pairs_found ?? 0 });
      const autoDecisions: Record<number, Decision> = {};
      ps.forEach((p, i) => { autoDecisions[i] = p.decision; });
      setDecisions(autoDecisions);

      const autoDeleted = ps.filter((p) => p.decision !== "keep_both").length;
      if (ps.length === 0) toast.success("No duplicates found at this threshold");
      else toast.success(`AI resolved ${ps.length} pairs — ${autoDeleted} marked for deletion. Review and confirm below.`);
    } catch {
      toast.error("Auto-resolve failed");
    } finally {
      setAutoResolving(false);
    }
  }

  async function applyDecisions() {
    const toDelete = new Set<string>();
    pairs.forEach((pair, i) => {
      const d = decisions[i] ?? "keep_a";
      if (d === "keep_a") toDelete.add(pair.b.id);
      else if (d === "keep_b") toDelete.add(pair.a.id);
      // keep_both: delete neither
    });

    if (toDelete.size === 0) { toast.error("Nothing to delete"); return; }

    const confirmed = window.confirm(`Delete ${toDelete.size} keyword${toDelete.size === 1 ? "" : "s"}? This cannot be undone.`);
    if (!confirmed) return;

    setApplying(true);
    try {
      const res = await fetch("/api/learn/approve-keywords", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...toDelete] }),
      });
      const data = await res.json() as { deleted?: number; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Delete failed"); return; }
      toast.success(`Deleted ${data.deleted} keywords`);
      await scan(); // re-scan
    } catch {
      toast.error("Delete failed");
    } finally {
      setApplying(false);
    }
  }

  const deleteCount = pairs.reduce((acc, pair, i) => {
    const d = decisions[i] ?? "keep_a";
    return acc + (d === "keep_both" ? 0 : 1);
  }, 0);

  const undecidedCount = Object.values(decisions).filter((d) => d === "keep_both").length;

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Keyword Deduplication</h1>
        <p className="text-sm text-gray-500 mt-1">
          Find keywords that are too similar to each other across all categories. When duplicates are found across categories, the one from the <span className="font-medium">earliest unit/category</span> is kept automatically — override per pair as needed.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 bg-white border border-gray-200 rounded-xl p-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Category</label>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="h-8 text-sm border border-gray-200 rounded-lg px-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">All categories (global scan)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">
            Similarity threshold: <span className="font-semibold text-gray-900">{threshold.toFixed(2)}</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">0.70</span>
            <input
              type="range"
              min={0.70}
              max={0.99}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="w-36 accent-blue-600"
            />
            <span className="text-xs text-gray-400">0.99</span>
          </div>
          <p className="text-[10px] text-gray-400">
            {threshold >= 0.92 ? "Near-identical only" : threshold >= 0.85 ? "Very similar" : "Broadly similar"}
          </p>
        </div>

        <Button onClick={scan} disabled={scanning || autoResolving} className="h-8 text-sm" variant="outline">
          {scanning ? <><Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1.5" /> Scanning…</> : "Scan (manual)"}
        </Button>
        <Button onClick={autoResolve} disabled={scanning || autoResolving} className="h-8 text-sm">
          {autoResolving ? <><Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1.5" /> AI resolving…</> : "✦ AI Auto-resolve"}
        </Button>

        {!selectedCategory && (
          <p className="text-xs text-amber-600">⚠ Global scan may be slow for large keyword sets</p>
        )}
      </div>

      {/* Results header */}
      {meta && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            <span className="font-semibold">{meta.found}</span> potential duplicate pairs found across{" "}
            <span className="font-semibold">{meta.scanned}</span> keywords
            {pairs.length < meta.found && ` (showing top ${pairs.length})`}
          </p>
          {pairs.length > 0 && (
            <Button
              onClick={applyDecisions}
              disabled={applying || deleteCount === 0}
              variant={deleteCount > 0 ? "default" : "outline"}
              className="text-sm h-8"
            >
              {applying
                ? <><Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1.5" /> Deleting…</>
                : deleteCount > 0
                  ? `Apply — delete ${deleteCount} keyword${deleteCount === 1 ? "" : "s"}`
                  : "No deletions selected"}
            </Button>
          )}
        </div>
      )}

      {/* Legend */}
      {pairs.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500" /> ≥ 0.92 near-identical</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-400" /> ≥ 0.85 very similar</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-400" /> ≥ threshold broadly similar</div>
          {undecidedCount > 0 && <span className="text-blue-600">{undecidedCount} kept both</span>}
        </div>
      )}

      {/* Pair cards */}
      {pairs.length > 0 && (
        <div className="space-y-3">
          {pairs.map((pair, i) => (
            <PairCard
              key={`${pair.a.id}-${pair.b.id}`}
              pair={pair}
              index={i}
              decision={decisions[i] ?? "keep_a"}
              onDecision={(d) => setDecisions((prev) => ({ ...prev, [i]: d }))}
            />
          ))}
        </div>
      )}

      {meta && pairs.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-8 text-center">
          <p className="text-sm text-green-700 font-medium">No duplicates found at this threshold.</p>
          <p className="text-xs text-green-600 mt-1">Try lowering the threshold to catch more broadly similar keywords.</p>
        </div>
      )}
    </div>
  );
}
