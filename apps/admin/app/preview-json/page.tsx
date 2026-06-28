"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KatexPlaygroundPreview } from "@/components/KatexPlaygroundPreview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { normalizeMcqChoiceLatex } from "@/lib/mcqChoiceLatex";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Keyword {
  id: string;
  label: string;
  name: string;
  description: string;
  tier: string;
  category_id?: string;
}

interface ProblemJson {
  latex_content: string;
  solution_latex: string;
  difficulty: number;
  problem_description?: string;
  choices?: string[];
  correct_index?: number;
  wrong_answer_data?: Array<
    | { index: number; description: string; keyword_weights?: Record<string, number> }
    | { description: string | null; embedding?: number[] | null; keyword_weights?: Record<string, number> }
  >;
  keyword_weights?: Record<string, number>;
  topic_description?: string;
  action_weights?: Record<string, number>;
  action_description?: string;
  representation_weights?: Record<string, number>;
  representation_description?: string;
  prerequisite_weights?: Record<string, number>;
  prerequisite_description?: string;
  rubric?: string;
}

type KeywordTab = "topic" | "action" | "representation" | "prerequisite";

const KEYWORD_TABS: { key: KeywordTab; label: string; weightField: keyof ProblemJson; descField: keyof ProblemJson; accent: string }[] = [
  { key: "topic",          label: "Topic",          weightField: "keyword_weights",         descField: "topic_description",          accent: "blue"   },
  { key: "action",         label: "Action",         weightField: "action_weights",          descField: "action_description",         accent: "green"  },
  { key: "representation", label: "Representation", weightField: "representation_weights",  descField: "representation_description", accent: "orange" },
  { key: "prerequisite",   label: "Prerequisite",   weightField: "prerequisite_weights",    descField: "prerequisite_description",   accent: "purple" },
];

const PLACEHOLDER = `{
  "latex_content": "A particle moves along the x-axis. Its velocity at time $t$ is $v(t) = 3t^2 - 6t + 4$. Find the acceleration at $t = 2$.",
  "choices": ["$2$", "$6$", "$-6$", "$12$"],
  "correct_index": 1,
  "wrong_answer_data": [
    { "index": 0, "description": "Evaluated v(2) instead of a(2) = v'(2)." },
    { "index": 2, "description": "Sign error when differentiating -6t." },
    { "index": 3, "description": "Differentiated v(t) twice, found a'(2) instead of a(2)." }
  ],
  "solution_latex": "Differentiate: $a(t) = v'(t) = 6t - 6$. At $t = 2$: $a(2) = 6(2) - 6 = 6$ m/s².",
  "difficulty": 2,
  "problem_description": "Tests differentiation of a polynomial velocity function to find acceleration.",

  "topic_description": "Tests the chain rule applied to a polynomial to compute acceleration from velocity.",
  "keyword_weights": { "motion_velocity_acceleration": 1.0 },

  "action_description": "Students must differentiate and evaluate at a point.",
  "action_weights": { "evaluate": 0.4, "solve": 0.6 },

  "representation_description": "The function is presented as an algebraic equation.",
  "representation_weights": {},

  "prerequisite_description": "Requires basic power rule differentiation.",
  "prerequisite_weights": { "power_rule": 1.0 }
}`;

