"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Preview } from "@/components/Preview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { normalizeMcqChoiceLatex } from "@/lib/mcqChoiceLatex";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ProblemType = "multiple_choice" | "free_response";
type CorrectIndex = 0 | 1 | 2 | 3;
type InputMode = "fields" | "json";
type PageMode = "input" | "reviewing";

interface PreviewState {
  latex_content: string;
  solution_latex: string;
  type: ProblemType;
  choices?: [string, string, string, string];
  correct_index?: CorrectIndex;
}

interface ParsedProblem {
  latex_content: string;
  solution_latex: string;
  type: ProblemType;
  choices: [string, string, string, string];
  correct_index: CorrectIndex;
  difficulty: number;
}

const CHOICE_LABELS = ["A", "B", "C", "D"] as const;

function parseOneProblem(obj: Record<string, unknown>): { ok: true } & ParsedProblem | { ok: false; message: string } {
  if (typeof obj.latex_content !== "string" || !obj.latex_content.trim())
    return { ok: false, message: "Missing latex_content." };
  if (typeof obj.solution_latex !== "string" || !obj.solution_latex.trim())
    return { ok: false, message: "Missing solution_latex." };
  const isMcq = Array.isArray(obj.choices) && (obj.choices as unknown[]).length > 0;
  const type: ProblemType = isMcq ? "multiple_choice" : "free_response";
  const rawChoices = isMcq ? (obj.choices as unknown[]) : [];
  const choices: [string, string, string, string] = [
    String(rawChoices[0] ?? ""),
    String(rawChoices[1] ?? ""),
    String(rawChoices[2] ?? ""),
    String(rawChoices[3] ?? ""),
  ];
  const ci = typeof obj.correct_index === "number" ? obj.correct_index : 0;
  const correct_index = (Math.min(Math.max(Math.floor(ci), 0), 3)) as CorrectIndex;
  const rawDiff = typeof obj.difficulty === "number" ? obj.difficulty : 3;
  const difficulty = Math.min(Math.max(Math.round(rawDiff), 1), 5);
  return { ok: true, latex_content: obj.latex_content, solution_latex: obj.solution_latex, type, choices, correct_index, difficulty };
}

function parseJsonIntoFields(text: string): ({ ok: true } & ParsedProblem) | { ok: false; message: string } {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "Invalid JSON — could not parse." };
  }
  return parseOneProblem(obj);
}

/** Parse comma-separated JSON objects or a JSON array into multiple problems. */
function parseMultipleJsons(text: string): ({ ok: true } & ParsedProblem)[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Try as a JSON array first
  try {
    const arr = JSON.parse(trimmed);
    if (Array.isArray(arr)) {
      return arr
        .map((item) => parseOneProblem(item as Record<string, unknown>))
        .filter((r): r is { ok: true } & ParsedProblem => r.ok);
    }
  } catch { /* fall through */ }

  // Try wrapping in [] to handle comma-separated objects
  try {
    const wrapped = `[${trimmed}]`;
    const arr = JSON.parse(wrapped);
    if (Array.isArray(arr)) {
      return arr
        .map((item) => parseOneProblem(item as Record<string, unknown>))
        .filter((r): r is { ok: true } & ParsedProblem => r.ok);
    }
  } catch { /* fall through */ }

  // Fallback: try as single object
  const single = parseOneProblem((() => { try { return JSON.parse(trimmed) as Record<string, unknown>; } catch { return {}; } })());
  return single.ok ? [single] : [];
}

