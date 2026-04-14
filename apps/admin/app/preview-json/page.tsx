"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KatexPlaygroundPreview } from "@/components/KatexPlaygroundPreview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { normalizeMcqChoiceLatex } from "@/lib/mcqChoiceLatex";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Topic {
  id: string;
  name: string;
  description: string;
}

/** Same shape as generator output / save payload (extra API fields tolerated). */
interface ProblemJson {
  latex_content: string;
  solution_latex: string;
  difficulty: number;
  topic_weights: Record<string, number>;
  choices?: string[];
  correct_index?: number;
  rubric?: string;
}

const PLACEHOLDER = `{
  "latex_content": "\\\\text{Example stem. } x^2",
  "solution_latex": "\\\\text{Example solution.}",
  "difficulty": 3,
  "topic_weights": { "2_5": 1 },
  "choices": ["$\\\\text{A}$", "$\\\\text{B}$", "$\\\\text{C}$", "$\\\\text{D}$"],
  "correct_index": 0
}`;

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
  if (!o.topic_weights || typeof o.topic_weights !== "object" || Array.isArray(o.topic_weights)) {
    return { ok: false, message: "Missing or invalid topic_weights (object required)." };
  }
  const tw = o.topic_weights as Record<string, unknown>;
  for (const [k, v] of Object.entries(tw)) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, message: `topic_weights["${k}"] must be a finite number.` };
    }
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

export default function PreviewJsonPage() {
  const [jsonText, setJsonText] = useState("");
  const [problem, setProblem] = useState<ProblemJson | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/topics");
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        setTopics(
          data.map(
            (d: Record<string, unknown>) =>
              ({
                id: String(d.id ?? ""),
                name: String(d.name ?? ""),
                description: String(d.description ?? ""),
              }) as Topic
          )
        );
      } catch {
        /* optional */
      }
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
    if (!t) {
      setProblem(null);
      setParseError("Paste JSON or load a file first.");
      toast.error("No JSON to parse");
      return;
    }
    try {
      applyParsed(JSON.parse(t));
    } catch {
      setProblem(null);
      const msg = "Invalid JSON (could not parse).";
      setParseError(msg);
      toast.error(msg);
    }
  }, [jsonText, applyParsed]);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        setJsonText(text);
        try {
          applyParsed(JSON.parse(text));
        } catch {
          setProblem(null);
          setParseError("File is not valid JSON.");
          toast.error("File is not valid JSON");
        }
      };
      reader.readAsText(file, "UTF-8");
    },
    [applyParsed]
  );

  const isMcq = Boolean(problem?.choices && problem.choices.length > 0);
  const showRubric = Boolean(problem?.rubric?.trim());

  return (
    <div className="min-h-screen p-6 flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Preview from JSON</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Paste or load a problem object in the same format as the generator ({" "}
            <code className="rounded bg-muted px-1">latex_content</code>,{" "}
            <code className="rounded bg-muted px-1">solution_latex</code>,{" "}
            <code className="rounded bg-muted px-1">difficulty</code>,{" "}
            <code className="rounded bg-muted px-1">topic_weights</code>
            ; optional <code className="rounded bg-muted px-1">choices</code> /{" "}
            <code className="rounded bg-muted px-1">correct_index</code> or{" "}
            <code className="rounded bg-muted px-1">rubric</code>).{" "}
            <code className="rounded bg-muted px-1">generation_prompts</code> is ignored if present.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/generate" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Generate
          </Link>
          <Link
            href="/preview-katex"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            KaTeX playground
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Card>
          <CardHeader>
            <CardTitle>JSON input</CardTitle>
          </CardHeader>
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
              <Button type="button" onClick={handleRender}>
                Render problem
              </Button>
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
                Load .json file
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setJsonText("");
                  setProblem(null);
                  setParseError(null);
                }}
              >
                Clear
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleFile}
              />
            </div>
            {parseError ? (
              <p className="text-sm text-destructive" role="alert">
                {parseError}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="text-sm text-muted-foreground lg:pt-4 space-y-2">
          <p>
            Each math block uses{" "}
            <Link href="/preview-katex" className="text-primary underline underline-offset-2">
              preview-katex
            </Link>{" "}
            output styling:{" "}
            <code className="rounded bg-muted px-1">KatexPlaygroundPreview</code> (default KaTeX fonts, same bordered
            container as the playground &quot;Rendered output&quot; pane).
          </p>
        </div>
      </div>

      {problem ? (
        <div className="space-y-6 max-w-4xl">
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle>Problem</CardTitle>
                <Badge variant="outline">Difficulty {problem.difficulty}</Badge>
                {isMcq ? <Badge variant="secondary">Multiple choice</Badge> : null}
                {showRubric && !isMcq ? <Badge variant="secondary">Free response</Badge> : null}
              </div>
            </CardHeader>
            <CardContent className="pt-4 min-w-0">
              <KatexPlaygroundPreview latexContent={problem.latex_content} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Solution</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 min-w-0">
              <KatexPlaygroundPreview latexContent={problem.solution_latex} />
            </CardContent>
          </Card>

          {isMcq && problem.choices ? (
            <Card>
              <CardHeader>
                <CardTitle>Choices</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <ul className="space-y-3 list-none p-0 m-0">
                  {problem.choices.map((choice, i) => (
                    <li key={i} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                      <span className="font-medium text-muted-foreground shrink-0 sm:pt-3">
                        {String.fromCharCode(65 + i)}.
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <KatexPlaygroundPreview
                          latexContent={normalizeMcqChoiceLatex(choice)}
                          className={
                            i === problem.correct_index
                              ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                              : undefined
                          }
                        />
                        {i === problem.correct_index ? (
                          <Badge variant="default" className="w-fit">
                            Correct
                          </Badge>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {problem.topic_weights && Object.keys(problem.topic_weights).length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Topic weights</CardTitle>
              </CardHeader>
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
                      {Object.keys(problem.topic_weights)
                        .slice()
                        .sort()
                        .map((id) => {
                          const meta = topics.find((tp) => tp.id === id);
                          const w = problem.topic_weights[id];
                          const label =
                            meta?.name && meta?.description
                              ? `${meta.name} (${meta.description})`
                              : meta?.name || meta?.description || "";
                          const maxLen = 120;
                          const truncated = label.length > maxLen;
                          return (
                            <tr key={id} className="border-b border-border/60 last:border-0">
                              <td className="py-2 pr-3 align-top">
                                <span className="font-mono text-xs block text-muted-foreground">
                                  {id}
                                </span>
                                <span className="text-foreground">
                                  {label.slice(0, maxLen)}
                                  {truncated ? "…" : ""}
                                </span>
                              </td>
                              <td className="py-2 tabular-nums">{w.toFixed(4)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {showRubric ? (
            <Card>
              <CardHeader>
                <CardTitle>Rubric</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 min-w-0">
                <KatexPlaygroundPreview latexContent={problem.rubric!} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