function tierColor(tier: string, accent?: string) {
  if (accent === "green")  return "bg-green-100 text-green-800 border-green-200";
  if (accent === "orange") return "bg-orange-100 text-orange-800 border-orange-200";
  if (accent === "purple") return "bg-purple-100 text-purple-800 border-purple-200";
  if (tier === "in_depth") return "bg-blue-100 text-blue-800 border-blue-200";
  if (tier === "umbrella") return "bg-purple-100 text-purple-800 border-purple-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

function stripApiExtras(raw: Record<string, unknown>): Record<string, unknown> {
  const { generation_prompts: _gp, ...rest } = raw;
  void _gp;
  return rest;
}

function validateProblem(data: unknown): { ok: true; problem: ProblemJson } | { ok: false; message: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, message: "Root value must be a JSON object." };
  }
  const o = stripApiExtras(data as Record<string, unknown>);
  if (typeof o.latex_content !== "string") {
    return { ok: false, message: "Missing or invalid latex_content (string required)." };
  }
  if (typeof o.solution_latex !== "string") {
    return { ok: false, message: "Missing or invalid solution_latex (string required)." };
  }
  if (typeof o.difficulty !== "number" || !Number.isFinite(o.difficulty)) {
    return { ok: false, message: "Missing or invalid difficulty (number required)." };
  }
  if (o.choices !== undefined) {
    if (!Array.isArray(o.choices) || !o.choices.every((c) => typeof c === "string")) {
      return { ok: false, message: "choices must be an array of strings when present." };
    }
  }
  if (
    o.correct_index !== undefined &&
    (typeof o.correct_index !== "number" || !Number.isInteger(o.correct_index))
  ) {
    return { ok: false, message: "correct_index must be an integer when present." };
  }
  if (o.rubric !== undefined && typeof o.rubric !== "string") {
    return { ok: false, message: "rubric must be a string when present." };
  }
  return { ok: true, problem: o as unknown as ProblemJson };
}

function getWrongEntry(wrongAnswers: ProblemJson["wrong_answer_data"], i: number) {
  if (!wrongAnswers?.length) return undefined;
  // Input format: {index, description}
  const byIndex = wrongAnswers.find((w) => "index" in w && (w as { index: number }).index === i);
  if (byIndex) return byIndex;
  // DB format: position-indexed array
  return wrongAnswers[i];
}

function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  if (total === 0) return weights;
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Math.round((v / total) * 100) / 100]));
}

// ─── Keyword Tagger ──────────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  label: string;
  weight: number;
}

