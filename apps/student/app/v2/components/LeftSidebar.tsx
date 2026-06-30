"use client";

import type { CSSProperties } from "react";
import {
  SearchIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HelpCircleIcon,
} from "./icons";
import { STUDY_MODES, type StudyMode } from "../mockData";
import type { TaxonomyCategory } from "../api";
import { categoryLeafIds, umbrellaLeafIds } from "../useMcatPractice";

interface LeftSidebarProps {
  open: boolean;
  onToggle: () => void;
  /** Open-panel width (px) — driven by the draggable resize handle. */
  width: number;
  modes: Record<StudyMode, boolean>;
  onToggleMode: (mode: StudyMode) => void;
  /** Real Biology taxonomy (categories → umbrellas → in_depth children). */
  categories: TaxonomyCategory[];
  /** STAGED (draft) selected leaf keyword ids — applied via onApply. */
  selectedLeafs: Set<string>;
  /** Toggle a set of leaf ids (category / umbrella / single keyword). */
  onToggleLeafs: (leafIds: string[]) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  /** Commit the staged selection to the live serve pool. */
  onApply: () => void;
  /** True when the draft differs from the committed selection. */
  dirty: boolean;
  expandedTopics: Set<string>;
  onToggleExpand: (key: string) => void;
}

const modeOn: CSSProperties = {
  border: "1px solid #93c5fd",
  background: "#eff6ff",
  color: "#3730a3",
};
const modeOff: CSSProperties = {
  border: "1px solid #e5e5e5",
  background: "#fff",
  color: "#737373",
};

// ── Tri-state selection coloring ──────────────────────────────────────────────
// all children selected = BLUE · some-but-not-all = YELLOW · none = white.
type Tri = "all" | "partial" | "none";
function triState(leafIds: string[], selected: Set<string>): Tri {
  if (leafIds.length === 0) return "none";
  let n = 0;
  for (const id of leafIds) if (selected.has(id)) n++;
  if (n === 0) return "none";
  return n === leafIds.length ? "all" : "partial";
}
const TRI: Record<Tri, { bg: string; dot: string }> = {
  all: { bg: "#eff6ff", dot: "#4f46e5" },
  partial: { bg: "#fffbeb", dot: "#f59e0b" },
  none: { bg: "transparent", dot: "" },
};
function triText(state: Tri, base: string): string {
  if (state === "all") return "#3730a3";
  if (state === "partial") return "#b45309";
  return base;
}

