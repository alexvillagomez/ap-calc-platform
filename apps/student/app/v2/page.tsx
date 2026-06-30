"use client";

/**
 * /v2 — Lodera single-page Biology study app (WIRED).
 *
 * The pixel-perfect design from the static pass, now driven by the REAL MCAT
 * "Custom Practice" workflow: live taxonomy, controlled-randomness serve loop,
 * adaptive flashcard-vs-quiz, on-demand lessons/refreshers, pgvector related
 * topics, real progress + profile. Logic lives in ./useMcatPractice +
 * ./useOnDemand; this file only maps that data into the design's components.
 */

import { useEffect, useMemo, useState } from "react";
import { TopBar } from "./components/TopBar";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightPanel } from "./components/RightPanel";
import { QuestionView } from "./components/QuestionView";
import { FlashcardView } from "./components/FlashcardView";
import { LessonView } from "./components/LessonView";
import { HistoryNav, ForwardButton } from "./components/HistoryNav";
import { MyProgressModal, LessonModal, RefresherModal, ProfileMenu, type MasteryNode } from "./components/Modals";
import { LoginModal } from "./components/LoginModal";
import type { StudyMode } from "./mockData";
import { useMcatPractice, categoryLeafIds } from "./useMcatPractice";
import { useOnDemand } from "./useOnDemand";
import type { TaxonomyCategory } from "./api";

export type StudyView = "questions" | "flashcards" | "lessons";

// ── Taxonomy lookups ────────────────────────────────────────────────────────

/** keyword id → label, across every leaf in the loaded Biology taxonomy. */
function buildLabelIndex(cats: TaxonomyCategory[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const cat of cats) {
    for (const u of cat.umbrellas ?? []) {
      if (u.children.length > 0) for (const c of u.children) m.set(c.id, c.label);
      else m.set(u.id, u.label);
    }
  }
  return m;
}

const pctOf = (score?: number) => (typeof score === "number" ? Math.round(score * 100) : 0);
const avgPct = (vals: number[]) => (vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0);

/** Hierarchical mastery (category → umbrella → keyword) for the My-progress modal. */
function buildMasteryTree(cats: TaxonomyCategory[], scores: Map<string, number>): MasteryNode[] {
  return cats.map((cat) => {
    const umbrellas: MasteryNode[] = (cat.umbrellas ?? []).map((u) => {
      if (u.children && u.children.length > 0) {
        const kids: MasteryNode[] = u.children.map((c) => ({ id: c.id, name: c.label, pct: pctOf(scores.get(c.id)) }));
        return { id: u.id, name: u.label, pct: avgPct(kids.map((k) => k.pct)), children: kids };
      }
      return { id: u.id, name: u.label, pct: pctOf(scores.get(u.id)) };
    });
    const leafPcts = categoryLeafIds(cat).map((id) => pctOf(scores.get(id)));
    return { id: cat.id, name: cat.label, pct: avgPct(leafPcts), children: umbrellas };
  });
}

