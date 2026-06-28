"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Preview } from "@/components/Preview";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Course = "ap_calc" | "precalc";

interface ProblemJson {
  latex_content: string;
  solution_latex: string;
  difficulty?: number;
  problem_description?: string;
  choices?: string[];
  correct_index?: number;
  wrong_answer_data?: Array<{ index: number; description: string } | { description: string | null; keyword_weights?: Record<string, number> }>;
  topic_description?: string;
  keyword_weights?: Record<string, number>;
  action_description?: string;
  action_weights?: Record<string, number>;
  representation_description?: string;
  representation_weights?: Record<string, number>;
  prerequisite_description?: string;
  prerequisite_weights?: Record<string, number>;
  notes?: string;
  course?: string;
}

type InsertState = "idle" | "inserting" | "done" | "error";

const PLACEHOLDER = `{
  "problem_description": "Tests whether a student can find intervals where a particle moves in the negative direction by analyzing the sign of the velocity function.",
  "latex_content": "A particle moves along the x-axis. Its position at time $t$ is $x(t) = t^3 - 6t^2 + 9t + 2$. At what time $t$ in the interval $[0, 5]$ is the particle moving in the negative direction?",
  "choices": [
    "$0 < t < 1$",
    "$1 < t < 3$",
    "$3 < t < 5$",
    "$t > 3$"
  ],
  "correct_index": 1,
  "wrong_answer_data": [
    { "index": 0, "description": "Found where position x(t) < 0 instead of where velocity v(t) < 0." },
    { "index": 2, "description": "Found where v(t) > 0 — confused positive and negative direction." },
    { "index": 3, "description": "Only found the critical point t = 3 and missed t = 1 due to a factoring error." }
  ],
  "solution_latex": "Find velocity: $v(t) = x'(t) = 3t^2 - 12t + 9 = 3(t-1)(t-3)$.\\n\\nThe particle moves in the negative direction when $v(t) < 0$, which occurs between the roots: $1 < t < 3$.",
  "difficulty": 2,
  "topic_description": "Tests differentiating a polynomial position function to find velocity, then analyzing the sign of velocity over an interval to determine direction of motion.",
  "action_description": "Students must differentiate, then analyze sign behavior of the resulting polynomial over a closed interval.",
  "representation_description": "The position function is given as an algebraic equation in explicit function notation.",
  "prerequisite_description": "Requires polynomial differentiation (power rule) and finding zeros of a quadratic by factoring."
}`;

function parseProblems(raw: string): { data: ProblemJson[]; error: null } | { data: null; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { data: null, error: "Empty input" };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const problems = items as ProblemJson[];
    for (const p of problems) {
      if (!p.latex_content?.trim()) return { data: null, error: "A problem is missing latex_content" };
      if (!p.solution_latex?.trim()) return { data: null, error: "A problem is missing solution_latex" };
    }
    return { data: problems, error: null };
  } catch {
    try {
      const wrapped = JSON.parse(`[${trimmed}]`) as ProblemJson[];
      if (!Array.isArray(wrapped) || wrapped.length === 0) return { data: null, error: "No problems found" };
      for (const p of wrapped) {
        if (!p.latex_content?.trim()) return { data: null, error: "A problem is missing latex_content" };
        if (!p.solution_latex?.trim()) return { data: null, error: "A problem is missing solution_latex" };
      }
      return { data: wrapped, error: null };
    } catch (e2) {
      return { data: null, error: (e2 as Error).message };
    }
  }
}

async function insertProblem(p: ProblemJson, course: Course): Promise<string> {
  const res = await fetch("/api/rag-examples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...p, course }),
  });
  const json = (await res.json()) as { id?: string; error?: string };
  if (!res.ok || !json.id) throw new Error(json.error ?? "Insert failed");
  return json.id;
}