function KeywordTagger({
  title,
  tab,
  accent,
  keywords,
  filterFn,
  initial,
  initialDescription,
  onApply,
  problem,
}: {
  title: string;
  tab: string;
  accent: string;
  keywords: Keyword[];
  filterFn?: (k: Keyword) => boolean;
  initial: Record<string, number>;
  initialDescription?: string;
  onApply: (weights: Record<string, number>, description: string) => void;
  problem: ProblemJson | null;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, number>>(initial);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => { setSelected(initial); }, [JSON.stringify(initial)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDescription(initialDescription ?? ""); }, [initialDescription]);

  const catalogKeywords = filterFn ? keywords.filter(filterFn) : keywords;

  const suggest = useCallback(async () => {
    // Use the description textarea as the query; fall back to problem text if empty
    const queryText = description.trim() || (problem ? [problem.latex_content, problem.problem_description].filter(Boolean).join(" ") : "");
    if (!queryText) { toast.error("Enter a description or render a problem first"); return; }

    setSuggesting(true);
    setSuggestions([]);
    try {
      const res = await fetch("/api/learn/keyword-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: queryText, tab }),
      });
      const data = await res.json() as { suggestions?: Suggestion[]; error?: string };
      if (!res.ok || data.error) { toast.error(data.error ?? "Suggestion failed"); return; }
      const kws = data.suggestions ?? [];
      setSuggestions(kws);
      toast.success(kws.length > 0 ? `${kws.length} suggestions ready` : "No close matches — try refining the description");
    } catch {
      toast.error("Suggestion request failed");
    } finally {
      setSuggesting(false);
    }
  }, [description, problem, tab]);

  const filtered = catalogKeywords
    .filter((k) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        k.id.toLowerCase().includes(q) ||
        k.label?.toLowerCase().includes(q) ||
        k.name?.toLowerCase().includes(q) ||
        k.description?.toLowerCase().includes(q)
      );
    })
    .slice(0, 60);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (id in prev) { const next = { ...prev }; delete next[id]; return next; }
      return { ...prev, [id]: 0.5 };
    });
  };

  const setWeight = (id: string, val: string) => {
    const n = parseFloat(val);
    if (!Number.isFinite(n)) return;
    setSelected((prev) => ({ ...prev, [id]: Math.max(0, Math.min(1, n)) }));
  };

  const handleApply = () => {
    onApply(normalizeWeights(selected), description);
    toast.success(`${title} applied to JSON`);
  };

  const handleNormalize = () => setSelected((prev) => normalizeWeights(prev));

  const total = Object.values(selected).reduce((s, v) => s + v, 0);
  const totalOk = Math.abs(total - 1) < 0.01 || Object.keys(selected).length === 0;

  return (
    <div className="space-y-4">
      {/* Description */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</p>
        <Textarea
          placeholder={`Describe what ${title.toLowerCase()} dimension this problem covers…`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="text-sm resize-none"
        />
      </div>

      {/* Selected keywords */}
      {Object.keys(selected).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Selected
            {!totalOk && (
              <span className="ml-2 text-amber-600 normal-case">
                (total = {total.toFixed(2)}, normalize before applying)
              </span>
            )}
          </p>
          <div className="flex flex-col gap-2">
            {Object.entries(selected)
              .sort(([, a], [, b]) => b - a)
              .map(([id, weight]) => {
                const kw = keywords.find((k) => k.id === id);
                const label = kw?.label || kw?.name || id;
                const tc = tierColor(kw?.tier ?? "", accent);
                return (
                  <div key={id} className="flex items-center gap-2">
                    <div className={cn("flex-1 flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium min-w-0", tc)}>
                      <span className="truncate">{label}</span>
                      <span className="text-xs opacity-50 shrink-0">{id}</span>
                    </div>
                    <Input
                      type="number" min={0} max={1} step={0.05}
                      value={weight}
                      onChange={(e) => setWeight(id, e.target.value)}
                      className="w-20 h-8 text-sm font-mono"
                    />
                    <button type="button" onClick={() => toggle(id)}
                      className="text-muted-foreground hover:text-destructive text-lg leading-none px-1" aria-label="Remove">
                      ×
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* AI suggestions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI suggestions</p>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
            disabled={suggesting || !problem} onClick={suggest}>
            {suggesting ? "Suggesting…" : "Suggest from embedding"}
          </Button>
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => {
              const kw = keywords.find((k) => k.id === s.id);
              const label = kw?.label || kw?.name || s.label || s.id;
              const tc = tierColor(kw?.tier ?? "", accent);
              const isSelected = s.id in selected;
              return (
                <button key={s.id} type="button"
                  onClick={() => {
                    if (!isSelected) setSelected((prev) => ({ ...prev, [s.id]: Math.round(s.weight * 100) / 100 }));
                    else { setSelected((prev) => { const n = { ...prev }; delete n[s.id]; return n; }); }
                  }}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all",
                    tc,
                    isSelected ? "ring-2 ring-offset-1 ring-primary opacity-100" : "opacity-80 hover:opacity-100"
                  )}>
                  <span>{label}</span>
                  <span className="text-[10px] opacity-50 tabular-nums">{s.weight.toFixed(2)}</span>
                </button>
              );
            })}
          </div>
        )}
        {!suggestions.length && !suggesting && (
          <p className="text-xs text-muted-foreground">
            Fill in the description above, then click Suggest — it embeds your description and finds the closest keywords.
          </p>
        )}
      </div>

      {/* Search + catalog */}
      <div className="space-y-2">
        <Input placeholder="Search keywords by name or ID…" value={search}
          onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" />
        {catalogKeywords.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {keywords.length === 0 ? "Loading keyword catalog…" : "No keywords in this category yet."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
            {filtered.map((kw) => {
              const isSelected = kw.id in selected;
              const tc = tierColor(kw.tier, accent);
              return (
                <button key={kw.id} type="button" onClick={() => toggle(kw.id)}
                  title={kw.id + (kw.description ? " — " + kw.description : "")}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all",
                    tc,
                    isSelected ? "ring-2 ring-offset-1 ring-primary opacity-100" : "opacity-60 hover:opacity-100"
                  )}>
                  {kw.label || kw.name || kw.id}
                </button>
              );
            })}
            {filtered.length === 0 && <p className="text-xs text-muted-foreground">No keywords match.</p>}
          </div>
        )}
      </div>

      {/* Apply bar */}
      <div className="flex items-center justify-between pt-1 border-t">
        {Object.keys(selected).length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={handleNormalize}>
            Normalize to 1.0
          </Button>
        )}
        <div className="ml-auto">
          <Button type="button" size="sm" onClick={handleApply}>
            Apply {title} to JSON
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PreviewJsonPage() {
  const [jsonText, setJsonText] = useState("");
  const [problem, setProblem] = useState<ProblemJson | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [activeTab, setActiveTab] = useState<KeywordTab>("topic");
  const [autoTagging, setAutoTagging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/learn/keywords");
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.keywords)) setKeywords(data.keywords);
      } catch { /* optional */ }
    })();
  }, []);

  const applyParsed = useCallback((parsed: unknown) => {
    const result = validateProblem(parsed);
    if (!result.ok) {
      setProblem(null);
      setParseError(result.message);
      toast.error(result.message);
      return;
    }
    setParseError(null);
    setProblem(result.problem);
    toast.success("Problem rendered");
  }, []);

  const handleRender = useCallback(() => {
    const t = jsonText.trim();
    if (!t) { setProblem(null); setParseError("Paste JSON or load a file first."); toast.error("No JSON to parse"); return; }
    try { applyParsed(JSON.parse(t)); }
    catch { setProblem(null); const msg = "Invalid JSON (could not parse)."; setParseError(msg); toast.error(msg); }
  }, [jsonText, applyParsed]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setJsonText(text);
      try { applyParsed(JSON.parse(text)); }
      catch { setProblem(null); setParseError("File is not valid JSON."); toast.error("File is not valid JSON"); }
    };
    reader.readAsText(file, "UTF-8");
  }, [applyParsed]);

  const handleTabApply = useCallback(
    (weightField: string, descField: string) =>
      (weights: Record<string, number>, description: string) => {
        let base: Record<string, unknown> = {};
        if (jsonText.trim()) {
          try { base = JSON.parse(jsonText) as Record<string, unknown>; } catch { /* start fresh */ }
        }
        const updated: Record<string, unknown> = { ...base, [weightField]: weights };
        if (description.trim()) updated[descField] = description;
        else delete updated[descField];
        const pretty = JSON.stringify(updated, null, 2);
        setJsonText(pretty);
        applyParsed(updated);
      },
    [jsonText, applyParsed]
  );

  const handleAutoTag = useCallback(async () => {
    if (!problem) return;
    setAutoTagging(true);
    try {
      const res = await fetch("/api/rag-examples/tag-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latex_content: problem.latex_content,
          solution_latex: problem.solution_latex,
          correct_index: problem.correct_index,
          wrong_answer_data: problem.wrong_answer_data,
          topic_description: problem.topic_description,
          action_description: problem.action_description,
          representation_description: problem.representation_description,
          prerequisite_description: problem.prerequisite_description,
        }),
      });
      const data = await res.json() as {
        keyword_weights?: Record<string, number>;
        action_weights?: Record<string, number>;
        representation_weights?: Record<string, number>;
        prerequisite_weights?: Record<string, number>;
        wrong_answer_data?: Array<{ description: string | null; keyword_weights: Record<string, number> }>;
        error?: string;
      };
      if (!res.ok || data.error) { toast.error(data.error ?? "Auto-tag failed"); return; }

      let base: Record<string, unknown> = {};
      try { base = JSON.parse(jsonText) as Record<string, unknown>; } catch { /* use empty */ }

      const updated: Record<string, unknown> = {
        ...base,
        ...(data.keyword_weights ? { keyword_weights: data.keyword_weights } : {}),
        ...(data.action_weights ? { action_weights: data.action_weights } : {}),
        ...(data.representation_weights ? { representation_weights: data.representation_weights } : {}),
        ...(data.prerequisite_weights ? { prerequisite_weights: data.prerequisite_weights } : {}),
        ...(data.wrong_answer_data ? { wrong_answer_data: data.wrong_answer_data } : {}),
      };
      const pretty = JSON.stringify(updated, null, 2);
      setJsonText(pretty);
      applyParsed(updated);
      toast.success("Auto-tags applied to JSON");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAutoTagging(false);
    }
  }, [problem, jsonText, applyParsed]);

  const isMcq = Boolean(problem?.choices && problem.choices.length > 0);
  const showRubric = Boolean(problem?.rubric?.trim());
  const wrongAnswers = problem?.wrong_answer_data ?? [];

  const tabFilter: Record<KeywordTab, (k: Keyword) => boolean> = {
    topic:          (k) => k.category_id !== "action_items",
    action:         (k) => k.category_id === "action_items",
    representation: (k) => k.category_id === "representations",
    prerequisite:   (k) => k.category_id !== "action_items",
  };

  return (
    <div className="min-h-screen p-6 flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Preview from JSON</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Paste a problem JSON to preview it. Required:{" "}
            <code className="rounded bg-muted px-1">latex_content</code>,{" "}
            <code className="rounded bg-muted px-1">solution_latex</code>,{" "}
            <code className="rounded bg-muted px-1">difficulty</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/generate" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Generate</Link>
          <Link href="/preview-katex" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>KaTeX playground</Link>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* JSON input */}
        <Card>
          <CardHeader><CardTitle>JSON input</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder={PLACEHOLDER}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={18}
              className="font-mono text-xs min-h-[280px]"
              spellCheck={false}
              aria-label="Problem JSON"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleRender}>Render problem</Button>
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>Load .json file</Button>
              <Button type="button" variant="ghost" onClick={() => { setJsonText(""); setProblem(null); setParseError(null); }}>Clear</Button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
              <Button
                type="button"
                variant="outline"
                disabled={!problem || autoTagging}
                onClick={handleAutoTag}
                className="ml-auto"
              >
                {autoTagging ? "Tagging…" : "Auto-tag preview"}
              </Button>
            </div>
            {parseError && <p className="text-sm text-destructive" role="alert">{parseError}</p>}
          </CardContent>
        </Card>

        {/* Keyword tagger panel */}
        <Card>
          <CardHeader className="border-b pb-3">
            <div className="grid grid-cols-4 gap-1 rounded-lg border p-1 bg-muted">
              {KEYWORD_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    "py-1.5 rounded text-sm font-medium transition-colors",
                    activeTab === t.key
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {KEYWORD_TABS.map((t) => (
              <div key={t.key} className={activeTab !== t.key ? "hidden" : ""}>
                <KeywordTagger
                  title={t.label}
                  tab={t.key}
                  accent={t.accent}
                  keywords={keywords}
                  filterFn={tabFilter[t.key]}
                  initial={(problem?.[t.weightField] as Record<string, number> | undefined) ?? {}}
                  initialDescription={(problem?.[t.descField] as string | undefined) ?? ""}
                  onApply={handleTabApply(t.weightField as string, t.descField as string)}
                  problem={problem}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {problem ? (
        <div className="space-y-6 max-w-4xl">

          {/* Problem description */}
          {problem.problem_description && (
            <Card>
              <CardHeader><CardTitle>Problem description</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{problem.problem_description}</p>
              </CardContent>
            </Card>
          )}

          {/* Stem */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle>Problem</CardTitle>
                <Badge variant="outline">Difficulty {problem.difficulty}</Badge>
                {isMcq && <Badge variant="secondary">Multiple choice</Badge>}
                {showRubric && !isMcq && <Badge variant="secondary">Free response</Badge>}
              </div>
            </CardHeader>
            <CardContent className="pt-4 min-w-0">
              <KatexPlaygroundPreview latexContent={problem.latex_content} useProblemTypography />
            </CardContent>
          </Card>

          {/* Choices */}
          {isMcq && problem.choices && (
            <Card>
              <CardHeader><CardTitle>Choices</CardTitle></CardHeader>
              <CardContent className="space-y-3 pt-4">
                <ul className="space-y-3 list-none p-0 m-0">
                  {problem.choices.map((choice, i) => {
                    const wrongEntry = getWrongEntry(wrongAnswers, i);
                    const isCorrect = i === problem.correct_index;
                    const entryKw = wrongEntry?.keyword_weights;
                    return (
                      <li key={i} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                        <span className="font-medium text-muted-foreground shrink-0 sm:pt-3">{String.fromCharCode(65 + i)}.</span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <KatexPlaygroundPreview useProblemTypography latexContent={normalizeMcqChoiceLatex(choice)}
                            className={isCorrect ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : undefined} />
                          {isCorrect && <Badge variant="default" className="w-fit">Correct</Badge>}
                          {!isCorrect && wrongEntry?.description && (
                            <p className="text-xs text-muted-foreground pl-1 italic">{wrongEntry.description}</p>
                          )}
                          {!isCorrect && entryKw && Object.keys(entryKw).length > 0 && (
                            <div className="flex flex-wrap gap-1 pl-1 pt-0.5">
                              {Object.entries(entryKw)
                                .sort(([, a], [, b]) => b - a)
                                .map(([id, weight]) => {
                                  const kw = keywords.find((k) => k.id === id);
                                  const label = kw?.label || kw?.name || id;
                                  return (
                                    <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-red-50 border-red-200 text-red-700 px-2 py-0.5 text-xs font-medium">
                                      {label}
                                      <span className="opacity-50 tabular-nums">{weight.toFixed(2)}</span>
                                    </span>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Solution */}
          <Card>
            <CardHeader><CardTitle>Solution</CardTitle></CardHeader>
            <CardContent className="pt-4 min-w-0">
              <KatexPlaygroundPreview latexContent={problem.solution_latex} useProblemTypography />
            </CardContent>
          </Card>

          {/* Keyword tags — one section per dimension */}
          {KEYWORD_TABS.map((t) => {
            const weights = problem[t.weightField] as Record<string, number> | undefined;
            const desc = problem[t.descField] as string | undefined;
            if (!weights || Object.keys(weights).length === 0) return null;
            return (
              <Card key={t.key}>
                <CardHeader>
                  <CardTitle>{t.label} keywords</CardTitle>
                  {desc && <p className="text-sm text-muted-foreground mt-1">{desc}</p>}
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(weights)
                      .sort(([, a], [, b]) => b - a)
                      .map(([id, weight]) => {
                        const kw = keywords.find((k) => k.id === id);
                        const label = kw?.label || kw?.name || id;
                        const tc = tierColor(kw?.tier ?? "", t.accent);
                        return (
                          <div key={id} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium", tc)}>
                            <span>{label}</span>
                            <span className="text-xs opacity-60 tabular-nums">{weight.toFixed(2)}</span>
                          </div>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Rubric */}
          {showRubric && (
            <Card>
              <CardHeader><CardTitle>Rubric</CardTitle></CardHeader>
              <CardContent className="pt-4 min-w-0">
                <KatexPlaygroundPreview latexContent={problem.rubric!} useProblemTypography />
              </CardContent>
            </Card>
          )}

        </div>
      ) : null}
    </div>
  );
}
