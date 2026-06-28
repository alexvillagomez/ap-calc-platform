"use client";

import { useState, useEffect, useCallback } from "react";
import { Preview } from "@/components/Preview";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Keyword = {
  id: string;
  label: string;
  tier: string;
  topic_id: string;
};

type CheckQuestion = {
  latex_content: string;
  choices: string[];
  correct_index: number;
  solution_latex: string;
};

type MicroStep = {
  step_index: number;
  has_check: boolean;
  explanation_latex: string;
  example_latex: string;
  check_question: CheckQuestion;
  hint_latex: string;
};

const LABELS = ["A", "B", "C", "D"];

const EXAMPLE_JSON: MicroStep[] = [
  {
    step_index: 1,
    has_check: false,
    explanation_latex: "\\text{A function } f(x) \\text{ is increasing on an interval if larger inputs give larger outputs.}",
    example_latex: "\\text{For } f(x) = x^2 \\text{, compare values:}\\n\\n$$f(1) = 1, \\quad f(2) = 4, \\quad f(3) = 9$$\\n\\n\\text{Since the outputs grow as } x \\text{ increases, } f \\text{ is increasing on } (0, \\infty).",
    check_question: { latex_content: "", choices: ["", "", "", ""], correct_index: 0, solution_latex: "" },
    hint_latex: "",
  },
  {
    step_index: 2,
    has_check: true,
    explanation_latex: "\\text{A function is decreasing when larger inputs give smaller outputs.}",
    example_latex: "\\text{For } f(x) = -x \\text{:}\\n\\n$$f(1) = -1, \\quad f(2) = -2$$\\n\\n\\text{Output decreases as } x \\text{ increases.}",
    check_question: {
      latex_content: "\\text{On which interval is } f(x) = x^2 \\text{ decreasing?}",
      choices: ["$(-\\infty, 0)$", "$(0, \\infty)$", "$(-\\infty, \\infty)$", "$(1, \\infty)$"],
      correct_index: 0,
      solution_latex: "\\text{For } x < 0 \\text{, larger inputs (closer to 0) give smaller outputs, so } f \\text{ decreases on } (-\\infty, 0).",
    },
    hint_latex: "\\text{Try plugging in } x = -2 \\text{ and } x = -1.",
  },
];

// ─── Step preview ─────────────────────────────────────────────────────────────

