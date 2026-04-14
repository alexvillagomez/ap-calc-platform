"use client";

import { useState, useEffect, useCallback } from "react";
import { Preview } from "@/components/Preview";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
import { toast } from "sonner";
import { Loader2Icon, ChevronDownIcon, RefreshCwIcon, CheckIcon } from "lucide-react";
import { normalizeMcqChoiceLatex } from "@/lib/mcqChoiceLatex";
import { cn } from "@/lib/utils";

interface Topic {
  id: string;
  name: string;
  description: string;
}

type QuestionType = "multiple_choice" | "free_response";

const RATER_STORAGE_KEY = "ap_calc_admin_rater_id";

interface GeneratedProblem {
  latex_content: string;
  solution_latex: string;
  choices?: string[];
  correct_index?: number;
  /** Set by assess-problem after generation. */
  difficulty?: number;
  /** Set by assess-problem after generation. */
  topic_weights?: Record<string, number>;
  rubric?: string;
  /** Server-set: MCQ emphasis topic id and/or FRQ archetype — preserved through refinement. */
  generation_meta?: {
    emphasis_topic_id?: string;
    emphasis_topic_name?: string;
    emphasis_topic_description?: string;
    frq_archetype_id?: number;
    frq_type?: string;
    frq_label?: string;
  };
}

type GenerationPrompts = { system: string; user: string };

function splitGenerationResponse(data: Record<string, unknown>): {
  problem: GeneratedProblem;
  prompts: GenerationPrompts | null;
  resolvedTopicIds: string[];
} {
  const { generation_prompts: gp, resolved_topic_ids: rti, ...rest } = data;
  let prompts: GenerationPrompts | null = null;
  if (gp && typeof gp === "object" && !Array.isArray(gp)) {
    const o = gp as Record<string, unknown>;
    if (typeof o.system === "string" && typeof o.user === "string") {
      prompts = { system: o.system, user: o.user };
    }
  }
  const resolvedTopicIds = Array.isArray(rti) ? (rti as string[]) : [];
  return { problem: rest as unknown as GeneratedProblem, prompts, resolvedTopicIds };
}

