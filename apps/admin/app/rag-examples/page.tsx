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
type CardStatus = "pending" | "saving" | "approved" | "skipped";

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
  problem_description?: string;
  wrong_answer_descriptions?: (string | null)[];
  topic_description?: string;
  keyword_weights?: Record<string, number>;
  action_description?: string;
  action_weights?: Record<string, number>;
  representation_description?: string;
  representation_weights?: Record<string, number>;
  prerequisite_description?: string;
  prerequisite_weights?: Record<string, number>;
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

  const problem_description = typeof obj.problem_description === "string" && obj.problem_description.trim()
    ? obj.problem_description.trim()
    : undefined;

  const wrong_answer_descriptions = Array.isArray(obj.wrong_answer_descriptions)
    ? (obj.wrong_answer_descriptions as unknown[]).map((v) =>
        v === null || v === undefined ? null : String(v)
      )
    : undefined;

  const topic_description = typeof obj.topic_description === "string" && obj.topic_description.trim() ? obj.topic_description.trim() : undefined;
  const action_description = typeof obj.action_description === "string" && obj.action_description.trim() ? obj.action_description.trim() : undefined;
  const representation_description = typeof obj.representation_description === "string" && obj.representation_description.trim() ? obj.representation_description.trim() : undefined;
  const prerequisite_description = typeof obj.prerequisite_description === "string" && obj.prerequisite_description.trim() ? obj.prerequisite_description.trim() : undefined;

  const keyword_weights = obj.keyword_weights && typeof obj.keyword_weights === "object" && !Array.isArray(obj.keyword_weights) ? obj.keyword_weights as Record<string, number> : undefined;
  const action_weights = obj.action_weights && typeof obj.action_weights === "object" && !Array.isArray(obj.action_weights) ? obj.action_weights as Record<string, number> : undefined;
  const representation_weights = obj.representation_weights && typeof obj.representation_weights === "object" && !Array.isArray(obj.representation_weights) ? obj.representation_weights as Record<string, number> : undefined;
  const prerequisite_weights = obj.prerequisite_weights && typeof obj.prerequisite_weights === "object" && !Array.isArray(obj.prerequisite_weights) ? obj.prerequisite_weights as Record<string, number> : undefined;

  return { ok: true, latex_content: obj.latex_content, solution_latex: obj.solution_latex, type, choices, correct_index, difficulty, problem_description, wrong_answer_descriptions, topic_description, keyword_weights, action_description, action_weights, representation_description, representation_weights, prerequisite_description, prerequisite_weights };
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

function parseMultipleJsons(text: string): ({ ok: true } & ParsedProblem)[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const arr = JSON.parse(trimmed);
    if (Array.isArray(arr)) {
      return arr
        .map((item) => parseOneProblem(item as Record<string, unknown>))
        .filter((r): r is { ok: true } & ParsedProblem => r.ok);
    }
  } catch { /* fall through */ }

  try {
    const wrapped = `[${trimmed}]`;
    const arr = JSON.parse(wrapped);
    if (Array.isArray(arr)) {
      return arr
        .map((item) => parseOneProblem(item as Record<string, unknown>))
        .filter((r): r is { ok: true } & ParsedProblem => r.ok);
    }
  } catch { /* fall through */ }

  const single = parseOneProblem((() => { try { return JSON.parse(trimmed) as Record<string, unknown>; } catch { return {}; } })());
  return single.ok ? [single] : [];
}

