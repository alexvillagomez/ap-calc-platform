"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2Icon, CheckIcon, XIcon, PencilIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = {
  id: string;
  name: string;
  description: string;
  order_index: number;
  approved_count: number;
};

type ReviewKeyword = {
  id: string;
  name: string;
  description: string;
  examples: string[];
  category: string;
  reviewStatus: "pending" | "approved" | "rejected";
  editing: boolean;
  // edit buffer
  editName: string;
  editDescription: string;
  editExamples: string;
};

type PanelState = "idle" | "generating" | "reviewing" | "saving" | "done";

// ─── Keyword card ─────────────────────────────────────────────────────────────

function KeywordCard({
  kw,
  onApprove,
  onReject,
  onToggleEdit,
  onSaveEdit,
  onChange,
}: {
  kw: ReviewKeyword;
  onApprove: () => void;
  onReject: () => void;
  onToggleEdit: () => void;
  onSaveEdit: () => void;
  onChange: (field: "editName" | "editDescription" | "editExamples", val: string) => void;
}) {
  const borderClass =
    kw.reviewStatus === "approved"
      ? "border-green-400 bg-green-50"
      : kw.reviewStatus === "rejected"
        ? "border-red-300 bg-red-50 opacity-60"
        : "border-gray-200 bg-white";

  return (
    <div className={cn("rounded-xl border p-4 space-y-2 transition-colors", borderClass)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {kw.editing ? (
            <Input
              value={kw.editName}
              onChange={(e) => onChange("editName", e.target.value)}
              className="text-sm font-semibold h-7 px-2"
            />
          ) : (
            <p className="text-sm font-semibold text-gray-900 leading-tight">{kw.name}</p>
          )}
          <p className="text-[10px] font-mono text-gray-400 mt-0.5">{kw.id}</p>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={onApprove}
            title="Approve"
            className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center transition-colors",
              kw.reviewStatus === "approved"
                ? "bg-green-500 text-white"
                : "border border-gray-200 text-gray-400 hover:border-green-400 hover:text-green-600"
            )}
          >
            <CheckIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onReject}
            title="Reject"
            className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center transition-colors",
              kw.reviewStatus === "rejected"
                ? "bg-red-500 text-white"
                : "border border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-500"
            )}
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onToggleEdit}
            title="Edit"
            className="w-7 h-7 rounded-full flex items-center justify-center border border-gray-200 text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            {kw.editing ? <ChevronUpIcon className="h-3.5 w-3.5" /> : <PencilIcon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Description */}
      {kw.editing ? (
        <Textarea
          value={kw.editDescription}
          onChange={(e) => onChange("editDescription", e.target.value)}
          rows={2}
          className="text-xs"
        />
      ) : (
        <p className="text-xs text-gray-600 leading-relaxed">{kw.description}</p>
      )}

      {/* Examples */}
      {kw.editing ? (
        <div className="space-y-1">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Examples (comma-separated)</p>
          <Input
            value={kw.editExamples}
            onChange={(e) => onChange("editExamples", e.target.value)}
            className="text-xs h-7 px-2"
          />
          <Button size="sm" variant="outline" onClick={onSaveEdit} className="h-6 text-[10px]">
            Save edits
          </Button>
        </div>
      ) : kw.examples.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {kw.examples.map((ex, i) => (
            <span key={i} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">
              {ex}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Embed unembedded button ──────────────────────────────────────────────────

const EMBED_BATCH_SIZE = 100;

function EmbedUnembeddedButton() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setProgress(null);
    try {
      const res = await fetch("/api/learn/keywords/unembedded");
      const data = await res.json() as { ids?: string[]; error?: string };
      if (!res.ok || !data.ids) {
        toast.error(data.error ?? "Failed to fetch unembedded keywords");
        return;
      }
      if (data.ids.length === 0) {
        toast.success("All keywords already embedded");
        setResult("All embedded");
        return;
      }

      const allIds = data.ids;
      const total = allIds.length;
      let totalEmbedded = 0;
      setProgress({ done: 0, total });

      for (let i = 0; i < allIds.length; i += EMBED_BATCH_SIZE) {
        const batch = allIds.slice(i, i + EMBED_BATCH_SIZE);
        const embedRes = await fetch("/api/learn/embed-keywords", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batch }),
        });
        const embedData = await embedRes.json() as { embedded?: number; error?: string };
        if (!embedRes.ok) {
          toast.error(embedData.error ?? "Embedding failed");
          return;
        }
        totalEmbedded += embedData.embedded ?? 0;
        setProgress({ done: Math.min(i + batch.length, total), total });
      }

      const msg = `Embedded ${totalEmbedded} / ${total} keywords`;
      toast.success(msg);
      setResult(msg);
    } catch {
      toast.error("Embed request failed");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        onClick={run}
        disabled={running}
        className="w-full h-7 text-xs"
      >
        {running ? (
          <><Loader2Icon className="h-3 w-3 animate-spin mr-1" />
            {progress ? `Embedding… ${progress.done} / ${progress.total}` : "Embedding…"}
          </>
        ) : (
          "Embed unembedded keywords"
        )}
      </Button>
      {running && progress && (
        <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}
      {result && !running && <span className="text-[10px] text-green-600">{result}</span>}
    </div>
  );
}

// ─── Seed representations button ─────────────────────────────────────────────

function SeedRepresentationsButton() {
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const res = await fetch("/api/learn/seed-representations", { method: "POST" });
      const data = await res.json() as { seeded?: number; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Seed failed"); return; }
      toast.success(`Seeded ${data.seeded} representation keywords`);
    } catch {
      toast.error("Request failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={run} disabled={running} className="w-full h-7 text-xs">
      {running ? <><Loader2Icon className="h-3 w-3 animate-spin mr-1" />Seeding…</> : "Seed representation keywords"}
    </Button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function KeywordsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Category | null>(null);

  const [panelState, setPanelState] = useState<PanelState>("idle");
  const [pendingKeywords, setPendingKeywords] = useState<ReviewKeyword[]>([]);
  const [savedKeywords, setSavedKeywords] = useState<ReviewKeyword[]>([]);
  const [embedAfterSave, setEmbedAfterSave] = useState(true);

  // ── Autocomplete state ───────────────────────────────────────────────────────
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoAbort, setAutoAbort] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{
    current: number; total: number; catName: string; done: string[]; failed: string[];
  } | null>(null);

  // ── Seed from list state ─────────────────────────────────────────────────────
  const [seedJson, setSeedJson] = useState("");
  const [seedRunning, setSeedRunning] = useState(false);
  const [seedProgress, setSeedProgress] = useState<{
    current: number; total: number; catName: string; done: number; failed: string[];
  } | null>(null);
  const [showSeedPanel, setShowSeedPanel] = useState(false);

  // ── Load categories ──────────────────────────────────────────────────────────

  const fetchCategories = useCallback(async () => {
    setLoadingCats(true);
    try {
      const res = await fetch("/api/learn/categories");
      const data = await res.json() as { categories?: Category[] };
      setCategories(data.categories ?? []);
    } catch {
      toast.error("Failed to load categories");
    } finally {
      setLoadingCats(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // ── Seed categories if needed ────────────────────────────────────────────────

  async function seedCategories() {
    const res = await fetch("/api/learn/categories/seed", { method: "POST" });
    const data = await res.json() as { seeded?: number; error?: string };
    if (!res.ok) { toast.error(data.error ?? "Seed failed"); return; }
    toast.success(`Seeded ${data.seeded} categories`);
    await fetchCategories();
  }

  // ── Seed from predefined list ─────────────────────────────────────────────────

  async function seedFromList(clearExisting: boolean) {
    let parsed: { category: string; in_depth_keywords: string[] }[];
    try {
      const raw = JSON.parse(seedJson);
      // Support both array and single object
      parsed = Array.isArray(raw) ? raw : [raw];
    } catch {
      toast.error("Invalid JSON — paste the full array");
      return;
    }

    const categories = parsed.map((c) => ({
      id: c.category,
      name: c.category.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
      keywords: c.in_depth_keywords,
    }));

    if (categories.length === 0) { toast.error("No categories found in JSON"); return; }

    setSeedRunning(true);
    setSeedProgress({ current: 0, total: categories.length, catName: "", done: 0, failed: [] });

    let totalDone = 0;
    const failed: string[] = [];

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i]!;
      setSeedProgress({ current: i + 1, total: categories.length, catName: cat.name, done: totalDone, failed });

      try {
        const res = await fetch("/api/learn/bulk-generate-descriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categories,
            category_id: cat.id,
            clear_existing: i === 0 && clearExisting,
          }),
        });
        const data = await res.json() as { total_saved?: number; error?: string };
        if (!res.ok || data.error) {
          failed.push(cat.name);
        } else {
          totalDone += data.total_saved ?? 0;
        }
      } catch {
        failed.push(cat.name);
      }

      setSeedProgress({ current: i + 1, total: categories.length, catName: cat.name, done: totalDone, failed: [...failed] });
    }

    setSeedRunning(false);
    await fetchCategories();

    const msg = `Saved ${totalDone} keywords across ${categories.length - failed.length} categories`;
    failed.length > 0 ? toast.error(`${msg} (${failed.length} failed)`) : toast.success(msg);
  }

  // ── Autocomplete remaining categories ────────────────────────────────────────

  async function autoCompleteRemaining() {
    const remaining = categories.filter((c) => c.approved_count === 0);
    if (remaining.length === 0) { toast.success("All categories already have keywords!"); return; }

    setAutoRunning(true);
    setAutoAbort(false);
    setAutoProgress({ current: 0, total: remaining.length, catName: "", done: [], failed: [] });

    const done: string[] = [];
    const failed: string[] = [];

    for (let i = 0; i < remaining.length; i++) {
      // Check abort flag via ref-like pattern
      if (autoAbort) break;

      const cat = remaining[i]!;
      setAutoProgress({ current: i + 1, total: remaining.length, catName: cat.name, done, failed });

      try {
        // 1. Generate keywords
        const genRes = await fetch("/api/learn/generate-category-keywords", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category_id: cat.id }),
        });
        const genData = await genRes.json() as {
          keywords?: { id: string; name: string; description: string; examples: string[] }[];
          error?: string;
        };
        if (!genRes.ok || !genData.keywords?.length) {
          failed.push(cat.name);
          continue;
        }

        // 2. Auto-approve all without review
        const approveRes = await fetch("/api/learn/approve-keywords", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keywords: genData.keywords.map((k) => ({ ...k, category: cat.id })),
          }),
        });
        const approveData = await approveRes.json() as { saved?: number; ids?: string[]; error?: string };

        if (!approveRes.ok) {
          failed.push(cat.name);
          continue;
        }

        // 3. Embed if requested (fire-and-forget per batch)
        if (embedAfterSave && approveData.ids?.length) {
          fetch("/api/learn/embed-keywords", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: approveData.ids }),
          }).catch(() => {});
        }

        done.push(cat.name);
      } catch {
        failed.push(cat.name);
      }

      setAutoProgress({ current: i + 1, total: remaining.length, catName: cat.name, done: [...done], failed: [...failed] });
    }

    setAutoRunning(false);
    await fetchCategories();

    const msg = `Done: ${done.length} categories completed${failed.length > 0 ? `, ${failed.length} failed` : ""}`;
    failed.length > 0 ? toast.error(msg) : toast.success(msg);
  }

  // ── Select category ──────────────────────────────────────────────────────────

  async function selectCategory(cat: Category) {
    setSelected(cat);
    setPendingKeywords([]);
    setPanelState("idle");
    // Load already-approved keywords for this category
    const res = await fetch(`/api/learn/keywords?category_id=${cat.id}`);
    const data = await res.json() as { keywords?: { id: string; name: string; description: string; examples: string[]; status: string }[] };
    const approved = (data.keywords ?? [])
      .filter((k) => k.status === "approved")
      .map((k): ReviewKeyword => ({
        id: k.id, name: k.name, description: k.description,
        examples: Array.isArray(k.examples) ? k.examples : [],
        category: cat.id, reviewStatus: "approved",
        editing: false, editName: k.name, editDescription: k.description,
        editExamples: (Array.isArray(k.examples) ? k.examples : []).join(", "),
      }));
    setSavedKeywords(approved);
  }

  // ── Generate ─────────────────────────────────────────────────────────────────

  async function generate() {
    if (!selected) return;
    setPanelState("generating");
    setPendingKeywords([]);
    try {
      const res = await fetch("/api/learn/generate-category-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: selected.id }),
      });
      const data = await res.json() as { keywords?: { id: string; name: string; description: string; examples: string[] }[]; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Generation failed"); setPanelState("idle"); return; }
      const reviewed: ReviewKeyword[] = (data.keywords ?? []).map((k) => ({
        ...k, category: selected.id, reviewStatus: "pending",
        editing: false, editName: k.name, editDescription: k.description,
        editExamples: (k.examples ?? []).join(", "),
      }));
      setPendingKeywords(reviewed);
      setPanelState("reviewing");
      toast.success(`${reviewed.length} keywords generated — review and approve`);
    } catch {
      toast.error("Generation failed");
      setPanelState("idle");
    }
  }

  // ── Approve / reject helpers ──────────────────────────────────────────────────

  function setStatus(id: string, status: ReviewKeyword["reviewStatus"]) {
    setPendingKeywords((prev) => prev.map((k) => k.id === id ? { ...k, reviewStatus: k.reviewStatus === status ? "pending" : status } : k));
  }

  function approveAll() {
    setPendingKeywords((prev) => prev.map((k) => ({ ...k, reviewStatus: "approved" })));
  }

  function rejectAll() {
    setPendingKeywords((prev) => prev.map((k) => ({ ...k, reviewStatus: "rejected" })));
  }

  function toggleEdit(id: string) {
    setPendingKeywords((prev) => prev.map((k) => k.id === id ? { ...k, editing: !k.editing } : k));
  }

  function saveEdit(id: string) {
    setPendingKeywords((prev) => prev.map((k) => k.id === id ? {
      ...k,
      name: k.editName.trim() || k.name,
      description: k.editDescription.trim() || k.description,
      examples: k.editExamples.split(",").map((s) => s.trim()).filter(Boolean),
      editing: false,
    } : k));
  }

  function onChange(id: string, field: "editName" | "editDescription" | "editExamples", val: string) {
    setPendingKeywords((prev) => prev.map((k) => k.id === id ? { ...k, [field]: val } : k));
  }

  // ── Save approved ─────────────────────────────────────────────────────────────

  async function saveApproved() {
    const toSave = pendingKeywords.filter((k) => k.reviewStatus === "approved");
    if (toSave.length === 0) { toast.error("No keywords approved"); return; }
    setPanelState("saving");
    try {
      const res = await fetch("/api/learn/approve-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: toSave }),
      });
      const data = await res.json() as { saved?: number; ids?: string[]; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Save failed"); setPanelState("reviewing"); return; }

      toast.success(`Saved ${data.saved} keywords`);

      // Optional: trigger embeddings
      if (embedAfterSave && data.ids && data.ids.length > 0) {
        fetch("/api/learn/embed-keywords", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: data.ids }),
        }).then((r) => r.json()).then((d: { embedded?: number }) => {
          toast.success(`Embedded ${d.embedded ?? 0} keywords`);
        }).catch(() => {});
      }

      // Move approved to savedKeywords, remove from pending
      const newSaved = toSave.map((k) => ({ ...k, reviewStatus: "approved" as const }));
      setSavedKeywords((prev) => {
        const ids = new Set(newSaved.map((k) => k.id));
        return [...prev.filter((k) => !ids.has(k.id)), ...newSaved];
      });
      setPendingKeywords((prev) => prev.filter((k) => k.reviewStatus !== "approved"));
      setPanelState(pendingKeywords.filter((k) => k.reviewStatus === "pending" || k.reviewStatus === "rejected").length === 0 ? "done" : "reviewing");

      await fetchCategories();
    } catch {
      toast.error("Save failed");
      setPanelState("reviewing");
    }
  }

  // ── Computed ──────────────────────────────────────────────────────────────────

  const filteredCats = categories.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  const approvedCount = pendingKeywords.filter((k) => k.reviewStatus === "approved").length;
  const pendingCount = pendingKeywords.filter((k) => k.reviewStatus === "pending").length;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left: category list */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">
        <div className="p-4 border-b border-gray-100 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-semibold text-gray-900">Keywords</h1>
            {categories.length === 0 && !loadingCats && (
              <Button size="sm" variant="outline" onClick={seedCategories} className="h-6 text-xs">
                Seed categories
              </Button>
            )}
          </div>
          <Input
            placeholder="Search categories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
          <p className="text-[10px] text-gray-400">
            {categories.length} categories · {categories.reduce((a, c) => a + c.approved_count, 0)} keywords approved
            {categories.filter((c) => c.approved_count === 0).length > 0 && (
              <> · <span className="text-amber-600">{categories.filter((c) => c.approved_count === 0).length} remaining</span></>
            )}
          </p>

          {/* Seed from predefined list */}
          <div className="space-y-1.5">
            <button
              onClick={() => setShowSeedPanel((v) => !v)}
              className="text-xs text-blue-600 hover:underline w-full text-left"
            >
              {showSeedPanel ? "▲ Hide" : "▼ Seed from keyword list"}
            </button>
            {showSeedPanel && (
              <div className="space-y-2">
                <Textarea
                  placeholder='Paste JSON: [{"category":"exponents","in_depth_keywords":["..."]}]'
                  value={seedJson}
                  onChange={(e) => setSeedJson(e.target.value)}
                  rows={4}
                  className="text-[10px] font-mono"
                />
                {seedRunning ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-gray-500">
                      <span>
                        <Loader2Icon className="h-3 w-3 animate-spin inline mr-1" />
                        {seedProgress?.current}/{seedProgress?.total} — {seedProgress?.catName}
                      </span>
                      <span className="text-green-600">{seedProgress?.done} saved</span>
                    </div>
                    <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${((seedProgress?.current ?? 0) / (seedProgress?.total ?? 1)) * 100}%` }}
                      />
                    </div>
                    {(seedProgress?.failed.length ?? 0) > 0 && (
                      <p className="text-[10px] text-red-500">{seedProgress?.failed.length} failed</p>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => seedFromList(false)}
                      disabled={!seedJson.trim()}
                      className="flex-1 h-6 text-[10px]"
                    >
                      Add keywords
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm("Delete ALL existing keywords first?")) seedFromList(true);
                      }}
                      disabled={!seedJson.trim()}
                      className="flex-1 h-6 text-[10px] text-red-600 border-red-200 hover:bg-red-50"
                    >
                      Clear & reseed
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Embed unembedded */}
          <EmbedUnembeddedButton />

          {/* Seed representation keywords */}
          <SeedRepresentationsButton />

          {/* Autocomplete button */}
          {categories.filter((c) => c.approved_count === 0).length > 0 && (
            <div className="space-y-1.5">
              {autoRunning ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <span>
                      <Loader2Icon className="h-3 w-3 animate-spin inline mr-1" />
                      {autoProgress?.current}/{autoProgress?.total} — {autoProgress?.catName}
                    </span>
                    <button
                      onClick={() => setAutoAbort(true)}
                      className="text-red-500 hover:underline"
                    >
                      Stop
                    </button>
                  </div>
                  <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${((autoProgress?.current ?? 0) / (autoProgress?.total ?? 1)) * 100}%` }}
                    />
                  </div>
                  {(autoProgress?.failed.length ?? 0) > 0 && (
                    <p className="text-[10px] text-red-500">{autoProgress?.failed.length} failed</p>
                  )}
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={autoCompleteRemaining}
                  className="w-full h-7 text-xs"
                >
                  ↺ Auto-complete {categories.filter((c) => c.approved_count === 0).length} remaining
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingCats ? (
            <div className="flex justify-center items-center py-8">
              <Loader2Icon className="h-4 w-4 animate-spin text-gray-400" />
            </div>
          ) : (
            filteredCats.map((cat) => (
              <button
                key={cat.id}
                onClick={() => void selectCategory(cat)}
                className={cn(
                  "w-full text-left px-4 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors",
                  selected?.id === cat.id && "bg-blue-50 border-l-2 border-l-blue-600"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-800 leading-tight truncate">{cat.name}</span>
                  {cat.approved_count > 0 ? (
                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      {cat.approved_count}
                    </span>
                  ) : (
                    <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      0
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: review panel */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            ← Select a category to begin
          </div>
        ) : (
          <>
            {/* Panel header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900">{selected.name}</h2>
                <p className="text-xs text-gray-500 mt-0.5 leading-snug">{selected.description}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {panelState === "reviewing" && (
                  <>
                    <Button size="sm" variant="outline" onClick={approveAll} className="text-xs h-7">
                      Approve all
                    </Button>
                    <Button size="sm" variant="outline" onClick={rejectAll} className="text-xs h-7 text-red-600 border-red-200 hover:bg-red-50">
                      Reject all
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  onClick={generate}
                  disabled={panelState === "generating" || panelState === "saving"}
                  className="text-xs h-7"
                >
                  {panelState === "generating" ? (
                    <><Loader2Icon className="h-3 w-3 animate-spin mr-1" /> Generating…</>
                  ) : (
                    "↺ Generate keywords"
                  )}
                </Button>
              </div>
            </div>

            {/* Saved keywords summary */}
            {savedKeywords.length > 0 && (
              <div className="px-6 py-2 bg-green-50 border-b border-green-100 flex items-center gap-2">
                <CheckIcon className="h-3.5 w-3.5 text-green-600" />
                <span className="text-xs text-green-700 font-medium">{savedKeywords.length} keywords already approved for this category</span>
              </div>
            )}

            {/* Pending review area */}
            <div className="flex-1 overflow-y-auto p-6">
              {panelState === "idle" && pendingKeywords.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
                  <p className="text-sm">No keywords generated yet.</p>
                  <p className="text-xs">Click "Generate keywords" to get started.</p>
                </div>
              )}

              {panelState === "generating" && (
                <div className="flex items-center justify-center h-full gap-2 text-gray-400">
                  <Loader2Icon className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Calling AI…</span>
                </div>
              )}

              {(panelState === "reviewing" || panelState === "saving" || panelState === "done") && pendingKeywords.length > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {pendingKeywords.map((kw) => (
                    <KeywordCard
                      key={kw.id}
                      kw={kw}
                      onApprove={() => setStatus(kw.id, "approved")}
                      onReject={() => setStatus(kw.id, "rejected")}
                      onToggleEdit={() => toggleEdit(kw.id)}
                      onSaveEdit={() => saveEdit(kw.id)}
                      onChange={(field, val) => onChange(kw.id, field, val)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Save bar */}
            {(panelState === "reviewing" || panelState === "saving") && pendingKeywords.length > 0 && (
              <div className="bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="text-green-600 font-medium">{approvedCount} approved</span>
                  <span>{pendingCount} pending</span>
                  <span className="text-red-500">{pendingKeywords.filter((k) => k.reviewStatus === "rejected").length} rejected</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={embedAfterSave}
                      onChange={(e) => setEmbedAfterSave(e.target.checked)}
                      className="accent-blue-600"
                    />
                    Embed after saving
                  </label>
                </div>
                <Button
                  onClick={saveApproved}
                  disabled={approvedCount === 0 || panelState === "saving"}
                  className="text-xs h-7"
                >
                  {panelState === "saving" ? (
                    <><Loader2Icon className="h-3 w-3 animate-spin mr-1" /> Saving…</>
                  ) : (
                    `Save ${approvedCount} approved →`
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