export default function GeneratePage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicOpen, setTopicOpen] = useState(false);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [questionType, setQuestionType] = useState<QuestionType>("multiple_choice");
  const [difficulty, setDifficulty] = useState(3);
  const [generated, setGenerated] = useState<GeneratedProblem | null>(null);
  const [feedback, setFeedback] = useState("");
  const [generating, setGenerating] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [tweaking, setTweaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawJsonDraft, setRawJsonDraft] = useState("");
  const [lastGenerationPrompts, setLastGenerationPrompts] = useState<GenerationPrompts | null>(null);
  const [raterId, setRaterId] = useState("");
  const [savedProblemMeta, setSavedProblemMeta] = useState<{
    id: string;
    avg_rating: number | null;
    rating_count: number;
  } | null>(null);
  const [ratingNotes, setRatingNotes] = useState("");
  const [ratingBusy, setRatingBusy] = useState(false);

  useEffect(() => {
    try {
      let id = localStorage.getItem(RATER_STORAGE_KEY);
      if (!id) {
        id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `r-${Date.now()}`;
        localStorage.setItem(RATER_STORAGE_KEY, id);
      }
      setRaterId(id);
    } catch {
      setRaterId(`r-${Date.now()}`);
    }
  }, []);

  const fetchTopics = useCallback(async (noCache = false) => {
    try {
      const url = noCache ? `/api/topics?nocache=${Date.now()}` : "/api/topics";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch topics");
      const data = await res.json();
      const normalized = Array.isArray(data)
        ? data.map(
            (d: Record<string, unknown>) =>
              ({
                id: d.id ?? d.Id ?? "",
                name: String(d.name ?? d.Name ?? ""),
                description: String(d.description ?? d.Description ?? ""),
              }) as Topic
          )
        : [];
      setTopics(normalized);
      console.log("Frontend received topics:", normalized);
    } catch {
      toast.error("Could not load topics");
    }
  }, []);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  // Auto-select full pool by default once topics load (user can still uncheck).
  useEffect(() => {
    if (topics.length === 0) return;
    setSelectedTopicIds((prev) => {
      if (prev.length > 0) return prev;
      return topics.map((t) => t.id).filter(Boolean);
    });
  }, [topics]);

  useEffect(() => {
    if (!generated) {
      setRawJsonDraft("");
      return;
    }
    setRawJsonDraft(JSON.stringify(generated, null, 2));
  }, [generated]);

  const emphasisTopicDisplay = (() => {
    if (!generated) return null;
    const meta = generated.generation_meta;
    const metaName = meta?.emphasis_topic_name?.trim();
    const metaSkill = meta?.emphasis_topic_description?.trim();
    const id = meta?.emphasis_topic_id?.trim();
    if (metaName || metaSkill) {
      const label =
        metaName && metaSkill ? `${metaName} (${metaSkill})` : metaName || metaSkill || "";
      if (label) return { id, label };
    }
    if (id) {
      const row = topics.find((t) => t.id === id);
      const n = row?.name?.trim();
      const s = row?.description?.trim();
      const label = n && s ? `${n} (${s})` : n || s || id;
      return { id, label };
    }
    const tw = generated.topic_weights;
    if (tw && typeof tw === "object" && !Array.isArray(tw)) {
      const keys = Object.keys(tw);
      if (keys.length === 1) {
        const k = keys[0]!;
        const row = topics.find((t) => t.id === k);
        const n = row?.name?.trim();
        const s = row?.description?.trim();
        return { id: k, label: n && s ? `${n} (${s})` : n || s || k };
      }
    }
    return null;
  })();

  /** Calls /api/assess-problem and merges difficulty + topic_weights into the current problem. */
  const runAssessment = async (
    problem: GeneratedProblem,
    topicIds: string[],
    type: QuestionType
  ): Promise<GeneratedProblem> => {
    const res = await fetch("/api/assess-problem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latex_content: problem.latex_content,
        solution_latex: problem.solution_latex,
        choices: problem.choices,
        rubric: problem.rubric,
        type,
        topicIds,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Assessment failed");
      return problem;
    }
    return {
      ...problem,
      difficulty: typeof data.difficulty === "number" ? data.difficulty : problem.difficulty,
      topic_weights:
        data.topic_weights && typeof data.topic_weights === "object"
          ? (data.topic_weights as Record<string, number>)
          : problem.topic_weights,
    };
  };

  const toggleTopicId = (id: string) => {
    setSelectedTopicIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const submitRating = async (stars: number) => {
    if (!savedProblemMeta?.id || !raterId) {
      toast.error("Cannot submit rating yet");
      return;
    }
    setRatingBusy(true);
    try {
      const res = await fetch(`/api/problems/${savedProblemMeta.id}/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rater_id: raterId,
          rating: stars,
          notes: ratingNotes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Rating failed");
        return;
      }
      setSavedProblemMeta((prev) =>
        prev
          ? {
              ...prev,
              avg_rating: data.avg_rating ?? null,
              rating_count: data.rating_count ?? 0,
            }
          : prev
      );
      toast.success("Rating saved");
    } catch {
      toast.error("Rating failed");
    } finally {
      setRatingBusy(false);
    }
  };

  const handleGenerate = async () => {
    if (selectedTopicIds.length === 0) {
      toast.error("Select at least one topic");
      return;
    }
    setGenerating(true);
    setGenerated(null);
    setSavedProblemMeta(null);
    setLastGenerationPrompts(null);
    try {
      const res = await fetch("/api/generate-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicIds: selectedTopicIds,
          difficulty,
          questionType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Generation failed");
        return;
      }
      const { problem, prompts, resolvedTopicIds } = splitGenerationResponse(
        data as Record<string, unknown>
      );
      setGenerated(problem);
      setLastGenerationPrompts(prompts);
      setGenerating(false);

      // Second pass: assess difficulty and topic weights independently.
      setAssessing(true);
      const topicPool = resolvedTopicIds.length > 0 ? resolvedTopicIds : selectedTopicIds;
      const assessed = await runAssessment(problem, topicPool, questionType);
      setGenerated(assessed);
      toast.success("Problem generated");
    } catch {
      toast.error("Generation failed");
    } finally {
      setGenerating(false);
      setAssessing(false);
    }
  };

  const handleTweak = async () => {
    if (!generated) {
      toast.error("Generate a problem first");
      return;
    }
    setTweaking(true);
    try {
      const { user_topic_priorities, ...rest } = generated as GeneratedProblem & {
        user_topic_priorities?: Record<string, number>;
      };
      void user_topic_priorities;
      const problemForRefine = rest;
      const res = await fetch("/api/generate-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          difficulty: generated.difficulty,
          questionType,
          topicIds: selectedTopicIds,
          previousProblem: problemForRefine,
          feedback: feedback.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Refinement failed");
        return;
      }
      const { problem, prompts, resolvedTopicIds } = splitGenerationResponse(
        data as Record<string, unknown>
      );
      setGenerated(problem);
      setLastGenerationPrompts(prompts);
      setTweaking(false);

      // Second pass: re-assess difficulty and topic weights on the refined problem.
      setAssessing(true);
      const topicPool = resolvedTopicIds.length > 0 ? resolvedTopicIds : selectedTopicIds;
      const assessed = await runAssessment(problem, topicPool, questionType);
      setGenerated(assessed);
      toast.success("Problem refined");
    } catch {
      toast.error("Refinement failed");
    } finally {
      setTweaking(false);
      setAssessing(false);
    }
  };

  const handleApproveSave = async () => {
    if (!generated) {
      toast.error("Generate a problem first");
      return;
    }
    setSaving(true);
    try {
      let problemToSave: GeneratedProblem = generated;
      if (showRawJson && rawJsonDraft.trim()) {
        try {
          problemToSave = JSON.parse(rawJsonDraft) as GeneratedProblem;
        } catch {
          toast.error("Invalid JSON (cannot parse). Fix the JSON and try again.");
          return;
        }
      }

      if (
        !problemToSave ||
        typeof problemToSave.latex_content !== "string" ||
        typeof problemToSave.solution_latex !== "string"
      ) {
        toast.error("JSON is missing required fields. Expected latex_content, solution_latex.");
        return;
      }
      if (typeof problemToSave.difficulty !== "number" || !problemToSave.topic_weights) {
        toast.error("Assessment is still running. Wait for difficulty and topic weights before saving.");
        return;
      }

      const payload: Record<string, unknown> = {
        latex_content: problemToSave.latex_content,
        solution_latex: problemToSave.solution_latex,
        difficulty: problemToSave.difficulty,
        topic_weights: problemToSave.topic_weights,
        type: questionType,
      };

      if (questionType === "multiple_choice") {
        payload.choices = Array.isArray(problemToSave.choices) ? problemToSave.choices : [];
        payload.correct_index =
          typeof problemToSave.correct_index === "number" ? problemToSave.correct_index : 0;
      } else {
        payload.rubric = typeof problemToSave.rubric === "string" ? problemToSave.rubric : "";
      }
      const res = await fetch("/api/problems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      toast.success("Problem saved");
      setFeedback("");
      setSavedProblemMeta({
        id: data.id,
        avg_rating: data.avg_rating ?? null,
        rating_count: data.rating_count ?? 0,
      });
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen p-6 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Problem Generation</h1>
        <p className="text-muted-foreground text-sm">Generate and approve AP Calculus problems</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Control panel */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-sm font-medium block">Topic pool</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => fetchTopics(true)}
                  title="Clear cache and re-fetch topics"
                >
                  <RefreshCwIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Popover open={topicOpen} onOpenChange={setTopicOpen}>
                <PopoverTrigger className="flex h-8 w-full items-center justify-between rounded-lg border border-input bg-background px-2.5 text-sm font-normal outline-none hover:bg-muted/50">
                  {selectedTopicIds.length > 0
                    ? `${selectedTopicIds.length} topic${selectedTopicIds.length === 1 ? "" : "s"} selected`
                    : "Select topics"}
                  <ChevronDownIcon className="h-4 w-4 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder={topics.length > 0 ? "Search topics..." : "Loading topics from database..."}
                    />
                    <CommandList>
                      <CommandEmpty>No topic found.</CommandEmpty>
                      {topics.map((t) => {
                        const id = t.id ?? "";
                        const n = t.name ?? "";
                        const desc = t.description ?? "";
                        const label =
                          n && desc ? `${id}: ${n} (${desc})` : n ? `${id}: ${n}` : `${id}: ${desc}`;
                        const selected = selectedTopicIds.includes(id);
                        return (
                          <CommandItem
                            key={id}
                            value={label}
                            onMouseDown={(e) => e.preventDefault()}
                            onSelect={() => toggleTopicId(id)}
                          >
                            <span
                              className={cn(
                                "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                                selected ? "border-primary bg-primary text-primary-foreground" : "border-muted"
                              )}
                            >
                              {selected ? <CheckIcon className="h-3 w-3" /> : null}
                            </span>
                            {label}
                          </CommandItem>
                        );
                      })}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Question type</label>
              <div className="flex rounded-lg border border-input overflow-hidden">
                <button
                  type="button"
                  onClick={() => setQuestionType("multiple_choice")}
                  className={cn(
                    "flex-1 py-2 text-sm font-medium",
                    questionType === "multiple_choice"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 hover:bg-muted"
                  )}
                >
                  Multiple choice
                </button>
                <button
                  type="button"
                  onClick={() => setQuestionType("free_response")}
                  className={cn(
                    "flex-1 py-2 text-sm font-medium",
                    questionType === "free_response"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 hover:bg-muted"
                  )}
                >
                  Free response
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Difficulty (1–5)</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((d) => (
                  <Button
                    key={d}
                    type="button"
                    variant={difficulty === d ? "default" : "outline"}
                    size="icon"
                    onClick={() => setDifficulty(d)}
                  >
                    {d}
                  </Button>
                ))}
              </div>
            </div>

            <Button
              className="w-full"
              onClick={handleGenerate}
              disabled={generating || assessing || selectedTopicIds.length === 0}
            >
              {generating ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : assessing ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Assessing…
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Preview */}
        <div className="lg:col-span-2 space-y-6">
          {generated ? (
            <>
              <Card>
                <CardHeader className="border-b space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>Problem</CardTitle>
                    {assessing ? (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <Loader2Icon className="h-3 w-3 animate-spin" />
                        Assessing…
                      </Badge>
                    ) : generated.difficulty != null ? (
                      <Badge variant="outline">Difficulty {generated.difficulty}</Badge>
                    ) : null}
                  </div>
                  {emphasisTopicDisplay ? (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground/80">Emphasis topic</span>
                      {": "}
                      {emphasisTopicDisplay.label}
                      {emphasisTopicDisplay.id &&
                      emphasisTopicDisplay.label !== emphasisTopicDisplay.id ? (
                        <span className="text-muted-foreground/80">
                          {" "}
                          ({emphasisTopicDisplay.id})
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="pt-6 space-y-4 min-w-0 overflow-x-auto">
                  <div className="min-w-0 max-w-full [&_.katex-display]:overflow-x-auto">
                    <Preview
                      latexContent={generated.latex_content}
                      useProblemTypography={false}
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <button
                      type="button"
                      onClick={() => setShowRawJson((v) => !v)}
                      className="text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                      {showRawJson ? "Hide JSON" : "View JSON"}
                    </button>
                  </div>
                  {showRawJson && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">Problem JSON</p>
                        <Textarea
                          value={rawJsonDraft}
                          onChange={(e) => setRawJsonDraft(e.target.value)}
                          rows={14}
                          className="text-xs rounded-lg bg-muted/50 p-4 font-mono whitespace-pre-wrap break-words min-h-[280px]"
                          spellCheck={false}
                        />
                      </div>
                      {lastGenerationPrompts ? (
                        <div className="min-w-0 space-y-3">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1.5">System prompt</p>
                            <Textarea
                              readOnly
                              value={lastGenerationPrompts.system}
                              rows={8}
                              className="text-xs rounded-lg bg-muted/30 p-3 font-mono whitespace-pre-wrap break-words min-h-[200px]"
                              spellCheck={false}
                              aria-label="System prompt used for generation"
                            />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1.5">User prompt</p>
                            <Textarea
                              readOnly
                              value={lastGenerationPrompts.user}
                              rows={8}
                              className="text-xs rounded-lg bg-muted/30 p-3 font-mono whitespace-pre-wrap break-words min-h-[200px]"
                              spellCheck={false}
                              aria-label="User prompt used for generation"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Solution</CardTitle>
                </CardHeader>
                <CardContent className="min-w-0 overflow-x-auto">
                  <div className="min-w-0 max-w-full [&_.katex-display]:overflow-x-auto">
                    <Preview
                      latexContent={generated.solution_latex}
                      useProblemTypography={false}
                    />
                  </div>
                </CardContent>
              </Card>

              {questionType === "multiple_choice" && generated.choices && (
                <Card>
                  <CardHeader>
                    <CardTitle>Choices</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {generated.choices.map((choice, i) => (
                        <li
                          key={i}
                          className={cn(
                            "flex items-start gap-2 rounded-lg border p-3",
                            i === generated.correct_index
                              ? "border-primary bg-primary/5"
                              : "border-border"
                          )}
                        >
                          <span className="font-medium text-muted-foreground">
                            {String.fromCharCode(65 + i)}.
                          </span>
                          <div className="flex-1 min-w-0">
                            <Preview
                              latexContent={normalizeMcqChoiceLatex(choice)}
                              useProblemTypography={false}
                            />
                          </div>
                          {i === generated.correct_index && (
                            <Badge variant="default">Correct</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {(assessing || (generated.topic_weights && Object.keys(generated.topic_weights).length > 0)) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      Topic alignment
                      {assessing && <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Independently assessed emphasis (sparse — weights only for subtopics actively exercised).
                    </p>
                  </CardHeader>
                  {!assessing && generated.topic_weights && (
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-2 pr-3 font-medium">Topic</th>
                              <th className="py-2 font-medium">Weight</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.keys(generated.topic_weights)
                              .slice()
                              .sort()
                              .map((id) => {
                                const meta = topics.find((tp) => tp.id === id);
                                const modelVal = generated.topic_weights![id];
                                return (
                                  <tr key={id} className="border-b border-border/60 last:border-0">
                                    <td className="py-2 pr-3 align-top">
                                      <span className="font-mono text-xs block text-muted-foreground">
                                        {id}
                                      </span>
                                      <span className="text-foreground">
                                        {(meta?.description ?? "").slice(0, 72)}
                                        {(meta?.description?.length ?? 0) > 72 ? "…" : ""}
                                      </span>
                                    </td>
                                    <td className="py-2 tabular-nums">
                                      {typeof modelVal === "number" ? modelVal.toFixed(4) : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                          <tfoot>
                            <tr className="text-muted-foreground">
                              <td className="py-2 pr-3 font-medium">Sum</td>
                              <td className="py-2 tabular-nums">
                                {Object.values(generated.topic_weights)
                                  .reduce((a, b) => a + (typeof b === "number" ? b : 0), 0)
                                  .toFixed(4)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </CardContent>
                  )}
                </Card>
              )}

              {questionType === "free_response" && generated.rubric && (
                <Card>
                  <CardHeader>
                    <CardTitle>Rubric preview</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Point allocations for grading
                    </p>
                  </CardHeader>
                  <CardContent className="min-w-0 overflow-x-auto">
                    <div className="min-w-0 max-w-full [&_.katex-display]:overflow-x-auto">
                      <Preview
                        latexContent={generated.rubric}
                        useProblemTypography={false}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Review & commit</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Editor notes (for Tweak later)
                  </p>
                </CardHeader>
                <CardContent>
                  <Textarea
                    placeholder="Optional feedback or notes…"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    rows={3}
                    className="resize-none"
                  />
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleTweak}
                    disabled={tweaking || assessing || !feedback.trim()}
                  >
                    {tweaking ? (
                      <>
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                        Refining…
                      </>
                    ) : assessing ? (
                      <>
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                        Assessing…
                      </>
                    ) : (
                      "Tweak"
                    )}
                  </Button>
                  <Button
                    onClick={handleApproveSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      "Approve & Save"
                    )}
                  </Button>
                </CardFooter>
              </Card>

              {savedProblemMeta && (
                <Card>
                  <CardHeader>
                    <CardTitle>Rate this problem</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Community avg:{" "}
                      {savedProblemMeta.avg_rating != null
                        ? savedProblemMeta.avg_rating.toFixed(2)
                        : "—"}{" "}
                      · {savedProblemMeta.rating_count} rating(s). Used later for recommendations.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Button
                          key={n}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={ratingBusy || !raterId}
                          onClick={() => void submitRating(n)}
                        >
                          {n} star{n === 1 ? "" : "s"}
                        </Button>
                      ))}
                    </div>
                    <Textarea
                      placeholder="Optional note (what worked or didn’t)…"
                      value={ratingNotes}
                      onChange={(e) => setRatingNotes(e.target.value)}
                      rows={2}
                      className="resize-none text-sm"
                    />
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                Select one or more topics and click Generate to create a problem.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
