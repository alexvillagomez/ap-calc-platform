"use client";

import { useState, useEffect } from "react";
import { Loader2Icon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Category = { id: string; name: string };

type RetagResult = {
  problem_id: string;
  cos_score: number;
  applies: boolean;
  weight: number;
  reasoning: string;
  updated: boolean;
};

type RetagResponse = {
  keyword: { id: string; name: string };
  problems_searched: number;
  candidates_above_threshold: number;
  applies_count: number;
  updated_count: number;
  dry_run: boolean;
  results: RetagResult[];
};

export default function KeywordAddPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [kwId, setKwId] = useState("");
  const [kwName, setKwName] = useState("");
  const [kwDesc, setKwDesc] = useState("");
  const [kwCategory, setKwCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [addedKeyword, setAddedKeyword] = useState<{ id: string; name: string } | null>(null);

  // Retroactive tagging
  const [cosThreshold, setCosThreshold] = useState(0.45);
  const [weightThreshold, setWeightThreshold] = useState(0.25);
  const [dryRun, setDryRun] = useState(true);
  const [retagging, setRetagging] = useState(false);
  const [retagResult, setRetagResult] = useState<RetagResponse | null>(null);

  // Existing keyword search
  const [searchKwId, setSearchKwId] = useState("");
  const [searchMode, setSearchMode] = useState<"new" | "existing">("new");

  useEffect(() => {
    fetch("/api/learn/categories")
      .then((r) => r.json())
      .then((d: { categories?: Category[] }) => setCategories(d.categories ?? []))
      .catch(() => {});
  }, []);

  // Auto-generate id from name
  function handleNameChange(val: string) {
    setKwName(val);
    if (!kwId || kwId === kwName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")) {
      setKwId(val.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
    }
  }

  async function addKeyword() {
    if (!kwId.trim() || !kwName.trim() || !kwDesc.trim()) {
      toast.error("ID, name, and description are all required");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/learn/add-keyword", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: kwId, name: kwName, description: kwDesc, category_id: kwCategory || null }),
      });
      const data = await res.json() as { keyword?: { id: string; name: string }; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Failed"); return; }
      setAddedKeyword(data.keyword ?? null);
      toast.success(`Keyword "${kwName}" added and embedded`);
    } catch {
      toast.error("Failed to add keyword");
    } finally {
      setAdding(false);
    }
  }

  async function runRetag(targetId: string) {
    setRetagging(true);
    setRetagResult(null);
    try {
      const res = await fetch("/api/learn/retag-with-keyword", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_id: targetId, cos_threshold: cosThreshold, weight_threshold: weightThreshold, dry_run: dryRun }),
      });
      const data = await res.json() as RetagResponse & { error?: string };
      if (!res.ok) { toast.error(data.error ?? "Retag failed"); return; }
      setRetagResult(data);
      toast.success(dryRun
        ? `Dry run: ${data.applies_count} problems would be updated`
        : `Updated ${data.updated_count} problems`
      );
    } catch {
      toast.error("Retag failed");
    } finally {
      setRetagging(false);
    }
  }

  const activeKeywordId = searchMode === "existing" ? searchKwId.trim() : addedKeyword?.id ?? null;

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Add Keyword + Retroactive Tagging</h1>
        <p className="text-sm text-gray-500 mt-1">
          Create a new keyword (or select an existing one), then run it against existing problems to find matches.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button size="sm" variant={searchMode === "new" ? "default" : "outline"} onClick={() => setSearchMode("new")}>New keyword</Button>
        <Button size="sm" variant={searchMode === "existing" ? "default" : "outline"} onClick={() => setSearchMode("existing")}>Existing keyword</Button>
      </div>

      {/* ── New keyword form ── */}
      {searchMode === "new" && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">1. Define the keyword</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Name</label>
              <Input value={kwName} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g. Quotient Rule for Exponents" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">ID (auto-generated, editable)</label>
              <Input value={kwId} onChange={(e) => setKwId(e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""))} placeholder="quotient_rule_for_exponents" className="font-mono text-sm" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Description <span className="text-gray-400">(optimized for embedding — describe the math pattern)</span></label>
            <Textarea value={kwDesc} onChange={(e) => setKwDesc(e.target.value)} rows={3} placeholder="Simplifying a quotient of powers with the same base by subtracting exponents, such as x^7/x^3 or a^m/a^n." />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Category <span className="text-gray-400">(optional)</span></label>
            <select value={kwCategory} onChange={(e) => setKwCategory(e.target.value)} className="w-full h-9 text-sm border border-input rounded-md px-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">— no category —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <Button onClick={addKeyword} disabled={adding || !kwId.trim() || !kwName.trim() || !kwDesc.trim()}>
            {adding ? <><Loader2Icon className="h-4 w-4 animate-spin mr-2" />Adding & embedding…</> : "Add keyword →"}
          </Button>

          {addedKeyword && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2">
              <CheckIcon className="h-4 w-4 text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm text-green-800 font-medium">Keyword added and embedded</p>
                <p className="text-xs text-green-600 font-mono">{addedKeyword.id}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Existing keyword ── */}
      {searchMode === "existing" && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-800">Select existing keyword</h2>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Keyword ID (snake_case)</label>
            <Input value={searchKwId} onChange={(e) => setSearchKwId(e.target.value)} placeholder="e.g. quotient_rule_for_exponents" className="font-mono" />
          </div>
        </div>
      )}

      {/* ── Retroactive tagging ── */}
      {(activeKeywordId || searchMode === "existing") && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">2. Check existing problems</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Embeds all approved problems, scores by cosine similarity, then asks the LLM if the keyword applies.
              {activeKeywordId && <span className="ml-1 font-mono text-gray-600">← {activeKeywordId}</span>}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Cosine similarity threshold</label>
              <div className="flex items-center gap-2">
                <input type="range" min={0.3} max={0.8} step={0.05} value={cosThreshold} onChange={(e) => setCosThreshold(parseFloat(e.target.value))} className="flex-1 accent-blue-600" />
                <span className="text-xs font-mono w-10 text-right">{cosThreshold.toFixed(2)}</span>
              </div>
              <p className="text-[10px] text-gray-400">Problems below this score are skipped without LLM call</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">LLM weight threshold</label>
              <div className="flex items-center gap-2">
                <input type="range" min={0.1} max={0.5} step={0.05} value={weightThreshold} onChange={(e) => setWeightThreshold(parseFloat(e.target.value))} className="flex-1 accent-blue-600" />
                <span className="text-xs font-mono w-10 text-right">{weightThreshold.toFixed(2)}</span>
              </div>
              <p className="text-[10px] text-gray-400">LLM weight must exceed this to update the problem</p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-blue-600" />
            <span className="font-medium">Dry run</span>
            <span className="text-gray-400 text-xs">— show results without writing to DB</span>
          </label>

          <Button onClick={() => activeKeywordId && runRetag(activeKeywordId)} disabled={retagging || !activeKeywordId}>
            {retagging
              ? <><Loader2Icon className="h-4 w-4 animate-spin mr-2" />Scanning {46} problems…</>
              : dryRun ? "Preview matches (dry run)" : "Apply to matching problems"}
          </Button>
        </div>
      )}

      {/* ── Results ── */}
      {retagResult && (
        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex gap-6 text-sm">
            <div><span className="text-gray-500">Searched</span> <span className="font-semibold">{retagResult.problems_searched}</span></div>
            <div><span className="text-gray-500">Above cosine threshold</span> <span className="font-semibold">{retagResult.candidates_above_threshold}</span></div>
            <div><span className="text-gray-500">LLM says applies</span> <span className="font-semibold text-green-600">{retagResult.applies_count}</span></div>
            <div><span className="text-gray-500">Updated in DB</span> <span className="font-semibold text-blue-600">{retagResult.updated_count}</span></div>
            {retagResult.dry_run && <Badge variant="outline">Dry run</Badge>}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
            {retagResult.results.map((r) => (
              <div key={r.problem_id} className={cn("px-4 py-3 flex items-start gap-3", !r.applies && "opacity-50")}>
                <div className="flex-shrink-0 mt-0.5">
                  {r.applies
                    ? <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded">✓ applies</span>
                    : <span className="text-[10px] font-semibold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">skip</span>
                  }
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500">{r.problem_id.slice(0, 8)}</span>
                    <span className="text-[10px] text-gray-400">cos: {r.cos_score.toFixed(4)}</span>
                    {r.applies && <span className="text-[10px] font-medium text-blue-600">weight: {r.weight.toFixed(2)}</span>}
                    {r.updated && <span className="text-[10px] text-green-600 font-medium">✓ updated</span>}
                  </div>
                  {r.reasoning && <p className="text-[11px] text-gray-500 italic">{r.reasoning}</p>}
                </div>
              </div>
            ))}
          </div>

          {retagResult.dry_run && retagResult.applies_count > 0 && (
            <Button onClick={() => { setDryRun(false); activeKeywordId && runRetag(activeKeywordId); }} className="w-full">
              Apply {retagResult.applies_count} updates to DB →
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
