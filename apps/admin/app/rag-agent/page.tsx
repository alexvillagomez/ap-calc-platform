"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { Preview } from "@/components/Preview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { normalizeMcqChoiceLatex } from "@/lib/mcqChoiceLatex";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

type Phase = "upload" | "review" | "approving" | "done" | "batch_pending" | "batch_review";

type ProblemTypeItem = { name: string; description: string };

type Task = { pt: ProblemTypeItem; iteration: number; targetDifficulty: number };

type PendingProblem = {
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
  assessedDifficulty: number;
  targetDifficulty: number;
  problem_description?: string;
  wrong_answer_descriptions?: string[];
  generation_thinking?: string;
  distractor_thinking?: string;
  distractor_pool?: { id: string; misconception: string; wrong_answer_plain: string }[];
};

type ApprovedEntry = {
  id: string;
  problemTypeName: string;
  difficulty: number;
  keyword_weights?: Record<string, number>;
};

type BatchProblem = {
  customId: string;
  taskIndex: number;
  latex_content: string;
  solution_latex: string;
  choices: string[];
  correct_index: number;
  assessedDifficulty: number;
  targetDifficulty: number;
  problem_description?: string;
  wrong_answer_descriptions?: string[];
  generation_thinking?: string;
  distractor_thinking?: string;
  distractor_pool?: { id: string; misconception: string; wrong_answer_plain: string }[];
};

type InputMode = "pdf" | "manual";

/** Distribute N problems across difficulties 1–5 so the full range is always covered. */
function buildDifficultySpread(count: number): number[] {
  if (count === 1) return [3];
  if (count === 2) return [2, 4];
  if (count === 3) return [1, 3, 5];
  if (count === 4) return [1, 2, 4, 5];
  // For 5+: evenly space across 1.0–5.0 and round, then shuffle for variety
  return Array.from({ length: count }, (_, i) =>
    Math.round(1 + (i / (count - 1)) * 4)
  );
}

