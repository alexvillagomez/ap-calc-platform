"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import MathText from "@/components/mcat/MathText";
import { XIcon, LightbulbIcon, ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, GridIcon, UserIcon, LogOutIcon, SettingsIcon, BookIcon, StarIcon } from "./icons";
import { LessonHeader, LessonProgress, LessonExample, LessonSkeleton } from "./LessonView";
import type { McatMicroStep, Refresher, MeResponse } from "../api";

/** Hierarchical mastery node: category → umbrella → keyword. */
export interface MasteryNode {
  id: string;
  name: string;
  pct: number;
  tier?: "Building" | "Solid" | "Strong";
  children?: MasteryNode[];
}

function Backdrop({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(23,23,23,.57)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 30,
        zIndex: 50,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ display: "contents" }}>
        {children}
      </div>
    </div>
  );
}

function CloseButton({ onClick, size = 32 }: { onClick: () => void; size?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: "#f5f5f5",
        width: size,
        height: size,
        borderRadius: 9,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: "#525252",
        flexShrink: 0,
      }}
    >
      <XIcon size={size === 30 ? 15 : 16} stroke="currentColor" strokeWidth={2.2} />
    </button>
  );
}

const modalShell: CSSProperties = {
  background: "#fff",
  borderRadius: 18,
  boxShadow: "0 24px 64px rgba(0,0,0,.28)",
  maxWidth: "100%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

/* ── My progress (hierarchical drill-down) ───────────────────────────────── */
export function MyProgressModal({ topics, onClose }: { topics: MasteryNode[]; onClose: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Backdrop onClose={onClose}>
      <div style={{ ...modalShell, width: 460, maxHeight: "90%" }}>
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 26px 14px" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#171717" }}>Your progress</div>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 26px 24px", display: "flex", flexDirection: "column", gap: 4 }}>
          {topics.length === 0 && (
            <div style={{ fontSize: 13, color: "#a3a3a3" }}>No progress yet — answer a few items to get started.</div>
          )}
          {topics.map((node) => (
            <ProgressRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggle} />
          ))}
        </div>
      </div>
    </Backdrop>
  );
}

