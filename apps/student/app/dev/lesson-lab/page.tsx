"use client";

/**
 * Dev-only Content Lab — live-tune the math + MCAT generation SYSTEM PROMPTS for
 * all four content types: LESSON | QUIZ | FLASHCARDS | REFRESHER.
 *
 * Pick a keyword, choose a content type, edit that type's system prompt, choose a
 * model, Generate (always FRESH, never cached), and compare the fresh output
 * against the stored/live one in the REAL student renderers.
 *
 * The editor shows the UNIVERSAL prompt for the slot (saved override if any, else
 * the source-code constant). "Save as universal" persists it to `prompt_overrides`
 * so EVERY generation path (students included) resolves override ?? source — that
 * is the universal prompt change. "Reset to source" deletes the override. The
 * content write-back button (replace stored lesson / deck / refresher, or save
 * quiz to the pool) is a separate, per-keyword write.
 *
 * Gated by the API (LESSON_LAB_ENABLED) — routes 404 in production.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import MathLessonView, { type LessonData } from "@/components/math/MathLessonView";
import MathText from "@/components/mcat/MathText";

type LabSystem = "math" | "mcat";
type LabCourse = "precalc" | "calc_ab";
type LabContentType = "lesson" | "quiz" | "flashcards" | "refresher";

const CONTENT_TYPES: { key: LabContentType; label: string }[] = [
  { key: "lesson", label: "Lesson" },
  { key: "quiz", label: "Quiz" },
  { key: "flashcards", label: "Flashcards" },
  { key: "refresher", label: "Refresher" },
];

// Write-back button label + nothing for quiz-has-no-stored handling.
const SAVE_LABEL: Record<LabContentType, string> = {
  lesson: "Replace stored lesson →",
  flashcards: "Replace deck →",
  refresher: "Replace refresher →",
  quiz: "Save to pool →",
};
const HAS_STORED: Record<LabContentType, boolean> = {
  lesson: true,
  flashcards: true,
  refresher: true,
  quiz: false,
};

interface LabKeyword {
  id: string;
  label: string;
  tier: string | null;
  parent_keyword_id: string | null;
  order_index: number | null;
}
/** One umbrella (topic) with its in_depth children, for the collapsible tree. */
interface KeywordNode {
  kw: LabKeyword;
  children: LabKeyword[];
}
/** Group the server's already-curriculum-ordered keywords into umbrella → children. */
function buildKeywordTree(keywords: LabKeyword[]): KeywordNode[] {
  const nodes: KeywordNode[] = [];
  const umb = new Map<string, KeywordNode>();
  for (const k of keywords) {
    if (k.tier === "umbrella") {
      const node: KeywordNode = { kw: k, children: [] };
      nodes.push(node);
      umb.set(k.id, node);
    } else if (k.parent_keyword_id && umb.has(k.parent_keyword_id)) {
      umb.get(k.parent_keyword_id)!.children.push(k);
    } else {
      nodes.push({ kw: k, children: [] }); // top-level keyword with no umbrella
    }
  }
  return nodes;
}
interface LabCategory {
  category_id: string;
  category_label: string;
  order_index: number;
  section: string | null;
  keywords: LabKeyword[];
}

const SECTION_LABEL: Record<string, string> = {
  biology: "Biology",
  psych_soc: "Psych / Soc",
  chemistry: "Chemistry",
  physics: "Physics",
};
interface Neighbor {
  label: string;
  relation: "earlier" | "later";
}
interface LabQuizItem {
  stem: string;
  choices: string[];
  correct_index: number;
  explanation: string;
  difficulty: number;
}
interface LabFlashcardItem {
  front: string;
  back: string;
}
type LabPreview =
  | { kind: "lesson"; micro_steps: unknown }
  | { kind: "quiz"; questions: LabQuizItem[] }
  | { kind: "flashcards"; flashcards: LabFlashcardItem[] }
  | { kind: "refresher"; rule_latex: string; example_latex: string };

interface StoredContent {
  preview: LabPreview | null;
  model: string | null;
  generated_at: string | null;
}
interface KeywordContext {
  keyword_id: string;
  keyword_label: string;
  description: string;
  examples: string | null;
  tier: string | null;
  neighbors: Neighbor[];
  blueprint: unknown;
  stored: StoredContent | null;
}