function StepPreview({ step, index }: { step: MicroStep; index: number }) {
  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Step {step.step_index ?? index + 1}
        </span>
        {step.has_check && (
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">has check</span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Explanation */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Explanation</p>
          <div className="bg-white border border-gray-100 rounded-xl p-4 ap-calc-preview text-sm leading-relaxed">
            <Preview latexContent={step.explanation_latex ?? ""} />
          </div>
        </div>

        {/* Example */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Example</p>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 ap-calc-preview text-sm leading-relaxed">
            <Preview latexContent={step.example_latex ?? ""} />
          </div>
        </div>

        {/* Check question */}
        {step.has_check && step.check_question?.latex_content && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Check Question</p>
            <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
              <div className="ap-calc-preview text-sm leading-relaxed">
                <Preview latexContent={step.check_question.latex_content} />
              </div>
              <div className="space-y-2">
                {step.check_question.choices?.map((choice, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm",
                      i === step.check_question.correct_index
                        ? "border-green-300 bg-green-50"
                        : "border-gray-200 bg-white"
                    )}
                  >
                    <span className={cn(
                      "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold",
                      i === step.check_question.correct_index ? "bg-green-500 text-white" : "bg-gray-100 text-gray-600"
                    )}>
                      {LABELS[i]}
                    </span>
                    <span className="ap-calc-preview flex-1">
                      <Preview latexContent={choice} />
                    </span>
                  </div>
                ))}
              </div>
              {step.check_question.solution_latex && (
                <div className="border-t border-gray-100 pt-3 space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Solution</p>
                  <div className="ap-calc-preview text-sm text-green-700">
                    <Preview latexContent={step.check_question.solution_latex} />
                  </div>
                </div>
              )}
              {step.hint_latex && (
                <div className="border-t border-gray-100 pt-3 space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Hint</p>
                  <div className="ap-calc-preview text-sm text-amber-700">
                    <Preview latexContent={step.hint_latex} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LessonsPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(true);
  const [selectedKeyword, setSelectedKeyword] = useState<string>("");
  const [jsonInput, setJsonInput] = useState(JSON.stringify(EXAMPLE_JSON, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedSteps, setParsedSteps] = useState<MicroStep[]>(EXAMPLE_JSON);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ ok?: boolean; error?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ ok?: boolean; deleted?: number; error?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [existingLesson, setExistingLesson] = useState<boolean | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);

  // Load keywords
  useEffect(() => {
    fetch("/api/learn/keywords")
      .then((r) => r.json())
      .then((data: { keywords?: Keyword[] }) => {
        setKeywords(data.keywords ?? []);
        setKeywordsLoading(false);
      })
      .catch(() => setKeywordsLoading(false));
  }, []);

  // Check if selected keyword already has a lesson
  useEffect(() => {
    if (!selectedKeyword) { setExistingLesson(null); return; }
    setLoadingExisting(true);
    setExistingLesson(null);
    fetch(`/api/learn/lesson/check?keyword_id=${encodeURIComponent(selectedKeyword)}`)
      .then((r) => r.json())
      .then((d: { exists?: boolean }) => { setExistingLesson(d.exists ?? false); setLoadingExisting(false); })
      .catch(() => setLoadingExisting(false));
  }, [selectedKeyword]);

  const handleJsonChange = useCallback((value: string) => {
    setJsonInput(value);
    setParseError(null);
    setUploadResult(null);
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setParseError("JSON must be a non-empty array of micro_steps");
        return;
      }
      setParsedSteps(parsed as MicroStep[]);
    } catch (e) {
      setParseError((e as Error).message);
    }
  }, []);

  async function handleUpload() {
    if (!selectedKeyword) { setUploadResult({ error: "Select a keyword first" }); return; }
    if (parseError || parsedSteps.length === 0) { setUploadResult({ error: "Fix JSON errors first" }); return; }

    setUploading(true);
    setUploadResult(null);
    try {
      const res = await fetch("/api/learn/lesson/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_id: selectedKeyword, micro_steps: parsedSteps }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      setUploadResult(data);
      if (data.ok) setExistingLesson(true);
    } catch {
      setUploadResult({ error: "Network error" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAll() {
    setDeleting(true);
    setDeleteResult(null);
    setConfirmDelete(false);
    try {
      const res = await fetch("/api/learn/lesson/delete-all", { method: "DELETE" });
      const data = await res.json() as { ok?: boolean; deleted?: number; error?: string };
      setDeleteResult(data);
      if (data.ok) setExistingLesson(false);
    } catch {
      setDeleteResult({ error: "Network error" });
    } finally {
      setDeleting(false);
    }
  }

  const selectedKw = keywords.find((k) => k.id === selectedKeyword);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Lesson Authoring</h1>
            <p className="text-sm text-gray-500 mt-0.5">Paste a micro_steps JSON, preview it, then upload for a keyword.</p>
          </div>
          <div className="flex items-center gap-3">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-600 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-50 transition-colors"
              >
                Delete all lessons
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-700 font-medium">Are you sure?</span>
                <button
                  onClick={handleDeleteAll}
                  disabled={deleting}
                  className="text-xs bg-red-600 text-white rounded-lg px-3 py-2 hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {deleting ? "Deleting…" : "Yes, delete all"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {deleteResult && (
          <div className={cn("rounded-lg px-4 py-3 text-sm", deleteResult.ok ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200")}>
            {deleteResult.ok ? `Deleted ${deleteResult.deleted} lesson(s).` : `Error: ${deleteResult.error}`}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Editor */}
          <div className="space-y-4">
            {/* Keyword selector */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Target Keyword</label>
              {keywordsLoading ? (
                <p className="text-sm text-gray-400">Loading keywords…</p>
              ) : (
                <select
                  value={selectedKeyword}
                  onChange={(e) => setSelectedKeyword(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— select a keyword —</option>
                  {keywords.map((kw) => (
                    <option key={kw.id} value={kw.id}>
                      {kw.label} ({kw.id})
                    </option>
                  ))}
                </select>
              )}
              {selectedKw && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="bg-gray-100 rounded px-2 py-0.5">{selectedKw.tier}</span>
                  <span>{selectedKw.topic_id}</span>
                  {loadingExisting ? (
                    <span className="text-gray-400">checking…</span>
                  ) : existingLesson === true ? (
                    <span className="bg-amber-100 text-amber-700 rounded px-2 py-0.5 font-medium">has existing lesson — will overwrite</span>
                  ) : existingLesson === false ? (
                    <span className="bg-green-100 text-green-700 rounded px-2 py-0.5 font-medium">no lesson yet</span>
                  ) : null}
                </div>
              )}
            </div>

            {/* JSON input */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">micro_steps JSON</label>
                <button
                  onClick={() => handleJsonChange(JSON.stringify(EXAMPLE_JSON, null, 2))}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Load example
                </button>
              </div>
              <textarea
                value={jsonInput}
                onChange={(e) => handleJsonChange(e.target.value)}
                rows={28}
                spellCheck={false}
                className={cn(
                  "w-full font-mono text-xs border rounded-xl p-3 resize-y focus:outline-none focus:ring-2 bg-gray-50",
                  parseError ? "border-red-300 focus:ring-red-400" : "border-gray-200 focus:ring-blue-500"
                )}
                placeholder="Paste your micro_steps JSON array here…"
              />
              {parseError && (
                <p className="text-xs text-red-600 font-mono">{parseError}</p>
              )}
              {!parseError && parsedSteps.length > 0 && (
                <p className="text-xs text-green-600">{parsedSteps.length} step{parsedSteps.length !== 1 ? "s" : ""} parsed</p>
              )}
            </div>

            {/* Upload button */}
            <div className="space-y-2">
              <button
                onClick={handleUpload}
                disabled={uploading || !!parseError || !selectedKeyword || parsedSteps.length === 0}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
              >
                {uploading ? "Uploading…" : "Approve & Upload Lesson"}
              </button>
              {uploadResult && (
                <div className={cn("rounded-lg px-4 py-3 text-sm", uploadResult.ok ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200")}>
                  {uploadResult.ok ? `Lesson uploaded for "${selectedKw?.label ?? selectedKeyword}".` : `Error: ${uploadResult.error}`}
                </div>
              )}
            </div>
          </div>

          {/* Right: Preview */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Preview — {parsedSteps.length} step{parsedSteps.length !== 1 ? "s" : ""}
              </h2>
              {selectedKw && (
                <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-lg font-medium">
                  {selectedKw.label}
                </span>
              )}
            </div>

            {parseError ? (
              <div className="bg-white rounded-2xl border border-red-200 p-8 text-center">
                <p className="text-sm text-red-500">Fix JSON errors to see preview</p>
              </div>
            ) : parsedSteps.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
                <p className="text-sm text-gray-400">No steps to preview</p>
              </div>
            ) : (
              <div className="space-y-4">
                {parsedSteps.map((step, i) => (
                  <StepPreview key={i} step={step} index={i} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