export function LeftSidebar(props: LeftSidebarProps) {
  const {
    open,
    onToggle,
    width,
    modes,
    onToggleMode,
    categories,
    selectedLeafs,
    onToggleLeafs,
    onSelectAll,
    onDeselectAll,
    onApply,
    dirty,
    expandedTopics,
    onToggleExpand,
  } = props;

  if (!open) {
    return (
      <aside
        style={{
          width: 62,
          flexShrink: 0,
          borderRight: "1px solid #e5e5e5",
          padding: "16px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          background: "#fafafa",
        }}
      >
        <button type="button" onClick={onToggle} className="ld-railicon" title="Expand" style={railBtn}>
          <ChevronsRightIcon size={19} />
        </button>
        <div style={{ width: 26, height: 1, background: "#e5e5e5", margin: "4px 0" }} />
        <div className="ld-railicon" style={{ ...railBtn, color: "#737373" }}>
          <SearchIcon size={19} />
        </div>
        <div
          style={{
            color: "#4f46e5",
            width: 38,
            height: 38,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#eff6ff",
            cursor: "pointer",
          }}
        >
          <HelpCircleIcon size={19} />
        </div>
      </aside>
    );
  }

  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        borderRight: "1px solid #e5e5e5",
        padding: "14px 13px",
        display: "flex",
        flexDirection: "column",
        gap: 11,
        background: "#fff",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      {/* STUDY mode switcher (multi-select) */}
      <div>
        <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 5 }}>
          <span>STUDY</span>
          <span className="ld-tipwrap" style={{ display: "inline-flex", color: "#c4c4c4", cursor: "help" }}>
            <HelpCircleIcon size={12} />
            <span className="ld-tip">
              The kinds of content in your practice rotation. Toggle Lessons, Flashcards, and Questions to choose what gets
              mixed in.
            </span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {STUDY_MODES.map((label) => {
            const on = modes[label];
            return (
              <button
                key={label}
                type="button"
                onClick={() => onToggleMode(label)}
                aria-pressed={on}
                style={{
                  ...(on ? modeOn : modeOff),
                  flex: 1,
                  minWidth: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "6px 5px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 9999,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 11px",
          border: "1px solid #e5e5e5",
          borderRadius: 11,
          background: "#fafafa",
          color: "#a3a3a3",
        }}
      >
        <SearchIcon size={14} />
        <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>Type anything…</span>
      </div>

      {/* TOPICS header + collapse */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", color: "#a3a3a3" }}>TOPICS</span>
        <button
          type="button"
          onClick={onToggle}
          className="ld-iconbtn"
          title="Hide panel"
          style={{
            border: "1px solid #e5e5e5",
            background: "#fff",
            color: "#525252",
            width: 28,
            height: 28,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <ChevronsLeftIcon size={17} />
        </button>
      </div>

      {/* Select all / Deselect all */}
      <div style={{ display: "flex", gap: 6, padding: "0 2px" }}>
        <button type="button" onClick={onSelectAll} style={bulkBtn}>
          Select all
        </button>
        <button type="button" onClick={onDeselectAll} style={bulkBtn}>
          Deselect all
        </button>
      </div>

      {/* Accordion — categories (topics) → umbrellas (subtopics) → keywords */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minHeight: 0, overflowY: "auto" }}>
        {categories.map((cat) => {
          const catLeaves = categoryLeafIds(cat);
          const state = triState(catLeaves, selectedLeafs);
          const tri = TRI[state];
          const isOpen = expandedTopics.has(cat.id);
          const umbrellas = cat.umbrellas ?? [];
          return (
            <div key={cat.id}>
              <div
                className="ld-tl-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  borderRadius: 9,
                  ...(state !== "none" ? { background: tri.bg } : {}),
                }}
              >
                <button
                  type="button"
                  onClick={() => onToggleLeafs(catLeaves)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    padding: "6px 9px",
                    textAlign: "left",
                    fontSize: 12,
                    fontWeight: state !== "none" ? 600 : 400,
                    color: triText(state, "#404040"),
                  }}
                >
                  {state !== "none" && (
                    <span style={{ width: 6, height: 6, borderRadius: 9999, background: tri.dot, flexShrink: 0 }} />
                  )}
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{cat.label}</span>
                </button>
                {umbrellas.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggleExpand(cat.id)}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      padding: "6px 9px",
                      display: "flex",
                      alignItems: "center",
                    }}
                    aria-label={isOpen ? "Collapse subtopics" : "Expand subtopics"}
                  >
                    {isOpen ? (
                      <ChevronDownIcon size={14} stroke="#a3a3a3" />
                    ) : (
                      <ChevronRightIcon size={14} stroke="#c4c4c4" />
                    )}
                  </button>
                )}
              </div>
              {isOpen && umbrellas.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "1px 0 4px 16px" }}>
                  {umbrellas.map((u) => {
                    const leaves = umbrellaLeafIds(u);
                    const uState = triState(leaves, selectedLeafs);
                    const uTri = TRI[uState];
                    const children = u.children ?? [];
                    const uOpen = expandedTopics.has(u.id);
                    return (
                      <div key={u.id}>
                        <div
                          className="ld-tl-row"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            borderRadius: 7,
                            ...(uState !== "none" ? { background: uTri.bg } : {}),
                          }}
                        >
                          <div
                            onClick={() => onToggleLeafs(leaves)}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 11.5,
                              color: triText(uState, "#525252"),
                              fontWeight: uState !== "none" ? 600 : 400,
                              padding: "5px 8px",
                              cursor: "pointer",
                            }}
                          >
                            {uState !== "none" && (
                              <span style={{ width: 5, height: 5, borderRadius: 9999, background: uTri.dot, flexShrink: 0 }} />
                            )}
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {u.label}
                            </span>
                          </div>
                          {children.length > 0 && (
                            <button
                              type="button"
                              onClick={() => onToggleExpand(u.id)}
                              style={{
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                padding: "5px 8px",
                                display: "flex",
                                alignItems: "center",
                              }}
                              aria-label={uOpen ? "Collapse keywords" : "Expand keywords"}
                            >
                              {uOpen ? (
                                <ChevronDownIcon size={13} stroke="#a3a3a3" />
                              ) : (
                                <ChevronRightIcon size={13} stroke="#c4c4c4" />
                              )}
                            </button>
                          )}
                        </div>
                        {uOpen && children.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "1px 0 3px 14px" }}>
                            {children.map((child) => {
                              const leafSelected = selectedLeafs.has(child.id);
                              return (
                                <div
                                  key={child.id}
                                  className="ld-tl-row"
                                  onClick={() => onToggleLeafs([child.id])}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: 11,
                                    color: leafSelected ? "#3730a3" : "#737373",
                                    fontWeight: leafSelected ? 600 : 400,
                                    padding: "4px 8px",
                                    borderRadius: 7,
                                    cursor: "pointer",
                                    ...(leafSelected ? { background: "#eff6ff" } : {}),
                                  }}
                                >
                                  {leafSelected && (
                                    <span
                                      style={{
                                        width: 5,
                                        height: 5,
                                        borderRadius: 9999,
                                        background: "#4f46e5",
                                        flexShrink: 0,
                                      }}
                                    />
                                  )}
                                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {child.label}
                                  </span>
                                </div>
                              );
                            })}
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

      {/* Apply staged selection */}
      <button
        type="button"
        onClick={onApply}
        disabled={!dirty}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          width: "100%",
          height: 38,
          border: "none",
          background: dirty ? "#3b82f6" : "#f0f0f0",
          color: dirty ? "#fff" : "#a3a3a3",
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 11,
          boxShadow: dirty ? "0 2px 8px 0 rgba(59,130,246,.30)" : "none",
          cursor: dirty ? "pointer" : "default",
        }}
      >
        {dirty ? "Apply changes" : "Up to date"}
      </button>
    </aside>
  );
}

const labelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  color: "#a3a3a3",
  margin: "0 2px 7px",
};

const bulkBtn: CSSProperties = {
  flex: 1,
  padding: "5px 0",
  border: "1px solid #e5e5e5",
  background: "#fff",
  color: "#525252",
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 8,
  cursor: "pointer",
};

const railBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#737373",
  width: 38,
  height: 38,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};