function lessonData(microSteps: unknown, kwId: string, label: string): LessonData {
  return {
    id: `lab-${kwId}`,
    keyword_id: kwId,
    keyword_label: label,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    micro_steps: (microSteps as any) ?? [],
    generated_at: new Date(0).toISOString(),
  };
}

/** Render any content-type preview with the real renderers. */
function ContentPreview({
  preview,
  kwId,
  label,
  keyBase,
}: {
  preview: LabPreview | null;
  kwId: string;
  label: string;
  keyBase: string;
}) {
  if (!preview) return <p className="text-sm text-neutral-400">none</p>;

  if (preview.kind === "lesson") {
    return (
      <MathLessonView
        key={`${keyBase}-${kwId}`}
        sessionId="lab"
        keywordId={kwId}
        keywordLabel={label}
        onComplete={() => {}}
        onSkip={() => {}}
        initialLesson={lessonData(preview.micro_steps, kwId, label)}
      />
    );
  }

  if (preview.kind === "quiz") {
    if (preview.questions.length === 0)
      return <p className="text-sm text-neutral-400">No questions generated.</p>;
    return (
      <div className="space-y-4">
        {preview.questions.map((q, qi) => (
          <div key={`${keyBase}-${qi}`} className="rounded-lg border border-neutral-200 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold text-neutral-400">Q{qi + 1}</span>
              <span className="text-[10px] text-neutral-400">difficulty {q.difficulty?.toFixed?.(2) ?? q.difficulty}</span>
            </div>
            <div className="text-sm text-neutral-900 mb-2">
              <MathText>{q.stem}</MathText>
            </div>
            <ul className="space-y-1 mb-2">
              {q.choices.map((c, ci) => (
                <li
                  key={ci}
                  className={`text-sm px-2 py-1 rounded ${
                    ci === q.correct_index
                      ? "bg-green-50 text-green-800 border border-green-200"
                      : "text-neutral-600"
                  }`}
                >
                  <span className="text-[10px] mr-1 text-neutral-400">{String.fromCharCode(65 + ci)}.</span>
                  <MathText>{c}</MathText>
                </li>
              ))}
            </ul>
            <div className="text-xs text-neutral-500 border-t border-neutral-100 pt-2">
              <span className="font-semibold">Solution: </span>
              <MathText>{q.explanation}</MathText>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (preview.kind === "flashcards") {
    if (preview.flashcards.length === 0)
      return <p className="text-sm text-neutral-400">No cards generated (keyword may have nothing memorizable).</p>;
    return (
      <div className="space-y-2">
        <p className="text-[10px] text-neutral-400">{preview.flashcards.length} cards</p>
        {preview.flashcards.map((c, i) => (
          <div key={`${keyBase}-${i}`} className="rounded-lg border border-neutral-200 overflow-hidden text-sm">
            <div className="px-3 py-2 bg-neutral-50 text-neutral-900">
              <MathText>{c.front}</MathText>
            </div>
            <div className="px-3 py-2 text-neutral-600 border-t border-neutral-100">
              <MathText>{c.back}</MathText>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // refresher
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-[10px] font-semibold text-neutral-400 uppercase">Rule</p>
        <div className="text-neutral-900">
          <MathText>{preview.rule_latex}</MathText>
        </div>
      </div>
      {preview.example_latex && (
        <div>
          <p className="text-[10px] font-semibold text-neutral-400 uppercase">Example</p>
          <div className="text-neutral-700">
            <MathText>{preview.example_latex}</MathText>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LessonLabPage() {
  const [system, setSystem] = useState<LabSystem>("math");
  const [course, setCourse] = useState<LabCourse>("precalc");
  const [contentType, setContentType] = useState<LabContentType>("lesson");

  const [categories, setCategories] = useState<LabCategory[]>([]);
  const [models, setModels] = useState<string[]>(["gpt-5.4-mini"]);
  const [model, setModel] = useState("gpt-5.4-mini");

  // Source defaults (from code) per content type + the overview prompt.
  const [defaultPrompts, setDefaultPrompts] = useState<Record<LabContentType, string>>({
    lesson: "",
    quiz: "",
    flashcards: "",
    refresher: "",
  });
  const [overviewDefault, setOverviewDefault] = useState("");
  // Saved UNIVERSAL prompt per slot (override ?? source default) — what generation
  // actually uses right now. Keyed: lesson | lesson_overview | quiz | flashcards | refresher.
  const [savedPrompts, setSavedPrompts] = useState<Record<string, string>>({});
  // Editable prompts (the textarea), same keys. Seeded from savedPrompts.
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [disabled, setDisabled] = useState(false);

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedUmb, setExpandedUmb] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ id: string; label: string; tier: string | null } | null>(null);

  const [ctx, setCtx] = useState<KeywordContext | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);

  const [gen, setGen] = useState<{ preview: LabPreview; raw: unknown } | null>(null);
  const [assembledPrompt, setAssembledPrompt] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [genCounter, setGenCounter] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [promptMsg, setPromptMsg] = useState<string | null>(null);

  // ── Load keyword picker + default prompts on system/course change ──
  const loadKeywords = useCallback(async () => {
    setCategories([]);
    setSelected(null);
    setCtx(null);
    setGen(null);
    const params = new URLSearchParams({ system, course });
    const res = await fetch(`/api/dev/lesson-lab/keywords?${params}`);
    if (!res.ok) {
      setDisabled(res.status === 404);
      return;
    }
    const data = await res.json();
    setCategories(data.categories ?? []);
    setModels(data.models ?? ["gpt-5.4-mini"]);
    setModel((m) => (data.models?.includes(m) ? m : data.default_model ?? "gpt-5.4-mini"));
    const dp = (data.default_prompts ?? {}) as Record<LabContentType, string>;
    const ov = data.default_overview_prompt ?? dp.lesson ?? "";
    const overrides = (data.override_prompts ?? {}) as Record<string, string>;
    setDefaultPrompts({
      lesson: dp.lesson ?? "",
      quiz: dp.quiz ?? "",
      flashcards: dp.flashcards ?? "",
      refresher: dp.refresher ?? "",
    });
    setOverviewDefault(ov);
    // Effective universal prompt = saved override if present, else source default.
    const saved: Record<string, string> = {
      lesson: overrides.lesson ?? dp.lesson ?? "",
      lesson_overview: overrides.lesson_overview ?? ov,
      quiz: overrides.quiz ?? dp.quiz ?? "",
      flashcards: overrides.flashcards ?? dp.flashcards ?? "",
      refresher: overrides.refresher ?? dp.refresher ?? "",
    };
    setSavedPrompts(saved);
    setPrompts({ ...saved });
  }, [system, course]);

  useEffect(() => {
    loadKeywords();
  }, [loadKeywords]);

  // ── Load per-keyword context (stored item for THIS content type + scope) ──
  const loadContext = useCallback(
    async (id: string) => {
      setCtx(null);
      setCtxLoading(true);
      const params = new URLSearchParams({ system, keywordId: id, contentType });
      const res = await fetch(`/api/dev/lesson-lab/context?${params}`);
      setCtxLoading(false);
      if (res.ok) setCtx(await res.json());
    },
    [system, contentType]
  );

  const selectKeyword = useCallback(
    (id: string, label: string, tier: string | null) => {
      setSelected({ id, label, tier });
      setGen(null);
      setAssembledPrompt("");
      setGenError(null);
      setSaveMsg(null);
      loadContext(id);
    },
    [loadContext]
  );

  // Re-fetch the stored item (and clear the generation) when the content type
  // changes while a keyword is selected — stored differs per content type.
  useEffect(() => {
    setGen(null);
    setAssembledPrompt("");
    setSaveMsg(null);
    setPromptMsg(null);
    if (selected) loadContext(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentType]);

  // Which prompt is active: umbrella lessons use the overview prompt (math only).
  const overviewMode = system === "math" && contentType === "lesson" && selected?.tier === "umbrella";
  const promptKey = overviewMode ? "lesson_overview" : contentType;
  const activePrompt = prompts[promptKey] ?? "";
  const activeSaved = savedPrompts[promptKey] ?? ""; // current UNIVERSAL prompt
  const activeDefault = overviewMode ? overviewDefault : defaultPrompts[contentType]; // source constant
  const promptDirty = activePrompt !== activeSaved; // unsaved edits in the textarea
  const isOverride = activeSaved !== activeDefault; // universal differs from source
  const setActivePrompt = useCallback(
    (v: string) => setPrompts((p) => ({ ...p, [promptKey]: v })),
    [promptKey]
  );

  // Save the textarea as the UNIVERSAL prompt for this slot — all generation uses it.
  const saveAsUniversal = useCallback(async () => {
    setSavingPrompt(true);
    setPromptMsg(null);
    try {
      const res = await fetch(`/api/dev/lesson-lab/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_prompt",
          system,
          contentType,
          overview: overviewMode,
          systemPrompt: activePrompt,
        }),
      });
      if (res.ok) {
        setSavedPrompts((p) => ({ ...p, [promptKey]: activePrompt }));
        setPromptMsg("Universal prompt saved ✓ — all generation now uses it.");
      } else {
        const d = await res.json().catch(() => ({}));
        setPromptMsg(`Save failed: ${d.error ?? "unknown"}`);
      }
    } catch (e) {
      setPromptMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setSavingPrompt(false);
    }
  }, [system, contentType, overviewMode, activePrompt, promptKey]);

  // Revert the slot to its SOURCE constant: reset the textarea, and if a saved
  // override exists, delete it so the universal prompt reverts to code.
  const resetToSource = useCallback(async () => {
    setActivePrompt(activeDefault);
    if (!isOverride) return;
    setSavingPrompt(true);
    setPromptMsg(null);
    try {
      const res = await fetch(`/api/dev/lesson-lab/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset_prompt",
          system,
          contentType,
          overview: overviewMode,
        }),
      });
      if (res.ok) {
        setSavedPrompts((p) => ({ ...p, [promptKey]: activeDefault }));
        setPromptMsg("Reverted to source default ✓.");
      } else {
        const d = await res.json().catch(() => ({}));
        setPromptMsg(`Reset failed: ${d.error ?? "unknown"}`);
      }
    } catch (e) {
      setPromptMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setSavingPrompt(false);
    }
  }, [setActivePrompt, activeDefault, isOverride, system, contentType, overviewMode, promptKey]);

  const generate = useCallback(async () => {
    if (!selected) return;
    setGenerating(true);
    setGenError(null);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/dev/lesson-lab/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          system,
          contentType,
          keywordId: selected.id,
          systemPrompt: activePrompt,
          model,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.detail || data.error || "Generation failed");
      } else {
        setGen({ preview: data.preview, raw: data.raw });
        setAssembledPrompt(data.assembled_user_prompt ?? "");
        setGenCounter((c) => c + 1);
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Network error");
    } finally {
      setGenerating(false);
    }
  }, [selected, system, contentType, activePrompt, model]);

  // Assemble the FULL prompt (system + user) WITHOUT calling the model — shows
  // exactly what the model receives, including scope/outline/neighbors/difficulty.
  const previewPrompt = useCallback(async () => {
    if (!selected) return;
    setPreviewing(true);
    setGenError(null);
    try {
      const res = await fetch(`/api/dev/lesson-lab/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          system,
          contentType,
          keywordId: selected.id,
          systemPrompt: activePrompt,
          model,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.detail || data.error || "Preview failed");
      } else {
        setAssembledPrompt(data.assembled_user_prompt ?? "");
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Network error");
    } finally {
      setPreviewing(false);
    }
  }, [selected, system, contentType, activePrompt, model]);

  const saveContent = useCallback(async () => {
    if (!selected || !gen) return;
    const verb =
      contentType === "quiz"
        ? `Save these ${(gen.preview.kind === "quiz" && gen.preview.questions.length) || ""} question(s) to the pool for "${selected.label}"?`
        : `Replace the stored ${contentType} for "${selected.label}" with this generation?`;
    if (!confirm(verb)) return;
    setSaveMsg(null);
    const res = await fetch(`/api/dev/lesson-lab/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        system,
        contentType,
        keywordId: selected.id,
        raw: gen.raw,
        model,
      }),
    });
    if (res.ok) {
      setSaveMsg(contentType === "quiz" ? "Saved to pool ✓" : "Saved ✓ — students now get this.");
      if (HAS_STORED[contentType]) loadContext(selected.id);
    } else {
      const d = await res.json().catch(() => ({}));
      setSaveMsg(`Save failed: ${d.error ?? "unknown"}`);
    }
  }, [selected, gen, system, contentType, model, loadContext]);

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((c) => ({
        ...c,
        keywords: c.keywords.filter(
          (k) => k.label.toLowerCase().includes(q) || k.id.toLowerCase().includes(q)
        ),
      }))
      .filter((c) => c.keywords.length > 0);
  }, [categories, search]);

  const isExpanded = (catId: string) => (search.trim() ? true : expanded.has(catId));
  const toggleCat = (catId: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(catId)) n.delete(catId);
      else n.add(catId);
      return n;
    });
  // When searching, expand every umbrella so all matches are visible.
  const isUmbExpanded = (umbId: string) => (search.trim() ? true : expandedUmb.has(umbId));
  const toggleUmb = (umbId: string) =>
    setExpandedUmb((s) => {
      const n = new Set(s);
      if (n.has(umbId)) n.delete(umbId);
      else n.add(umbId);
      return n;
    });

  const renderKwButton = (k: LabKeyword) => (
    <button
      key={k.id}
      onClick={() => selectKeyword(k.id, k.label, k.tier)}
      className={`w-full text-left px-2 py-1 rounded text-xs leading-snug ${
        selected?.id === k.id ? "bg-brand-500 text-white" : "text-neutral-600 hover:bg-neutral-100"
      }`}
      title={k.id}
    >
      {k.order_index === -1 && (
        <span className={`mr-1 text-[9px] font-semibold ${selected?.id === k.id ? "text-white/80" : "text-amber-500"}`}>
          intro
        </span>
      )}
      {k.label}
    </button>
  );

  if (disabled) {
    return (
      <div className="max-w-2xl mx-auto p-10 text-center">
        <h1 className="text-xl font-semibold text-neutral-900">Content Lab is disabled</h1>
        <p className="mt-2 text-sm text-neutral-500">
          This tool only runs in local/dev. Set <code>LESSON_LAB_ENABLED=1</code> to enable it elsewhere.
        </p>
      </div>
    );
  }

  const storedPreview = ctx?.stored?.preview ?? null;

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="max-w-[1400px] mx-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold">🧪 Content Lab</h1>
          <span className="text-xs text-neutral-400">dev-only · live prompt tuning</span>

          <div className="ml-auto flex items-center gap-2">
            {/* Content-type toggle */}
            <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden text-sm">
              {CONTENT_TYPES.map((ct) => (
                <button
                  key={ct.key}
                  onClick={() => setContentType(ct.key)}
                  className={`px-3 py-1.5 ${contentType === ct.key ? "bg-emerald-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-100"}`}
                >
                  {ct.label}
                </button>
              ))}
            </div>
            {/* System toggle */}
            <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden text-sm">
              {(["math", "mcat"] as LabSystem[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSystem(s)}
                  className={`px-3 py-1.5 ${system === s ? "bg-brand-500 text-white" : "bg-white text-neutral-600 hover:bg-neutral-100"}`}
                >
                  {s === "math" ? "Math" : "MCAT"}
                </button>
              ))}
            </div>
            {/* Course toggle (math only) */}
            {system === "math" && (
              <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden text-sm">
                {(["precalc", "calc_ab"] as LabCourse[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCourse(c)}
                    className={`px-3 py-1.5 ${course === c ? "bg-neutral-800 text-white" : "bg-white text-neutral-600 hover:bg-neutral-100"}`}
                  >
                    {c === "precalc" ? "Precalc" : "Calc AB"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* ── Keyword picker ── */}
          <aside className="bg-white rounded-xl border border-neutral-200 p-3 h-[calc(100vh-90px)] overflow-auto">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keywords…"
              className="w-full mb-3 px-3 py-2 text-sm rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {filteredCategories.length === 0 && (
              <p className="text-xs text-neutral-400 px-1">Loading keywords…</p>
            )}
            <div className="space-y-1">
              {filteredCategories.map((cat, ci) => {
                // Section divider when the section changes (MCAT only).
                const prevSection = ci > 0 ? filteredCategories[ci - 1].section : null;
                const showSection = !!cat.section && cat.section !== prevSection;
                return (
                <div key={cat.category_id}>
                  {showSection && (
                    <p className="px-2 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      {SECTION_LABEL[cat.section!] ?? cat.section}
                    </p>
                  )}
                  <button
                    onClick={() => toggleCat(cat.category_id)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-neutral-100 flex items-center gap-1.5"
                  >
                    <span className="text-neutral-400 text-xs">{isExpanded(cat.category_id) ? "▾" : "▸"}</span>
                    <span className="text-xs font-semibold text-neutral-700 truncate">{cat.category_label}</span>
                    <span className="ml-auto text-[10px] text-neutral-400">{cat.keywords.length}</span>
                  </button>
                  {isExpanded(cat.category_id) && (
                    <div className="mt-0.5 space-y-0.5">
                      {buildKeywordTree(cat.keywords).map((node) => {
                        // Top-level keyword with no umbrella → render directly.
                        if (node.kw.tier !== "umbrella") return renderKwButton(node.kw);

                        const open = isUmbExpanded(node.kw.id);
                        const sel = selected?.id === node.kw.id;
                        return (
                          <div key={node.kw.id}>
                            <div className={`flex items-center rounded ${sel ? "bg-brand-500" : "hover:bg-neutral-100"}`}>
                              <button
                                onClick={() => toggleUmb(node.kw.id)}
                                disabled={node.children.length === 0}
                                className={`px-1.5 py-1 text-[11px] ${sel ? "text-white/80" : "text-neutral-400"} disabled:opacity-30`}
                                title={open ? "Collapse" : "Expand"}
                              >
                                {node.children.length ? (open ? "▾" : "▸") : "•"}
                              </button>
                              <button
                                onClick={() => selectKeyword(node.kw.id, node.kw.label, node.kw.tier)}
                                className={`flex-1 text-left pr-2 py-1 text-xs font-semibold truncate ${sel ? "text-white" : "text-neutral-700"}`}
                                title={node.kw.id}
                              >
                                {node.kw.label}
                                {node.children.length > 0 && (
                                  <span className={`ml-1 text-[9px] font-normal ${sel ? "text-white/70" : "text-neutral-400"}`}>
                                    {node.children.length}
                                  </span>
                                )}
                              </button>
                            </div>
                            {open && node.children.length > 0 && (
                              <div className="ml-3 border-l border-neutral-200 pl-1 py-0.5 space-y-0.5">
                                {node.children.map((child) => renderKwButton(child))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </aside>

          {/* ── Main ── */}
          <main className="space-y-4">
            {/* Prompt + controls */}
            <section className="bg-white rounded-xl border border-neutral-200 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                  {contentType} prompt
                  {overviewMode && <span className="ml-1 normal-case text-brand-600">· umbrella/topic</span>}
                </span>
                {/* Universal status: is the live prompt a custom override or the source constant? */}
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    isOverride
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-neutral-100 text-neutral-500 border border-neutral-200"
                  }`}
                  title={
                    isOverride
                      ? "A custom universal prompt is saved — all generation uses it."
                      : "No override saved — generation uses the source-code constant."
                  }
                >
                  universal · {isOverride ? "custom" : "source"}
                </span>
                {promptDirty && <span className="text-[10px] text-amber-600 font-semibold">unsaved edits</span>}
                <button
                  onClick={saveAsUniversal}
                  disabled={!promptDirty || savingPrompt}
                  className="text-xs font-semibold px-2.5 py-1 rounded border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                  title="Save this prompt as the universal default for every generation (students included)."
                >
                  {savingPrompt ? "Saving…" : "💾 Save as universal"}
                </button>
                <button
                  onClick={resetToSource}
                  disabled={savingPrompt || (activePrompt === activeDefault && !isOverride)}
                  className="text-xs px-2 py-1 rounded border border-neutral-300 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
                  title="Discard the override and revert this slot to its source-code constant."
                >
                  ↺ Reset to source
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="text-xs px-2 py-1.5 rounded-lg border border-neutral-300 bg-white"
                  >
                    {models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <button
                    onClick={previewPrompt}
                    disabled={!selected || previewing}
                    className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
                    title="Assemble the full prompt (system + user) sent to the model — no generation, no cost."
                  >
                    {previewing ? "Assembling…" : "🔍 Preview prompt"}
                  </button>
                  <button
                    onClick={generate}
                    disabled={!selected || generating}
                    className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40"
                  >
                    {generating ? "Generating…" : "Generate ▸"}
                  </button>
                </div>
              </div>
              <textarea
                value={activePrompt}
                onChange={(e) => setActivePrompt(e.target.value)}
                spellCheck={false}
                className="w-full h-48 px-3 py-2 text-xs font-mono leading-relaxed rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
                placeholder="Select a keyword to load the default prompt…"
              />
              {promptMsg && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  {promptMsg}
                </p>
              )}
              {genError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {genError}
                </p>
              )}
            </section>

            {/* Read-only context */}
            {selected && (
              <details className="bg-white rounded-xl border border-neutral-200 p-3 text-xs" open>
                <summary className="cursor-pointer font-semibold text-neutral-600">
                  Full prompt & model input (read-only) — exactly what the model is sent
                </summary>
                <div className="mt-2 space-y-3">
                  {ctxLoading && <p className="text-neutral-400">Loading context…</p>}
                  {assembledPrompt ? (
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-neutral-500">
                          Full prompt — exactly what&apos;s sent to the model
                          <span className="ml-1 font-normal text-neutral-400">
                            ({isOverride ? "custom universal" : "source default"} prompt)
                          </span>
                        </p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${activePrompt}\n\n${assembledPrompt}`);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-300 text-neutral-600 hover:bg-neutral-100"
                        >
                          {copied ? "Copied ✓" : "Copy"}
                        </button>
                      </div>
                      <pre className="mt-1 text-[11px] text-neutral-700 bg-neutral-50 rounded-lg p-2 overflow-auto max-h-[40rem] whitespace-pre-wrap">
                        {`${activePrompt}\n\n${assembledPrompt}`}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-neutral-400">
                      Click <span className="font-semibold">🔍 Preview prompt</span> to assemble the full
                      prompt without generating.
                    </p>
                  )}
                </div>
              </details>
            )}

            {/* Compare: stored vs new */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Stored / live */}
              <section className="bg-white rounded-xl border border-neutral-200 p-4">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neutral-100">
                  <span className="text-xs font-bold text-neutral-700 uppercase tracking-wide">Stored (live)</span>
                  {ctx?.stored?.model && (
                    <span className="text-[10px] text-neutral-400">{ctx.stored.model}</span>
                  )}
                </div>
                {!selected ? (
                  <p className="text-sm text-neutral-400">Pick a keyword.</p>
                ) : !HAS_STORED[contentType] ? (
                  <p className="text-sm text-neutral-400">
                    Quizzes are drawn from the shared question pool — there is no single stored quiz per keyword. Generate on the right, then “Save to pool”.
                  </p>
                ) : storedPreview ? (
                  <ContentPreview preview={storedPreview} kwId={selected.id} label={selected.label} keyBase="stored" />
                ) : (
                  <p className="text-sm text-neutral-400">No stored {contentType} yet for this keyword.</p>
                )}
              </section>

              {/* New generation */}
              <section className="bg-white rounded-xl border border-brand-200 p-4">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neutral-100">
                  <span className="text-xs font-bold text-brand-600 uppercase tracking-wide">Generated (new)</span>
                  {gen != null && (
                    <>
                      <span className="text-[10px] text-neutral-400">{model}</span>
                      <button
                        onClick={saveContent}
                        className="ml-auto text-xs font-semibold px-3 py-1 rounded-lg bg-neutral-800 text-white hover:bg-neutral-700"
                      >
                        {SAVE_LABEL[contentType]}
                      </button>
                    </>
                  )}
                </div>
                {saveMsg && <p className="text-xs text-green-700 mb-2">{saveMsg}</p>}
                {gen != null && selected ? (
                  <ContentPreview
                    preview={gen.preview}
                    kwId={selected.id}
                    label={selected.label}
                    keyBase={`new-${genCounter}`}
                  />
                ) : (
                  <p className="text-sm text-neutral-400">
                    {generating ? "Generating…" : "Generate to preview here."}
                  </p>
                )}
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