export default function V2StudyPage() {
  const practice = useMcatPractice();
  const {
    sessionId,
    categories,
    loadingCats,
    me,
    authRequired,
    authChecked,
    reloadAfterAuth,
    signOut,
    selectedLeafs,
    activeItem,
    itemPhase,
    currentKeywordId,
    selectedChoice,
    dontKnow,
    revealCorrect,
    explanation,
    errorMsg,
    scoresRef,
    history,
    viewIndex,
    atFrontier,
    setEnabledTypes,
    commitSelection,
    answerQuestion,
    skipToNext,
    gradeFlashcard,
    similarQuestion,
    next,
    serveNext,
    markRefresherUsed,
    goToIndex,
    goPrev,
    goForward,
  } = practice;

  const labelIndex = useMemo(() => buildLabelIndex(categories), [categories]);
  const currentLabel = currentKeywordId ? labelIndex.get(currentKeywordId) ?? null : null;

  // ── STUDY modes (multi-select) = the content TYPES in circulation ─────────────
  // They feed the serve loop; they do NOT navigate. The center view follows
  // whatever item is actually served (lessons circulate like questions/cards).
  const [modes, setModes] = useState<Record<StudyMode, boolean>>({
    Lessons: false,
    Flashcards: false,
    Questions: true,
  });

  useEffect(() => {
    // setEnabledTypes invalidates the look-ahead buffer + re-serves so a mode
    // change takes effect on the NEXT item (a same-value call — incl. this one on
    // mount — is a no-op there). See useMcatPractice.setEnabledTypes.
    setEnabledTypes({ lessons: modes.Lessons, flashcards: modes.Flashcards, quizzes: modes.Questions });
  }, [modes.Lessons, modes.Flashcards, modes.Questions, setEnabledTypes]);

  function toggleMode(mode: StudyMode) {
    setModes((prev) => {
      const nextModes = { ...prev, [mode]: !prev[mode] };
      if (!Object.values(nextModes).some(Boolean)) return prev; // keep at least one on
      return nextModes;
    });
  }

  // Center view is DERIVED from the served item, not from the mode toggles.
  const view: StudyView =
    activeItem?.kind === "flashcard" ? "flashcards" : activeItem?.kind === "lesson" ? "lessons" : "questions";

  // ── Staged boot reveal ───────────────────────────────────────────────────────
  // The serve loop shows the (restored) first item INSTANTLY, before taxonomy.
  // We hold the right toolbar back until the topic tree has loaded, then fade it
  // in — so the boot order is: question → categories (left) → right toolbar.
  const shellReady = categories.length > 0;
  const [rightReady, setRightReady] = useState(false);
  useEffect(() => {
    if (!shellReady) return;
    // One frame after categories land, reveal the right toolbar.
    const t = setTimeout(() => setRightReady(true), 80);
    return () => clearTimeout(t);
  }, [shellReady]);

  // ── Panels ─────────────────────────────────────────────────────────────────
  const [pOpen, setPOpen] = useState(true);
  const [rOpen, setROpen] = useState(true);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  function toggleExpand(key: string) {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Draggable panel widths ───────────────────────────────────────────────────
  const [leftWidth, setLeftWidth] = useState(268);
  const [rightWidth, setRightWidth] = useState(264);
  function startResize(e: React.MouseEvent, which: "left" | "right") {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === "left" ? leftWidth : rightWidth;
    const clamp = (n: number) => Math.max(210, Math.min(460, n));
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (which === "left") setLeftWidth(clamp(startW + dx));
      else setRightWidth(clamp(startW - dx));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  // ── Staged topic selection (draft → "Apply changes") ─────────────────────────
  // Toggling topics edits a DRAFT; the served pool only changes on Apply.
  const allBiologyLeaves = useMemo(() => categories.flatMap(categoryLeafIds), [categories]);
  const [draftLeafs, setDraftLeafs] = useState<Set<string>>(new Set());
  // Re-sync the draft whenever the committed selection changes (bootstrap default
  // + after each Apply, which sets selectedLeafs = draft → a no-op re-sync).
  useEffect(() => {
    setDraftLeafs(new Set(selectedLeafs));
  }, [selectedLeafs]);

  function toggleDraft(leafIds: string[]) {
    setDraftLeafs((prev) => {
      const allSelected = leafIds.length > 0 && leafIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) for (const id of leafIds) next.delete(id);
      else for (const id of leafIds) next.add(id);
      return next;
    });
  }
  const selectionDirty = useMemo(() => {
    if (draftLeafs.size !== selectedLeafs.size) return true;
    for (const id of draftLeafs) if (!selectedLeafs.has(id)) return true;
    return false;
  }, [draftLeafs, selectedLeafs]);
  function applyChanges() {
    commitSelection(draftLeafs);
  }

  // Reset per-item UI whenever a new item is served.
  useEffect(() => {
    setFlashFlipped(false);
    setServedLessonStep(1);
  }, [activeItem]);

  // ── Flashcard flip ───────────────────────────────────────────────────────────
  const [flashFlipped, setFlashFlipped] = useState(false);

  // ── Served-lesson stepper (a lesson circulated into the center) ───────────────
  const [servedLessonStep, setServedLessonStep] = useState(1);
  const servedLessonSteps = activeItem?.kind === "lesson" ? activeItem.data.micro_steps : [];
  function servedLessonBack() {
    setServedLessonStep((s) => Math.max(1, s - 1));
  }
  function servedLessonNext() {
    setServedLessonStep((s) => Math.min(Math.max(1, servedLessonSteps.length), s + 1));
  }

  // ── History view (re-viewing a past item read-only) ──────────────────────────
  const viewingEntry = history[viewIndex];
  const displayItem = atFrontier ? activeItem : viewingEntry?.item ?? null;
  const dotEntries = useMemo(() => history.map((h) => ({ outcome: h.outcome })), [history]);
  const canPrev = viewIndex > 0;
  // A past lesson gets its own stepper, reset whenever the viewed item changes.
  const [pastLessonStep, setPastLessonStep] = useState(1);
  useEffect(() => {
    setPastLessonStep(1);
  }, [viewIndex]);

  // ── On-demand content (lesson / refresher / related / prioritize) ────────────
  // The right panel + modals can target ANY keyword (current or a related one).
  const [targetKw, setTargetKw] = useState<string | null>(null);
  const targetKeyword = targetKw ?? currentKeywordId;
  const targetLabel = targetKeyword ? labelIndex.get(targetKeyword) ?? currentLabel : currentLabel;
  const onDemand = useOnDemand({
    sessionId,
    keywordId: currentKeywordId,
    keywordLabel: currentLabel,
    // Whenever a question or flashcard is on screen, silently warm the lesson +
    // refresher for its topic so the right-panel buttons / modals open instantly.
    prefetchContent: activeItem?.kind === "question" || activeItem?.kind === "flashcard",
  });

  // ── Lesson stepper (shared by inline view + modal) ───────────────────────────
  const [lessonStep, setLessonStep] = useState(1);
  const lessonSteps = onDemand.lesson?.micro_steps ?? [];
  const lessonEyebrow = (onDemand.lesson?.keyword_label ?? targetLabel ?? "Lesson").toUpperCase();
  const lessonTitle = lessonSteps.length ? `Step ${lessonStep} of ${Math.max(1, lessonSteps.length)}` : "Loading";

  function lessonBack() {
    setLessonStep((s) => Math.max(1, s - 1));
  }
  function lessonNext() {
    setLessonStep((s) => Math.min(Math.max(1, lessonSteps.length), s + 1));
  }

  // ── Overlays ─────────────────────────────────────────────────────────────────
  const [modal, setModal] = useState<null | "lesson" | "refresher">(null);
  const [pProgress, setPProgress] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  function openLesson(kw: string | null) {
    const id = kw ?? currentKeywordId;
    setTargetKw(id);
    setLessonStep(1);
    setModal("lesson");
    onDemand.loadLesson(id);
  }
  function openRefresher(kw: string | null) {
    const id = kw ?? currentKeywordId;
    setTargetKw(id);
    markRefresherUsed();
    setModal("refresher");
    onDemand.loadRefresher(id);
  }

  // ── Right panel feedback (local for now) ─────────────────────────────────────
  const [pRate, setPRate] = useState(0);
  const [reported, setReported] = useState(false);
  // Reset per-item feedback when the active item changes.
  useEffect(() => {
    setPRate(0);
    setReported(false);
  }, [activeItem]);

  // ── My progress + profile data ───────────────────────────────────────────────
  const mastery = useMemo(
    () => buildMasteryTree(categories, scoresRef.current),
    // recompute when progress modal opens or categories change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, pProgress]
  );
  const profileInitials = useMemo(() => {
    const u = me?.user;
    const name =
      u?.display_name || [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username || u?.email || "";
    return (
      name
        .split(/\s+/)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() ?? "")
        .join("") || "?"
    );
  }, [me]);

  // ── Question handlers (wrap the practice handlers + helper dock) ─────────────
  function onPick(idx: number) {
    answerQuestion(idx);
  }

  const answered = itemPhase === "revealed";

  // ── Display props: live frontier uses live state; a past item is read-only ────
  const displayQuestion = displayItem?.kind === "question" ? displayItem.data : null;
  const displayFlashcard = displayItem?.kind === "flashcard" ? displayItem.data : null;
  const displayLesson = displayItem?.kind === "lesson" ? displayItem.data : null;
  const qSelected = atFrontier ? selectedChoice : viewingEntry?.selectedIndex ?? null;
  const qReveal = atFrontier ? revealCorrect : displayQuestion?.correct_index ?? null;
  const qDontKnow = atFrontier ? dontKnow : viewingEntry?.dontKnow ?? false;
  const qAnswered = atFrontier ? answered : true;
  const qExplanation = atFrontier ? explanation : displayQuestion?.explanation ?? "";
  const pastKwLabel = viewingEntry?.keywordId ? labelIndex.get(viewingEntry.keywordId) ?? null : null;
  const flashTag = (atFrontier ? currentLabel : pastKwLabel) ?? "Flashcard";
  const lessonStepsForView = atFrontier ? servedLessonSteps : displayLesson?.micro_steps ?? [];
  const lessonStepForView = atFrontier ? servedLessonStep : pastLessonStep;
  const lessonTitleForView = lessonStepsForView.length
    ? `Step ${lessonStepForView} of ${Math.max(1, lessonStepsForView.length)}`
    : "Lesson";
  const lessonEyebrowForView = (
    (atFrontier ? currentLabel : displayLesson?.keyword_label ?? pastKwLabel) ?? "Lesson"
  ).toUpperCase();
  const pastLessonLen = displayLesson?.micro_steps.length ?? 1;

  // ── Auth FIRST ───────────────────────────────────────────────────────────────
  // Decide login before rendering anything. Until the getUser() pre-check
  // resolves, render nothing; if logged out, render ONLY the login/sign-up gate
  // (no study shell behind it).
  if (!authChecked) {
    return <div style={{ height: "100vh", background: "#f0eee9" }} />;
  }
  if (authRequired) {
    return (
      <div style={{ height: "100vh", background: "#f0eee9", position: "relative", overflow: "hidden" }}>
        <LoginModal onSuccess={reloadAfterAuth} />
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", overflow: "hidden", background: "#f0eee9", display: "flex" }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          color: "#171717",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <TopBar
          initials={profileInitials}
          onOpenProgress={() => setPProgress(true)}
          onToggleProfile={() => setProfileOpen((v) => !v)}
        />

        <div style={{ display: "flex", alignItems: "stretch", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <LeftSidebar
            open={pOpen}
            onToggle={() => setPOpen((v) => !v)}
            width={leftWidth}
            modes={modes}
            onToggleMode={toggleMode}
            categories={categories}
            selectedLeafs={draftLeafs}
            onToggleLeafs={toggleDraft}
            onSelectAll={() => setDraftLeafs(new Set(allBiologyLeaves))}
            onDeselectAll={() => setDraftLeafs(new Set())}
            onApply={applyChanges}
            dirty={selectionDirty}
            expandedTopics={expandedTopics}
            onToggleExpand={toggleExpand}
          />
          {pOpen && <ResizeHandle onMouseDown={(e) => startResize(e, "left")} />}

          <main
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              overflowY: "auto",
              padding: "28px 32px",
              background: "#fafafa",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Loading / error states — only at the live frontier */}
            {atFrontier && (loadingCats || itemPhase === "loading-next" || itemPhase === "loading-similar") && !activeItem && (
              <CenterStatus
                message={
                  itemPhase === "loading-similar"
                    ? "Generating a similar question…"
                    : loadingCats
                    ? "Loading your topics…"
                    : "Finding your next item…"
                }
                sub="The first item for a topic can take a few seconds to generate."
              />
            )}

            {atFrontier && itemPhase === "error" && !activeItem && (
              <CenterError message={errorMsg || "Failed to load the next item"} onRetry={() => serveNext(0)} />
            )}

            {/* Question — live frontier or read-only past re-view */}
            {displayQuestion && (
              <QuestionView
                question={displayQuestion}
                selectedChoice={qSelected}
                revealCorrect={qReveal}
                dontKnow={qDontKnow}
                answered={qAnswered}
                explanation={qExplanation}
                onPick={onPick}
                onSimilar={similarQuestion}
                onSkip={skipToNext}
                onNext={next}
                onForward={goForward}
                atFrontier={atFrontier}
                entries={dotEntries}
                viewIndex={viewIndex}
                onSelectDot={goToIndex}
                onPrev={goPrev}
                canPrev={canPrev}
              />
            )}

            {/* Flashcard — live or read-only past, with the shared history footer */}
            {displayFlashcard && (
              <>
                <FlashcardView
                  card={displayFlashcard}
                  tag={flashTag}
                  flipped={atFrontier ? flashFlipped : true}
                  onFlip={atFrontier ? () => setFlashFlipped((v) => !v) : () => {}}
                  onGrade={
                    atFrontier
                      ? (r) => {
                          setFlashFlipped(false);
                          gradeFlashcard(r);
                        }
                      : undefined
                  }
                  readOnly={!atFrontier}
                />
                <div style={{ width: "100%", maxWidth: 600, alignSelf: "center" }}>
                  <HistoryNav
                    entries={dotEntries}
                    viewIndex={viewIndex}
                    onSelect={goToIndex}
                    onPrev={goPrev}
                    canPrev={canPrev}
                    right={atFrontier ? null : <ForwardButton onClick={goForward} />}
                  />
                </div>
              </>
            )}

            {/* Lesson — live (circulated) or read-only past, with history footer */}
            {displayLesson && (
              <>
                <LessonView
                  steps={lessonStepsForView}
                  eyebrow={lessonEyebrowForView}
                  title={lessonTitleForView}
                  step={lessonStepForView}
                  loading={false}
                  onBack={atFrontier ? servedLessonBack : () => setPastLessonStep((s) => Math.max(1, s - 1))}
                  onNext={
                    atFrontier
                      ? servedLessonNext
                      : () => setPastLessonStep((s) => Math.min(Math.max(1, pastLessonLen), s + 1))
                  }
                  onTryQuestion={next}
                  readOnly={!atFrontier}
                />
                <div style={{ width: "100%", maxWidth: 760, alignSelf: "center" }}>
                  <HistoryNav
                    entries={dotEntries}
                    viewIndex={viewIndex}
                    onSelect={goToIndex}
                    onPrev={goPrev}
                    canPrev={canPrev}
                    right={atFrontier ? null : <ForwardButton onClick={goForward} />}
                  />
                </div>
              </>
            )}
            </div>
          </main>

          {/* Right toolbar — held back until the topic tree loads, then revealed
              (boot order: question → categories → right toolbar). */}
          {rightReady && rOpen && <ResizeHandle onMouseDown={(e) => startResize(e, "right")} />}
          {rightReady && (
            <RightPanel
              open={rOpen}
              onToggle={() => setROpen((v) => !v)}
              width={rightWidth}
              view={view}
              currentLabel={currentLabel}
              currentKeywordId={currentKeywordId}
              related={onDemand.related}
              prioritized={onDemand.prioritized}
              onTogglePriority={onDemand.togglePriority}
              rate={pRate}
              onRate={setPRate}
              reported={reported}
              onToggleReport={() => setReported((v) => !v)}
              onOpenLesson={openLesson}
              onOpenRefresher={openRefresher}
            />
          )}
        </div>

        {/* Overlays */}
        {profileOpen && <ProfileMenu me={me} onClose={() => setProfileOpen(false)} onSignOut={signOut} />}
        {modal === "lesson" && (
          <LessonModal
            steps={lessonSteps}
            eyebrow={lessonEyebrow}
            title={lessonTitle}
            loading={onDemand.lessonLoading}
            step={lessonStep}
            onBack={lessonBack}
            onNext={lessonNext}
            onClose={() => setModal(null)}
          />
        )}
        {modal === "refresher" && (
          <RefresherModal
            refresher={onDemand.refresher}
            loading={onDemand.refresherLoading}
            subtitle={targetLabel ?? "Quick refresher"}
            onClose={() => setModal(null)}
          />
        )}
        {pProgress && <MyProgressModal topics={mastery} onClose={() => setPProgress(false)} />}
      </div>
    </div>
  );
}

// ── Draggable column resize handle ──────────────────────────────────────────────
function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="ld-resize"
      title="Drag to resize"
      style={{
        flexShrink: 0,
        width: 6,
        cursor: "col-resize",
        background: "transparent",
        alignSelf: "stretch",
      }}
    />
  );
}

// ── On-brand center loading / error (inside the workspace card area) ────────────

function CenterStatus({ message, sub }: { message: string; sub?: string }) {
  return (
    <div
      style={{
        margin: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: 40,
        textAlign: "center",
      }}
    >
      <div style={{ position: "relative", width: 38, height: 38 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 9999, border: "4px solid #e0e7ff" }} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 9999,
            border: "4px solid #4f46e5",
            borderTopColor: "transparent",
            animation: "ldSpin 0.8s linear infinite",
          }}
        />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#404040" }}>{message}</div>
      {sub && <div style={{ fontSize: 12.5, color: "#a3a3a3", maxWidth: 320 }}>{sub}</div>}
    </div>
  );
}

function CenterError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        margin: "auto",
        maxWidth: 420,
        border: "1px solid #fecdd3",
        background: "#fff1f2",
        borderRadius: 14,
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 13.5, color: "#be123c", marginBottom: 14 }}>{message}</div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          height: 38,
          padding: "0 18px",
          border: "none",
          background: "#3b82f6",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 11,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