export default function RagExamplesPage() {
  const [pageMode, setPageMode] = useState<PageMode>("input");
  const [inputMode, setInputMode] = useState<InputMode>("json");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Single-problem fields
  const [course, setCourse] = useState<"ap_calc" | "precalc">("ap_calc");
  const [type, setType] = useState<ProblemType>("multiple_choice");
  const [difficulty, setDifficulty] = useState(3);
  const [latexContent, setLatexContent] = useState("");
  const [solutionLatex, setSolutionLatex] = useState("");
  const [choices, setChoices] = useState<[string, string, string, string]>(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState<CorrectIndex>(0);
  const [notes, setNotes] = useState("");
  const [previewed, setPreviewed] = useState<PreviewState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Batch review state
  const [reviewQueue, setReviewQueue] = useState<ParsedProblem[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewApproved, setReviewApproved] = useState(0);
  const [reviewSkipped, setReviewSkipped] = useState(0);
  const [reviewSaving, setReviewSaving] = useState(false);

  const handleChoiceChange = useCallback((i: number, value: string) => {
    setChoices((prev) => {
      const next = [...prev] as [string, string, string, string];
      next[i] = value;
      return next;
    });
  }, []);

  const handleLoadJson = useCallback(() => {
    if (!jsonText.trim()) { toast.error("Paste JSON first"); return; }
    const result = parseJsonIntoFields(jsonText);
    if (!result.ok) { toast.error(result.message); return; }
    setJsonError(null);
    setType(result.type);
    setLatexContent(result.latex_content);
    setSolutionLatex(result.solution_latex);
    setChoices(result.choices);
    setCorrectIndex(result.correct_index);
    setSaved(false);
    setPreviewed({
      latex_content: result.latex_content,
      solution_latex: result.solution_latex,
      type: result.type,
      ...(result.type === "multiple_choice" ? { choices: result.choices, correct_index: result.correct_index } : {}),
    });
    setInputMode("fields");
    toast.success("Loaded and previewed");
  }, [jsonText]);

  /** Parse all JSONs and enter batch review mode. */
  const handleLoadAndReview = useCallback(() => {
    if (!jsonText.trim()) { toast.error("Paste JSON first"); return; }
    const problems = parseMultipleJsons(jsonText);
    if (problems.length === 0) { toast.error("No valid problems found in the pasted text"); return; }
    setReviewQueue(problems);
    setReviewIndex(0);
    setReviewNotes("");
    setReviewApproved(0);
    setReviewSkipped(0);
    setPageMode("reviewing");
  }, [jsonText]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setJsonText(text);
      const result = parseJsonIntoFields(text);
      if (!result.ok) { toast.error(result.message); return; }
      setJsonError(null);
      setType(result.type);
      setLatexContent(result.latex_content);
      setSolutionLatex(result.solution_latex);
      setChoices(result.choices);
      setCorrectIndex(result.correct_index);
      setSaved(false);
      setPreviewed({
        latex_content: result.latex_content,
        solution_latex: result.solution_latex,
        type: result.type,
        ...(result.type === "multiple_choice" ? { choices: result.choices, correct_index: result.correct_index } : {}),
      });
      setInputMode("fields");
      toast.success("Loaded and previewed");
    };
    reader.readAsText(file, "UTF-8");
  }, []);

  const handlePreview = useCallback(() => {
    if (!latexContent.trim()) { toast.error("Problem stem is required to preview"); return; }
    if (!solutionLatex.trim()) { toast.error("Solution is required to preview"); return; }
    setPreviewed({
      latex_content: latexContent,
      solution_latex: solutionLatex,
      type,
      ...(type === "multiple_choice" ? { choices, correct_index: correctIndex } : {}),
    });
    toast.success("Preview updated");
  }, [latexContent, solutionLatex, type, choices, correctIndex]);

  const handleSave = useCallback(async () => {
    if (!latexContent.trim()) { toast.error("Problem stem is required"); return; }
    if (!solutionLatex.trim()) { toast.error("Solution is required"); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { latex_content: latexContent.trim(), solution_latex: solutionLatex.trim(), difficulty, course };
      if (type === "multiple_choice") { body.choices = choices; body.correct_index = correctIndex; }
      if (notes.trim()) body.notes = notes.trim();
      const res = await fetch("/api/rag-examples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const err = (await res.json()) as { error?: string }; throw new Error(err.error ?? "Save failed"); }
      toast.success("Saved to RAG pool");
      setSaved(true);
      setLatexContent(""); setSolutionLatex(""); setChoices(["", "", "", ""]); setCorrectIndex(0); setDifficulty(3); setNotes(""); setJsonText(""); setPreviewed(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [latexContent, solutionLatex, difficulty, type, choices, correctIndex, notes]);

  // ── Batch review helpers ───────────────────────────────────
  async function handleReviewApprove() {
    const problem = reviewQueue[reviewIndex];
    if (!problem) return;
    setReviewSaving(true);
    try {
      const body: Record<string, unknown> = {
        latex_content: problem.latex_content,
        solution_latex: problem.solution_latex,
        difficulty: problem.difficulty,
        course,
      };
      if (problem.type === "multiple_choice") { body.choices = problem.choices; body.correct_index = problem.correct_index; }
      if (reviewNotes.trim()) body.notes = reviewNotes.trim();
      const res = await fetch("/api/rag-examples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const err = (await res.json()) as { error?: string }; throw new Error(err.error ?? "Save failed"); }
      setReviewApproved((c) => c + 1);
      advanceReview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setReviewSaving(false);
    }
  }

  function handleReviewSkip() {
    setReviewSkipped((c) => c + 1);
    advanceReview();
  }

  function advanceReview() {
    const next = reviewIndex + 1;
    setReviewNotes("");
    if (next >= reviewQueue.length) {
      setPageMode("input");
      toast.success(`Done — ${reviewApproved + 1} added, ${reviewSkipped} skipped`);
      return;
    }
    setReviewIndex(next);
  }

  // ── Reviewing mode ─────────────────────────────────────────
  if (pageMode === "reviewing") {
    const problem = reviewQueue[reviewIndex];
    const total = reviewQueue.length;
    if (!problem) return null;

    return (
      <div className="min-h-screen p-6 max-w-4xl mx-auto space-y-5">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Review Queue</h1>
          <button onClick={() => setPageMode("input")} className="text-sm text-muted-foreground hover:underline">
            ← Back to input
          </button>
        </header>

        {/* Progress */}
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium">{reviewIndex + 1} / {total}</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((reviewIndex) / total) * 100}%` }} />
          </div>
          <span className="text-muted-foreground text-xs">{reviewApproved} added · {reviewSkipped} skipped</span>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline">Difficulty {problem.difficulty}</Badge>
          <Badge variant="secondary">{problem.type === "multiple_choice" ? "MCQ" : "FRQ"}</Badge>
          <Badge variant={course === "precalc" ? "default" : "outline"}>{course === "precalc" ? "Pre-Calculus" : "AP Calculus"}</Badge>
        </div>

        {/* Problem */}
        <Card>
          <CardHeader className="border-b py-3"><CardTitle className="text-sm">Problem</CardTitle></CardHeader>
          <CardContent className="pt-4 min-w-0 overflow-x-auto">
            <div className="ap-calc-preview min-w-0 max-w-full">
              <Preview latexContent={problem.latex_content} useProblemTypography={false} />
            </div>
          </CardContent>
        </Card>

        {/* Choices */}
        {problem.type === "multiple_choice" && (
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Choices</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0">
              {problem.choices.map((choice, i) => (
                <div key={i} className={cn(
                  "flex items-start gap-2 rounded border p-2",
                  i === problem.correct_index ? "border-primary bg-primary/5" : "border-border"
                )}>
                  <span className="text-sm text-muted-foreground w-4 shrink-0">{CHOICE_LABELS[i]}.</span>
                  <div className="flex-1 min-w-0">
                    <Preview latexContent={normalizeMcqChoiceLatex(choice)} useProblemTypography={false} />
                  </div>
                  {i === problem.correct_index && <Badge variant="default" className="shrink-0 text-xs">Correct</Badge>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Solution */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Solution</CardTitle></CardHeader>
          <CardContent className="pt-0 min-w-0 overflow-x-auto">
            <div className="ap-calc-preview min-w-0 max-w-full">
              <Preview latexContent={problem.solution_latex} useProblemTypography={false} />
            </div>
          </CardContent>
        </Card>

        {/* Notes + actions */}
        <div className="space-y-3">
          <Input
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="text-sm max-w-md"
          />
          <div className="flex gap-2">
            <button
              onClick={handleReviewApprove}
              disabled={reviewSaving}
              className="px-5 py-2 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {reviewSaving ? "Saving…" : "✓ Add to RAG pool"}
            </button>
            <button
              onClick={handleReviewSkip}
              disabled={reviewSaving}
              className="px-5 py-2 rounded border text-sm text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Normal input mode ──────────────────────────────────────
  return (
    <div className="min-h-screen p-6 flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">RAG Examples</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Write problems directly into the RAG pool — no generation required.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/generate" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Generate</Link>
          <Link href="/lookup" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Lookup</Link>
        </div>
      </header>

      {/* Input mode tabs */}
      <div className="flex gap-2 border-b pb-2">
        <button type="button" onClick={() => setInputMode("fields")}
          className={cn("text-sm px-3 py-1.5 rounded-md font-medium transition-colors",
            inputMode === "fields" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
          Fields
        </button>
        <button type="button" onClick={() => setInputMode("json")}
          className={cn("text-sm px-3 py-1.5 rounded-md font-medium transition-colors",
            inputMode === "json" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
          Paste JSON
        </button>
      </div>

      {/* JSON paste panel */}
      {inputMode === "json" && (
        <Card className="max-w-2xl">
          <CardContent className="pt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Paste a single JSON object, multiple comma-separated objects, or a JSON array{" "}
              <code className="bg-muted px-1 rounded">[{"{"}...{"}"}, {"{"}...{"}"}]</code>.
            </p>
            <Textarea
              placeholder={'{ "latex_content": "...", "solution_latex": "...", "choices": ["...","...","...","..."], "correct_index": 0 },\n{ "latex_content": "...", ... }'}
              value={jsonText}
              onChange={(e) => { setJsonText(e.target.value); setJsonError(null); }}
              rows={14}
              className="font-mono text-xs min-h-[240px]"
              spellCheck={false}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleLoadAndReview}>
                Load &amp; Review All
              </Button>
              <Button type="button" variant="secondary" onClick={handleLoadJson}>
                Load single into fields
              </Button>
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
                Load .json file
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setJsonText(""); setJsonError(null); }}>
                Clear
              </Button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
            </div>
            {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}
          </CardContent>
        </Card>
      )}

      {/* Fields + preview */}
      {inputMode === "fields" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          {/* Left panel */}
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant={course === "ap_calc" ? "default" : "outline"}
                      onClick={() => { setCourse("ap_calc"); setSaved(false); }}>AP Calculus</Button>
                    <Button type="button" size="sm" variant={course === "precalc" ? "default" : "outline"}
                      onClick={() => { setCourse("precalc"); setSaved(false); }}>Pre-Calculus</Button>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant={type === "multiple_choice" ? "default" : "outline"}
                      onClick={() => { setType("multiple_choice"); setSaved(false); }}>Multiple Choice</Button>
                    <Button type="button" size="sm" variant={type === "free_response" ? "default" : "outline"}
                      onClick={() => { setType("free_response"); setSaved(false); }}>Free Response</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">Difficulty</span>
                  <span className="text-sm font-semibold tabular-nums">{difficulty} / 5</span>
                </div>
                <Slider min={1} max={5} value={difficulty} onChange={(v) => { setDifficulty(v); setSaved(false); }} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Problem stem</CardTitle></CardHeader>
              <CardContent>
                <Textarea placeholder={"\\text{Let } f(x) = x^2. \\text{ Find } f'(x)."} value={latexContent}
                  onChange={(e) => { setLatexContent(e.target.value); setSaved(false); }}
                  rows={8} className="font-mono text-xs min-h-[160px]" spellCheck={false} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Solution</CardTitle></CardHeader>
              <CardContent>
                <Textarea placeholder={"f'(x) = 2x"} value={solutionLatex}
                  onChange={(e) => { setSolutionLatex(e.target.value); setSaved(false); }}
                  rows={8} className="font-mono text-xs min-h-[160px]" spellCheck={false} />
              </CardContent>
            </Card>

            {type === "multiple_choice" && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Choices</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {CHOICE_LABELS.map((label, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-5 text-sm font-medium text-muted-foreground shrink-0">{label}.</span>
                      <Input placeholder={`Choice ${label}`} value={choices[i]}
                        onChange={(e) => { handleChoiceChange(i, e.target.value); setSaved(false); }}
                        className="font-mono text-xs" />
                    </div>
                  ))}
                  <div className="pt-1">
                    <p className="text-xs text-muted-foreground mb-2">Correct answer</p>
                    <div className="flex gap-2">
                      {CHOICE_LABELS.map((label, i) => (
                        <Button key={i} type="button" size="sm" variant={correctIndex === i ? "default" : "outline"}
                          className="w-10" onClick={() => { setCorrectIndex(i as CorrectIndex); setSaved(false); }}>{label}</Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Notes <span className="text-muted-foreground font-normal text-sm">(optional)</span></CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea placeholder="e.g. Classic chain rule setup with trig. Good FRQ seed." value={notes}
                  onChange={(e) => { setNotes(e.target.value); setSaved(false); }} rows={2} className="text-sm" />
              </CardContent>
            </Card>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handlePreview}>Preview</Button>
              <Button type="button" variant={saved ? "secondary" : "default"} onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : saved ? "Saved to RAG pool" : "Save to RAG pool"}
              </Button>
            </div>
          </div>

          {/* Right panel — preview */}
          {previewed ? (
            <div className="space-y-4">
              <Card>
                <CardHeader className="border-b space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>Problem</CardTitle>
                    <Badge variant="secondary">{previewed.type === "multiple_choice" ? "Multiple choice" : "Free response"}</Badge>
                    <Badge variant={course === "precalc" ? "default" : "outline"}>{course === "precalc" ? "Pre-Calculus" : "AP Calculus"}</Badge>
                    <Badge variant="outline">Difficulty {difficulty}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 min-w-0 overflow-x-auto">
                  <div className="min-w-0 max-w-full [&_.katex-display]:overflow-x-auto">
                    <Preview latexContent={previewed.latex_content} useProblemTypography={false} />
                  </div>
                </CardContent>
              </Card>

              {previewed.type === "multiple_choice" && previewed.choices && (
                <Card>
                  <CardHeader><CardTitle>Choices</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {previewed.choices.map((choice, i) => (
                        <li key={i} className={cn(
                          "flex items-start gap-2 rounded-lg border p-3",
                          i === previewed.correct_index ? "border-primary bg-primary/5" : "border-border"
                        )}>
                          <span className="font-medium text-muted-foreground shrink-0">{CHOICE_LABELS[i]}.</span>
                          <div className="flex-1 min-w-0">
                            <Preview latexContent={normalizeMcqChoiceLatex(choice)} useProblemTypography={false} />
                          </div>
                          {i === previewed.correct_index && <Badge variant="default">Correct</Badge>}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader><CardTitle>Solution</CardTitle></CardHeader>
                <CardContent className="min-w-0 overflow-x-auto">
                  <div className="min-w-0 max-w-full [&_.katex-display]:overflow-x-auto">
                    <Preview latexContent={previewed.solution_latex} useProblemTypography={false} />
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="hidden xl:flex items-center justify-center rounded-xl border border-dashed text-muted-foreground text-sm min-h-[200px]">
              Click Preview to render your problem
            </div>
          )}
        </div>
      )}
    </div>
  );
}