export default function RagAgentPage() {
  const [phase, setPhase] = useState<Phase>("upload");

  // Upload
  const [inputMode, setInputMode] = useState<InputMode>("pdf");
  const [course, setCourse] = useState<"ap_calc" | "precalc">("ap_calc");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Manual input
  const [manualName, setManualName] = useState("");
  const [manualDescription, setManualDescription] = useState("");

  // Review
  const [problemTypes, setProblemTypes] = useState<ProblemTypeItem[]>([]);
  const [countPerType, setCountPerType] = useState(5);

  // Approving
  const [taskQueue, setTaskQueue] = useState<Task[]>([]);
  const [taskIndex, setTaskIndex] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [currentProblem, setCurrentProblem] = useState<PendingProblem | null>(null);
  const [showDenyForm, setShowDenyForm] = useState(false);
  const [denyFeedback, setDenyFeedback] = useState("");
  const [approvedCount, setApprovedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [approvedEntries, setApprovedEntries] = useState<ApprovedEntry[]>([]);
  const [keywordsExpanded, setKeywordsExpanded] = useState(false);
  const [fetchingKeywords, setFetchingKeywords] = useState(false);

  // Batch state
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchTasks, setBatchTasks] = useState<Task[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchPollStatus, setBatchPollStatus] = useState<string>("pending");
  const [batchCompletedCount, setBatchCompletedCount] = useState(0);
  const [batchTotalCount, setBatchTotalCount] = useState(0);
  const [batchProblems, setBatchProblems] = useState<BatchProblem[]>([]);
  const [batchReviewIndex, setBatchReviewIndex] = useState(0);
  const batchPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch keyword_weights for approved entries ─────────────
  const fetchKeywords = useCallback(async (entries: ApprovedEntry[]) => {
    if (entries.length === 0) return;
    setFetchingKeywords(true);
    try {
      const ids = entries.map((e) => e.id).join(",");
      const res = await fetch(`/api/rag-agent/keywords?ids=${encodeURIComponent(ids)}`);
      if (!res.ok) { toast.error("Failed to fetch keywords"); return; }
      const data = await res.json() as { items?: Array<{ id: string; keyword_weights?: Record<string, number> | null }> };
      if (data.items) {
        const kwMap = new Map(data.items.map((item) => [item.id, item.keyword_weights ?? null]));
        setApprovedEntries((prev) =>
          prev.map((e) => {
            const kw = kwMap.get(e.id);
            return kw && Object.keys(kw).length > 0 ? { ...e, keyword_weights: kw } : e;
          })
        );
      }
    } catch {
      toast.error("Failed to fetch keywords");
    } finally {
      setFetchingKeywords(false);
    }
  }, []);

  // Auto-expand panel when first problem is approved
  useEffect(() => {
    if (approvedEntries.length === 1) setKeywordsExpanded(true);
  }, [approvedEntries.length]);

  // ── Batch: poll status ─────────────────────────────────────
  const pollBatchStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/rag-agent/batch-status?batchId=${encodeURIComponent(id)}`);
      if (!res.ok) { toast.error("Failed to check batch status"); return; }
      const data = await res.json() as {
        status: string;
        completedCount?: number;
        totalCount?: number;
        problems?: BatchProblem[];
      };
      setBatchPollStatus(data.status);
      setBatchCompletedCount(data.completedCount ?? 0);
      setBatchTotalCount(data.totalCount ?? 0);
      if (data.status === "completed") {
        const problems = data.problems ?? [];
        setBatchProblems(problems);
        setBatchReviewIndex(0);
        setPhase("batch_review");
      } else if (data.status === "failed" || data.status === "expired" || data.status === "cancelled") {
        toast.error(`Batch job ${data.status}`);
      } else {
        // Still in progress — poll again in 30s
        batchPollRef.current = setTimeout(() => void pollBatchStatus(id), 30_000);
      }
    } catch {
      toast.error("Network error checking batch status");
    }
  }, []);

  // Stop polling on unmount
  useEffect(() => {
    return () => { if (batchPollRef.current) clearTimeout(batchPollRef.current); };
  }, []);

  // ── Batch: send remaining tasks ───────────────────────────
  async function handleSendToBatch() {
    const remaining = taskQueue.slice(taskIndex);
    if (!remaining.length) return;
    setBatchSubmitting(true);
    try {
      const res = await fetch("/api/rag-agent/batch-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: remaining, course }),
      });
      const json = await res.json() as { batchId?: string; taskCount?: number; error?: string };
      if (!res.ok) { toast.error(json.error ?? "Batch submit failed"); return; }
      setBatchId(json.batchId!);
      setBatchTasks(remaining);
      setBatchPollStatus("validating");
      setBatchCompletedCount(0);
      setBatchTotalCount(json.taskCount ?? remaining.length);
      setPhase("batch_pending");
      // Start polling
      batchPollRef.current = setTimeout(() => void pollBatchStatus(json.batchId!), 15_000);
    } catch {
      toast.error("Network error submitting batch");
    } finally {
      setBatchSubmitting(false);
    }
  }

  // ── Batch: approve one result ──────────────────────────────
  async function handleBatchApprove() {
    const problem = batchProblems[batchReviewIndex];
    const task = batchTasks[problem?.taskIndex ?? batchReviewIndex];
    if (!problem || !task) { advanceBatchReview(); return; }
    try {
      const res = await fetch("/api/rag-agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...problem,
          problemTypeName: task.pt.name,
          targetDifficulty: task.targetDifficulty,
          course,
          problem_description: problem.problem_description,
          wrong_answer_descriptions: problem.wrong_answer_descriptions,
          generation_thinking: problem.generation_thinking,
          distractor_thinking: problem.distractor_thinking,
          distractor_pool: problem.distractor_pool,
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) { toast.error(json.error ?? "Insert failed"); return; }
      setApprovedCount((c) => c + 1);
      if (json.id) {
        setApprovedEntries((prev) => [
          ...prev,
          { id: json.id!, problemTypeName: task.pt.name, difficulty: task.targetDifficulty },
        ]);
      }
    } catch {
      toast.error("Network error during approval");
    }
    advanceBatchReview();
  }

  function advanceBatchReview() {
    const next = batchReviewIndex + 1;
    if (next >= batchProblems.length) {
      setPhase("done");
    } else {
      setBatchReviewIndex(next);
    }
  }

  // ── Phase 1a: Manual entry ─────────────────────────────────
  function handleManualStart() {
    const desc = manualDescription.trim();
    if (!desc) return;
    const name = manualName.trim() || desc.slice(0, 60);
    setProblemTypes([{ name, description: desc }]);
    // Skip review, go straight to session
    const difficulties = buildDifficultySpread(countPerType);
    const tasks: Task[] = difficulties.map((d, i) => ({
      pt: { name, description: desc },
      iteration: i,
      targetDifficulty: d,
    }));
    setTaskQueue(tasks);
    setTaskIndex(0);
    setApprovedCount(0);
    setSkippedCount(0);
    setApprovedEntries([]);
    setKeywordsExpanded(false);
    setCurrentProblem(null);
    setShowDenyForm(false);
    setDenyFeedback("");
    setGenError(null);
    setPhase("approving");
    generateProblem(tasks, 0);
  }

  // ── Phase 1b: Extract from PDF ─────────────────────────────
  async function handleExtract() {
    if (!file) return;
    setParsing(true);
    setParseError(null);
    const formData = new FormData();
    formData.append("pdf", file);
    try {
      const res = await fetch("/api/rag-agent/parse", { method: "POST", body: formData });
      const json = await res.json() as { problemTypes?: ProblemTypeItem[]; error?: string };
      if (!res.ok) { setParseError(json.error ?? "Parse failed"); return; }
      setProblemTypes(json.problemTypes ?? []);
      setPhase("review");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Network error");
    } finally {
      setParsing(false);
    }
  }

  // ── Phase 2: Start session ─────────────────────────────────
  function handleStartSession() {
    const difficulties = buildDifficultySpread(countPerType);
    const tasks: Task[] = problemTypes.flatMap((pt) =>
      difficulties.map((d, i) => ({ pt, iteration: i, targetDifficulty: d }))
    );
    setTaskQueue(tasks);
    setTaskIndex(0);
    setApprovedCount(0);
    setSkippedCount(0);
    setApprovedEntries([]);
    setKeywordsExpanded(false);
    setCurrentProblem(null);
    setShowDenyForm(false);
    setDenyFeedback("");
    setGenError(null);
    setPhase("approving");
    // Generate first problem immediately
    generateProblem(tasks, 0);
  }

  // ── Core: generate one problem ─────────────────────────────
  const generateProblem = useCallback(async (
    queue: Task[],
    index: number,
    previousProblemJson?: string,
    feedback?: string
  ) => {
    const task = queue[index];
    if (!task) return;
    setGenerating(true);
    setGenError(null);
    setCurrentProblem(null);
    setShowDenyForm(false);
    setDenyFeedback("");
    try {
      const res = await fetch("/api/rag-agent/generate-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemTypeName: task.pt.name,
          problemTypeDescription: task.pt.description,
          targetDifficulty: task.targetDifficulty ?? undefined,
          iteration: task.iteration,
          previousProblemJson,
          feedback,
          course,
          ...(course === "precalc" ? { trackDiversity: true } : {}),
        }),
      });
      const json = await res.json() as Partial<PendingProblem> & { error?: string; problem_description?: string; wrong_answer_descriptions?: string[] };
      if (!res.ok) {
        setGenError(json.error ?? `Error ${res.status}`);
        return;
      }
      setCurrentProblem({
        latex_content: json.latex_content ?? "",
        solution_latex: json.solution_latex ?? "",
        choices: json.choices ?? [],
        correct_index: json.correct_index ?? 0,
        assessedDifficulty: json.assessedDifficulty ?? task.targetDifficulty,
        targetDifficulty: task.targetDifficulty,
        problem_description: json.problem_description,
        wrong_answer_descriptions: json.wrong_answer_descriptions,
        generation_thinking: json.generation_thinking,
        distractor_thinking: json.distractor_thinking,
        distractor_pool: json.distractor_pool,
      });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Network error");
    } finally {
      setGenerating(false);
    }
  }, []);

  // ── Approve ────────────────────────────────────────────────
  async function handleApprove() {
    if (!currentProblem) return;
    const task = taskQueue[taskIndex]!;
    try {
      const res = await fetch("/api/rag-agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...currentProblem,
          problemTypeName: task.pt.name,
          targetDifficulty: task.targetDifficulty,
          course,
          problem_description: currentProblem.problem_description,
          wrong_answer_descriptions: currentProblem.wrong_answer_descriptions,
          generation_thinking: currentProblem.generation_thinking,
          distractor_thinking: currentProblem.distractor_thinking,
          distractor_pool: currentProblem.distractor_pool,
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "Insert failed");
        return;
      }
      setApprovedCount((c) => c + 1);
      if (json.id) {
        setApprovedEntries((prev) => [
          ...prev,
          { id: json.id!, problemTypeName: task.pt.name, difficulty: task.targetDifficulty },
        ]);
      }
      advanceToNext(taskQueue, taskIndex);
    } catch {
      toast.error("Network error during approval");
    }
  }

  // ── Deny: regenerate with optional feedback ────────────────
  function handleDeny() {
    const previousJson = currentProblem ? JSON.stringify(currentProblem) : undefined;
    const fb = denyFeedback.trim() || undefined;
    generateProblem(taskQueue, taskIndex, previousJson, fb);
  }

  // ── Skip: move on without inserting ───────────────────────
  function handleSkip() {
    setSkippedCount((c) => c + 1);
    advanceToNext(taskQueue, taskIndex);
  }

  function advanceToNext(queue: Task[], current: number) {
    const next = current + 1;
    if (next >= queue.length) {
      setPhase("done");
      return;
    }
    setTaskIndex(next);
    generateProblem(queue, next);
  }

  const currentTask = taskQueue[taskIndex];
  const totalTasks = taskQueue.length;
  const progressPct = totalTasks > 0 ? Math.round((taskIndex / totalTasks) * 100) : 0;

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">RAG Agent</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Generate and review gold-star RAG seed problems one at a time.
          </p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">← Admin</Link>
      </header>

      {/* ── Phase 1: Upload ─────────────────────────────────── */}
      {phase === "upload" && (
        <div className="border rounded-lg overflow-hidden max-w-xl">
          {/* Mode tabs */}
          <div className="flex border-b">
            {(["manual", "pdf"] as InputMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setInputMode(m); setParseError(null); }}
                className={cn(
                  "flex-1 py-2.5 text-sm font-medium transition-colors",
                  inputMode === m
                    ? "bg-background border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "manual" ? "Type / Paste" : "Upload PDF"}
              </button>
            ))}
          </div>

          <div className="px-5 pt-4 pb-0 flex gap-2">
            <button
              onClick={() => setCourse("ap_calc")}
              className={cn("px-3 py-1 rounded text-xs font-medium border transition-colors",
                course === "ap_calc" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >AP Calculus</button>
            <button
              onClick={() => setCourse("precalc")}
              className={cn("px-3 py-1 rounded text-xs font-medium border transition-colors",
                course === "precalc" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >Pre-Calculus</button>
          </div>

          <div className="p-5 space-y-4">
            {inputMode === "manual" ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Describe the type of problem you want. The agent will generate the number of versions you choose below, spread across difficulties 1–5.
                </p>
                <label className="block">
                  <span className="text-sm font-medium mb-1 block">Name <span className="text-muted-foreground font-normal">(optional)</span></span>
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="e.g. Related rates — ladder sliding down wall"
                    className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium mb-1 block">Problem description</span>
                  <textarea
                    value={manualDescription}
                    onChange={(e) => setManualDescription(e.target.value)}
                    placeholder="Paste or type the problem type description here…"
                    className="w-full border rounded px-3 py-2 text-sm resize-none h-28 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium shrink-0">Count:</label>
                  <input
                    type="number" min={1} max={20} value={countPerType}
                    onChange={(e) => setCountPerType(Math.min(20, Math.max(1, parseInt(e.target.value) || 5)))}
                    className="w-16 border rounded px-2 py-1 text-sm text-center"
                  />
                  <span className="text-xs text-muted-foreground">difficulties: {buildDifficultySpread(countPerType).join(", ")}</span>
                </div>
                <button
                  onClick={handleManualStart}
                  disabled={!manualDescription.trim()}
                  className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  Generate {countPerType} Problem{countPerType !== 1 ? "s" : ""}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Upload a PDF listing AP Calculus problem types. The agent will generate
                  problems per type and let you approve or deny each one.
                </p>
                <div>
                  <span className="text-sm font-medium mb-1 block">Select PDF</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(e) => { setFile(e.target.files?.[0] ?? null); setParseError(null); }}
                    className="block w-full text-sm file:mr-4 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:opacity-90 cursor-pointer"
                  />
                </div>
                {file && <p className="text-sm text-muted-foreground">Selected: <span className="font-medium">{file.name}</span></p>}
                {parseError && <p className="text-sm text-destructive bg-destructive/10 rounded p-2">{parseError}</p>}
                <button
                  onClick={handleExtract}
                  disabled={!file || parsing}
                  className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  {parsing ? "Extracting…" : "Extract Problem Types"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Phase 2: Review ─────────────────────────────────── */}
      {phase === "review" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Found <span className="font-semibold text-foreground">{problemTypes.length}</span> problem types.
            </p>
            <button onClick={() => setPhase("upload")} className="text-sm text-muted-foreground hover:underline">← Back</button>
          </div>

          <div className="border rounded-lg overflow-hidden max-h-80 overflow-y-auto divide-y">
            {problemTypes.map((pt, i) => (
              <div key={i} className="p-3 flex gap-3 items-start">
                <span className="text-xs text-muted-foreground mt-0.5 w-5 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{pt.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{pt.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border rounded-lg p-4 flex items-center gap-4">
            <label className="text-sm font-medium shrink-0">Problems per type:</label>
            <input
              type="number" min={1} max={20} value={countPerType}
              onChange={(e) => setCountPerType(Math.min(20, Math.max(1, parseInt(e.target.value) || 5)))}
              className="w-16 border rounded px-2 py-1 text-sm text-center"
            />
            <p className="text-sm text-muted-foreground">
              = <span className="font-semibold text-foreground">{problemTypes.length * countPerType}</span> total
              &nbsp;· difficulties: {buildDifficultySpread(countPerType).join(", ")}
            </p>
          </div>

          <button
            onClick={handleStartSession}
            className="w-full px-4 py-2.5 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Start Review Session ({problemTypes.length * countPerType} problems)
          </button>
        </div>
      )}

      {/* ── Phase 3: Approving ──────────────────────────────── */}
      {phase === "approving" && currentTask && (
        <div className="space-y-4">
          {/* Progress */}
          <div className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{currentTask.pt.name}</span>
              <span className="text-muted-foreground">{taskIndex + 1} / {totalTasks}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>Target D{currentTask.targetDifficulty}</span>
              <span>·</span>
              <span className="text-green-600">{approvedCount} approved</span>
              <span>·</span>
              <span>{skippedCount} skipped</span>
            </div>
          </div>

          {/* Generating spinner */}
          {generating && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2Icon className="h-5 w-5 animate-spin" />
              <span>Generating problem…</span>
            </div>
          )}

          {/* Generation error */}
          {genError && !generating && (
            <div className="border border-destructive/30 rounded-lg p-4 space-y-2">
              <p className="text-sm text-destructive">{genError}</p>
              <div className="flex gap-2">
                <button onClick={() => generateProblem(taskQueue, taskIndex)} className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm hover:opacity-90">
                  Retry
                </button>
                <button onClick={handleSkip} className="px-3 py-1.5 rounded border text-sm hover:bg-muted">
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* Problem preview */}
          {currentProblem && !generating && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Assessed D{currentProblem.assessedDifficulty}</Badge>
                {currentProblem.assessedDifficulty !== currentProblem.targetDifficulty && (
                  <span className="text-xs text-muted-foreground">(target D{currentProblem.targetDifficulty})</span>
                )}
              </div>

              <Card>
                <CardHeader className="border-b py-3">
                  <CardTitle className="text-sm">Problem</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="ap-calc-preview">
                    <Preview latexContent={currentProblem.latex_content} />
                  </div>
                </CardContent>
              </Card>

              {currentProblem.problem_description && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                  <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Problem description</p>
                  <p className="text-sm text-blue-900">{currentProblem.problem_description}</p>
                </div>
              )}

              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Choices</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {currentProblem.choices.map((choice, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-sm text-muted-foreground shrink-0 pt-0.5 w-4">{String.fromCharCode(65 + i)}.</span>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className={cn(
                          "ap-calc-preview rounded px-2 py-0.5",
                          i === currentProblem.correct_index ? "ring-2 ring-primary ring-offset-1" : ""
                        )}>
                          <Preview latexContent={normalizeMcqChoiceLatex(choice)} />
                        </div>
                        {i === currentProblem.correct_index && (
                          <Badge variant="default" className="text-xs">Correct</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b py-3">
                  <CardTitle className="text-sm">Solution</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="ap-calc-preview">
                    <Preview latexContent={currentProblem.solution_latex} />
                  </div>
                </CardContent>
              </Card>

              {/* Descriptions */}
              {(currentProblem.problem_description || currentProblem.wrong_answer_descriptions?.some((d) => d && d !== "null")) && (
                <Card>
                  <CardHeader className="border-b py-3">
                    <CardTitle className="text-sm">Descriptions</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-3 space-y-3">
                    {currentProblem.problem_description && (
                      <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
                        <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-0.5">Problem</p>
                        <p className="text-sm text-blue-900">{currentProblem.problem_description}</p>
                      </div>
                    )}
                    {currentProblem.wrong_answer_descriptions && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Wrong answer reasoning</p>
                        {currentProblem.wrong_answer_descriptions.map((desc, i) => {
                          if (i === currentProblem.correct_index || !desc || desc === "null") return null;
                          return (
                            <div key={i} className="flex gap-2 items-start rounded-md bg-muted/50 px-3 py-2">
                              <span className="text-xs font-bold text-muted-foreground shrink-0 mt-0.5 w-4">{String.fromCharCode(65 + i)}.</span>
                              <p className="text-sm text-foreground/80">{desc}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* AI Reasoning */}
              {(currentProblem.generation_thinking || currentProblem.distractor_thinking) && (
                <Card>
                  <CardHeader className="border-b py-3">
                    <CardTitle className="text-sm text-muted-foreground">AI Reasoning</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-3 space-y-3">
                    {currentProblem.generation_thinking && (
                      <div>
                        <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-1">Generation thinking</p>
                        <p className="text-xs text-foreground/70 leading-relaxed">{currentProblem.generation_thinking}</p>
                      </div>
                    )}
                    {currentProblem.distractor_thinking && (
                      <div>
                        <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-1">Distractor thinking</p>
                        <p className="text-xs text-foreground/70 leading-relaxed">{currentProblem.distractor_thinking}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Approve / Deny / Skip */}
              {!showDenyForm ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleApprove}
                    className="px-5 py-2 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => { setShowDenyForm(true); setTimeout(() => feedbackRef.current?.focus(), 50); }}
                    className="px-5 py-2 rounded border border-destructive text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors"
                  >
                    ✗ Deny
                  </button>
                  <button
                    onClick={handleSkip}
                    className="px-4 py-2 rounded border text-sm text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Skip
                  </button>
                  {taskIndex > 0 && taskIndex < taskQueue.length && (
                    <button
                      onClick={() => void handleSendToBatch()}
                      disabled={batchSubmitting}
                      className="ml-auto px-4 py-2 rounded border border-primary text-primary text-sm font-medium hover:bg-primary/5 disabled:opacity-50 transition-colors"
                    >
                      {batchSubmitting ? "Submitting…" : `Batch remaining ${taskQueue.length - taskIndex}`}
                    </button>
                  )}
                </div>
              ) : (
                <div className="border rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium">What to fix or add? <span className="text-muted-foreground font-normal">(optional)</span></p>
                  <textarea
                    ref={feedbackRef}
                    value={denyFeedback}
                    onChange={(e) => setDenyFeedback(e.target.value)}
                    placeholder="e.g. Use a graph, make it about velocity, change to exponential function…"
                    className="w-full border rounded px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleDeny}
                      className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
                    >
                      Regenerate
                    </button>
                    <button
                      onClick={handleSkip}
                      className="px-4 py-2 rounded border text-sm text-muted-foreground hover:bg-muted"
                    >
                      Skip instead
                    </button>
                    <button
                      onClick={() => setShowDenyForm(false)}
                      className="px-4 py-2 rounded text-sm text-muted-foreground hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recently Approved + Keyword Verification */}
          {approvedEntries.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-2.5 bg-muted/50 cursor-pointer select-none"
                onClick={() => setKeywordsExpanded((e) => !e)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Recently Approved ({approvedEntries.length})</span>
                  <span className="text-xs text-muted-foreground">
                    {approvedEntries.filter((e) => e.keyword_weights && Object.keys(e.keyword_weights).length > 0).length} tagged
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(ev) => { ev.stopPropagation(); void fetchKeywords(approvedEntries); }}
                    disabled={fetchingKeywords}
                    className="text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    {fetchingKeywords ? "Refreshing…" : "Refresh Keywords"}
                  </button>
                  <span className="text-xs text-muted-foreground">{keywordsExpanded ? "▲" : "▼"}</span>
                </div>
              </div>
              {keywordsExpanded && (
                <div className="divide-y max-h-72 overflow-y-auto">
                  {[...approvedEntries].reverse().map((entry) => (
                    <div key={entry.id} className="px-4 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate max-w-[260px]">{entry.problemTypeName}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">D{entry.difficulty}</Badge>
                      </div>
                      {entry.keyword_weights && Object.keys(entry.keyword_weights).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(entry.keyword_weights)
                            .sort(([, a], [, b]) => b - a)
                            .slice(0, 10)
                            .map(([kw, weight]) => (
                              <span
                                key={kw}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium"
                              >
                                {kw.replace(/_/g, " ")}
                                <span className="opacity-55">{weight.toFixed(2)}</span>
                              </span>
                            ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground italic">Keywords pending — click Refresh Keywords</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Phase 4: Done ───────────────────────────────────── */}
      {phase === "done" && (
        <div className="space-y-4">
          <div className="border rounded-lg p-6 space-y-4 max-w-md">
            <h2 className="text-lg font-semibold">Session complete</h2>
            <p className="text-sm text-muted-foreground">
              <span className="text-green-600 font-medium">{approvedCount} approved</span>
              {" · "}
              <span>{skippedCount} skipped</span>
              {" · "}
              <span>{taskQueue.length} total tasks</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setPhase("review"); setTaskQueue([]); setTaskIndex(0); }}
                className="px-4 py-2 rounded border text-sm hover:bg-muted transition-colors"
              >
                New Session
              </button>
              <Link
                href="/rag-examples"
                className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity"
              >
                View RAG Examples →
              </Link>
            </div>
          </div>

          {approvedEntries.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Approved Problems — Keyword Verification</span>
                  <span className="text-xs text-muted-foreground">
                    {approvedEntries.filter((e) => e.keyword_weights && Object.keys(e.keyword_weights).length > 0).length} / {approvedEntries.length} tagged
                  </span>
                </div>
                <button
                  onClick={() => void fetchKeywords(approvedEntries)}
                  disabled={fetchingKeywords}
                  className="text-xs text-primary hover:underline disabled:opacity-50"
                >
                  {fetchingKeywords ? "Refreshing…" : "Refresh Keywords"}
                </button>
              </div>
              <div className="divide-y max-h-96 overflow-y-auto">
                {approvedEntries.map((entry) => (
                  <div key={entry.id} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate max-w-[300px]">{entry.problemTypeName}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">D{entry.difficulty}</Badge>
                    </div>
                    {entry.keyword_weights && Object.keys(entry.keyword_weights).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(entry.keyword_weights)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 12)
                          .map(([kw, weight]) => (
                            <span
                              key={kw}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium"
                            >
                              {kw.replace(/_/g, " ")}
                              <span className="opacity-55">{weight.toFixed(2)}</span>
                            </span>
                          ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic">Keywords pending — click Refresh Keywords</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Phase 5: Batch Pending ──────────────────────────── */}
      {phase === "batch_pending" && (
        <div className="space-y-4 max-w-lg">
          <div className="border rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Batch job submitted</h2>
              <Badge variant="outline" className="text-xs capitalize">{batchPollStatus}</Badge>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{batchCompletedCount} / {batchTotalCount} completed</span>
                <span>{batchId}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: batchTotalCount > 0 ? `${Math.round((batchCompletedCount / batchTotalCount) * 100)}%` : "0%" }}
                />
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Auto-checking every 30 seconds. You can close this tab and come back — paste the batch ID to resume.
            </p>

            <button
              onClick={() => void pollBatchStatus(batchId!)}
              className="px-4 py-2 rounded border text-sm hover:bg-muted transition-colors"
            >
              Check Now
            </button>
          </div>

          {/* Resume by batch ID */}
          <div className="border rounded-lg p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Resume a batch</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="batch_..."
                defaultValue={batchId ?? ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const id = (e.target as HTMLInputElement).value.trim();
                    if (id) { setBatchId(id); void pollBatchStatus(id); }
                  }
                }}
                className="flex-1 border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={(e) => {
                  const input = (e.currentTarget.previousSibling as HTMLInputElement);
                  const id = input.value.trim();
                  if (id) { setBatchId(id); void pollBatchStatus(id); }
                }}
                className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm hover:opacity-90"
              >
                Check
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 6: Batch Review ───────────────────────────── */}
      {phase === "batch_review" && (() => {
        const problem = batchProblems[batchReviewIndex];
        const task = batchTasks[problem?.taskIndex ?? batchReviewIndex];
        if (!problem) return <p className="text-sm text-muted-foreground">No results to review.</p>;
        return (
          <div className="space-y-4">
            {/* Progress */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{task?.pt.name ?? "Batch result"}</span>
                <span className="text-muted-foreground">{batchReviewIndex + 1} / {batchProblems.length}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((batchReviewIndex / batchProblems.length) * 100)}%` }}
                />
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">D{problem.assessedDifficulty}</Badge>
                <span className="text-green-600">{approvedCount} approved</span>
                <span>{skippedCount} skipped</span>
              </div>
            </div>

            <Card>
              <CardHeader className="border-b py-3"><CardTitle className="text-sm">Problem</CardTitle></CardHeader>
              <CardContent className="pt-4">
                <div className="ap-calc-preview"><Preview latexContent={problem.latex_content} /></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Choices</CardTitle></CardHeader>
              <CardContent className="space-y-2 pt-0">
                {problem.choices.map((choice, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-sm text-muted-foreground shrink-0 pt-0.5 w-4">{String.fromCharCode(65 + i)}.</span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className={cn("ap-calc-preview rounded px-2 py-0.5", i === problem.correct_index ? "ring-2 ring-primary ring-offset-1" : "")}>
                        <Preview latexContent={normalizeMcqChoiceLatex(choice)} />
                      </div>
                      {i === problem.correct_index && <Badge variant="default" className="text-xs">Correct</Badge>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b py-3"><CardTitle className="text-sm">Solution</CardTitle></CardHeader>
              <CardContent className="pt-4">
                <div className="ap-calc-preview"><Preview latexContent={problem.solution_latex} /></div>
              </CardContent>
            </Card>

            {(problem.problem_description || problem.wrong_answer_descriptions?.some((d) => d && d !== "null")) && (
              <Card>
                <CardHeader className="border-b py-3"><CardTitle className="text-sm">Descriptions</CardTitle></CardHeader>
                <CardContent className="pt-3 space-y-3">
                  {problem.problem_description && (
                    <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
                      <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-0.5">Problem</p>
                      <p className="text-sm text-blue-900">{problem.problem_description}</p>
                    </div>
                  )}
                  {problem.wrong_answer_descriptions && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Wrong answer reasoning</p>
                      {problem.wrong_answer_descriptions.map((desc, i) => {
                        if (i === problem.correct_index || !desc || desc === "null") return null;
                        return (
                          <div key={i} className="flex gap-2 items-start rounded-md bg-muted/50 px-3 py-2">
                            <span className="text-xs font-bold text-muted-foreground shrink-0 mt-0.5 w-4">{String.fromCharCode(65 + i)}.</span>
                            <p className="text-sm text-foreground/80">{desc}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {(problem.generation_thinking || problem.distractor_thinking) && (
              <Card>
                <CardHeader className="border-b py-3"><CardTitle className="text-sm text-muted-foreground">AI Reasoning</CardTitle></CardHeader>
                <CardContent className="pt-3 space-y-3">
                  {problem.generation_thinking && (
                    <div>
                      <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-1">Generation thinking</p>
                      <p className="text-xs text-foreground/70 leading-relaxed">{problem.generation_thinking}</p>
                    </div>
                  )}
                  {problem.distractor_thinking && (
                    <div>
                      <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-1">Distractor thinking</p>
                      <p className="text-xs text-foreground/70 leading-relaxed">{problem.distractor_thinking}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="flex gap-2">
              <button onClick={() => void handleBatchApprove()} className="px-5 py-2 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors">
                ✓ Approve
              </button>
              <button onClick={() => { setSkippedCount((c) => c + 1); advanceBatchReview(); }} className="px-4 py-2 rounded border text-sm text-muted-foreground hover:bg-muted transition-colors">
                Skip
              </button>
            </div>

            {/* Keywords panel */}
            {approvedEntries.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50 cursor-pointer select-none" onClick={() => setKeywordsExpanded((e) => !e)}>
                  <span className="text-sm font-medium">Approved ({approvedEntries.length}) · {approvedEntries.filter((e) => e.keyword_weights && Object.keys(e.keyword_weights).length > 0).length} tagged</span>
                  <div className="flex items-center gap-3">
                    <button onClick={(ev) => { ev.stopPropagation(); void fetchKeywords(approvedEntries); }} disabled={fetchingKeywords} className="text-xs text-primary hover:underline disabled:opacity-50">
                      {fetchingKeywords ? "Refreshing…" : "Refresh Keywords"}
                    </button>
                    <span className="text-xs text-muted-foreground">{keywordsExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>
                {keywordsExpanded && (
                  <div className="divide-y max-h-64 overflow-y-auto">
                    {[...approvedEntries].reverse().map((entry) => (
                      <div key={entry.id} className="px-4 py-2.5 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium truncate max-w-[260px]">{entry.problemTypeName}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">D{entry.difficulty}</Badge>
                        </div>
                        {entry.keyword_weights && Object.keys(entry.keyword_weights).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(entry.keyword_weights).sort(([, a], [, b]) => b - a).slice(0, 10).map(([kw, weight]) => (
                              <span key={kw} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">
                                {kw.replace(/_/g, " ")}<span className="opacity-55">{weight.toFixed(2)}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground italic">Keywords pending</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </main>
  );
}