// ── Review card ────────────────────────────────────────────────────────────
function ReviewCard({
  problem,
  index,
  status,
  course,
  onApprove,
  onSkip,
}: {
  problem: ParsedProblem;
  index: number;
  status: CardStatus;
  course: "ap_calc" | "precalc";
  onApprove: () => void;
  onSkip: () => void;
}) {
  const [notesLocal, setNotesLocal] = useState("");
  const [expanded, setExpanded] = useState(true);

  const overlay =
    status === "approved"
      ? "border-green-500 bg-green-50/60 dark:bg-green-950/20"
      : status === "skipped"
      ? "opacity-40"
      : "";

  return (
    <Card className={cn("relative transition-all", overlay)}>
      {/* Status ribbon */}
      {status === "approved" && (
        <div className="absolute top-3 right-3 z-10">
          <Badge className="bg-green-600 text-white">✓ Added</Badge>
        </div>
      )}
      {status === "skipped" && (
        <div className="absolute top-3 right-3 z-10">
          <Badge variant="outline">Skipped</Badge>
        </div>
      )}

      <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setExpanded((v) => !v)}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-muted-foreground">#{index + 1}</span>
          <Badge variant="outline">Difficulty {problem.difficulty}</Badge>
          <Badge variant="secondary">{problem.type === "multiple_choice" ? "MCQ" : "FRQ"}</Badge>
          <Badge variant={course === "precalc" ? "default" : "outline"}>
            {course === "precalc" ? "Pre-Calculus" : "AP Calculus"}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">{expanded ? "▲ collapse" : "▼ expand"}</span>
        </div>
        {problem.problem_description && (
          <p className="text-sm text-muted-foreground mt-1 italic">"{problem.problem_description}"</p>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Problem stem */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Problem</p>
            <div className="ap-calc-preview min-w-0 max-w-full overflow-x-auto">
              <Preview latexContent={problem.latex_content} useProblemTypography={false} />
            </div>
          </div>

          {/* Choices */}
          {problem.type === "multiple_choice" && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Choices</p>
              <div className="space-y-1.5">
                {problem.choices.map((choice, i) => {
                  const wrongDesc = problem.wrong_answer_descriptions?.[i];
                  const isCorrect = i === problem.correct_index;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "rounded border px-3 py-2",
                        isCorrect ? "border-primary bg-primary/5" : "border-border"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-sm text-muted-foreground w-4 shrink-0 pt-0.5">{CHOICE_LABELS[i]}.</span>
                        <div className="flex-1 min-w-0">
                          <Preview latexContent={normalizeMcqChoiceLatex(choice)} useProblemTypography={false} />
                        </div>
                        {isCorrect && <Badge variant="default" className="shrink-0 text-xs">Correct</Badge>}
                      </div>
                      {!isCorrect && wrongDesc && (
                        <p className="text-xs text-muted-foreground mt-1 ml-6 italic">{wrongDesc}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Solution */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Solution</p>
            <div className="ap-calc-preview min-w-0 max-w-full overflow-x-auto">
              <Preview latexContent={problem.solution_latex} useProblemTypography={false} />
            </div>
          </div>

          {/* Actions */}
          {status === "pending" && (
            <div className="flex items-center gap-2 pt-1">
              <Input
                value={notesLocal}
                onChange={(e) => setNotesLocal(e.target.value)}
                placeholder="Notes (optional)"
                className="text-sm max-w-xs h-8"
              />
              <button
                onClick={() => onApprove()}
                className="px-4 py-1.5 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
              >
                ✓ Add to RAG pool
              </button>
              <button
                onClick={onSkip}
                className="px-4 py-1.5 rounded border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Skip
              </button>
            </div>
          )}
          {status === "saving" && (
            <p className="text-sm text-muted-foreground">Saving…</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
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
  const [topicDescription, setTopicDescription] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [representationDescription, setRepresentationDescription] = useState("");
  const [prerequisiteDescription, setPrerequisiteDescription] = useState("");
  const [previewed, setPreviewed] = useState<PreviewState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Batch review state
  const [reviewQueue, setReviewQueue] = useState<ParsedProblem[]>([]);
  const [reviewStatuses, setReviewStatuses] = useState<CardStatus[]>([]);
  const [reviewNotes, setReviewNotes] = useState<string[]>([]);

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

  const handleLoadAndReview = useCallback(() => {
    if (!jsonText.trim()) { toast.error("Paste JSON first"); return; }
    const problems = parseMultipleJsons(jsonText);
    if (problems.length === 0) { toast.error("No valid problems found in the pasted text"); return; }
    setReviewQueue(problems);
    setReviewStatuses(problems.map(() => "pending"));
    setReviewNotes(problems.map(() => ""));
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
      if (topicDescription.trim()) body.topic_description = topicDescription.trim();
      if (actionDescription.trim()) body.action_description = actionDescription.trim();
      if (representationDescription.trim()) body.representation_description = representationDescription.trim();
      if (prerequisiteDescription.trim()) body.prerequisite_description = prerequisiteDescription.trim();
      const res = await fetch("/api/rag-examples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const err = (await res.json()) as { error?: string }; throw new Error(err.error ?? "Save failed"); }
      toast.success("Saved to RAG pool");
      setSaved(true);
      setLatexContent(""); setSolutionLatex(""); setChoices(["", "", "", ""]); setCorrectIndex(0); setDifficulty(3); setNotes(""); setTopicDescription(""); setActionDescription(""); setRepresentationDescription(""); setPrerequisiteDescription(""); setJsonText(""); setPreviewed(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [latexContent, solutionLatex, difficulty, type, choices, correctIndex, notes, course]);

  async function handleApprove(index: number) {
    const problem = reviewQueue[index];
    const noteText = reviewNotes[index] ?? "";
    if (!problem) return;
    setReviewStatuses((prev) => { const n = [...prev]; n[index] = "saving"; return n; });
    try {
      const body: Record<string, unknown> = {
        latex_content: problem.latex_content,
        solution_latex: problem.solution_latex,
        difficulty: problem.difficulty,
        course,
      };
      if (problem.type === "multiple_choice") { body.choices = problem.choices; body.correct_index = problem.correct_index; }
      if (noteText.trim()) body.notes = noteText.trim();
      if (problem.problem_description) body.problem_description = problem.problem_description;
      if (problem.wrong_answer_descriptions) body.wrong_answer_descriptions = problem.wrong_answer_descriptions;
      if (problem.topic_description) body.topic_description = problem.topic_description;
      if (problem.keyword_weights && Object.keys(problem.keyword_weights).length > 0) body.keyword_weights = problem.keyword_weights;
      if (problem.action_description) body.action_description = problem.action_description;
      if (problem.action_weights && Object.keys(problem.action_weights).length > 0) body.action_weights = problem.action_weights;
      if (problem.representation_description) body.representation_description = problem.representation_description;
      if (problem.representation_weights && Object.keys(problem.representation_weights).length > 0) body.representation_weights = problem.representation_weights;
      if (problem.prerequisite_description) body.prerequisite_description = problem.prerequisite_description;
      if (problem.prerequisite_weights && Object.keys(problem.prerequisite_weights).length > 0) body.prerequisite_weights = problem.prerequisite_weights;
      const res = await fetch("/api/rag-examples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const err = (await res.json()) as { error?: string }; throw new Error(err.error ?? "Save failed"); }
      setReviewStatuses((prev) => { const n = [...prev]; n[index] = "approved"; return n; });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      setReviewStatuses((prev) => { const n = [...prev]; n[index] = "pending"; return n; });
    }
  }

  function handleSkip(index: number) {
    setReviewStatuses((prev) => { const n = [...prev]; n[index] = "skipped"; return n; });
  }

  // ── Reviewing mode ─────────────────────────────────────────────────────
  if (pageMode === "reviewing") {
    const approved = reviewStatuses.filter((s) => s === "approved").length;
    const skipped = reviewStatuses.filter((s) => s === "skipped").length;
    const pending = reviewStatuses.filter((s) => s === "pending" || s === "saving").length;
    const total = reviewQueue.length;

    return (
      <div className="min-h-screen p-6 max-w-3xl mx-auto space-y-5">
        <header className="flex items-center justify-between gap-4 sticky top-0 bg-background z-20 py-2 border-b">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">Review Queue</h1>
            <span className="text-sm text-muted-foreground">{approved} added · {skipped} skipped · {pending} left</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Course toggle visible during review */}
            <button
              onClick={() => setCourse("ap_calc")}
              className={cn("text-xs px-2.5 py-1 rounded border font-medium transition-colors",
                course === "ap_calc" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground")}
            >AP Calc</button>
            <button
              onClick={() => setCourse("precalc")}
              className={cn("text-xs px-2.5 py-1 rounded border font-medium transition-colors",
                course === "precalc" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground")}
            >Pre-Calculus</button>
            <button onClick={() => setPageMode("input")} className="text-sm text-muted-foreground hover:underline ml-2">
              ← Back
            </button>
          </div>
        </header>

        <div className="space-y-6">
          {reviewQueue.map((problem, i) => (
            <ReviewCard
              key={i}
              problem={problem}
              index={i}
              status={reviewStatuses[i] ?? "pending"}
              course={course}
              onApprove={() => handleApprove(i)}
              onSkip={() => handleSkip(i)}
            />
          ))}
        </div>

        <div className="sticky bottom-0 bg-background border-t py-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} problems · {approved} added · {skipped} skipped · {pending} pending</span>
          <button onClick={() => setPageMode("input")} className="text-sm text-muted-foreground hover:underline">
            ← Back to input
          </button>
        </div>
      </div>
    );
  }

  // ── Normal input mode ──────────────────────────────────────────────────
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
              Optional fields: <code className="bg-muted px-1 rounded">problem_description</code>,{" "}
              <code className="bg-muted px-1 rounded">wrong_answer_descriptions</code>.
            </p>
            <Textarea
              placeholder={'{ "latex_content": "...", "solution_latex": "...", "choices": ["...","...","...","..."], "correct_index": 0, "problem_description": "...", "wrong_answer_descriptions": [null,"...","...","..."] },\n{ "latex_content": "...", ... }'}
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

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Keyword descriptions <span className="text-muted-foreground font-normal text-sm">(optional — add keywords later in Preview JSON)</span></CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Topic", value: topicDescription, setter: setTopicDescription, placeholder: "What topic/skill does this problem test?" },
                  { label: "Action", value: actionDescription, setter: setActionDescription, placeholder: "What action does the student perform? (solve, factor, evaluate…)" },
                  { label: "Representation", value: representationDescription, setter: setRepresentationDescription, placeholder: "How is the problem presented? (equation, graph, table…)" },
                  { label: "Prerequisite", value: prerequisiteDescription, setter: setPrerequisiteDescription, placeholder: "What prior knowledge does this require?" },
                ].map(({ label, value, setter, placeholder }) => (
                  <div key={label} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    <Textarea placeholder={placeholder} value={value}
                      onChange={(e) => { setter(e.target.value); setSaved(false); }}
                      rows={2} className="text-sm resize-none" />
                  </div>
                ))}
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
