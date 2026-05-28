"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Preview } from "@/components/Preview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalizeMcqChoiceLatex } from "@/lib/mcqChoiceLatex";
import { Loader2Icon, CopyIcon, CheckIcon } from "lucide-react";
import { toast } from "sonner";

interface Problem {
  id: string;
  latex_content: string;
  solution_latex: string;
  difficulty: number | null;
  estimated_difficulty: number | null;
  keyword_weights: Record<string, number> | null;
  choices: string[] | null;
  correct_index: number | null;
  rubric: string | null;
  type: string | null;
  status: string | null;
  avg_rating: number | null;
  rating_count: number | null;
  attempt_count: number | null;
  success_count: number | null;
  generation_meta: Record<string, unknown> | null;
  [key: string]: unknown;
}

type Source = "problems" | "rag_examples";

export default function LookupPage() {
  const [inputId, setInputId] = useState("");
  const [source, setSource] = useState<Source>("problems");
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const lookup = useCallback(async (id: string, src: Source) => {
    const trimmed = id.trim();
    if (!trimmed) {
      toast.error("Enter an ID");
      return;
    }
    setLoading(true);
    setProblem(null);
    try {
      const url =
        src === "rag_examples"
          ? `/api/rag-examples/${encodeURIComponent(trimmed)}`
          : `/api/problems/${encodeURIComponent(trimmed)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? `Error ${res.status}`);
        return;
      }
      setProblem(data as Problem);
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      lookup(inputId, source);
    },
    [inputId, source, lookup]
  );

  const handleCopy = useCallback(() => {
    if (!problem) return;
    navigator.clipboard.writeText(JSON.stringify(problem, null, 2)).then(() => {
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  }, [problem]);

  const isMcq = Boolean(problem?.choices && (problem.choices as string[]).length > 0);
  const showRubric = Boolean(problem?.rubric?.trim());

  return (
    <div className="min-h-screen p-6 flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Problem Lookup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter a Supabase problem ID to view the rendered problem and full JSON.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Home
          </Link>
          <Link href="/generate" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Generate
          </Link>
        </div>
      </header>

      <div className="space-y-2 max-w-xl">
        {/* Source toggle */}
        <div className="flex gap-1 p-1 bg-muted rounded-md w-fit">
          {(["problems", "rag_examples"] as Source[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setSource(s); setProblem(null); }}
              className={cn(
                "px-3 py-1 rounded text-sm font-medium transition-colors",
                source === s
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s === "problems" ? "Problems" : "RAG Examples"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            placeholder="e.g. 3f7a2b1c-…"
            className="font-mono text-sm"
            aria-label="ID"
            disabled={loading}
          />
          <Button type="submit" disabled={loading || !inputId.trim()}>
            {loading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : "Look up"}
          </Button>
        </form>
      </div>

      {problem ? (
        <div className="space-y-6 max-w-4xl">
          {/* Meta badges */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="font-mono text-xs text-muted-foreground">{problem.id}</span>
            {source === "rag_examples" ? (
              <Badge variant="secondary">RAG Example</Badge>
            ) : null}
            {problem.status ? (
              <Badge variant={problem.status === "approved" ? "default" : "secondary"}>
                {problem.status}
              </Badge>
            ) : null}
            {isMcq ? <Badge variant="outline">MCQ</Badge> : null}
            {showRubric && !isMcq ? <Badge variant="outline">FRQ</Badge> : null}
            {problem.difficulty != null ? (
              <Badge variant="outline">Difficulty {problem.difficulty}</Badge>
            ) : null}
            {problem.estimated_difficulty != null ? (
              <Badge variant="outline">
                Est. difficulty {Number(problem.estimated_difficulty).toFixed(2)}
              </Badge>
            ) : null}
            {problem.avg_rating != null ? (
              <Badge variant="outline">
                ★ {Number(problem.avg_rating).toFixed(2)} ({problem.rating_count ?? 0})
              </Badge>
            ) : null}
            {problem.attempt_count != null ? (
              <Badge variant="outline">
                {problem.success_count ?? 0}/{problem.attempt_count} correct
              </Badge>
            ) : null}
            {typeof problem.topic_id === "string" && problem.topic_id ? (
              <Badge variant="outline">Topic {problem.topic_id}</Badge>
            ) : null}
            {typeof problem.notes === "string" && problem.notes ? (
              <span className="text-xs text-muted-foreground italic">{problem.notes}</span>
            ) : null}
          </div>

          {/* Problem stem */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Problem</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 min-w-0">
              <div className="ap-calc-preview">
                <Preview latexContent={problem.latex_content} />
              </div>
            </CardContent>
          </Card>

          {/* Solution */}
          <Card>
            <CardHeader>
              <CardTitle>Solution</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 min-w-0">
              <div className="ap-calc-preview">
                <Preview latexContent={problem.solution_latex} />
              </div>
            </CardContent>
          </Card>

          {/* MCQ choices */}
          {isMcq && problem.choices ? (
            <Card>
              <CardHeader>
                <CardTitle>Choices</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <ul className="space-y-3 list-none p-0 m-0">
                  {(problem.choices as string[]).map((choice, i) => (
                    <li key={i} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                      <span className="font-medium text-muted-foreground shrink-0 sm:pt-1">
                        {String.fromCharCode(65 + i)}.
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div
                          className={cn(
                            "ap-calc-preview rounded-md px-3 py-1",
                            i === problem.correct_index
                              ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                              : ""
                          )}
                        >
                          <Preview latexContent={normalizeMcqChoiceLatex(choice)} />
                        </div>
                        {i === problem.correct_index ? (
                          <Badge variant="default" className="w-fit">Correct</Badge>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* Rubric */}
          {showRubric ? (
            <Card>
              <CardHeader>
                <CardTitle>Rubric</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 min-w-0">
                <div className="ap-calc-preview">
                  <Preview latexContent={problem.rubric!} />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Full JSON */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b">
              <CardTitle>Full JSON</CardTitle>
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                {copied ? (
                  <CheckIcon className="h-4 w-4 mr-1" />
                ) : (
                  <CopyIcon className="h-4 w-4 mr-1" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </CardHeader>
            <CardContent className="pt-4">
              <pre className="text-xs font-mono bg-muted rounded-md p-4 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(problem, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