function ProgressRow({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: MasteryNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  const kids = node.children ?? [];
  const hasKids = kids.length > 0;
  const isOpen = expanded.has(node.id);
  // Visual scale by depth: category (bold) → umbrella → keyword (lighter).
  const nameStyle: CSSProperties =
    depth === 0
      ? { fontSize: 13.5, color: "#171717", fontWeight: 600 }
      : depth === 1
      ? { fontSize: 12.5, color: "#404040", fontWeight: 500 }
      : { fontSize: 12, color: "#525252", fontWeight: 400 };

  return (
    <div>
      <div
        className={hasKids ? "ld-dock-row" : undefined}
        onClick={hasKids ? () => onToggle(node.id) : undefined}
        style={{
          padding: "7px 8px",
          paddingLeft: 8 + depth * 16,
          borderRadius: 9,
          cursor: hasKids ? "pointer" : "default",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {hasKids ? (
              isOpen ? (
                <ChevronDownIcon size={13} stroke="#a3a3a3" />
              ) : (
                <ChevronRightIcon size={13} stroke="#c4c4c4" />
              )
            ) : (
              <span style={{ width: 13, flexShrink: 0 }} />
            )}
            <span style={{ ...nameStyle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {node.tier && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".02em",
                  textTransform: "uppercase",
                  padding: "2px 6px",
                  borderRadius: 6,
                  color:
                    node.tier === "Strong" ? "#047857" : node.tier === "Solid" ? "#4338ca" : "#737373",
                  background:
                    node.tier === "Strong" ? "#d1fae5" : node.tier === "Solid" ? "#e0e7ff" : "#f5f5f5",
                }}
              >
                {node.tier}
              </span>
            )}
            <span style={{ fontSize: 11.5, color: "#737373", fontWeight: 600 }}>{node.pct}%</span>
          </span>
        </div>
        <div style={{ height: 5, borderRadius: 9999, background: "#f5f5f5", overflow: "hidden", marginLeft: 19 }}>
          <div
            style={{
              height: "100%",
              width: `${node.pct}%`,
              borderRadius: 9999,
              background:
                node.pct >= 80 ? "linear-gradient(to right,#34d399,#10b981)" : "linear-gradient(to right,#60a5fa,#4f46e5)",
            }}
          />
        </div>
      </div>
      {hasKids && isOpen && (
        <div>
          {kids.map((child) => (
            <ProgressRow key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Lesson modal (stepped) ──────────────────────────────────────────────── */
interface LessonModalProps {
  steps: McatMicroStep[];
  eyebrow: string;
  title: string;
  loading: boolean;
  step: number;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}
export function LessonModal({ steps, eyebrow, title, loading, step, onBack, onNext, onClose }: LessonModalProps) {
  const total = Math.max(1, steps.length);
  const data = steps[step - 1];
  const isLast = step >= total;

  return (
    <Backdrop onClose={onClose}>
      <div style={{ ...modalShell, width: 720, maxHeight: "92%" }}>
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "24px 28px 14px" }}>
          <div style={{ minWidth: 0 }}>
            <LessonHeader eyebrow={eyebrow} title={title} />
          </div>
          <CloseButton onClick={onClose} size={30} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 28px 26px" }}>
        <LessonProgress step={step} total={total} />
        {loading || !data ? (
          <LessonSkeleton />
        ) : (
          <>
            <div className="ld-serif" style={{ fontSize: 16, lineHeight: 1.65, color: "#171717" }}>
              <MathText>{data.explanation_latex}</MathText>
            </div>
            {data.example_latex ? <LessonExample example={data.example_latex} /> : null}
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            height: 46,
            border: "none",
            background: "#3b82f6",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 13,
            boxShadow: "0 2px 8px 0 rgba(59,130,246,.28)",
            cursor: "pointer",
          }}
        >
          Try a question
        </button>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20 }}>
          <button type="button" onClick={onBack} disabled={step <= 1} style={{ ...modalBack, opacity: step <= 1 ? 0.45 : 1 }}>
            <ArrowLeftIcon size={16} />
            Back
          </button>
          {isLast ? (
            <button type="button" onClick={onClose} style={modalFinish}>
              Finish lesson
              <CheckIcon size={16} stroke="currentColor" strokeWidth={2.4} />
            </button>
          ) : (
            <button type="button" onClick={onNext} style={modalNext}>
              Next
              <ArrowRightIcon size={16} />
            </button>
          )}
        </div>
        </div>
      </div>
    </Backdrop>
  );
}

/* ── Refresher modal ─────────────────────────────────────────────────────── */
export function RefresherModal({
  refresher,
  loading,
  subtitle,
  onClose,
}: {
  refresher: Refresher | null;
  loading: boolean;
  subtitle: string;
  onClose: () => void;
}) {
  // Real refreshers are terse newline-separated bullets in rule_latex.
  const rules = (refresher?.rule_latex ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <Backdrop onClose={onClose}>
      <div style={{ ...modalShell, width: 600, maxHeight: "90%" }}>
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 26px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: "#eff6ff",
                color: "#4f46e5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <LightbulbIcon size={17} stroke="currentColor" />
            </span>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#171717" }}>Refresher</div>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 26px 24px" }}>
        <div style={{ fontSize: 12.5, color: "#737373", marginBottom: 16 }}>{subtitle}</div>
        {loading ? (
          <LessonSkeleton />
        ) : rules.length === 0 ? (
          <div style={{ fontSize: 13, color: "#a3a3a3" }}>No quick refresher available for this topic.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {rules.map((rule, i) => (
              <div key={i} style={{ display: "flex", gap: 11 }}>
                <span style={{ flexShrink: 0, color: "#4f46e5", fontWeight: 700 }}>•</span>
                <span className="ld-serif" style={{ fontSize: 14, lineHeight: 1.55, color: "#404040" }}>
                  <MathText>{rule}</MathText>
                </span>
              </div>
            ))}
            {refresher?.example_latex ? (
              <div style={{ marginTop: 6, border: "1px solid #dbeafe", background: "#f5f9ff", borderRadius: 11, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".07em", color: "#4f46e5", marginBottom: 6 }}>EXAMPLE</div>
                <div className="ld-serif" style={{ fontSize: 14, lineHeight: 1.55, color: "#1e293b" }}>
                  <MathText>{refresher.example_latex}</MathText>
                </div>
              </div>
            ) : null}
          </div>
        )}
        </div>
      </div>
    </Backdrop>
  );
}

/* ── Profile dropdown ────────────────────────────────────────────────────── */
export function ProfileMenu({
  me,
  onClose,
  onSignOut,
  onOpenSettings,
  subject = "MCAT",
}: {
  me: MeResponse | null;
  onClose: () => void;
  onSignOut: () => void;
  /** Open the section-scoped settings overlay (import past progress, etc.). */
  onOpenSettings?: () => void;
  /** Current portal — drives the "<subject> settings" label. */
  subject?: string;
}) {
  const u = me?.user;
  const name =
    u?.display_name ||
    [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
    u?.username ||
    u?.email ||
    "Your account";
  const email = u?.email ?? "";
  const initials =
    (name || "?")
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 60 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 64,
          right: 22,
          width: 252,
          background: "#fff",
          border: "1px solid #e5e5e5",
          borderRadius: 14,
          boxShadow: "0 16px 48px rgba(0,0,0,.18)",
          padding: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 4px 12px" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 9999,
              background: "linear-gradient(135deg,#38bdf8,#6366f1)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 600,
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#171717" }}>{name}</div>
            <div style={{ fontSize: 12, color: "#737373", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {email}
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: "#f0f0f0", margin: "0 -14px 8px" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <MenuRow href="/mcat" icon={<GridIcon size={16} stroke="#4f46e5" />} label="Select course" weight={600} />
          {onOpenSettings && (
            <MenuRow
              onClick={() => { onClose(); onOpenSettings(); }}
              icon={<SettingsIcon size={16} stroke="#4f46e5" />}
              label={`${subject} settings`}
              weight={600}
            />
          )}
          <MenuRow href="/profile" icon={<UserIcon size={16} stroke="#737373" />} label="Account settings" weight={500} />
        </div>
        <div style={{ height: 1, background: "#f0f0f0", margin: "8px -14px" }} />
        <MenuRow onClick={onSignOut} icon={<LogOutIcon size={16} stroke="#e11d48" />} label="Sign out" color="#e11d48" weight={600} />
      </div>
    </div>
  );
}

/* ── Section-scoped settings (import past progress) ──────────────────────── */
export function SettingsModal({
  subject = "MCAT",
  sectionLabel,
  onClose,
  onImportAnki,
  onSetConfidence,
}: {
  /** Portal label — "MCAT" or "Math". Drives the heading. */
  subject?: string;
  /** Current section within the portal (e.g. "Biology"). Optional. */
  sectionLabel?: string | null;
  onClose: () => void;
  /** Wired once the Anki import flow exists. */
  onImportAnki?: () => void;
  /** Wired once the manual confidence flow exists. */
  onSetConfidence?: () => void;
}) {
  return (
    <Backdrop onClose={onClose}>
      <div style={{ ...modalShell, width: 520 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "18px 20px",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
            <SettingsIcon size={18} stroke="#4f46e5" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#171717" }}>{subject} settings</div>
              {sectionLabel && (
                <div style={{ fontSize: 12, color: "#737373" }}>
                  Bringing in progress for <strong style={{ color: "#4f46e5" }}>{sectionLabel}</strong>
                </div>
              )}
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* Bring-in-progress section */}
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: "#a3a3a3", textTransform: "uppercase" }}>
            Bring in past progress
          </div>

          <SettingsCard
            icon={<BookIcon size={18} stroke="#4f46e5" />}
            title="Import an Anki deck"
            body="Upload an .apkg and we'll estimate how well you already know each topic from your review history. Your cards are never stored — only used to set your starting mastery."
            cta="Import .apkg"
            onClick={onImportAnki}
          />

          <SettingsCard
            icon={<StarIcon size={18} stroke="#4f46e5" />}
            title="How confident are you?"
            body="Rate how well you already know each topic and we'll start you there instead of from zero. We'll still check a few questions to confirm."
            cta="Rate my topics"
            onClick={onSetConfidence}
          />
        </div>
      </div>
    </Backdrop>
  );
}

function SettingsCard({
  icon,
  title,
  body,
  cta,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  cta: string;
  onClick?: () => void;
}) {
  const ready = typeof onClick === "function";
  return (
    <div
      style={{
        border: "1px solid #ececec",
        borderRadius: 13,
        padding: 14,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        background: "#fafafa",
      }}
    >
      <div style={{ marginTop: 1, flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#171717" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "#666", lineHeight: 1.5, marginTop: 3 }}>{body}</div>
        <button
          type="button"
          onClick={onClick}
          disabled={!ready}
          style={{
            marginTop: 11,
            height: 34,
            padding: "0 14px",
            borderRadius: 9,
            border: "none",
            background: ready ? "#4f46e5" : "#e5e5e5",
            color: ready ? "#fff" : "#a3a3a3",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: ready ? "pointer" : "default",
          }}
        >
          {ready ? cta : "Coming soon"}
        </button>
      </div>
    </div>
  );
}

function MenuRow({
  href,
  onClick,
  icon,
  label,
  color = "#404040",
  weight = 600,
}: {
  href?: string;
  onClick?: () => void;
  icon: ReactNode;
  label: string;
  color?: string;
  weight?: number;
}) {
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 11,
    width: "100%",
    padding: "9px 8px",
    border: "none",
    background: "transparent",
    borderRadius: 9,
    textAlign: "left",
    textDecoration: "none",
    cursor: "pointer",
    fontSize: 13,
    color,
    fontWeight: weight,
  };
  // Button when an action is given (e.g. Sign out), link otherwise.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="ld-dock-row" style={style}>
        {icon}
        {label}
      </button>
    );
  }
  return (
    <a href={href} className="ld-dock-row" style={style}>
      {icon}
      {label}
    </a>
  );
}

const modalBack: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 42,
  padding: "0 16px",
  border: "1px solid #e5e5e5",
  background: "#fff",
  color: "#525252",
  fontSize: 13.5,
  fontWeight: 600,
  borderRadius: 12,
  cursor: "pointer",
};
const modalNext: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 42,
  padding: "0 20px",
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 12,
  boxShadow: "0 2px 8px 0 rgba(59,130,246,.28)",
  cursor: "pointer",
};
const modalFinish: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 42,
  padding: "0 20px",
  border: "none",
  background: "#10b981",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 12,
  boxShadow: "0 2px 8px 0 rgba(16,185,129,.28)",
  cursor: "pointer",
};