function ProblemPreview({
  problem,
  course,
  insertState,
  insertedId,
  onInsert,
}: {
  problem: ProblemJson;
  course: Course;
  insertState: InsertState;
  insertedId: string | null;
  onInsert: () => void;
}) {
  const isMcq = Array.isArray(problem.choices) && problem.choices.length > 0;

  return (
    <div className="space-y-5">
      {/* Insert row */}
      <div className="flex items-center gap-3 pb-3 border-b">
        <Button
          size="sm"
          onClick={onInsert}
          disabled={insertState === "inserting" || insertState === "done"}
          variant={insertState === "done" ? "outline" : "default"}
          className={insertState === "done" ? "text-green-600 border-green-300" : ""}
        >
          {insertState === "inserting" ? "Inserting…" : insertState === "done" ? "✓ Inserted" : "Insert this problem"}
        </Button>
        {insertedId && (
          <Link href={`/preview-json?id=${insertedId}`} className="text-xs text-blue-600 hover:underline">
            View →
          </Link>
        )}
        {insertState === "error" && <span className="text-xs text-destructive">Insert failed</span>}
        <span className={cn(
          "ml-auto text-xs font-semibold px-2 py-0.5 rounded-full",
          course === "precalc"
            ? "bg-purple-100 text-purple-700 border border-purple-200"
            : "bg-blue-100 text-blue-700 border border-blue-200"
        )}>
          {course === "precalc" ? "Precalc" : "AP Calc"}
        </span>
      </div>

      {/* Problem stem */}
      <Preview latexContent={problem.latex_content} />

      {/* Choices */}
      {isMcq && problem.choices && (
        <ol className="space-y-2 list-none pl-0">
          {problem.choices.map((choice, i) => {
            const isCorrect = i === problem.correct_index;
            const wrongDesc = problem.wrong_answer_data?.find(
              (w) => "index" in w && (w as { index: number }).index === i
            )?.description;
            return (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-2 rounded px-3 py-2 text-sm",
                  isCorrect ? "bg-green-50 border border-green-300" : "bg-muted/40 border border-border"
                )}
              >
                <span className="font-medium text-muted-foreground w-5 shrink-0 pt-0.5">
                  {String.fromCharCode(65 + i)}.
                </span>
                <div className="flex-1 min-w-0 space-y-1">
                  <Preview latexContent={choice} />
                  {!isCorrect && wrongDesc && (
                    <p className="text-xs text-muted-foreground italic">{wrongDesc}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Solution */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Solution</p>
        <div className="border-l-2 border-muted pl-3">
          <Preview latexContent={problem.solution_latex} />
        </div>
      </div>

      {/* Metadata */}
      <div className="text-xs text-muted-foreground space-y-1 border-t pt-4">
        {problem.difficulty && <p>Difficulty: {problem.difficulty}</p>}
        {problem.problem_description && <p>Description: {problem.problem_description}</p>}
      </div>

      {/* Keyword descriptions */}
      {(problem.topic_description || problem.action_description || problem.representation_description || problem.prerequisite_description) && (
        <div className="border-t pt-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Keyword Descriptions</p>
          {[
            { label: "Topic", value: problem.topic_description, color: "bg-blue-50 border-blue-200" },
            { label: "Action", value: problem.action_description, color: "bg-green-50 border-green-200" },
            { label: "Representation", value: problem.representation_description, color: "bg-orange-50 border-orange-200" },
            { label: "Prerequisite", value: problem.prerequisite_description, color: "bg-purple-50 border-purple-200" },
          ].filter(d => d.value).map(({ label, value, color }) => (
            <div key={label} className={cn("rounded border px-3 py-2 text-xs", color)}>
              <span className="font-semibold">{label}:</span> {value}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InputPage() {
  const [raw, setRaw] = useState("");
  const [course, setCourse] = useState<Course>("ap_calc");
  const [activeTab, setActiveTab] = useState(0);
  const [insertStates, setInsertStates] = useState<InsertState[]>([]);
  const [insertedIds, setInsertedIds] = useState<(string | null)[]>([]);
  const [insertingAll, setInsertingAll] = useState(false);

  const parsed = raw.trim() ? parseProblems(raw) : null;
  const problems = parsed?.data ?? null;
  const parseError = parsed?.error ?? null;
  const isBulk = (problems?.length ?? 0) > 1;

  // Reset per-problem state when problems change
  const handleRawChange = (value: string) => {
    setRaw(value);
    setActiveTab(0);
    setInsertStates([]);
    setInsertedIds([]);
  };

  const setStateForIdx = (idx: number, state: InsertState) =>
    setInsertStates(prev => { const next = [...prev]; next[idx] = state; return next; });

  const setIdForIdx = (idx: number, id: string | null) =>
    setInsertedIds(prev => { const next = [...prev]; next[idx] = id; return next; });

  const handleInsertOne = useCallback(async (idx: number) => {
    if (!problems) return;
    const p = problems[idx]!;
    setStateForIdx(idx, "inserting");
    try {
      const id = await insertProblem(p, course);
      setStateForIdx(idx, "done");
      setIdForIdx(idx, id);
      toast.success(`Problem ${idx + 1} inserted — id: ${id}`);
    } catch (e) {
      setStateForIdx(idx, "error");
      toast.error(`Problem ${idx + 1}: ${(e as Error).message}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problems, course]);

  const handleInsertAll = useCallback(async () => {
    if (!problems) return;
    setInsertingAll(true);
    let successCount = 0;
    for (let i = 0; i < problems.length; i++) {
      if (insertStates[i] === "done") continue; // skip already inserted
      setStateForIdx(i, "inserting");
      try {
        const id = await insertProblem(problems[i]!, course);
        setStateForIdx(i, "done");
        setIdForIdx(i, id);
        successCount++;
      } catch (e) {
        setStateForIdx(i, "error");
        toast.error(`Problem ${i + 1}: ${(e as Error).message}`);
      }
    }
    setInsertingAll(false);
    if (successCount > 0) {
      const label = course === "precalc" ? "Precalc" : "AP Calc";
      toast.success(`Inserted ${successCount} problem${successCount > 1 ? "s" : ""} as ${label}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problems, course, insertStates]);

  const allDone = problems ? problems.every((_, i) => insertStates[i] === "done") : false;
  const anyInserting = insertStates.some(s => s === "inserting") || insertingAll;

  return (
    <main className="min-h-screen p-6">
      <div className="mb-4 flex items-center gap-4">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Admin</Link>
        <h1 className="text-xl font-bold">Problem Input</h1>
      </div>

      <div className="grid grid-cols-2 gap-6 h-[calc(100vh-100px)]">
        {/* Left: JSON input */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Paste problem JSON</span>
            {raw.trim() && (
              <span className={cn("text-xs", parseError ? "text-destructive" : "text-green-600")}>
                {parseError ? `Parse error: ${parseError}` : isBulk ? `${problems!.length} problems` : "Valid JSON"}
              </span>
            )}
          </div>
          <Textarea
            className="flex-1 font-mono text-xs resize-none min-h-0"
            placeholder={PLACEHOLDER}
            value={raw}
            onChange={(e) => handleRawChange(e.target.value)}
            spellCheck={false}
          />

          {/* Course toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Course:</span>
            <div className="flex rounded-md border overflow-hidden text-sm">
              {(["ap_calc", "precalc"] as Course[]).map((c, i) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCourse(c)}
                  className={cn(
                    "px-3 py-1.5 font-medium transition-colors",
                    i > 0 && "border-l",
                    course === c ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  {c === "ap_calc" ? "AP Calc" : "Precalc"}
                </button>
              ))}
            </div>
          </div>

          {/* Insert All (only shown for bulk) */}
          {isBulk && (
            <div className="flex items-center gap-3">
              <Button onClick={handleInsertAll} disabled={!problems || anyInserting || allDone}>
                {insertingAll ? "Inserting…" : allDone ? "✓ All inserted" : `Insert all ${problems!.length} problems`}
              </Button>
              <Button variant="outline" onClick={() => handleRawChange("")}>Clear</Button>
              <span className="text-xs text-muted-foreground ml-auto">
                {insertStates.filter(s => s === "done").length}/{problems!.length} inserted
              </span>
            </div>
          )}

          {/* Single problem buttons */}
          {!isBulk && problems && (
            <div className="flex items-center gap-3">
              <Button onClick={() => handleInsertOne(0)} disabled={anyInserting || insertStates[0] === "done"}>
                {insertStates[0] === "inserting" ? "Inserting…" : insertStates[0] === "done" ? "✓ Inserted" : "Insert into DB"}
              </Button>
              <Button variant="outline" onClick={() => handleRawChange("")}>Clear</Button>
              {insertedIds[0] && (
                <Link href={`/preview-json?id=${insertedIds[0]}`} className="text-sm text-blue-600 hover:underline ml-auto">
                  View in Preview JSON →
                </Link>
              )}
            </div>
          )}

          {insertedIds.some(Boolean) && (
            <p className="text-xs text-muted-foreground">
              Embedding + keyword tags will populate in ~10s per problem.
            </p>
          )}
        </div>

        {/* Right: preview with tabs for multi-problem */}
        <div className="flex flex-col min-h-0 border rounded-lg bg-background overflow-hidden">
          {!problems ? (
            <div className="p-5">
              <p className="text-sm text-muted-foreground">Preview will appear here once JSON is valid.</p>
            </div>
          ) : (
            <>
              {/* Tab bar */}
              {isBulk && (
                <div className="flex border-b shrink-0">
                  {problems.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveTab(i)}
                      className={cn(
                        "px-4 py-2 text-sm font-medium transition-colors border-r last:border-r-0 flex items-center gap-1.5",
                        activeTab === i
                          ? "bg-background text-foreground border-b-2 border-b-primary -mb-px"
                          : "bg-muted/40 text-muted-foreground hover:bg-muted"
                      )}
                    >
                      Problem {i + 1}
                      {insertStates[i] === "done" && <span className="text-green-600 text-xs">✓</span>}
                      {insertStates[i] === "error" && <span className="text-destructive text-xs">✗</span>}
                    </button>
                  ))}
                </div>
              )}

              {/* Problem content */}
              <div className="flex-1 overflow-y-auto p-5">
                <ProblemPreview
                  problem={problems[activeTab]!}
                  course={course}
                  insertState={insertStates[activeTab] ?? "idle"}
                  insertedId={insertedIds[activeTab] ?? null}
                  onInsert={() => handleInsertOne(activeTab)}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
