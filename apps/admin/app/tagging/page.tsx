"use client";

import { useState } from "react";
import { Loader2Icon, ChevronDownIcon, ChevronUpIcon, CopyIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProblemInput, TaggingResult } from "@/app/api/tagging/route";

// ─── Seeded example ───────────────────────────────────────────────────────────

const EXAMPLE: ProblemInput = {
  question: "Simplify completely: (2x³y⁻²)² ÷ (4x²)",
  solution: "Apply power of a product: (2x³y⁻²)² = 2²·(x³)²·(y⁻²)² = 4x⁶y⁻⁴.\nDivide: 4x⁶y⁻⁴ / (4x²) = x⁶⁻²·y⁻⁴ = x⁴y⁻⁴.\nRewrite negative exponent: x⁴y⁻⁴ = x⁴/y⁴.",
  problem_description: "Multi-rule exponent simplification requiring power of a product, power of a power, negative exponent rewriting, and quotient rule for exponents. All operations in one expression.",
  answer_choices: [
    { id: "A", text: "x⁴/y⁴", is_correct: true, wrong_answer_description: "" },
    { id: "B", text: "x⁴y⁴", is_correct: false, wrong_answer_description: "Applied the power of a product and power of a power rules correctly but then treated the negative exponent y⁻⁴ as positive, keeping y⁴ in the numerator instead of moving it to the denominator." },
    { id: "C", text: "x⁸/y⁴", is_correct: false, wrong_answer_description: "Added exponents when squaring instead of multiplying them: computed x^(3+3)=x⁶ correctly but then added the denominator exponent 2 instead of subtracting, getting x⁸ rather than x⁴." },
    { id: "D", text: "x/y⁴", is_correct: false, wrong_answer_description: "Made an arithmetic error in the quotient rule step: divided the x exponent by 2 instead of subtracting, computing 6÷2=3 then 3−2=1, rather than the correct 6−2=4." },
  ],
};

// ─── Mini components ──────────────────────────────────────────────────────────

