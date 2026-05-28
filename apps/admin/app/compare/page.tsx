"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export default function ComparePage() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function compare() {
    setLoading(true);
    setScore(null);
    setError(null);
    try {
      const res = await fetch("/api/learn/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a, b }),
      });
      const data = await res.json() as { similarity?: number; error?: string };
      if (!res.ok) { setError(data.error ?? "Failed"); return; }
      setScore(data.similarity ?? 0);
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  const label =
    score === null ? null :
    score >= 0.90 ? "Near-identical" :
    score >= 0.75 ? "Very similar" :
    score >= 0.55 ? "Somewhat related" :
    score >= 0.35 ? "Loosely related" : "Not similar";

  const barColor =
    score === null ? "" :
    score >= 0.75 ? "bg-green-500" :
    score >= 0.55 ? "bg-blue-500" :
    score >= 0.35 ? "bg-yellow-500" : "bg-gray-300";

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Embedding Similarity</h1>
        <p className="text-sm text-gray-500 mt-1">Enter two descriptions to see how similar they are.</p>
      </div>

      <div className="space-y-3">
        <Textarea
          placeholder="First description…"
          value={a}
          onChange={(e) => setA(e.target.value)}
          rows={3}
          className="text-sm"
        />
        <Textarea
          placeholder="Second description…"
          value={b}
          onChange={(e) => setB(e.target.value)}
          rows={3}
          className="text-sm"
        />
        <Button onClick={compare} disabled={loading || !a.trim() || !b.trim()}>
          {loading ? <><Loader2Icon className="h-4 w-4 animate-spin mr-2" />Comparing…</> : "Compare"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {score !== null && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-end justify-between">
            <span className="text-4xl font-bold tabular-nums text-gray-900">{score.toFixed(4)}</span>
            <span className={cn("text-sm font-medium px-3 py-1 rounded-full",
              score >= 0.75 ? "bg-green-100 text-green-700" :
              score >= 0.55 ? "bg-blue-100 text-blue-700" :
              score >= 0.35 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"
            )}>{label}</span>
          </div>
          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-500", barColor)}
              style={{ width: `${score * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-gray-400">
            <span>0 — unrelated</span>
            <span>1 — identical</span>
          </div>
        </div>
      )}
    </div>
  );
}