function WeightBar({ weight }: { weight: number }) {
  const color = weight >= 0.75 ? "bg-green-500" : weight >= 0.5 ? "bg-blue-500" : "bg-yellow-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${weight * 100}%` }} />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-gray-500">{weight.toFixed(2)}</span>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 0.6 ? "bg-green-400" : score >= 0.45 ? "bg-blue-400" : "bg-gray-300";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${score * 100}%` }} />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-gray-400">{score.toFixed(4)}</span>
    </div>
  );
}

const TAG_COLORS: Record<string, string> = {
  action_tags: "bg-violet-100 text-violet-700",
  representation_tags: "bg-sky-100 text-sky-700",
  problem_style_tags: "bg-orange-100 text-orange-700",
};

function Collapsible({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
      >
        {title}
        {open ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  );
}

function CandidateTable({ candidates, label }: { candidates: { id: string; label: string; description: string; score: number }[]; label: string }) {
  if (candidates.length === 0) return <p className="text-xs text-gray-400">No candidates</p>;
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label} ({candidates.length})</p>
      <div className="space-y-0.5">
        {candidates.map((c) => (
          <div key={c.id} className="flex items-start gap-2 py-1 border-b border-gray-50 last:border-0">
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-gray-700">{c.label}</span>
              <span className="text-[10px] text-gray-400 ml-1.5 font-mono">{c.id}</span>
              <p className="text-[10px] text-gray-400 leading-snug truncate">{c.description}</p>
            </div>
            <div className="flex-shrink-0 pt-0.5">
              <ScoreBar score={c.score} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeightedLabelList({ items, category }: { items: { id: string; label: string; weight: number }[]; category?: "categories" | "keywords" | "tags" }) {
  if (items.length === 0) return <p className="text-xs text-gray-400 italic">None selected</p>;
  return (
    <div className="space-y-1.5">
      {items.sort((a, b) => b.weight - a.weight).map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-800 flex-1 min-w-0 truncate">{item.label}</span>
          <span className="text-[10px] font-mono text-gray-400 hidden xl:block">{item.id}</span>
          <WeightBar weight={item.weight} />
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type FormChoice = { id: string; text: string; is_correct: boolean; wrong_answer_description: string };

const DEFAULT_CHOICES: FormChoice[] = [
  { id: "A", text: "", is_correct: true,  wrong_answer_description: "" },
  { id: "B", text: "", is_correct: false, wrong_answer_description: "" },
  { id: "C", text: "", is_correct: false, wrong_answer_description: "" },
  { id: "D", text: "", is_correct: false, wrong_answer_description: "" },
];

export default function TaggingPage() {
  const [question, setQuestion] = useState("");
  const [solution, setSolution] = useState("");
  const [description, setDescription] = useState("");
  const [choices, setChoices] = useState<FormChoice[]>(DEFAULT_CHOICES);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TaggingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function loadExample() {
    setQuestion(EXAMPLE.question);
    setSolution(EXAMPLE.solution);
    setDescription(EXAMPLE.problem_description);
    setChoices(EXAMPLE.answer_choices.map((c) => ({
      id: c.id,
      text: c.text,
      is_correct: c.is_correct,
      wrong_answer_description: c.wrong_answer_description ?? "",
    })));
    setResult(null);
    setError(null);
  }

  function setCorrect(id: string) {
    setChoices((prev) => prev.map((c) => ({ ...c, is_correct: c.id === id })));
  }

  function updateChoice(id: string, field: keyof FormChoice, value: string | boolean) {
    setChoices((prev) => prev.map((c) => c.id === id ? { ...c, [field]: value } : c));
  }

  async function run() {
    if (!question.trim() || !solution.trim()) { setError("Question and solution are required"); return; }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const payload: ProblemInput = {
        question: question.trim(),
        solution: solution.trim(),
        problem_description: description.trim(),
        answer_choices: choices.map((c) => ({
          id: c.id,
          text: c.text.trim(),
          is_correct: c.is_correct,
          wrong_answer_description: c.wrong_answer_description.trim() || undefined,
        })),
      };
      const res = await fetch("/api/tagging", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json() as TaggingResult & { error?: string };
      if (!res.ok) { setError(data.error ?? "Request failed"); return; }
      setResult(data);
    } catch {
      setError("Request failed");
    } finally {
      setRunning(false);
    }
  }

  function exportJson() {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const wrongChoices = choices.filter((c) => !c.is_correct && c.text.trim());

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Left: Form ── */}
      <div className="w-[42%] flex-shrink-0 border-r border-gray-200 flex flex-col bg-white overflow-y-auto">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Supervised Tagging</h1>
            <p className="text-[10px] text-gray-400 mt-0.5">Retrieval → LLM rerank (candidates only)</p>
          </div>
          <Button size="sm" variant="outline" onClick={loadExample} className="text-xs h-7">
            Load example
          </Button>
        </div>

        <div className="p-5 space-y-4 flex-1">
          {/* Problem fields */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Question *</label>
            <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} className="text-sm resize-none" placeholder="The question stem…" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Solution *</label>
            <Textarea value={solution} onChange={(e) => setSolution(e.target.value)} rows={4} className="text-sm resize-none" placeholder="Full worked solution…" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Problem description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-sm resize-none" placeholder="One sentence describing what skills this problem tests…" />
          </div>

          {/* Answer choices */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-600">Answer choices</label>
            <div className="text-[10px] text-gray-400 bg-amber-50 border border-amber-100 rounded px-2.5 py-1.5">
              For wrong answers, the <strong>mistake description</strong> is the primary retrieval text — describe the specific error or misconception.
            </div>
            {choices.map((choice) => (
              <div key={choice.id} className={cn("rounded-xl border p-3 space-y-2 transition-colors", choice.is_correct ? "border-green-300 bg-green-50" : "border-gray-200 bg-white")}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 w-4 flex-shrink-0">{choice.id}</span>
                  <Input
                    value={choice.text}
                    onChange={(e) => updateChoice(choice.id, "text", e.target.value)}
                    className="flex-1 h-7 text-xs"
                    placeholder={`Choice ${choice.id}…`}
                  />
                  <button
                    onClick={() => setCorrect(choice.id)}
                    className={cn("text-[10px] px-2 py-1 rounded border transition-colors flex-shrink-0",
                      choice.is_correct
                        ? "bg-green-500 border-green-500 text-white font-medium"
                        : "border-gray-200 text-gray-400 hover:border-green-400 hover:text-green-600"
                    )}
                  >
                    {choice.is_correct ? "✓ Correct" : "Wrong"}
                  </button>
                </div>
                {!choice.is_correct && (
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-400">Mistake description (primary retrieval text)</label>
                    <Textarea
                      value={choice.wrong_answer_description}
                      onChange={(e) => updateChoice(choice.id, "wrong_answer_description", e.target.value)}
                      rows={2}
                      className="text-xs resize-none"
                      placeholder="Describe the specific error or misconception a student makes when choosing this answer…"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Run button */}
        <div className="p-4 border-t border-gray-100">
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          <Button onClick={run} disabled={running} className="w-full">
            {running ? <><Loader2Icon className="h-4 w-4 animate-spin mr-2" />Running pipeline…</> : "Run tagging"}
          </Button>
          <p className="text-[10px] text-gray-400 mt-1.5 text-center">
            {running ? "Embedding → retrieval → LLM rerank" : `${wrongChoices.length} wrong answer${wrongChoices.length !== 1 ? "s" : ""} will be tagged separately`}
          </p>
        </div>
      </div>

      {/* ── Right: Results ── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {!result && !running && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 space-y-2">
            <p className="text-sm">Results appear here after running the pipeline.</p>
            <p className="text-xs">Click "Load example" then "Run tagging" to try it immediately.</p>
          </div>
        )}

        {running && (
          <div className="flex items-center justify-center h-40 gap-3 text-gray-400">
            <Loader2Icon className="h-5 w-5 animate-spin" />
            <span className="text-sm">Embedding → retrieving candidates → LLM reranking…</span>
          </div>
        )}

        {result && (
          <>
            {/* ── Section 1: Problem-level labels ── */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Problem-Level Labels</h2>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">LLM constrained to retrieved candidates</span>
                  <Button size="sm" variant="outline" onClick={exportJson} className="h-6 text-[10px] gap-1">
                    {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
                    {copied ? "Copied" : "Export JSON"}
                  </Button>
                </div>
              </div>
              <div className="p-5 grid grid-cols-3 gap-5">
                {/* Categories */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Categories</p>
                    <Badge variant="outline" className="text-[9px] h-4">{result.reranked.problem.categories.length}/2</Badge>
                  </div>
                  <WeightedLabelList items={result.reranked.problem.categories} category="categories" />
                </div>
                {/* Keywords */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Keywords</p>
                    <Badge variant="outline" className="text-[9px] h-4">{result.reranked.problem.keywords.length}/10</Badge>
                  </div>
                  <WeightedLabelList items={result.reranked.problem.keywords} category="keywords" />
                </div>
                {/* Tags */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tags</p>
                    <Badge variant="outline" className="text-[9px] h-4">{result.reranked.problem.tags.length}/5</Badge>
                  </div>
                  <WeightedLabelList items={result.reranked.problem.tags} category="tags" />
                </div>
              </div>
            </div>

            {/* ── Section 2: Wrong answers ── */}
            {result.reranked.wrong_answers.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">Wrong-Answer Labels</h2>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {result.reranked.wrong_answers.map((wa) => {
                    const choice = choices.find((c) => c.id === wa.answer_id);
                    const waRetrieval = result.retrieval_texts.wrong_answers.find((w) => w.answer_id === wa.answer_id);
                    return (
                      <div key={wa.answer_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-700">Choice {wa.answer_id}</span>
                            <span className="text-xs text-gray-600 font-medium">{choice?.text}</span>
                          </div>
                          {waRetrieval && (
                            <p className="text-[10px] text-gray-400 mt-0.5 leading-snug italic">{waRetrieval.text}</p>
                          )}
                        </div>
                        <div className="p-4 grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Keywords ({wa.keywords.length})</p>
                            <WeightedLabelList items={wa.keywords} />
                          </div>
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Tags ({wa.tags.length})</p>
                            <WeightedLabelList items={wa.tags} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Section 3: Retrieval details (collapsible) ── */}
            <Collapsible title={`Retrieval Details — ${result.retrieval.problem.keywords.length} keyword candidates, ${result.retrieval.problem.categories.length} category candidates, ${result.retrieval.problem.tags.length} tag candidates`}>
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Problem retrieval text</p>
                  <pre className="text-[10px] text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed border border-gray-100">{result.retrieval_texts.problem}</pre>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <CandidateTable candidates={result.retrieval.problem.categories} label="Categories" />
                  <CandidateTable candidates={result.retrieval.problem.keywords} label="Keywords" />
                  <CandidateTable candidates={result.retrieval.problem.tags} label="Tags" />
                </div>

                {result.retrieval.wrong_answers.map((wa) => {
                  const waText = result.retrieval_texts.wrong_answers.find((w) => w.answer_id === wa.answer_id);
                  return (
                    <div key={wa.answer_id} className="border-t border-gray-100 pt-3 space-y-2">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Wrong answer {wa.answer_id} retrieval text</p>
                      <pre className="text-[10px] text-gray-600 bg-gray-50 rounded p-2 whitespace-pre-wrap font-mono leading-relaxed border border-gray-100">{waText?.text}</pre>
                      <div className="grid grid-cols-2 gap-4">
                        <CandidateTable candidates={wa.keywords} label="Keywords" />
                        <CandidateTable candidates={wa.tags} label="Tags" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Collapsible>

            {/* ── Section 4: LLM debug (collapsible) ── */}
            <Collapsible title="LLM Debug — raw model output">
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Problem reranking response</p>
                  <pre className="text-[10px] text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed border border-gray-100 max-h-64 overflow-y-auto">
                    {(() => { try { return JSON.stringify(JSON.parse(result.raw_llm.problem), null, 2); } catch { return result.raw_llm.problem; } })()}
                  </pre>
                </div>
                {result.raw_llm.wrong_answers.map((wa) => (
                  <div key={wa.answer_id}>
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Wrong answer {wa.answer_id} response</p>
                    <pre className="text-[10px] text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed border border-gray-100 max-h-48 overflow-y-auto">
                      {(() => { try { return JSON.stringify(JSON.parse(wa.raw), null, 2); } catch { return wa.raw; } })()}
                    </pre>
                  </div>
                ))}
              </div>
            </Collapsible>
          </>
        )}
      </div>
    </div>
  );
}
